"""
batch_processor.py - Bulk STEP Model Processing & Manufacturing Workflow Automation
Allows batch import of multiple STEP (.step/.stp) models, executes parallel multi-core
unfolding, classifies parts by material thickness, generates 2D manufacturing drawings,
and organizes output files into structured directories.
"""

import sys
import os
import json
import glob
import concurrent.futures
import shutil

# Ensure backend directory is on sys.path
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

from occ_unfold_bridge import unfold_with_occ
from cache_manager import cleanup_memory

def process_single_step_part(args):
    """
    Worker function executed in parallel process pool for a single STEP part.
    """
    step_path, output_base_dir, kfactor, bend_style = args
    base_name = os.path.splitext(os.path.basename(step_path))[0]
    
    # Temporary staging path
    stage_dxf = os.path.join(output_base_dir, "_temp_stage", f"{base_name}.dxf")
    stage_svg = os.path.join(output_base_dir, "_temp_stage", f"{base_name}.svg")

    res = unfold_with_occ(step_path, kfactor, stage_dxf, stage_svg, bend_line_style=bend_style)
    res["step_path"] = step_path
    res["name"] = base_name
    return res

def run_batch_step_processing(file_paths, output_dir, kfactor=0.44, bend_style="tick", max_workers=None):
    """
    Processes multiple STEP files in parallel, classifies them by thickness,
    and organizes generated 2D manufacturing drawings into output folders.
    """
    os.makedirs(output_dir, exist_ok=True)
    temp_stage = os.path.join(output_dir, "_temp_stage")
    os.makedirs(temp_stage, exist_ok=True)

    # Prepare worker tasks
    tasks = [(fp, output_dir, kfactor, bend_style) for fp in file_paths if os.path.exists(fp)]
    if not tasks:
        return {"status": "error", "error": "No valid STEP files found to process."}

    num_workers = max_workers if max_workers else min(os.cpu_count() or 4, len(tasks))
    results = []

    # Multi-core process pool execution
    with concurrent.futures.ProcessPoolExecutor(max_workers=num_workers) as executor:
        futures = [executor.submit(process_single_step_part, task) for task in tasks]
        for future in concurrent.futures.as_completed(futures):
            try:
                res = future.result()
                results.append(res)
            except Exception as ex:
                results.append({"status": "error", "error": str(ex)})

    # Classification & Folder Organization
    parts_by_thickness = {}
    processed_parts = []
    error_parts = []

    for res in results:
        if res.get("status") == "success":
            thickness_key = f"{res.get('thickness', 2.0):.1f}mm"
            
            # Destination directory structure:
            # OutputDir/2D_Drawings/[Thickness]/
            thickness_drawings_dir = os.path.join(output_dir, "2D_Drawings", f"Thickness_{thickness_key}")
            flat_patterns_dir = os.path.join(output_dir, "Flat_Patterns")
            os.makedirs(thickness_drawings_dir, exist_ok=True)
            os.makedirs(flat_patterns_dir, exist_ok=True)

            base_name = res["name"]
            final_dxf_path = os.path.join(thickness_drawings_dir, f"{base_name}_2D_Drawing.dxf")
            final_svg_path = os.path.join(flat_patterns_dir, f"{base_name}_flat.svg")

            # Move staged output to final organized folders
            if os.path.exists(res["dxf_path"]):
                shutil.move(res["dxf_path"], final_dxf_path)
                res["dxf_path"] = os.path.abspath(final_dxf_path)
            if os.path.exists(res["svg_path"]):
                shutil.move(res["svg_path"], final_svg_path)
                res["svg_path"] = os.path.abspath(final_svg_path)

            res["thickness_group"] = thickness_key
            processed_parts.append(res)

            if thickness_key not in parts_by_thickness:
                parts_by_thickness[thickness_key] = []
            parts_by_thickness[thickness_key].append(res)
        else:
            error_parts.append(res)

    # Clean up temporary staging directory
    if os.path.exists(temp_stage):
        try:
            shutil.rmtree(temp_stage)
        except Exception:
            pass

    cleanup_memory()

    return {
        "status": "success",
        "total_processed": len(processed_parts),
        "total_failed": len(error_parts),
        "thickness_groups": list(parts_by_thickness.keys()),
        "parts_by_thickness": parts_by_thickness,
        "processed_parts": processed_parts,
        "failed_parts": error_parts,
        "output_directory": os.path.abspath(output_dir)
    }

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "test":
        test_files = glob.glob("3d model/*.step") + glob.glob("3d model/*.STEP")
        print(f"Testing batch processor on {len(test_files)} STEP models...")
        res = run_batch_step_processing(test_files, "exports/Batch_Test_Output")
        print(json.dumps(res, indent=2))
