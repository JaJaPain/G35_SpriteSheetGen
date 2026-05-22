import os

def find_context(filename, search_str, before=10, after=30):
    if not os.path.exists(filename):
        print(f"File not found: {filename}")
        return
    with open(filename, 'r', encoding='utf-8', errors='ignore') as f:
        lines = f.readlines()
    
    matches = []
    for i, line in enumerate(lines):
        if search_str in line:
            matches.append(i)
            
    print(f"Found {len(matches)} matches for '{search_str}':")
    for idx in matches:
        print(f"\n--- Match at line {idx+1} ---")
        start = max(0, idx - before)
        end = min(len(lines), idx + after)
        for line_num in range(start, end):
            print(f"{line_num+1}: {lines[line_num]}", end='')

if __name__ == "__main__":
    wgp_path = os.path.join("Wan2GP", "wgp.py")
    find_context(wgp_path, "def get_model_filename", before=2, after=50)
    find_context(wgp_path, "def download_models", before=2, after=50)
