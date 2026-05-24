import os
import sys
import json
import random
import subprocess
import argparse

# Define base paths
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(BACKEND_DIR)
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

def determine_direction(filename):
    if "34front" in filename: return "34front"
    if "34back" in filename: return "34back"
    if "front" in filename: return "front"
    if "back" in filename: return "back"
    return "side"

def load_global_good_seeds(global_seeds_path):
    if os.path.exists(global_seeds_path):
        try:
            with open(global_seeds_path, 'r') as f:
                return json.load(f)
        except Exception as e:
            print(f"Warning: could not read global good seeds: {e}")
    return {
        "front": [],
        "back": [],
        "34front": [],
        "34back": [],
        "side": []
    }

def load_project_seeds_metadata(seeds_meta_path):
    if seeds_meta_path and os.path.exists(seeds_meta_path):
        try:
            with open(seeds_meta_path, 'r') as f:
                return json.load(f)
        except Exception as e:
            print(f"Warning: could not read project seeds metadata: {e}")
    return {
        "good_seeds": {},
        "rejected_seeds": {}
    }

def generate_walk_cycle_videos(project=None, dry_run=False, force_all=False, mode="initial", target_sprite=None):
    # Resolve project paths
    if project:
        project_dir = os.path.join(WORKSPACE_DIR, "projects", project)
        bg_dir = os.path.join(project_dir, "processed")
        output_video_dir = os.path.join(project_dir, "videos")
        log_path = os.path.join(project_dir, "generation_log.json")
        seeds_meta_path = os.path.join(project_dir, "seeds_metadata.json")
    else:
        bg_dir = os.path.join(WORKSPACE_DIR, "ProcessedSprites", "with_bg")
        output_video_dir = os.path.join(WORKSPACE_DIR, "ProcessedSprites", "videos")
        log_path = os.path.join(WORKSPACE_DIR, "ProcessedSprites", "generation_log.json")
        seeds_meta_path = None

    global_seeds_path = os.path.join(WORKSPACE_DIR, "projects", "global_good_seeds.json")
    global_seeds_meta = load_global_good_seeds(global_seeds_path)
    project_seeds_meta = load_project_seeds_metadata(seeds_meta_path)

    if not os.path.exists(bg_dir):
        print(f"Error: Processed sprites directory not found at {bg_dir}")
        sys.exit(1)
        
    os.makedirs(output_video_dir, exist_ok=True)
    
    # Check what sprites are available
    sprite_files = [f for f in os.listdir(bg_dir) if f.lower().endswith('.png')]
    if not sprite_files:
        print(f"No processed sprites found in {bg_dir}")
        sys.exit(1)
        
    print(f"Found {len(sprite_files)} sprites in processed directory.")
    
    # Load existing attempts grouped by filename
    existing_log_attempts = {}
    if os.path.exists(log_path):
        try:
            with open(log_path, 'r') as f:
                log_list = json.load(f)
                for item in log_list:
                    fn = item["filename"]
                    if fn not in existing_log_attempts:
                        existing_log_attempts[fn] = []
                    existing_log_attempts[fn].append(item)
        except Exception as e:
            print(f"Warning: could not read existing log: {e}")

    tasks = []
    log_data = []
    
    # Use random for fresh seeds
    random.seed()
    
    for filename in sprite_files:
        sprite_path = os.path.join(bg_dir, filename)
        prompt = determine_prompt(filename)
        direction = determine_direction(filename)
        
        # Get all attempts currently in log for this sprite
        attempts = existing_log_attempts.get(filename, [])
        
        # If target_sprite is specified, skip generating new ones for any other sprite
        if target_sprite and filename != target_sprite:
            print(f"Sprite: {filename} -> Preserving all existing attempts (Target is {target_sprite})")
            log_data.extend(attempts)
            continue
            
        passed_attempts = []
        used_seeds = set()
        for att in attempts:
            used_seeds.add(att["seed"])
            verification = att.get("verification")
            if isinstance(verification, dict) and verification.get("passed", False):
                passed_attempts.append(att)
                
        # Determine target new candidates count
        P = len(passed_attempts)
        if mode == "regen":
            # Regeneration targets 3 new candidates
            new_candidates_needed = 3
            print(f"Sprite: {filename} -> Mode: Regen (Generating 3 additional candidates, current verified: {P})")
        else:
            # Initial run targets 6 verified candidates total
            if P >= 6 and not force_all:
                print(f"Sprite: {filename} -> Preserving already verified candidates (Count: {P})")
                log_data.extend(attempts)
                continue
            new_candidates_needed = 6 - P
            print(f"Sprite: {filename} -> Mode: Initial (Targeting 6 verified candidates, current: {P}, generating {new_candidates_needed})")
            
        # Get lists of good and rejected seeds
        global_seeds = global_seeds_meta.get(direction, [])
        project_rejected = project_seeds_meta.get("rejected_seeds", {}).get(filename, [])
        
        # Generate new seeds using good seeds first, avoiding rejected seeds
        new_seeds = []
        
        # Try to pull from global good seeds first
        for g_seed in global_seeds:
            if len(new_seeds) >= new_candidates_needed:
                break
            if g_seed not in used_seeds and g_seed not in project_rejected:
                print(f"  Using global good seed: {g_seed}")
                new_seeds.append(g_seed)
                used_seeds.add(g_seed)
                
        # Fill remaining with random seeds
        while len(new_seeds) < new_candidates_needed:
            r_seed = random.randint(100000, 999999)
            if r_seed not in used_seeds and r_seed not in project_rejected:
                new_seeds.append(r_seed)
                used_seeds.add(r_seed)
                
        # Create tasks for the new seeds
        is_34 = "34front" in filename or "34back" in filename
        motion_amp = 1.2 if is_34 else 1.3
        
        for seed in new_seeds:
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
            
            attempts.append({
                "filename": filename,
                "prompt": prompt,
                "seed": seed,
                "motion_amplitude": motion_amp,
                "video_length": 49,
                "resolution": "832x480",
                "image_start_path": sprite_path,
                "status": "pending",
                "verification": None
            })
            
        log_data.extend(attempts)
        
    if not tasks:
        print("No new attempts needed for any sprites. Nothing to generate.")
        return
        
    # Save log pending execution
    with open(log_path, 'w') as f:
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
        "--output-dir", output_video_dir
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
            print(line, end='', flush=True)
        p.wait()
        
        if p.returncode == 0:
            print("Successfully processed task queue!")
            if not dry_run:
                # Update status in log for the generated tasks
                for item in log_data:
                    if any(t["image_start"] == item["image_start_path"] and t["seed"] == item["seed"] for t in tasks):
                        item["status"] = "generated"
                with open(log_path, 'w') as f:
                    json.dump(log_data, f, indent=4)
        else:
            print(f"Wan2GP execution exited with return code {p.returncode}")
            sys.exit(p.returncode)
            
    except Exception as e:
        print(f"Error executing Wan2GP: {e}")
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate walk cycle videos using Wan2GP")
    parser.add_argument("--project", "-p", type=str, default="default_project", help="Project name")
    parser.add_argument("--dry-run", "-d", action="store_true", help="Dry run validation")
    parser.add_argument("--force-all", "-f", action="store_true", help="Force regenerate all")
    parser.add_argument("--mode", "-m", type=str, default="initial", choices=["initial", "regen"], help="Generation mode")
    parser.add_argument("--sprite", "-s", type=str, default=None, help="Target sprite filename")
    args = parser.parse_args()
    
    project = args.project
    if project == "None" or project == "none":
        project = None
        
    generate_walk_cycle_videos(
        project=project,
        dry_run=args.dry_run,
        force_all=args.force_all,
        mode=args.mode,
        target_sprite=args.sprite
    )
