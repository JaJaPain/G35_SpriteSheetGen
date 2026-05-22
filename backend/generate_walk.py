import os
import sys
import json
import random
import subprocess

# Define base paths
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(BACKEND_DIR)
PROCESSED_DIR = os.path.join(WORKSPACE_DIR, "ProcessedSprites")
BG_DIR = os.path.join(PROCESSED_DIR, "with_bg")
OUTPUT_VIDEO_DIR = os.path.join(PROCESSED_DIR, "videos")
LOG_PATH = os.path.join(PROCESSED_DIR, "generation_log.json")
WAN2GP_DIR = os.path.join(BACKEND_DIR, "Wan2GP")
VENV_PYTHON = os.path.join(WAN2GP_DIR, "env_venv", "Scripts", "python.exe")

# Updated Prompts to strongly encourage leg/arm animation & limb motion
PROMPT_TEMPLATES = {
    "front": "A full body shot of the character walking forward towards the camera, walk cycle loop, stepping legs, moving arms and legs, animated, clean outlines",
    "back": "A full body shot of the character walking away from the camera, walk cycle loop, stepping legs, moving arms and legs, animated, clean outlines",
    "34front": "Dynamic walk cycle loop, character walking forward at a constant 3/4 angle in place, legs taking diagonal steps, arms swinging, active walking animation, full movement, maintaining the exact same 3/4 angle across all frames without turning or rotating, game sprite",
    "34back": "A full body shot of the character walking away at a constant 3/4 angle in place, walk cycle loop, stepping legs diagonally, moving arms and legs, animated, clean outlines, maintaining the exact same 3/4 angle across all frames without turning or rotating",
    "SideFacingLeft": "A full body profile shot of the character walking to the left, side view, walk cycle loop, active leg movement, legs stepping back and forth, swinging arms, animated, clean outlines",
    "side": "A full body profile shot of the character walking to the side, side view, walk cycle loop, active leg movement, legs stepping back and forth, swinging arms, animated, clean outlines"
}

def determine_prompt(filename):
    # Sort keys by length in descending order to match longest prefixes first
    for key in sorted(PROMPT_TEMPLATES.keys(), key=len, reverse=True):
        if key in filename:
            return PROMPT_TEMPLATES[key]
    return PROMPT_TEMPLATES["front"]

def generate_walk_cycle_videos(dry_run=False, force_all=False):
    if not os.path.exists(BG_DIR):
        print(f"Error: Processed sprites directory not found at {BG_DIR}")
        sys.exit(1)
        
    os.makedirs(OUTPUT_VIDEO_DIR, exist_ok=True)
    
    # Check what sprites are available
    sprite_files = [f for f in os.listdir(BG_DIR) if f.lower().endswith('.png')]
    if not sprite_files:
        print(f"No processed sprites found in {BG_DIR}")
        sys.exit(1)
        
    print(f"Found {len(sprite_files)} sprites in processed directory.")
    
    # Load existing log if available
    existing_log = {}
    if os.path.exists(LOG_PATH):
        try:
            with open(LOG_PATH, 'r') as f:
                existing_log = {item["filename"]: item for item in json.load(f)}
        except Exception as e:
            print(f"Warning: could not read existing log: {e}")

    tasks = []
    log_data = []
    
    # Use random for fresh seeds on failure
    random.seed()
    
    for filename in sprite_files:
        sprite_path = os.path.join(BG_DIR, filename)
        prompt = determine_prompt(filename)
        
        # Check if we should skip or regenerate
        if filename in existing_log and not force_all:
            item = existing_log[filename]
            status = item.get("status", "pending")
            verification = item.get("verification", {})
            has_passed = verification.get("passed", False)
            
            # If verified and passed, preserve it!
            if status == "verified" and has_passed:
                print(f"Sprite: {filename} -> Preserving already verified video (Seed: {item['seed']})")
                log_data.append(item)
                continue
                
        # Otherwise, generate/regenerate with a new seed and motion_amplitude
        seed = random.randint(100000, 999999)
        print(f"Sprite: {filename} -> Queueing for generation (Seed: {seed}, Prompt: '{prompt}')")
        
        # Determine motion amplitude based on orientation
        is_34 = "34front" in filename or "34back" in filename
        motion_amp = 1.2 if is_34 else 1.3
        
        task = {
            "model_type": "i2v",
            "prompt": prompt,
            "image_start": sprite_path,
            "seed": seed,
            "video_length": 49,
            "resolution": "832x480",
            "num_inference_steps": 30,
            "motion_amplitude": motion_amp
        }
        tasks.append(task)
        
        log_data.append({
            "filename": filename,
            "prompt": prompt,
            "seed": seed,
            "motion_amplitude": motion_amp,
            "video_length": 49,
            "resolution": "832x480",
            "image_start_path": sprite_path,
            "status": "pending"
        })
        
    if not tasks:
        print("All sprites are already verified and passed. Nothing to generate.")
        return
        
    # Save log pending execution (merging preserved and pending)
    with open(LOG_PATH, 'w') as f:
        json.dump(log_data, f, indent=4)
        
    # Write task file for Wan2GP CLI
    task_json_path = os.path.join(WAN2GP_DIR, "walk_tasks.json")
    with open(task_json_path, 'w') as f:
        json.dump(tasks, f, indent=4)
        
    print(f"Wrote {len(tasks)} task(s) configuration to {task_json_path}")
    
    # Run wgp.py
    cmd = [
        VENV_PYTHON,
        "wgp.py",
        "--process", "walk_tasks.json",
        "--output-dir", OUTPUT_VIDEO_DIR
    ]
    
    if dry_run:
        cmd.append("--dry-run")
        print("Running validation dry-run...")
    else:
        print(f"Starting video generation for {len(tasks)} task(s)...")
        
    try:
        # Run process and stream output to stdout
        p = subprocess.Popen(cmd, cwd=WAN2GP_DIR, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        for line in p.stdout:
            print(line, end='')
        p.wait()
        
        if p.returncode == 0:
            print("Successfully processed task queue!")
            if not dry_run:
                # Update status in log for the generated tasks
                for item in log_data:
                    # If this filename was part of the tasks we ran, update its status
                    if any(t["image_start"] == item["image_start_path"] for t in tasks):
                        item["status"] = "generated"
                with open(LOG_PATH, 'w') as f:
                    json.dump(log_data, f, indent=4)
        else:
            print(f"Wan2GP execution exited with return code {p.returncode}")
            sys.exit(p.returncode)
            
    except Exception as e:
        print(f"Error executing Wan2GP: {e}")
        sys.exit(1)

if __name__ == "__main__":
    dry = "--dry-run" in sys.argv or "-d" in sys.argv
    force = "--force-all" in sys.argv or "-f" in sys.argv
    generate_walk_cycle_videos(dry_run=dry, force_all=force)
