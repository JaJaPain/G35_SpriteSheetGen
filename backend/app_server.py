import os
import sys
import json
import shutil
import subprocess
import base64
import numpy as np
import cv2
from PIL import Image
from fastapi import FastAPI, HTTPException, Body, BackgroundTasks, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Dict, Optional

# Define base paths
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(BACKEND_DIR)
PROCESSED_DIR = os.path.join(WORKSPACE_DIR, "ProcessedSprites")
BG_DIR = os.path.join(PROCESSED_DIR, "with_bg")
FRAMES_DIR = os.path.join(PROCESSED_DIR, "frames")
EXPORTS_DIR = os.path.join(PROCESSED_DIR, "exports")
PROCESSING_LOG = os.path.join(PROCESSED_DIR, "processing_log.json")
GENERATION_LOG = os.path.join(PROCESSED_DIR, "generation_log.json")

app = FastAPI(title="AI Sprite Animation Studio API")

# Enable CORS for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure directories exist
os.makedirs(PROCESSED_DIR, exist_ok=True)
os.makedirs(FRAMES_DIR, exist_ok=True)
os.makedirs(EXPORTS_DIR, exist_ok=True)

# Mount frames static files so frontend can load individual frames
if os.path.exists(FRAMES_DIR):
    app.mount("/frames", StaticFiles(directory=FRAMES_DIR), name="frames")
if os.path.exists(BG_DIR):
    app.mount("/with_bg", StaticFiles(directory=BG_DIR), name="with_bg")
if os.path.exists(EXPORTS_DIR):
    app.mount("/exports", StaticFiles(directory=EXPORTS_DIR), name="exports")

# Mount projects static directory
PROJECTS_DIR = os.path.join(WORKSPACE_DIR, "projects")
os.makedirs(PROJECTS_DIR, exist_ok=True)
app.mount("/projects", StaticFiles(directory=PROJECTS_DIR), name="projects")

@app.get("/")
def read_root():
    return {
        "message": "AI Sprite Animation Studio Backend API is running.",
        "frontend_url": "http://127.0.0.1:5173"
    }

class OffsetItem(BaseModel):
    frameIndex: int
    dx: int
    dy: int
    tolerance: Optional[int] = None
    override_color: Optional[List[int]] = None

class OffsetSaveRequest(BaseModel):
    offsets: List[OffsetItem]

class ExportRequest(BaseModel):
    tolerance: int = 15
    export_type: str = "spritesheet" # "spritesheet" or "sequence" or "both"
    padding: int = 0

class ProjectCreateRequest(BaseModel):
    name: str

class PromoteRequest(BaseModel):
    seed: int

@app.get("/api/sprites")
def get_sprites(project: Optional[str] = None):
    """Retrieve all processed sprites and their animation metadata."""
    if not project:
        if not os.path.exists(PROCESSING_LOG):
            return []
            
        try:
            with open(PROCESSING_LOG, 'r') as f:
                proc_data = json.load(f)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to read processing log: {e}")
            
        gen_data = {}
        if os.path.exists(GENERATION_LOG):
            try:
                with open(GENERATION_LOG, 'r') as f:
                    for item in json.load(f):
                        gen_data[item["filename"]] = item
            except Exception as e:
                print(f"Warning: Failed to read generation log: {e}")
                
        merged = []
        for p in proc_data:
            filename = p["filename"]
            gen_entry = gen_data.get(p["processed_filename"], {})
            sprite_name = os.path.splitext(p["processed_filename"])[0]
            sprite_frames_dir = os.path.join(FRAMES_DIR, sprite_name)
            
            has_frames = False
            frame_list = []
            offsets = []
            
            if os.path.exists(sprite_frames_dir):
                files = sorted([f for f in os.listdir(sprite_frames_dir) if f.startswith("frame_") and f.endswith(".png")])
                if files:
                    has_frames = True
                    frame_list = files
                    
                offsets_path = os.path.join(sprite_frames_dir, "offsets.json")
                if os.path.exists(offsets_path):
                    try:
                        with open(offsets_path, 'r') as f:
                            offsets = json.load(f).get("offsets", [])
                    except Exception as e:
                        print(f"Error reading offsets for {sprite_name}: {e}")
                        
            merged.append({
                "id": sprite_name,
                "original_filename": filename,
                "processed_filename": p["processed_filename"],
                "dominant_color": p["dominant_color"],
                "background_name": p["background_name"],
                "background_rgb": p["background_rgb"],
                "prompt": gen_entry.get("prompt", ""),
                "seed": gen_entry.get("seed", None),
                "video_path": gen_entry.get("video_path", ""),
                "status": gen_entry.get("status", "pending"),
                "verification": gen_entry.get("verification", None),
                "has_frames": has_frames,
                "frames": frame_list,
                "offsets": offsets,
                "frames_dir": f"ProcessedSprites/frames/{sprite_name}",
                "rejected_attempts": []
            })
            
        return merged

    # Project Pathway
    project_dir = os.path.join(WORKSPACE_DIR, "projects", project)
    proc_log = os.path.join(project_dir, "processing_log.json")
    gen_log = os.path.join(project_dir, "generation_log.json")
    seeds_meta_path = os.path.join(project_dir, "seeds_metadata.json")
    
    if not os.path.exists(proc_log):
        return []
        
    try:
        with open(proc_log, 'r') as f:
            proc_data = json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read processing log: {e}")
        
    # Load project seeds metadata
    project_seeds = {
        "good_seeds": {},
        "rejected_seeds": {}
    }
    if os.path.exists(seeds_meta_path):
        try:
            with open(seeds_meta_path, 'r') as f:
                project_seeds = json.load(f)
        except Exception as e:
            print(f"Warning: Failed to read project seeds metadata: {e}")
            
    # Load all attempts grouped by filename
    attempts_by_file = {}
    if os.path.exists(gen_log):
        try:
            with open(gen_log, 'r') as f:
                gen_list = json.load(f)
                for item in gen_list:
                    fn = item["filename"]
                    if fn not in attempts_by_file:
                        attempts_by_file[fn] = []
                    attempts_by_file[fn].append(item)
        except Exception as e:
            print(f"Warning: Failed to read generation log: {e}")
            
    merged = []
    for p in proc_data:
        filename = p["filename"]
        processed_filename = p["processed_filename"]
        sprite_name = os.path.splitext(processed_filename)[0]
        
        # Get all attempts from generation log for this file
        raw_attempts = attempts_by_file.get(processed_filename, [])
        
        # Load attempts details (frames, offsets, etc.)
        attempts_details = []
        for att in raw_attempts:
            seed = att["seed"]
            status = att.get("status", "pending")
            video_path = att.get("video_path", "")
            frames_dir_rel = att.get("frames_dir", "")
            
            # Check frames
            has_frames = False
            frame_list = []
            offsets = []
            if frames_dir_rel:
                sprite_frames_dir = os.path.join(WORKSPACE_DIR, frames_dir_rel)
                if os.path.exists(sprite_frames_dir):
                    files = sorted([f for f in os.listdir(sprite_frames_dir) if f.startswith("frame_") and f.endswith(".png")])
                    if files:
                        has_frames = True
                        frame_list = files
                    
                    # Load offsets if exist
                    offsets_path = os.path.join(sprite_frames_dir, "offsets.json")
                    if os.path.exists(offsets_path):
                        try:
                            with open(offsets_path, 'r') as f:
                                offsets = json.load(f).get("offsets", [])
                        except Exception:
                            pass
            
            good_seeds_list = project_seeds.get("good_seeds", {}).get(processed_filename, [])
            is_good = seed in good_seeds_list
            
            attempts_details.append({
                "seed": seed,
                "status": status,
                "video_path": video_path,
                "frames_dir": frames_dir_rel,
                "verification": att.get("verification"),
                "has_frames": has_frames,
                "frames": frame_list,
                "offsets": offsets,
                "is_good": is_good
            })
            
        # Get project-specific seeds metadata lists
        good_seeds = project_seeds.get("good_seeds", {}).get(processed_filename, [])
        rejected_seeds = project_seeds.get("rejected_seeds", {}).get(processed_filename, [])
        
        # Find active attempt for backwards compatibility
        active_att = None
        for att in attempts_details:
            if att["is_good"]:
                active_att = att
                break
        if not active_att:
            for att in attempts_details:
                if att["status"] == "verified":
                    active_att = att
                    break
        if not active_att and attempts_details:
            active_att = attempts_details[0]
            
        seed_val = active_att["seed"] if active_att else None
        status_val = active_att["status"] if active_att else "pending"
        video_path_val = active_att["video_path"] if active_att else ""
        frames_dir_val = active_att["frames_dir"] if active_att else ""
        verification_val = active_att["verification"] if active_att else None
        has_frames_val = active_att["has_frames"] if active_att else False
        frames_val = active_att["frames"] if active_att else []
        offsets_val = active_att["offsets"] if active_att else []
        
        # Build prompt from active attempt if available
        prompt_val = p.get("prompt", "")
        if active_att:
            # Look up raw prompt from gen_log
            for att_raw in raw_attempts:
                if att_raw["seed"] == active_att["seed"]:
                    prompt_val = att_raw.get("prompt", prompt_val)
                    break
        
        merged.append({
            "id": sprite_name,
            "original_filename": filename,
            "processed_filename": processed_filename,
            "dominant_color": p["dominant_color"],
            "background_name": p["background_name"],
            "background_rgb": p["background_rgb"],
            "attempts": attempts_details,
            "good_seeds": good_seeds,
            "rejected_seeds": rejected_seeds,
            # Backwards compatibility fields
            "prompt": prompt_val,
            "seed": seed_val,
            "status": status_val,
            "video_path": video_path_val,
            "frames_dir": frames_dir_val,
            "verification": verification_val,
            "has_frames": has_frames_val,
            "frames": frames_val,
            "offsets": offsets_val,
            "rejected_attempts": []
        })
        
    return merged

@app.get("/api/sprite/{sprite_name}/frames")
def get_sprite_frames(sprite_name: str):
    """Retrieve frame list and offsets for a specific sprite."""
    sprite_frames_dir = os.path.join(FRAMES_DIR, sprite_name)
    if not os.path.exists(sprite_frames_dir):
        raise HTTPException(status_code=404, detail="Sprite frames directory not found")
        
    files = sorted([f for f in os.listdir(sprite_frames_dir) if f.startswith("frame_") and f.endswith(".png")])
    
    offsets_path = os.path.join(sprite_frames_dir, "offsets.json")
    offsets = []
    if os.path.exists(offsets_path):
        try:
            with open(offsets_path, 'r') as f:
                offsets = json.load(f).get("offsets", [])
        except Exception as e:
            print(f"Error reading offsets: {e}")
            
    return {
        "sprite_name": sprite_name,
        "frames": files,
        "offsets": offsets
    }

@app.post("/api/sprite/{sprite_name}/save-offsets")
def save_offsets(sprite_name: str, payload: OffsetSaveRequest, project: Optional[str] = None, frames_dir: Optional[str] = None):
    """Save user-defined frame alignment offsets."""
    if project and frames_dir:
        sprite_frames_dir = os.path.join(WORKSPACE_DIR, frames_dir)
    else:
        sprite_frames_dir = os.path.join(FRAMES_DIR, sprite_name)
        
    if not os.path.exists(sprite_frames_dir):
        raise HTTPException(status_code=404, detail="Sprite frames directory not found")
        
    offsets_path = os.path.join(sprite_frames_dir, "offsets.json")
    try:
        with open(offsets_path, 'w') as f:
            json.dump({"offsets": [o.model_dump() for o in payload.offsets]}, f, indent=4)
        return {"status": "success", "message": f"Offsets saved to {offsets_path}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save offsets: {e}")

class SaveFrameRequest(BaseModel):
    image_data: str # Base64 data URL

@app.post("/api/sprite/{sprite_name}/frame/{frame_index}")
def save_frame(sprite_name: str, frame_index: int, payload: SaveFrameRequest, project: Optional[str] = None, frames_dir: Optional[str] = None):
    """Save edited frame image data (Base64 PNG) back to disk."""
    if project and frames_dir:
        sprite_frames_dir = os.path.join(WORKSPACE_DIR, frames_dir)
    else:
        sprite_frames_dir = os.path.join(FRAMES_DIR, sprite_name)
        
    if not os.path.exists(sprite_frames_dir):
        raise HTTPException(status_code=404, detail="Sprite frames directory not found")
        
    frame_files = sorted([f for f in os.listdir(sprite_frames_dir) if f.startswith("frame_") and f.endswith(".png")])
    if frame_index < 0 or frame_index >= len(frame_files):
        raise HTTPException(status_code=400, detail="Invalid frame index")
        
    frame_file_name = frame_files[frame_index]
    frame_path = os.path.join(sprite_frames_dir, frame_file_name)
    
    try:
        header, encoded = payload.image_data.split(",", 1)
        data = base64.b64decode(encoded)
        with open(frame_path, "wb") as f:
            f.write(data)
        return {"status": "success", "message": f"Frame {frame_index} saved to {frame_path}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save frame: {e}")

def apply_chroma_key(img_bgr, bg_rgb, tolerance):
    """Perform chroma keying to remove background color and make it transparent."""
    # Convert image to BGRA
    img_bgra = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2BGRA)
    
    # Target color in BGR
    bg_bgr = np.array([bg_rgb[2], bg_rgb[1], bg_rgb[0]], dtype=np.int32)
    
    # Calculate absolute difference
    diff = np.abs(img_bgra[:, :, :3].astype(np.int32) - bg_bgr)
    
    # Max difference across channels
    max_diff = np.max(diff, axis=2)
    
    # Soft keying threshold
    mask = max_diff < tolerance
    img_bgra[mask, 3] = 0
    
    # Smooth edges where keying is close
    transition_width = 8
    soft_mask = (max_diff >= tolerance) & (max_diff < tolerance + transition_width)
    if np.any(soft_mask):
        factors = (max_diff[soft_mask] - tolerance) / transition_width
        img_bgra[soft_mask, 3] = (img_bgra[soft_mask, 3] * factors).astype(np.uint8)
        
    return img_bgra

def translate_image(img, dx, dy):
    """Translate image by dx, dy, filling empty space with transparency."""
    rows, cols = img.shape[:2]
    M = np.float32([[1, 0, dx], [0, 1, dy]])
    # borderMode=cv2.BORDER_CONSTANT with value 0 ensures transparent background padding
    return cv2.warpAffine(img, M, (cols, rows), borderMode=cv2.BORDER_CONSTANT, borderValue=(0,0,0,0))

@app.post("/api/sprite/{sprite_name}/export")
def export_sprite(sprite_name: str, payload: ExportRequest, project: Optional[str] = None, frames_dir: Optional[str] = None):
    """Chroma keys background, applies translation offsets, and exports frames/spritesheet."""
    if project and frames_dir:
        sprite_frames_dir = os.path.join(WORKSPACE_DIR, frames_dir)
        project_dir = os.path.join(WORKSPACE_DIR, "projects", project)
        processing_log_path = os.path.join(project_dir, "processing_log.json")
        exports_dir_path = os.path.join(project_dir, "exports")
    else:
        sprite_frames_dir = os.path.join(FRAMES_DIR, sprite_name)
        processing_log_path = PROCESSING_LOG
        exports_dir_path = EXPORTS_DIR
        
    if not os.path.exists(sprite_frames_dir):
        raise HTTPException(status_code=404, detail="Sprite frames directory not found")
        
    # Get background color from processing log
    if not os.path.exists(processing_log_path):
        raise HTTPException(status_code=500, detail="Processing log not found")
        
    with open(processing_log_path, 'r') as f:
        proc_data = json.load(f)
        
    bg_rgb = None
    for p in proc_data:
        if os.path.splitext(p["processed_filename"])[0] == sprite_name:
            bg_rgb = p["background_rgb"]
            break
            
    if bg_rgb is None:
        # Fallback to top-left pixel color if not in log
        sample_frame_path = os.path.join(sprite_frames_dir, "frame_000.png")
        if os.path.exists(sample_frame_path):
            sample_img = cv2.imread(sample_frame_path)
            bg_rgb = [int(sample_img[0, 0, 2]), int(sample_img[0, 0, 1]), int(sample_img[0, 0, 0])]
        else:
            bg_rgb = [255, 255, 255] # Default fallback white
            
    # Load offsets
    offsets_path = os.path.join(sprite_frames_dir, "offsets.json")
    offsets_map = {}
    if os.path.exists(offsets_path):
        try:
            with open(offsets_path, 'r') as f:
                offsets_list = json.load(f).get("offsets", [])
                for o in offsets_list:
                    offsets_map[o["frameIndex"]] = o
        except Exception as e:
            print(f"Error reading offsets: {e}")
            
    frame_files = sorted([f for f in os.listdir(sprite_frames_dir) if f.startswith("frame_") and f.endswith(".png")])
    if not frame_files:
        raise HTTPException(status_code=400, detail="No frame images found to export")
        
    frames_dir_basename = os.path.basename(sprite_frames_dir)
    sprite_export_dir = os.path.join(exports_dir_path, frames_dir_basename)
    os.makedirs(sprite_export_dir, exist_ok=True)
    
    processed_frames = []
    
    # Step 1: Chroma Key and Translate
    for i, file_name in enumerate(frame_files):
        frame_path = os.path.join(sprite_frames_dir, file_name)
        img_bgr = cv2.imread(frame_path)
        
        # Check if there are overrides for this frame
        frame_override = offsets_map.get(i, {})
        
        # Determine background color to use
        override_color = frame_override.get("override_color") # [R, G, B]
        if override_color:
            frame_bg_rgb = override_color
        else:
            # Sample the top-left pixel
            pixel_bgr = img_bgr[0, 0]
            frame_bg_rgb = [int(pixel_bgr[2]), int(pixel_bgr[1]), int(pixel_bgr[0])]
            
        # Calculate local background color variance in the top 15 rows of the frame
        h, w = img_bgr.shape[:2]
        block_h = min(15, h)
        top_rows = img_bgr[0:block_h, :]
        
        # target_bgr is in BGR format
        if override_color:
            target_bgr = np.array([override_color[2], override_color[1], override_color[0]], dtype=np.int32)
        else:
            pixel_bgr = img_bgr[0, 0]
            target_bgr = np.array([pixel_bgr[0], pixel_bgr[1], pixel_bgr[2]], dtype=np.int32)
            
        diffs = np.abs(top_rows.astype(np.int32) - target_bgr)
        max_diffs = np.max(diffs, axis=2)
        local_variance = int(np.max(max_diffs))
        
        # Determine base tolerance
        base_tolerance = frame_override.get("tolerance")
        if base_tolerance is None:
            base_tolerance = payload.tolerance
            
        # Dynamic adaptive tolerance = base tolerance + local variance
        adaptive_tolerance = max(5, base_tolerance + local_variance)
        
        # Apply Chroma Key
        img_transparent = apply_chroma_key(img_bgr, frame_bg_rgb, adaptive_tolerance)
        
        # Apply offsets
        dx = frame_override.get("dx", 0)
        dy = frame_override.get("dy", 0)
        img_translated = translate_image(img_transparent, dx, dy)
        
        # Save transparent frame to export directory
        export_frame_path = os.path.join(sprite_export_dir, f"trans_frame_{i:03d}.png")
        cv2.imwrite(export_frame_path, img_translated)
        processed_frames.append(img_translated)
        
    # Step 2: Auto-crop to bounding box of all transparent frames combined to keep dimensions consistent
    bboxes = []
    for frame in processed_frames:
        # Find non-transparent bounding box
        alpha = frame[:, :, 3]
        pts = np.argwhere(alpha > 0)
        if pts.size > 0:
            y_min, x_min = pts.min(axis=0)
            y_max, x_max = pts.max(axis=0)
            bboxes.append((x_min, y_min, x_max, y_max))
            
    if bboxes:
        x_min = min(b[0] for b in bboxes)
        y_min = min(b[1] for b in bboxes)
        x_max = max(b[2] for b in bboxes)
        y_max = max(b[3] for b in bboxes)
        
        crop_w = x_max - x_min + 1
        crop_h = y_max - y_min + 1
        
        pad = payload.padding
        crop_w += 2 * pad
        crop_h += 2 * pad
        
        cropped_frames = []
        for frame in processed_frames:
            h, w = frame.shape[:2]
            canvas = np.zeros((crop_h, crop_w, 4), dtype=np.uint8)
            
            src_x1 = max(0, x_min - pad)
            src_y1 = max(0, y_min - pad)
            src_x2 = min(w, x_max + 1 + pad)
            src_y2 = min(h, y_max + 1 + pad)
            
            dst_x1 = max(0, pad - (x_min - src_x1))
            dst_y1 = max(0, pad - (y_min - src_y1))
            dst_x2 = dst_x1 + (src_x2 - src_x1)
            dst_y2 = dst_y1 + (src_y2 - src_y1)
            
            canvas[dst_y1:dst_y2, dst_x1:dst_x2] = frame[src_y1:src_y2, src_x1:src_x2]
            cropped_frames.append(canvas)
    else:
        cropped_frames = processed_frames
        crop_w, crop_h = processed_frames[0].shape[1], processed_frames[0].shape[0]
        
    export_paths = {}
    
    # Save cropped frame sequence
    sequence_dir = os.path.join(sprite_export_dir, "sequence")
    os.makedirs(sequence_dir, exist_ok=True)
    for idx, c_frame in enumerate(cropped_frames):
        cv2.imwrite(os.path.join(sequence_dir, f"frame_{idx:03d}.png"), c_frame)
        
    if project:
        export_paths["sequence"] = f"/projects/{project}/exports/{frames_dir_basename}/sequence"
    else:
        export_paths["sequence"] = f"/exports/{sprite_name}/sequence"
        
    # Zip the sequence folder
    zip_path = os.path.join(sprite_export_dir, f"{sprite_name}_sequence")
    shutil.make_archive(zip_path, 'zip', sequence_dir)
    
    if project:
        export_paths["zip"] = f"/projects/{project}/exports/{frames_dir_basename}/{sprite_name}_sequence.zip"
    else:
        export_paths["zip"] = f"/exports/{sprite_name}/{sprite_name}_sequence.zip"
        
    # Generate Sprite Sheet
    if payload.export_type in ["spritesheet", "both"]:
        num_frames = len(cropped_frames)
        spritesheet = np.zeros((crop_h, crop_w * num_frames, 4), dtype=np.uint8)
        for idx, c_frame in enumerate(cropped_frames):
            spritesheet[:, idx * crop_w : (idx + 1) * crop_w] = c_frame
            
        spritesheet_path = os.path.join(sprite_export_dir, f"{sprite_name}_spritesheet.png")
        cv2.imwrite(spritesheet_path, spritesheet)
        
        if project:
            export_paths["spritesheet"] = f"/projects/{project}/exports/{frames_dir_basename}/{sprite_name}_spritesheet.png"
        else:
            export_paths["spritesheet"] = f"/exports/{sprite_name}/{sprite_name}_spritesheet.png"
        
    return {
        "status": "success",
        "message": f"Export complete for {sprite_name}",
        "dimensions": {"width": int(crop_w), "height": int(crop_h)},
        "export_paths": export_paths
    }

pipeline_status = {}

def run_project_pipeline_task(project_name: str, mode: str = "initial", sprite_name: Optional[str] = None):
    pipeline_status[project_name] = "running"
    try:
        venv_python = sys.executable
        max_iterations = 5  # Safe loop limit
        
        for iteration in range(1, max_iterations + 1):
            print(f"\n--- Pipeline Loop Iteration {iteration}/{max_iterations} for Project {project_name} ---")
            
            # Step 1: Run generate_walk.py
            cmd_gen = [venv_python, "-u", "generate_walk.py", "--project", project_name, "--mode", mode]
            if sprite_name:
                cmd_gen.extend(["--sprite", sprite_name])
                
            print(f"Running: {' '.join(cmd_gen)}")
            gen_process = subprocess.Popen(
                cmd_gen,
                cwd=os.path.join(WORKSPACE_DIR, "backend"),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1
            )
            for line in gen_process.stdout:
                print(line, end='', flush=True)
            gen_process.wait()
            
            print(f"generate_walk.py completed. Return code: {gen_process.returncode}")
            if gen_process.returncode != 0:
                pipeline_status[project_name] = f"failed (generation error: {gen_process.returncode})"
                return
                
            # Step 2: Run verify_frames.py
            cmd_verify = [venv_python, "-u", "verify_frames.py", "--project", project_name]
            print(f"Running: {' '.join(cmd_verify)}")
            verify_process = subprocess.Popen(
                cmd_verify,
                cwd=os.path.join(WORKSPACE_DIR, "backend"),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1
            )
            for line in verify_process.stdout:
                print(line, end='', flush=True)
            verify_process.wait()
            
            print(f"verify_frames.py completed. Return code: {verify_process.returncode}")
            if verify_process.returncode != 0:
                pipeline_status[project_name] = f"failed (verification error: {verify_process.returncode})"
                return
                
            # Step 3: Check if we have met the target count of verified candidates
            if mode == "regen":
                # Regen mode generates exactly 3 attempts once, so we break immediately
                break
                
            # For initial mode, check if all directions have at least 6 verified candidates
            log_path = os.path.join(WORKSPACE_DIR, "projects", project_name, "generation_log.json")
            if not os.path.exists(log_path):
                break
                
            try:
                with open(log_path, 'r') as f:
                    log_data = json.load(f)
            except Exception:
                break
                
            # Group by filename and count passed
            passed_counts = {}
            for item in log_data:
                fn = item["filename"]
                verification = item.get("verification")
                if isinstance(verification, dict) and verification.get("passed", False):
                    passed_counts[fn] = passed_counts.get(fn, 0) + 1
                    
            # Check if all directions have at least 6 passed attempts
            proc_log_path = os.path.join(WORKSPACE_DIR, "projects", project_name, "processing_log.json")
            if not os.path.exists(proc_log_path):
                break
                
            try:
                with open(proc_log_path, 'r') as f:
                    proc_data = json.load(f)
            except Exception:
                break
                
            all_done = True
            for p in proc_data:
                fn = p["processed_filename"]
                # If a specific sprite was targeted, we only care about that one
                if sprite_name and fn != sprite_name:
                    continue
                count = passed_counts.get(fn, 0)
                if count < 6:
                    print(f"Sprite {fn} only has {count}/6 verified candidates. Needs another iteration.")
                    all_done = False
                    break
                    
            if all_done:
                print("All directions met target candidate counts. Pipeline complete!")
                break
                
        pipeline_status[project_name] = "idle"
    except Exception as e:
        print(f"Error running pipeline for {project_name}: {e}")
        pipeline_status[project_name] = f"failed ({str(e)})"

@app.get("/api/projects")
def get_projects():
    """List folders in projects directory."""
    projects_dir = os.path.join(WORKSPACE_DIR, "projects")
    if not os.path.exists(projects_dir):
        return []
    return [d for d in os.listdir(projects_dir) if os.path.isdir(os.path.join(projects_dir, d))]

@app.post("/api/projects/create")
def create_project(payload: ProjectCreateRequest):
    """Create project folders and process starter background sprites."""
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Project name cannot be empty")
    
    if any(c in name for c in ['/', '\\', '?', '%', '*', ':', '|', '"', '<', '>', '.']):
        raise HTTPException(status_code=400, detail="Invalid characters in project name")
        
    project_dir = os.path.join(WORKSPACE_DIR, "projects", name)
    if os.path.exists(project_dir):
        raise HTTPException(status_code=400, detail="Project already exists")
        
    dirs = ["source", "processed", "videos", "front", "back", "34front", "34back", "side", "rejected", "exports"]
    for d in dirs:
        os.makedirs(os.path.join(project_dir, d), exist_ok=True)
        
    test_sprites_dir = os.path.join(WORKSPACE_DIR, "TestSprites")
    results = []
    if os.path.exists(test_sprites_dir):
        for file in os.listdir(test_sprites_dir):
            if file.lower().endswith('.png'):
                src_path = os.path.join(test_sprites_dir, file)
                dest_path = os.path.join(project_dir, "source", file)
                shutil.copy2(src_path, dest_path)
                
                from process_backgrounds import process_sprite
                res = process_sprite(dest_path, os.path.join(project_dir, "processed"), autocrop=True)
                results.append(res)
                
        log_path = os.path.join(project_dir, "processing_log.json")
        with open(log_path, 'w') as f:
            json.dump(results, f, indent=4)
            
    return {"status": "success", "message": f"Project '{name}' created and seeded."}

@app.get("/api/projects/{project_name}/pipeline-status")
def get_pipeline_status(project_name: str):
    """Retrieve running status of the generator pipeline."""
    return {"status": pipeline_status.get(project_name, "idle")}

@app.post("/api/projects/{project_name}/run-pipeline")
def run_pipeline(project_name: str, background_tasks: BackgroundTasks, mode: str = "initial", sprite: Optional[str] = None):
    """Run generation & verification pipeline for project in background."""
    current_status = pipeline_status.get(project_name, "idle")
    if current_status == "running":
        return {"status": "already_running", "message": "Pipeline is already running."}
        
    background_tasks.add_task(run_project_pipeline_task, project_name, mode, sprite)
    return {"status": "started", "message": "Pipeline run started."}

def get_next_training_index(directory: str, prefix: str) -> int:
    """Find the next sequential index for a given class prefix in the directory."""
    os.makedirs(directory, exist_ok=True)
    max_idx = 0
    for filename in os.listdir(directory):
        if filename.startswith(prefix) and (filename.endswith(".mp4") or filename.endswith(".json")):
            # Remove prefix and extension to extract number
            base = os.path.splitext(filename)[0]
            num_part = base[len(prefix):].strip("_")
            try:
                val = int(num_part)
                if val > max_idx:
                    max_idx = val
            except ValueError:
                pass
    return max_idx + 1

def export_to_training_dataset(project_name: str, sprite_name: str, seed: int, status: str):
    """Export the accepted or rejected video and sidecar metadata JSON to the gemma training folders."""
    project_dir = os.path.join(WORKSPACE_DIR, "projects", project_name)
    gen_log_path = os.path.join(project_dir, "generation_log.json")
    
    if not os.path.exists(gen_log_path):
        print(f"[Training Export] Generation log not found for project: {project_name}")
        return

    try:
        with open(gen_log_path, 'r') as f:
            gen_log = json.load(f)
    except Exception as e:
        print(f"[Training Export] Error reading generation log: {e}")
        return

    # Find the attempt matching the sprite and seed
    attempt = None
    for item in gen_log:
        if item["filename"] == sprite_name and item["seed"] == seed:
            attempt = item
            break

    if not attempt:
        print(f"[Training Export] Attempt with seed {seed} not found in log for sprite {sprite_name}")
        return

    video_path_rel = attempt.get("video_path")
    if not video_path_rel:
        print(f"[Training Export] No video path recorded for seed {seed}")
        return

    video_path_abs = os.path.join(WORKSPACE_DIR, video_path_rel)
    if not os.path.exists(video_path_abs):
        print(f"[Training Export] Video file does not exist on disk: {video_path_abs}")
        return

    # Direction class mapping
    dir_mappings = {
        "front": "South_Facing_Walking",
        "back": "North_Facing_Walking",
        "34front": "South_East_34front_Walking",
        "34back": "North_East_34back_Walking",
        "side": "East_SideFacing_Walking"
    }
    direction = determine_direction(sprite_name)
    prefix = dir_mappings.get(direction, "South_Facing_Walking")

    # Set up training directories
    dest_dir = os.path.join(WORKSPACE_DIR, "projects", "gemma_training_data", status)
    os.makedirs(dest_dir, exist_ok=True)

    next_idx = get_next_training_index(dest_dir, prefix)
    dest_base = f"{prefix}_{next_idx:03d}"
    dest_video_path = os.path.join(dest_dir, f"{dest_base}.mp4")
    dest_json_path = os.path.join(dest_dir, f"{dest_base}.json")

    # Copy video
    try:
        shutil.copy2(video_path_abs, dest_video_path)
        print(f"[Training Export] Copied video to {dest_video_path}")
    except Exception as e:
        print(f"[Training Export] Failed to copy video file: {e}")
        return

    # Write metadata JSON
    metadata = {
        "project_name": project_name,
        "sprite_name": sprite_name,
        "direction": direction,
        "direction_label": prefix,
        "seed": seed,
        "prompt": attempt.get("prompt", ""),
        "status": status,
        "gemma_qc_verdict": attempt.get("verification")
    }

    try:
        with open(dest_json_path, 'w') as f:
            json.dump(metadata, f, indent=4)
        print(f"[Training Export] Wrote metadata to {dest_json_path}")
    except Exception as e:
        print(f"[Training Export] Failed to write sidecar metadata file: {e}")

@app.post("/api/projects/{project_name}/sprite/{sprite_name}/seed/{seed}/approve")
def approve_seed(project_name: str, sprite_name: str, seed: int):
    project_dir = os.path.join(WORKSPACE_DIR, "projects", project_name)
    seeds_meta_path = os.path.join(project_dir, "seeds_metadata.json")
    
    # 1. Update project metadata
    project_seeds = {"good_seeds": {}, "rejected_seeds": {}}
    if os.path.exists(seeds_meta_path):
        try:
            with open(seeds_meta_path, 'r') as f:
                project_seeds = json.load(f)
        except Exception:
            pass
            
    good_seeds = project_seeds.setdefault("good_seeds", {})
    sprite_good = good_seeds.setdefault(sprite_name, [])
    if seed not in sprite_good:
        sprite_good.append(seed)
        
    try:
        with open(seeds_meta_path, 'w') as f:
            json.dump(project_seeds, f, indent=4)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update project seeds: {e}")
        
    # 2. Update global registry
    global_seeds_path = os.path.join(WORKSPACE_DIR, "projects", "global_good_seeds.json")
    global_seeds = {"front": [], "back": [], "34front": [], "34back": [], "side": []}
    if os.path.exists(global_seeds_path):
        try:
            with open(global_seeds_path, 'r') as f:
                global_seeds = json.load(f)
        except Exception:
            pass
            
    direction = determine_direction(sprite_name)
    dir_seeds = global_seeds.setdefault(direction, [])
    if seed not in dir_seeds:
        dir_seeds.append(seed)
        
    try:
        with open(global_seeds_path, 'w') as f:
            json.dump(global_seeds, f, indent=4)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update global good seeds: {e}")
        
    # 3. Export a copy of the accepted video to training good folder
    export_to_training_dataset(project_name, sprite_name, seed, "good")

    return {"status": "success", "message": f"Seed {seed} approved globally."}

@app.post("/api/projects/{project_name}/sprite/{sprite_name}/seed/{seed}/reject")
def reject_seed(project_name: str, sprite_name: str, seed: int):
    project_dir = os.path.join(WORKSPACE_DIR, "projects", project_name)
    seeds_meta_path = os.path.join(project_dir, "seeds_metadata.json")
    gen_log = os.path.join(project_dir, "generation_log.json")
    
    # 1. Update project metadata
    project_seeds = {"good_seeds": {}, "rejected_seeds": {}}
    if os.path.exists(seeds_meta_path):
        try:
            with open(seeds_meta_path, 'r') as f:
                project_seeds = json.load(f)
        except Exception:
            pass
            
    rejected_seeds = project_seeds.setdefault("rejected_seeds", {})
    sprite_rejected = rejected_seeds.setdefault(sprite_name, [])
    if seed not in sprite_rejected:
        sprite_rejected.append(seed)
        
    # Remove from good_seeds if present
    good_seeds = project_seeds.get("good_seeds", {})
    sprite_good = good_seeds.get(sprite_name, [])
    if seed in sprite_good:
        sprite_good.remove(seed)
        
    try:
        with open(seeds_meta_path, 'w') as f:
            json.dump(project_seeds, f, indent=4)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update project seeds: {e}")
        
    # 2. Export attempt to gemma training bad folder before deletion
    export_to_training_dataset(project_name, sprite_name, seed, "bad")

    # 3. Delete files and remove from generation_log.json
    if os.path.exists(gen_log):
        try:
            with open(gen_log, 'r') as f:
                gen_list = json.load(f)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to read generation log: {e}")
            
        updated_list = []
        deleted_files = []
        for item in gen_list:
            if item["filename"] == sprite_name and item["seed"] == seed:
                # Delete video
                video_path_rel = item.get("video_path")
                if video_path_rel:
                    video_path_abs = os.path.join(WORKSPACE_DIR, video_path_rel)
                    if os.path.exists(video_path_abs):
                        try:
                            os.remove(video_path_abs)
                            deleted_files.append(video_path_rel)
                        except Exception as e:
                            print(f"Failed to delete video: {e}")
                # Delete frames
                frames_dir_rel = item.get("frames_dir")
                if frames_dir_rel:
                    frames_dir_abs = os.path.join(WORKSPACE_DIR, frames_dir_rel)
                    if os.path.exists(frames_dir_abs):
                        try:
                            shutil.rmtree(frames_dir_abs)
                            deleted_files.append(frames_dir_rel)
                        except Exception as e:
                            print(f"Failed to delete frames: {e}")
            else:
                updated_list.append(item)
                
        try:
            with open(gen_log, 'w') as f:
                json.dump(updated_list, f, indent=4)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to save generation log: {e}")
            
    return {"status": "success", "message": f"Seed {seed} rejected and files cleaned up."}


@app.post("/api/projects/{project_name}/sprite/{sprite_name}/reset")
def reset_sprite(project_name: str, sprite_name: str):
    """Move active sprite walk cycle files to rejected directory and set status to pending."""
    project_dir = os.path.join(WORKSPACE_DIR, "projects", project_name)
    log_path = os.path.join(project_dir, "generation_log.json")
    if not os.path.exists(log_path):
        raise HTTPException(status_code=404, detail="Generation log not found")
        
    with open(log_path, 'r') as f:
        log_data = json.load(f)
        
    item_found = None
    for item in log_data:
        item_base = os.path.splitext(item["filename"])[0]
        if item_base == sprite_name:
            item_found = item
            break
            
    if not item_found:
        raise HTTPException(status_code=404, detail="Sprite not found in generation log")
        
    video_path_rel = item_found.get("video_path")
    frames_dir_rel = item_found.get("frames_dir")
    seed = item_found.get("seed", 0)
    
    rejected_dir = os.path.join(project_dir, "rejected")
    os.makedirs(rejected_dir, exist_ok=True)
    
    if video_path_rel:
        video_path_abs = os.path.join(WORKSPACE_DIR, video_path_rel)
        if os.path.exists(video_path_abs) and "rejected" not in video_path_rel:
            dest_video = os.path.join(rejected_dir, f"{sprite_name}_seed{seed}_failed.mp4")
            if os.path.exists(dest_video):
                os.remove(dest_video)
            shutil.move(video_path_abs, dest_video)
            
    if frames_dir_rel:
        frames_dir_abs = os.path.join(WORKSPACE_DIR, frames_dir_rel)
        if os.path.exists(frames_dir_abs) and "rejected" not in frames_dir_rel:
            dest_frames = os.path.join(rejected_dir, f"{sprite_name}_seed{seed}_failed")
            if os.path.exists(dest_frames):
                shutil.rmtree(dest_frames)
            shutil.move(frames_dir_abs, dest_frames)
            
    item_found["status"] = "pending"
    item_found["verification"] = None
    if "video_path" in item_found:
        del item_found["video_path"]
    if "frames_dir" in item_found:
        del item_found["frames_dir"]
        
    with open(log_path, 'w') as f:
        json.dump(log_data, f, indent=4)
        
    return {"status": "success", "message": f"Sprite '{sprite_name}' reset."}

def determine_direction(filename):
    filename_lower = filename.lower()
    if "34front" in filename_lower:
        return "34front"
    elif "34back" in filename_lower:
        return "34back"
    elif "front" in filename_lower:
        return "front"
    elif "back" in filename_lower:
        return "back"
    elif "side" in filename_lower:
        return "side"
    return "front"

@app.post("/api/projects/{project_name}/sprite/{sprite_name}/promote")
def promote_attempt(project_name: str, sprite_name: str, payload: PromoteRequest):
    """Swap chosen rejected attempt into active walk cycle position."""
    seed = payload.seed
    project_dir = os.path.join(WORKSPACE_DIR, "projects", project_name)
    rejected_dir = os.path.join(project_dir, "rejected")
    
    source_video = os.path.join(rejected_dir, f"{sprite_name}_seed{seed}_failed.mp4")
    source_frames = os.path.join(rejected_dir, f"{sprite_name}_seed{seed}_failed")
    
    if not os.path.exists(source_video) or not os.path.exists(source_frames):
        raise HTTPException(status_code=404, detail=f"Rejected attempt with seed {seed} not found")
        
    direction = determine_direction(sprite_name)
    dest_dir = os.path.join(project_dir, direction)
    os.makedirs(dest_dir, exist_ok=True)
    
    promoted_video = os.path.join(dest_dir, f"{sprite_name}_seed{seed}.mp4")
    promoted_frames = os.path.join(dest_dir, f"{sprite_name}_seed{seed}")
    
    log_path = os.path.join(project_dir, "generation_log.json")
    if not os.path.exists(log_path):
        raise HTTPException(status_code=404, detail="Generation log not found")
        
    with open(log_path, 'r') as f:
        log_data = json.load(f)
        
    item_found = None
    for item in log_data:
        item_base = os.path.splitext(item["filename"])[0]
        if item_base == sprite_name:
            item_found = item
            break
            
    if not item_found:
        raise HTTPException(status_code=404, detail="Sprite not found in generation log")
        
    old_video_rel = item_found.get("video_path")
    old_frames_rel = item_found.get("frames_dir")
    old_seed = item_found.get("seed")
    
    if old_video_rel and old_seed and old_seed != seed:
        old_video_abs = os.path.join(WORKSPACE_DIR, old_video_rel)
        if os.path.exists(old_video_abs) and "rejected" not in old_video_rel:
            dest_video = os.path.join(rejected_dir, f"{sprite_name}_seed{old_seed}_failed.mp4")
            if os.path.exists(dest_video):
                os.remove(dest_video)
            shutil.move(old_video_abs, dest_video)
            
    if old_frames_rel and old_seed and old_seed != seed:
        old_frames_abs = os.path.join(WORKSPACE_DIR, old_frames_rel)
        if os.path.exists(old_frames_abs) and "rejected" not in old_frames_rel:
            dest_frames = os.path.join(rejected_dir, f"{sprite_name}_seed{old_seed}_failed")
            if os.path.exists(dest_frames):
                shutil.rmtree(dest_frames)
            shutil.move(old_frames_abs, dest_frames)
            
    if os.path.exists(promoted_video):
        os.remove(promoted_video)
    shutil.move(source_video, promoted_video)
    
    if os.path.exists(promoted_frames):
        shutil.rmtree(promoted_frames)
    shutil.move(source_frames, promoted_frames)
    
    item_found["seed"] = seed
    item_found["status"] = "verified"
    item_found["verification"] = {
        "passed": True,
        "analysis": "Manually promoted by user."
    }
    item_found["video_path"] = os.path.relpath(promoted_video, WORKSPACE_DIR).replace("\\", "/")
    item_found["frames_dir"] = os.path.relpath(promoted_frames, WORKSPACE_DIR).replace("\\", "/")
    
    frame_files = [f for f in os.listdir(promoted_frames) if f.startswith("frame_") and f.endswith(".png")]
    item_found["frame_count"] = len(frame_files)
    
    with open(log_path, 'w') as f:
        json.dump(log_data, f, indent=4)
        
    return {"status": "success", "message": f"Attempt with seed {seed} promoted."}

@app.on_event("startup")
def startup_event():
    default_proj_dir = os.path.join(WORKSPACE_DIR, "projects", "default_project")
    if not os.path.exists(default_proj_dir):
        print("Initializing 'default_project'...")
        try:
            payload = ProjectCreateRequest(name="default_project")
            create_project(payload)
            print("'default_project' initialized successfully!")
        except Exception as e:
            print(f"Error initializing 'default_project': {e}")

if __name__ == "__main__":
    import uvicorn
    # Allow running server directly
    uvicorn.run(app, host="127.0.0.1", port=8000)
