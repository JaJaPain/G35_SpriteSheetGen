import os
import sys
import json
import cv2
import base64
import requests
import argparse
import shutil

try:
    sys.stdout.reconfigure(encoding='utf-8')
except AttributeError:
    pass

# Define base paths
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(BACKEND_DIR)
PROCESSED_DIR = os.path.join(WORKSPACE_DIR, "ProcessedSprites")
OUTPUT_VIDEO_DIR = os.path.join(PROCESSED_DIR, "videos")
FRAMES_DIR = os.path.join(PROCESSED_DIR, "frames")
LOG_PATH = os.path.join(PROCESSED_DIR, "generation_log.json")
OLLAMA_URL = "http://localhost:11434/api/chat"
MODEL_NAME = "gemma4:e4b"

def extract_frames_from_video(video_path, output_dir):
    """Extract frames from the video using OpenCV."""
    os.makedirs(output_dir, exist_ok=True)
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"Error opening video file {video_path}")
        return 0, 0.0
    
    fps = cap.get(cv2.CAP_PROP_FPS) or 16.0
    count = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        frame_name = f"frame_{count:03d}.png"
        cv2.imwrite(os.path.join(output_dir, frame_name), frame)
        count += 1
        
    cap.release()
    print(f"Extracted {count} frames (FPS: {fps:.2f}) to {output_dir}")
    return count, fps

def encode_image_base64(image_path):
    """Encode image to base64 for Ollama API."""
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')

def clean_and_parse_json(text):
    """Clean and parse JSON from the model response, handling markdown blocks or surrounding text."""
    text = text.strip()
    # Remove markdown code blocks if present
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[0].strip().startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    
    # Locate outermost curly braces to isolate the JSON object
    start_idx = text.find("{")
    end_idx = text.rfind("}")
    if start_idx != -1 and end_idx != -1:
        text = text[start_idx:end_idx+1]
        
    return json.loads(text)

def verify_with_gemma(frame_paths):
    """Send key frames to Gemma 4 via Ollama individually, get descriptions, then compare them."""
    if len(frame_paths) < 4:
        return {"passed": False, "analysis": "Insufficient frame paths provided."}
    
    descriptions = []
    
    # Generic, unbiased prompt used for independent analysis of each frame
    prompt_frame = (
        "Analyze this image of a character from an animation frame. Describe the character's appearance in detail:\n"
        "1. Styling and Textures: Is the character a fully textured, detailed, colored illustration? Or is the character a solid silhouette or a shape of a single color (like solid white, solid gray, solid black) with all textures and detailed colors bleached out/lost?\n"
        "2. Clothing and Color Scheme: Describe the exact colors of the character's hair/beard, skin, upper clothing layer, lower clothing layer, belt, and shoes/boots.\n"
        "3. Pose: Describe the pose of the character, particularly their legs, arms, and body orientation (e.g., walking, standing, facing left/right/forward/away)."
    )
    
    for idx, path in enumerate(frame_paths):
        print(f"  Analyzing Frame {idx}: {os.path.basename(path)}...")
        img_base64 = encode_image_base64(path)
        payload = {
            "model": MODEL_NAME,
            "messages": [{"role": "user", "content": prompt_frame, "images": [img_base64]}],
            "stream": False
        }
        try:
            res = requests.post(OLLAMA_URL, json=payload, timeout=60)
            desc = res.json().get("message", {}).get("content", "")
            print(f"  Frame {idx} Description: {desc.strip()}")
            descriptions.append(desc)
        except Exception as e:
            return {"passed": False, "analysis": f"Error analyzing Frame {idx}: {e}"}
            
    # Final Comparison and Reasoning Call
    print("  Comparing descriptions using Gemma reasoning...")
    compare_prompt = (
        "You are an animation Quality Control reasoning assistant. You are given descriptions of a character in 4 keyframes of a walk cycle sequence (Frame 0 to Frame 3):\n\n"
        f"Frame 0 Description:\n{descriptions[0]}\n\n"
        f"Frame 1 Description:\n{descriptions[1]}\n\n"
        f"Frame 2 Description:\n{descriptions[2]}\n\n"
        f"Frame 3 Description:\n{descriptions[3]}\n\n"
        "Use step-by-step reasoning to evaluate if the animation is a successful walk cycle that maintains visual consistency across frames:\n"
        "1. Evaluate styling consistency (Bleaching check): Compare the styling across all frames. Does any frame describe the character as a solid silhouette, solid white, solid gray, solid black, or a single-color shape, while other frames describe a detailed/textured illustration? If a frame turned solid white/gray/black or lost its textures, this is a texture loss failure.\n"
        "2. Evaluate color/design consistency: Do the described colors of the hair/beard, upper clothing, lower clothing, and boots represent the same character design? Expect minor description variations or light shading shifts (e.g., sage green vs teal, tan vs khaki, brown vs reddish-brown), but reject complete design shifts (e.g., green clothing turning red, or brown boots turning blue) or loss of colors.\n"
        "3. Evaluate animation progression: Compare the described poses, body orientation, and positions of the legs/arms. Do they change between frames, suggesting movement/walking? If the character is in the exact same pose in every frame, or if the descriptions indicate no change in body/limb position, this is a failure.\n\n"
        "Return a JSON object with the following fields:\n"
        "- 'reasoning_steps': A detailed step-by-step analysis comparing the frame descriptions, explaining why the frames do or do not make sense together as a consistent walk cycle.\n"
        "- 'texture_loss': A boolean (true if any frame shows texture loss/silhouette/bleaching/solid color state).\n"
        "- 'color_consistent': A boolean (true if the design/colors are consistent across all frames).\n"
        "- 'is_animating': A boolean (true if the poses/limbs indicate movement/walking progression).\n"
        "- 'passed': A boolean (true ONLY if 'texture_loss' is false, 'color_consistent' is true, and 'is_animating' is true).\n"
        "- 'analysis': A short summary of the verdict (keep it under 2 sentences)."
    )
    
    payload_compare = {
        "model": MODEL_NAME,
        "messages": [{"role": "user", "content": compare_prompt}],
        "stream": False,
        "format": "json",
        "options": {
            "num_predict": 4096,
            "temperature": 0.0
        }
    }
    
    try:
        res = requests.post(OLLAMA_URL, json=payload_compare, timeout=60)
        if res.status_code == 200:
            result_json = res.json()
            message_content = result_json.get("message", {}).get("content", "")
            print(f"  Comparison Result: {message_content.strip()}")
            return clean_and_parse_json(message_content)
        else:
            return {"passed": False, "analysis": f"Comparison HTTP error {res.status_code}"}
    except Exception as e:
        return {"passed": False, "analysis": f"Comparison error: {e}"}

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

def run_verification(project=None, force_verify=False):
    if project:
        project_dir = os.path.join(WORKSPACE_DIR, "projects", project)
        log_path = os.path.join(project_dir, "generation_log.json")
        videos_dir = os.path.join(project_dir, "videos")
        temp_frames_dir = os.path.join(project_dir, "temp_frames")
    else:
        project_dir = None
        log_path = os.path.join(WORKSPACE_DIR, "ProcessedSprites", "generation_log.json")
        videos_dir = os.path.join(WORKSPACE_DIR, "ProcessedSprites", "videos")
        temp_frames_dir = os.path.join(WORKSPACE_DIR, "ProcessedSprites", "frames")

    if not os.path.exists(log_path):
        print(f"No generation log found at {log_path}")
        return
        
    with open(log_path, 'r') as f:
        log_data = json.load(f)
        
    # Scan videos folder for generated videos
    video_files = []
    if os.path.exists(videos_dir):
        video_files = [f for f in os.listdir(videos_dir) if f.lower().endswith('.mp4')]
    print(f"Found {len(video_files)} video files in {videos_dir}.")
    
    updated_log = []
    
    for item in log_data:
        seed = item["seed"]
        filename = item["filename"]
        sprite_name = os.path.splitext(filename)[0]
        
        # Check if we can skip verification
        status = item.get("status", "pending")
        verification = item.get("verification")
        if not isinstance(verification, dict):
            verification = {}
        has_passed = verification.get("passed", False)
        analysis = verification.get("analysis", "")
        
        # Calculate duration if metadata exists
        existing_frame_count = item.get("frame_count", 0)
        existing_fps = item.get("fps", 16.0)
        existing_duration = existing_frame_count / existing_fps if existing_fps > 0 else 0
        
        is_conn_error = "connection error" in analysis.lower() or "timed out" in analysis.lower() or "http error" in analysis.lower()
        
        if not force_verify and status == "verified" and has_passed:
            # Only skip if the video also meets the new 3-second duration requirement
            if existing_duration >= 3.0 or (existing_frame_count >= 48 and existing_fps <= 16.0):
                print(f"Skipping {filename}: Already verified, passed, and meets 3s duration.")
                updated_log.append(item)
                continue
            else:
                print(f"Re-verifying {filename}: Duration is too short ({existing_duration:.2f}s) for new 3s qualification.")
            
        if not force_verify and status == "failed_verification" and not is_conn_error:
            print(f"Skipping {filename} (Seed: {seed}): Already failed verification.")
            updated_log.append(item)
            continue
            
        # Find video path
        matching_video = None
        # First check in videos directory
        for v in video_files:
            if f"seed{seed}" in v or f"_{seed}_" in v or v.endswith(f"_{seed}.mp4"):
                matching_video = os.path.join(videos_dir, v)
                break
                
        # If not in videos directory, check the video_path in log
        if not matching_video and item.get("video_path"):
            stored_path = item.get("video_path")
            if not os.path.isabs(stored_path):
                temp_p = os.path.join(WORKSPACE_DIR, stored_path)
                if os.path.exists(temp_p):
                    matching_video = temp_p
            elif os.path.exists(stored_path):
                matching_video = stored_path

        if not matching_video:
            print(f"Could not find matching video for {filename} (Seed: {seed})")
            updated_log.append(item)
            continue
            
        print(f"Processing verification for {filename} (status: {status}, seed: {seed})...")
        
        # Decide frame extraction directory
        if project:
            os.makedirs(temp_frames_dir, exist_ok=True)
            extraction_dir = os.path.join(temp_frames_dir, f"{sprite_name}_seed{seed}")
        else:
            extraction_dir = os.path.join(temp_frames_dir, sprite_name)
            
        frame_count, fps = extract_frames_from_video(matching_video, extraction_dir)
        item["frame_count"] = frame_count
        item["fps"] = fps
        duration = frame_count / fps if fps > 0 else 0.0
        item["duration"] = duration
        
        if frame_count > 0:
            if duration < 3.0:
                print(f"  FAILED DURATION QUALIFICATION: {duration:.2f} seconds is less than 3.0 seconds.")
                verification_result = {
                    "passed": False,
                    "analysis": f"Failed qualification: Video duration is too short ({duration:.2f}s). Must be at least 3.0 seconds."
                }
                item["verification"] = verification_result
                item["status"] = "failed_verification"
            else:
                # Pick 4 key frames (start, 1/3, 2/3, end)
                indices = [0, frame_count // 3, (2 * frame_count) // 3, frame_count - 1]
                key_frames = [os.path.join(extraction_dir, f"frame_{idx:03d}.png") for idx in indices]
                
                # Verify with Gemma 4
                verification_result = verify_with_gemma(key_frames)
                item["verification"] = verification_result
                item["status"] = "verified" if verification_result.get("passed", False) else "failed_verification"
                
            # Save verification.json in the extraction directory for local record
            try:
                with open(os.path.join(extraction_dir, "verification.json"), "w") as vf:
                    json.dump(item["verification"], vf, indent=4)
            except Exception as e:
                print(f"  Warning: could not write verification.json: {e}")

            # If project, sort the video and frame directories based on verdict
            if project:
                passed = item["verification"].get("passed", False)
                direction = determine_direction(filename)
                
                if passed:
                    dest_dir = os.path.join(project_dir, direction)
                    final_video_path = os.path.join(dest_dir, f"{sprite_name}_seed{seed}.mp4")
                    final_frames_dir = os.path.join(dest_dir, f"{sprite_name}_seed{seed}")
                else:
                    dest_dir = os.path.join(project_dir, "rejected")
                    final_video_path = os.path.join(dest_dir, f"{sprite_name}_seed{seed}_failed.mp4")
                    final_frames_dir = os.path.join(dest_dir, f"{sprite_name}_seed{seed}_failed")
                
                os.makedirs(dest_dir, exist_ok=True)
                
                # Move video if it's currently in the raw videos directory (not already sorted)
                if os.path.dirname(matching_video) == os.path.abspath(videos_dir):
                    print(f"  Moving video to {final_video_path}...")
                    if os.path.exists(final_video_path):
                        os.remove(final_video_path)
                    shutil.move(matching_video, final_video_path)
                else:
                    # If it was already in a sorted location (e.g. failed in previous run) but now passes/re-fails
                    if os.path.abspath(matching_video) != os.path.abspath(final_video_path):
                        print(f"  Moving video from sorted location to {final_video_path}...")
                        if os.path.exists(final_video_path):
                            os.remove(final_video_path)
                        shutil.move(matching_video, final_video_path)
                
                # Move frames
                print(f"  Moving frames to {final_frames_dir}...")
                if os.path.exists(final_frames_dir):
                    shutil.rmtree(final_frames_dir)
                shutil.move(extraction_dir, final_frames_dir)
                
                # Update paths to relative for portability
                item["video_path"] = os.path.relpath(final_video_path, WORKSPACE_DIR).replace("\\", "/")
                item["frames_dir"] = os.path.relpath(final_frames_dir, WORKSPACE_DIR).replace("\\", "/")
            else:
                item["video_path"] = os.path.relpath(matching_video, WORKSPACE_DIR).replace("\\", "/")
                item["frames_dir"] = os.path.relpath(extraction_dir, WORKSPACE_DIR).replace("\\", "/")
        else:
            item["status"] = "failed_frame_extraction"
            item["verification"] = {"passed": False, "analysis": "Zero frames extracted."}
            item["video_path"] = os.path.relpath(matching_video, WORKSPACE_DIR).replace("\\", "/")
            item["frames_dir"] = os.path.relpath(extraction_dir, WORKSPACE_DIR).replace("\\", "/")
            
        updated_log.append(item)
        
    with open(log_path, 'w') as f:
        json.dump(updated_log, f, indent=4)
        
    print("Verification completed and log updated.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Verify generated walk cycle videos using Gemma 4")
    parser.add_argument("--project", "-p", type=str, default="default_project", help="Project name")
    parser.add_argument("--force", "-f", action="store_true", help="Force verification")
    args = parser.parse_args()
    
    project = args.project
    if project == "None" or project == "none":
        project = None
        
    run_verification(project=project, force_verify=args.force)

