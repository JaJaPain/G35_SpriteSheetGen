import os
import sys
import json
import shutil
import numpy as np
import cv2
from PIL import Image
from fastapi import FastAPI, HTTPException, Body
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

class OffsetItem(BaseModel):
    frameIndex: int
    dx: int
    dy: int

class OffsetSaveRequest(BaseModel):
    offsets: List[OffsetItem]

class ExportRequest(BaseModel):
    tolerance: int = 15
    export_type: str = "spritesheet" # "spritesheet" or "sequence" or "both"
    padding: int = 0

@app.get("/api/sprites")
def get_sprites():
    """Retrieve all processed sprites and their animation metadata."""
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
        # Match processing log to generation log using original filename
        filename = p["filename"]
        # Look up generation entry
        gen_entry = gen_data.get(p["processed_filename"], {})
        
        # Get frame folder if exists
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
                
            # Load offsets if exist
            offsets_path = os.path.join(sprite_frames_dir, "offsets.json")
            if os.path.exists(offsets_path):
                try:
                    with open(offsets_path, 'r') as f:
                        offsets = json.load(f).get("offsets", [])
                except Exception as e:
                    print(f"Error reading offsets for {sprite_name}: {e}")
                    
        # Construct combined status
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
            "offsets": offsets
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
def save_offsets(sprite_name: str, payload: OffsetSaveRequest):
    """Save user-defined frame alignment offsets."""
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
def export_sprite(sprite_name: str, payload: ExportRequest):
    """Chroma keys background, applies translation offsets, and exports frames/spritesheet."""
    sprite_frames_dir = os.path.join(FRAMES_DIR, sprite_name)
    if not os.path.exists(sprite_frames_dir):
        raise HTTPException(status_code=404, detail="Sprite frames directory not found")
        
    # Get background color from processing log
    if not os.path.exists(PROCESSING_LOG):
        raise HTTPException(status_code=500, detail="Processing log not found")
        
    with open(PROCESSING_LOG, 'r') as f:
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
                    offsets_map[o["frameIndex"]] = (o["dx"], o["dy"])
        except Exception as e:
            print(f"Error reading offsets: {e}")
            
    frame_files = sorted([f for f in os.listdir(sprite_frames_dir) if f.startswith("frame_") and f.endswith(".png")])
    if not frame_files:
        raise HTTPException(status_code=400, detail="No frame images found to export")
        
    sprite_export_dir = os.path.join(EXPORTS_DIR, sprite_name)
    os.makedirs(sprite_export_dir, exist_ok=True)
    
    processed_frames = []
    
    # Step 1: Chroma Key and Translate
    for i, file_name in enumerate(frame_files):
        frame_path = os.path.join(sprite_frames_dir, file_name)
        img_bgr = cv2.imread(frame_path)
        
        # Apply Chroma Key
        img_transparent = apply_chroma_key(img_bgr, bg_rgb, payload.tolerance)
        
        # Apply offsets
        dx, dy = offsets_map.get(i, (0, 0))
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
            # pts is [row, col] -> y, x
            y_min, x_min = pts.min(axis=0)
            y_max, x_max = pts.max(axis=0)
            bboxes.append((x_min, y_min, x_max, y_max))
            
    if bboxes:
        # Get bounding box enclosing all frames
        x_min = min(b[0] for b in bboxes)
        y_min = min(b[1] for b in bboxes)
        x_max = max(b[2] for b in bboxes)
        y_max = max(b[3] for b in bboxes)
        
        # Crop width and height
        crop_w = x_max - x_min + 1
        crop_h = y_max - y_min + 1
        
        # Add optional padding
        pad = payload.padding
        crop_w += 2 * pad
        crop_h += 2 * pad
        
        cropped_frames = []
        for frame in processed_frames:
            # Crop frame, taking padding into account
            h, w = frame.shape[:2]
            canvas = np.zeros((crop_h, crop_w, 4), dtype=np.uint8)
            
            # Source bounds
            src_x1 = max(0, x_min - pad)
            src_y1 = max(0, y_min - pad)
            src_x2 = min(w, x_max + 1 + pad)
            src_y2 = min(h, y_max + 1 + pad)
            
            # Destination bounds on canvas
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
    export_paths["sequence"] = f"/exports/{sprite_name}/sequence"
    
    # Zip the sequence folder
    zip_path = os.path.join(sprite_export_dir, f"{sprite_name}_sequence")
    shutil.make_archive(zip_path, 'zip', sequence_dir)
    export_paths["zip"] = f"/exports/{sprite_name}/{sprite_name}_sequence.zip"
    
    # Generate Sprite Sheet
    if payload.export_type in ["spritesheet", "both"]:
        num_frames = len(cropped_frames)
        # Combine side-by-side horizontally
        spritesheet = np.zeros((crop_h, crop_w * num_frames, 4), dtype=np.uint8)
        for idx, c_frame in enumerate(cropped_frames):
            spritesheet[:, idx * crop_w : (idx + 1) * crop_w] = c_frame
            
        spritesheet_path = os.path.join(sprite_export_dir, f"{sprite_name}_spritesheet.png")
        cv2.imwrite(spritesheet_path, spritesheet)
        export_paths["spritesheet"] = f"/exports/{sprite_name}/{sprite_name}_spritesheet.png"
        
    return {
        "status": "success",
        "message": f"Export complete for {sprite_name}",
        "dimensions": {"width": int(crop_w), "height": int(crop_h)},
        "export_paths": export_paths
    }

if __name__ == "__main__":
    import uvicorn
    # Allow running server directly
    uvicorn.run(app, host="127.0.0.1", port=8000)
