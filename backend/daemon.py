"""
daemon.py - Persistent Python IPC Daemon for Cadanest
Warm-loads FreeCAD, OpenCASCADE, Shapely, and ezdxf once at process startup.
Listens for line-delimited JSON-RPC requests on standard input, dispatches commands,
streams progress notifications, and enforces explicit memory cleanup.
"""

import sys
import os
import json
import traceback
import gc

# 1. Capture pristine stdout handle before redirection
raw_stdout = sys.stdout

# Redirect default sys.stdout to sys.stderr so print() statements from libraries don't pollute IPC stream
sys.stdout = sys.stderr

# Ensure project backend directory and FreeCAD environment are on sys.path
_here = os.path.dirname(os.path.abspath(__file__))
if _here not in sys.path:
    sys.path.insert(0, _here)

FREECAD_BIN_PATH = os.path.dirname(sys.executable)
if FREECAD_BIN_PATH not in sys.path:
    sys.path.append(FREECAD_BIN_PATH)

# Add DLL directory on Windows for FreeCAD / OpenCASCADE C++ libraries if available
if hasattr(os, "add_dll_directory") and os.path.exists(FREECAD_BIN_PATH):
    try:
        os.add_dll_directory(FREECAD_BIN_PATH)
    except Exception:
        pass

# Warm-load heavy libraries
try:
    import shapely
    import ezdxf
    import cache_manager
except Exception as e:
    sys.stderr.write(f"Daemon warm-load warning: {e}\n")


def send_ipc(data: dict):
    """Writes clean line-delimited JSON to raw stdout."""
    try:
        line = json.dumps(data, ensure_ascii=False)
        raw_stdout.write(line + "\n")
        raw_stdout.flush()
    except Exception as err:
        sys.stderr.write(f"IPC Send Error: {err}\n")


def send_progress(req_id: str, method: str, progress: float, message: str, extra: dict = None):
    """Sends a real-time progress notification line."""
    payload = {
        "type": "progress",
        "id": req_id,
        "method": method,
        "progress": round(progress, 2),
        "message": message
    }
    if extra:
        payload.update(extra)
    send_ipc(payload)


def handle_ping(req_id: str, params: dict) -> dict:
    return {
        "status": "success",
        "message": "pong",
        "python_executable": sys.executable,
        "pid": os.getpid()
    }


def handle_parse_dxf(req_id: str, params: dict) -> dict:
    dxf_path = params.get("dxfPath") or params.get("dxf_path")
    svg_out = params.get("svgPreviewOut") or params.get("svg_preview_out")

    if not dxf_path or not os.path.exists(dxf_path):
        return {"status": "error", "error": f"DXF file not found: {dxf_path}"}

    import nester
    poly = nester.load_polygon_from_dxf(dxf_path)
    bounds = poly.bounds

    return {
        "status": "success",
        "dxf_path": dxf_path,
        "bounds": {"min_x": bounds[0], "min_y": bounds[1], "max_x": bounds[2], "max_y": bounds[3]},
        "area": round(poly.area, 2)
    }


def handle_parse_cad_assembly(req_id: str, params: dict) -> dict:
    file_path = params.get("filePath") or params.get("file_path")
    export_dir = params.get("exportDir") or params.get("export_dir")

    if not file_path or not os.path.exists(file_path):
        return {"status": "error", "error": f"CAD file not found: {file_path}"}

    if not export_dir:
        export_dir = os.path.join(os.path.dirname(os.path.abspath(file_path)), "exports")

    import solid_edge_bridge
    return solid_edge_bridge.process_cad_file(file_path, export_dir)


def handle_parse_cad_assembly_batch(req_id: str, params: dict) -> dict:
    asm_path = params.get("asmPath") or params.get("asm_path")
    export_dir = params.get("exportDir") or params.get("export_dir")

    if not asm_path or not os.path.exists(asm_path):
        return {"status": "error", "error": f"Assembly file not found: {asm_path}", "parts": []}

    if not export_dir:
        export_dir = os.path.join(os.path.dirname(os.path.abspath(asm_path)), "exports")

    import solid_edge_bridge
    return solid_edge_bridge.convert_assembly_batch(asm_path, export_dir)


def handle_run_analyze(req_id: str, params: dict) -> dict:
    step_path = params.get("stepPath") or params.get("step_path")
    svg_out = params.get("svgPreviewOut") or params.get("svg_preview_out")
    stl_out = params.get("stlPreviewOut") or params.get("stl_preview_out")
    orig_path = params.get("originalPath") or params.get("original_path")

    if not step_path or not os.path.exists(step_path):
        return {"status": "error", "error": f"STEP file not found: {step_path}"}

    import occ_unfold_bridge
    return occ_unfold_bridge.analyze_only_with_occ(step_path, svg_out, stl_out, orig_path)


def handle_run_analyze_batch(req_id: str, params: dict) -> dict:
    items = params.get("items", [])
    if not items:
        return {"status": "success", "results": []}

    import occ_unfold_bridge
    from concurrent.futures import ThreadPoolExecutor

    def _analyze_single(item):
        step_path = item.get("stepPath") or item.get("step_path")
        svg_out = item.get("svgPreviewOut") or item.get("svg_preview_out")
        stl_out = item.get("stlPreviewOut") or item.get("stl_preview_out")
        orig_path = item.get("originalPath") or item.get("original_path")
        
        if not step_path or not os.path.exists(step_path):
            return {"status": "error", "error": f"STEP file not found: {step_path}", "step_path": step_path}

        res = occ_unfold_bridge.analyze_only_with_occ(step_path, svg_out, stl_out, orig_path)
        res["step_path"] = step_path
        return res

    max_workers = min(len(items), 8)
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        results = list(executor.map(_analyze_single, items))

    return {"status": "success", "results": results}


def handle_run_unfold(req_id: str, params: dict) -> dict:
    step_path = params.get("stepPath") or params.get("step_path")
    
    k_mode = params.get("kFactorMode") or params.get("kfactor_mode") or "manual"
    k_preset = params.get("kFactorPreset") or params.get("kfactor_preset")
    y_val = params.get("yFactor") if params.get("yFactor") is not None else params.get("y_factor")
    if y_val is not None:
        try:
            y_val = float(y_val)
        except Exception:
            y_val = None
    custom_k = params.get("kfactor")
    if custom_k is not None:
        try:
            custom_k = float(custom_k)
        except Exception:
            custom_k = 0.44

    from unfold.bend_math import get_effective_kfactor
    kfactor = get_effective_kfactor(
        mode=k_mode,
        material=params.get("material", "steel"),
        custom_k=custom_k,
        preset=k_preset,
        y_factor=y_val
    )

    dxf_out = params.get("dxfOut") or params.get("dxfPath") or params.get("dxf_out")
    svg_out = params.get("svgOut") or params.get("svgPath") or params.get("svg_out")
    base_face = params.get("baseFace") or params.get("base_face")
    exclude_bend_lines = bool(params.get("excludeBendLines") or params.get("exclude_bend_lines"))
    bend_style = params.get("bendStyle") or params.get("bend_style") or "tick"
    mirror = bool(params.get("mirror"))
    
    minimal_dimple_holes = params.get("minimalDimpleHoles")
    if minimal_dimple_holes is None:
        minimal_dimple_holes = params.get("minimal_dimple_holes")
    if minimal_dimple_holes is None:
        minimal_dimple_holes = params.get("exportMinimalDimpleHoles")
    if minimal_dimple_holes is None:
        minimal_dimple_holes = params.get("export_minimal_dimple_holes")
    if minimal_dimple_holes is None:
        minimal_dimple_holes = True
    else:
        minimal_dimple_holes = bool(minimal_dimple_holes)

    bend_radius = params.get("bendRadius") or params.get("bend_radius")
    etch_marker_position = params.get("etchMarkerPosition") or params.get("etch_marker_position") or "interior"
    etch_marker_length = float(params.get("etchMarkerLength") or params.get("etch_marker_length") or 4.5)
    
    if not step_path or not os.path.exists(step_path):
        return {"status": "error", "error": f"STEP file not found: {step_path}"}

    if not dxf_out or not svg_out:
        base_name = os.path.splitext(os.path.basename(step_path))[0]
        out_dir = os.path.join(os.path.dirname(os.path.abspath(step_path)), "exports")
        dxf_out = dxf_out or os.path.join(out_dir, f"{base_name}_unfolded.dxf")
        svg_out = svg_out or os.path.join(out_dir, f"{base_name}_unfolded.svg")

    import occ_unfold_bridge
    return occ_unfold_bridge.unfold_with_occ(
        step_path, kfactor, dxf_out, svg_out, base_face, exclude_bend_lines, bend_style, mirror, minimal_dimple_holes, bend_radius, etch_marker_position, etch_marker_length
    )


def handle_run_unfold_batch(req_id: str, params: dict) -> dict:
    items = params.get("items", [])
    if not items:
        return {"status": "success", "results": []}

    results = []
    for item in items:
        results.append(handle_run_unfold(req_id, item))

    return {"status": "success", "results": results}


def handle_run_batch_step(req_id: str, params: dict) -> dict:
    file_paths = params.get("filePaths") or params.get("file_paths") or []
    output_dir = params.get("outputDir") or params.get("output_dir")
    kfactor = float(params.get("kfactor", 0.40))
    bend_style = params.get("bendStyle") or params.get("bend_style") or "tick"

    if not file_paths:
        return {"status": "error", "error": "No file paths provided for batch STEP processing."}

    import batch_processor
    return batch_processor.run_batch_step_processing(file_paths, output_dir, kfactor, bend_style)


def handle_run_nesting(req_id: str, params: dict) -> dict:
    import nester

    def progress_cb(pct, msg=""):
        send_progress(req_id, "run_nesting", pct, msg)

    config = dict(params)
    config["progress_callback"] = progress_cb
    return nester.run_nesting_from_dict(config)


def handle_clear_cache(req_id: str, params: dict) -> dict:
    import cache_manager
    cache_manager.clear_cache_folder()
    return {"status": "success", "message": "Cache folder cleared successfully."}


def handle_calibrate_kfactor(req_id: str, params: dict) -> dict:
    target_length = float(params.get("targetFlatLength") or params.get("target_flat_length") or 0.0)
    straight_sum = float(params.get("straightSum") or params.get("straight_sum") or 0.0)
    bend_angles = params.get("bendAngles") or params.get("bend_angles") or []
    bend_radii = params.get("bendRadii") or params.get("bend_radii") or []
    thickness = float(params.get("thickness", 1.0))

    if target_length <= 0:
        return {"status": "error", "error": "Target flat length must be greater than zero."}

    try:
        from unfold.bend_math import calibrate_kfactor
        k_val = calibrate_kfactor(
            target_flat_length=target_length,
            straight_flange_sum=straight_sum,
            bend_angles=[float(a) for a in bend_angles],
            bend_radii=[float(r) for r in bend_radii],
            thickness=thickness
        )
        return {"status": "success", "kfactor": k_val}
    except Exception as ex:
        return {"status": "error", "error": f"Calibration failed: {str(ex)}"}


DISPATCH_TABLE = {
    "ping": handle_ping,
    "parse_dxf": handle_parse_dxf,
    "parse_cad_assembly": handle_parse_cad_assembly,
    "parse_cad_assembly_batch": handle_parse_cad_assembly_batch,
    "run_analyze": handle_run_analyze,
    "run_analyze_batch": handle_run_analyze_batch,
    "run_unfold": handle_run_unfold,
    "run_unfold_batch": handle_run_unfold_batch,
    "run_batch_step": handle_run_batch_step,
    "run_nesting": handle_run_nesting,
    "clear_cache": handle_clear_cache,
    "calibrate_kfactor": handle_calibrate_kfactor
}


def main():
    import atexit
    import cache_manager
    sys.stderr.write(f"Cadanest Python Daemon started [PID: {os.getpid()}]\n")
    sys.stderr.flush()

    # Clear any residual caches from previous sessions on daemon startup
    cache_manager.clear_cache_folder()
    atexit.register(cache_manager.clear_cache_folder)

    try:
        while True:
            try:
                line = sys.stdin.readline()
                if not line:
                    break

                line_str = line.strip()
                if not line_str:
                    continue

                request = json.loads(line_str)
                req_id = request.get("id")
                method = request.get("method")
                params = request.get("params", {})

                if not method or method not in DISPATCH_TABLE:
                    send_ipc({
                        "id": req_id,
                        "status": "error",
                        "error": f"Unknown method: '{method}'. Available: {list(DISPATCH_TABLE.keys())}"
                    })
                    continue

                handler = DISPATCH_TABLE[method]
                result = handler(req_id, params)

                response = {"id": req_id, "status": result.get("status", "success")}
                if result.get("status") == "error":
                    response["error"] = result.get("error", "Unknown error")
                    if "traceback" in result:
                        response["traceback"] = result["traceback"]
                else:
                    response["result"] = result

                send_ipc(response)

                cache_manager.cleanup_memory()

            except json.JSONDecodeError as err:
                send_ipc({"id": None, "status": "error", "error": f"Invalid JSON payload: {str(err)}"})
            except Exception as ex:
                sys.stderr.write(f"Daemon request unhandled exception: {traceback.format_exc()}\n")
                send_ipc({"id": None, "status": "error", "error": str(ex), "traceback": traceback.format_exc()})
                cache_manager.cleanup_memory()
    finally:
        # Guarantee full session cache wipe when daemon exits
        cache_manager.clear_cache_folder()


if __name__ == "__main__":
    main()
