import os
import sys
import argparse
import numpy as np
from PIL import Image

CANDIDATES = {
    "magenta": (255, 0, 255),
    "green": (0, 255, 0),
    "blue": (0, 0, 255),
    "cyan": (0, 255, 255),
    "yellow": (255, 255, 0)
}

def get_brightness(rgb):
    # Standard YIQ/YUV formula for relative perceived luminance
    return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]

def get_sprite_colors_and_dominant(img):
    # Convert image to RGBA
    img = img.convert("RGBA")
    data = np.array(img)
    
    # Filter for non-transparent pixels (alpha > 10)
    r, g, b, a = data[:,:,0], data[:,:,1], data[:,:,2], data[:,:,3]
    mask = a > 10
    
    if not np.any(mask):
        # Empty sprite
        return (128, 128, 128), []
        
    pixels = np.column_stack((r[mask], g[mask], b[mask]))
    
    # Quantize colors into 32-sized buckets (8 buckets per channel, total 512 buckets)
    quantized = pixels // 32
    # Convert 3D coordinates to a 1D index: r * 64 + g * 8 + b
    indices = quantized[:, 0] * 64 + quantized[:, 1] * 8 + quantized[:, 2]
    
    # Find bucket frequencies
    counts = np.bincount(indices, minlength=512)
    
    # Get top buckets that have substantial pixels (at least 0.5% of total pixels)
    min_pixels = int(len(pixels) * 0.005)
    top_bucket_indices = np.where(counts >= min_pixels)[0]
    
    # Sort by frequency descending
    top_bucket_indices = top_bucket_indices[np.argsort(counts[top_bucket_indices])[::-1]]
    
    # Extract average colors for each top bucket
    top_colors = []
    for idx in top_bucket_indices:
        in_bucket = indices == idx
        avg_color = pixels[in_bucket].mean(axis=0)
        top_colors.append(tuple(map(int, avg_color)))
        
    # The absolute top bucket is dominant
    if len(top_colors) > 0:
        dominant_rgb = top_colors[0]
    else:
        dominant_rgb = (128, 128, 128)
        
    return dominant_rgb, top_colors[:15]

def choose_background_color(dominant_rgb, sprite_colors):
    best_color_name = None
    max_score = -999999
    
    dom_y = get_brightness(dominant_rgb)
    
    for name, cand_rgb in CANDIDATES.items():
        # RGB Euclidean Distance to dominant
        dist_rgb = np.linalg.norm(np.array(dominant_rgb) - np.array(cand_rgb))
        
        # Brightness difference to dominant
        cand_y = get_brightness(cand_rgb)
        dist_y = abs(dom_y - cand_y)
        
        # Base score prioritizing chromatic difference + brightness contrast
        score = dist_rgb + 2.0 * dist_y
        
        # Penalty if the candidate color is too close to ANY significant color in the sprite
        min_dist_to_sprite = 999.0
        for sprite_rgb in sprite_colors:
            d = np.linalg.norm(np.array(sprite_rgb) - np.array(cand_rgb))
            if d < min_dist_to_sprite:
                min_dist_to_sprite = d
                
        # If minimum distance to any sprite color is less than 75, apply heavy penalty
        if min_dist_to_sprite < 75:
            penalty = (75 - min_dist_to_sprite) * 12.0
            score -= penalty
            
        if score > max_score:
            max_score = score
            best_color_name = name
            
    return best_color_name, CANDIDATES[best_color_name]

def process_sprite(src_path, dest_dir, autocrop=True):
    print(f"Processing {os.path.basename(src_path)}...")
    img = Image.open(src_path)
    
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
        
    if autocrop:
        bbox = img.getbbox()
        if bbox:
            img = img.crop(bbox)
            print(f"  Cropped transparent borders to bounding box: {bbox}")
            
    # Add 35% transparent padding margin (based on max dimension)
    pad_size = int(max(img.width, img.height) * 0.35)
    pad_size = max(pad_size, 20) # Minimum 20px padding
    padded_img = Image.new("RGBA", (img.width + 2 * pad_size, img.height + 2 * pad_size), (0, 0, 0, 0))
    padded_img.paste(img, (pad_size, pad_size))
    img = padded_img
    print(f"  Added {pad_size}px padding on all sides. New size: {img.size}")
            
    dom_color, sprite_colors = get_sprite_colors_and_dominant(img)
    bg_name, bg_rgb = choose_background_color(dom_color, sprite_colors)
    print(f"  Dominant color: {dom_color}")
    print(f"  Significant colors: {sprite_colors}")
    print(f"  Selected background: {bg_name} {bg_rgb}")
    
    # Create background image
    bg_img = Image.new("RGBA", img.size, bg_rgb + (255,))
    # Composite the sprite on top
    final_img = Image.alpha_composite(bg_img, img)
    # Convert to RGB (jpeg compatibility / standard format)
    final_rgb = final_img.convert("RGB")
    
    # Ensure destination exists
    os.makedirs(dest_dir, exist_ok=True)
    basename = os.path.splitext(os.path.basename(src_path))[0]
    out_path = os.path.join(dest_dir, f"{basename}_bg.png")
    final_rgb.save(out_path, "PNG")
    print(f"  Saved to {out_path}")
    
    return {
        "filename": os.path.basename(src_path),
        "processed_filename": f"{basename}_bg.png",
        "processed_path": out_path,
        "dominant_color": dom_color,
        "background_name": bg_name,
        "background_rgb": bg_rgb
    }

def main():
    parser = argparse.ArgumentParser(description="Process sprites background color")
    parser.add_argument("--project", "-p", type=str, default="default_project", help="Project name")
    args = parser.parse_args()

    project = args.project
    if project == "None" or project == "none":
        project = None

    workspace = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if project:
        project_dir = os.path.join(workspace, "projects", project)
        sprites_dir = os.path.join(project_dir, "source")
        output_dir = os.path.join(project_dir, "processed")
        log_dir = project_dir
    else:
        sprites_dir = os.path.join(workspace, "TestSprites")
        output_dir = os.path.join(workspace, "ProcessedSprites", "with_bg")
        log_dir = os.path.join(workspace, "ProcessedSprites")
    
    if not os.path.exists(sprites_dir):
        print(f"Error: Sprites directory not found at {sprites_dir}")
        sys.exit(1)
        
    results = []
    for file in os.listdir(sprites_dir):
        if file.lower().endswith('.png'):
            src_path = os.path.join(sprites_dir, file)
            res = process_sprite(src_path, output_dir, autocrop=True)
            results.append(res)
            
    import json
    os.makedirs(log_dir, exist_ok=True)
    log_path = os.path.join(log_dir, "processing_log.json")
    with open(log_path, 'w') as f:
        json.dump(results, f, indent=4)
        
    print(f"Finished processing. Processing log saved to {log_path}")

if __name__ == "__main__":
    main()
