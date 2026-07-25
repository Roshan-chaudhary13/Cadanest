"""
occ_unfold_bridge.py
Wraps the OCC-based sheet_unfold engine with JSON interface,
SHA-256 caching, physical 3D solid/shell body auto-discovery,
and strict C++ memory leak management.
"""

import os
import sys

def _add_occ_paths():
    candidates = [
        os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "FreeCAD_1.1.1-Windows-x86_64-py311", "bin")),
        r"C:\Program Files\FreeCAD 1.1\bin",
        r"C:\Program Files\FreeCAD 1.1\lib",
        r"C:\Program Files\FreeCAD 1.1\Mod",
    ]
    for p in candidates:
        if os.path.isdir(p) and p not in sys.path:
            sys.path.insert(0, p)

def auto_discover_base_faces(shape, faces, classification, thickness=None):
    if not faces:
        return "Face1"

    from OCC.Core.TopExp import TopExp_Explorer
    from OCC.Core.TopAbs import TopAbs_SHELL, TopAbs_SOLID, TopAbs_FACE
    from OCC.Core.TopoDS import topods

    exp_solid = TopExp_Explorer(shape, TopAbs_SOLID)
    solids = []
    while exp_solid.More():
        solids.append(topods.Solid(exp_solid.Current()))
        exp_solid.Next()

    if not solids:
        exp_shell = TopExp_Explorer(shape, TopAbs_SHELL)
        while exp_shell.More():
            solids.append(topods.Shell(exp_shell.Current()))
            exp_shell.Next()

    if not solids:
        planar_indices = [i for i, c in enumerate(classification) if c["type"] == "PLANE"]
        if not planar_indices:
            return "Face1"
        best_f = max(planar_indices, key=lambda idx: classification[idx]["area"])
        return f"Face{best_f + 1}"

    solid_roots = []
    for solid in solids:
        exp_f = TopExp_Explorer(solid, TopAbs_FACE)
        solid_face_indices = []
        while exp_f.More():
            f = topods.Face(exp_f.Current())
            for i, ref_f in enumerate(faces):
                if ref_f.IsEqual(f):
                    solid_face_indices.append(i)
                    break
            exp_f.Next()

        planar_in_solid = [i for i in solid_face_indices if classification[i]["type"] == "PLANE"]
        if planar_in_solid:
            best_f = max(planar_in_solid, key=lambda idx: classification[idx]["area"])
            solid_roots.append(best_f)

    if not solid_roots:
        planar_indices = [i for i, c in enumerate(classification) if c["type"] == "PLANE"]
        if not planar_indices:
            return "Face1"
        solid_roots = [max(planar_indices, key=lambda idx: classification[idx]["area"])]

    return ",".join([f"Face{r + 1}" for r in solid_roots])


def unfold_with_occ(step_path, kfactor, dxf_path, svg_path, base_face_name=None, exclude_bend_lines=False, bend_line_style="tick"):
    _here = os.path.dirname(os.path.abspath(__file__))
    if _here not in sys.path:
        sys.path.insert(0, _here)

    from cache_manager import compute_file_hash, get_cached_json, set_cached_json, cleanup_memory

    cache_params = {
        "kfactor": float(kfactor),
        "base_face": base_face_name,
        "exclude_bend_lines": exclude_bend_lines,
        "bend_line_style": bend_line_style
    }
    cache_key = compute_file_hash(step_path, cache_params)
    cached_result = None

    shape = None
    faces = None
    flat_shape = None
    bend_lines = None

    try:
        _add_occ_paths()

        from unfold.step_loader import load_step_file, extract_faces
        from unfold.face_graph import classify_face
        from unfold.unfolder import detect_thickness, unfold_sheet_metal
        from unfold.dxf_export import export_to_dxf_and_svg

        shape = load_step_file(step_path)
        faces = extract_faces(shape)
        classification = [classify_face(f) for f in faces]

        thickness = detect_thickness(faces, classification)
        if thickness is None:
            thickness = 2.0

        faces_meta = []
        for i, c in enumerate(classification):
            faces_meta.append({"name": f"Face{i + 1}", "type": c["type"], "area": c["area"]})

        auto_base = auto_discover_base_faces(shape, faces, classification, thickness)

        root_indices = []
        target_base_name = auto_base if (not base_face_name or base_face_name == "auto") else base_face_name

        parts = target_base_name.split(",")
        for p in parts:
            p = p.strip()
            if p.startswith("Face"):
                try:
                    idx = int(p.replace("Face", "")) - 1
                    if 0 <= idx < len(faces):
                        root_indices.append(idx)
                except ValueError:
                    pass

        if not root_indices:
            root_indices = None

        flat_shape, bend_lines = unfold_sheet_metal(shape, thickness, float(kfactor), root_indices)

        os.makedirs(os.path.dirname(os.path.abspath(dxf_path)), exist_ok=True)
        os.makedirs(os.path.dirname(os.path.abspath(svg_path)), exist_ok=True)

        export_to_dxf_and_svg(flat_shape, bend_lines, dxf_path, svg_path, exclude_bend_lines, bend_line_style)

        dxf_ok = os.path.exists(dxf_path)
        svg_ok = os.path.exists(svg_path)

        svg_content = ""
        if svg_ok:
            with open(svg_path, "r", encoding="utf-8") as f:
                svg_content = f.read()

        if base_face_name and base_face_name != "auto":
            result_base = base_face_name
        else:
            unfolded_face_names = [f"Face{r + 1}" for r in root_indices] if root_indices else [auto_base]
            result_base = ",".join(unfolded_face_names)

        result = {
            "status": "success",
            "thickness": round(thickness, 4),
            "base_face": result_base,
            "planar_face_count": len([c for c in classification if c["type"] == "PLANE"]),
            "total_face_count": len(faces),
            "dxf_exported": dxf_ok,
            "svg_exported": svg_ok,
            "bend_lines_count": len(bend_lines),
            "projection_fallback": False,
            "dxf_path": os.path.abspath(dxf_path),
            "svg_path": os.path.abspath(svg_path),
            "svg_content": svg_content,
            "faces": faces_meta,
        }

        set_cached_json(cache_key, result)
        return result

    except Exception as ex:
        import traceback
        return {
            "status": "error",
            "error": f"OCC unfold failed: {str(ex)}",
            "traceback": traceback.format_exc(),
        }
    finally:
        cleanup_memory(shape, faces, flat_shape, bend_lines)
