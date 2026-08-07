"""
occ_unfold_bridge.py
Wraps the OCC-based sheet_unfold engine with JSON interface,
SHA-256 caching, physical 3D solid/shell body auto-discovery,
and strict C++ memory leak management.
"""

import os
import sys
import json
import math

# Import the material K-factor lookup that already exists in bend_math.
# Done at module level so analyze_only_with_occ() can return the correct
# material-specific default without repeating the lookup table anywhere else.
try:
    _here = os.path.dirname(os.path.abspath(__file__))
    if _here not in sys.path:
        sys.path.insert(0, _here)
    from unfold.bend_math import get_k_factor as _get_k_factor
    from unfold.bend_math import (
        DEFAULT_THICKNESS_MM,
        DEFAULT_ETCH_MARKER_LENGTH_MM,
        DEFAULT_BEND_STYLE,
        DEFAULT_ETCH_MARKER_POSITION,
    )
except Exception:
    def _get_k_factor(material: str = "steel") -> float:  # type: ignore[misc]
        """Fallback if bend_math unavailable at import time."""
        _K = {"mild_steel": 0.44, "stainless_steel": 0.45, "stainless": 0.45,
              "aluminum": 0.40, "aluminium": 0.40, "default": 0.44}
        key = (material or "default").lower().replace(" ", "_")
        return _K.get(key, _K["default"])
    DEFAULT_THICKNESS_MM = 2.0
    DEFAULT_ETCH_MARKER_LENGTH_MM = 4.5
    DEFAULT_BEND_STYLE = "tick"
    DEFAULT_ETCH_MARKER_POSITION = "interior"

def _add_occ_paths():
    candidates = [
        os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "FreeCAD_1.1.1-Windows-x86_64-py311", "bin")),
        r"C:\Program Files\FreeCAD 1.1\bin",
        r"C:\Program Files\FreeCAD 1.1\bin\Lib\site-packages",
        r"C:\Program Files\FreeCAD 1.1\bin\DLLs",
        r"C:\Program Files\FreeCAD 1.1\lib",
        r"C:\Program Files\FreeCAD 1.1\Mod",
    ]
    for p in candidates:
        if os.path.isdir(p):
            if p not in sys.path:
                sys.path.insert(0, p)
            if hasattr(os, "add_dll_directory"):
                try:
                    os.add_dll_directory(p)
                except Exception:
                    pass

_add_occ_paths()

def get_component_sheet_metal_status(shape, faces, classification, thickness=None):
    """
    Analyzes connected topological components of the shape and returns a set of face indices
    that belong to valid sheet-metal components.
    """
    if not faces or not classification:
        return set(range(len(faces) if faces else 0))

    try:
        from unfold.face_graph import build_face_adjacency_graph
        from unfold.unfolder import detect_thickness
        from OCC.Core.BRepAdaptor import BRepAdaptor_Surface
        from OCC.Core.BRep import BRep_Tool
        from OCC.Core.GeomAbs import GeomAbs_G1, GeomAbs_C1
        from OCC.Core.TopoDS import topods

        raw_adj = build_face_adjacency_graph(shape, faces)
        planar_indices = set(i for i, c in enumerate(classification) if c.get("type") == "PLANE")

        def is_true_bend_line(face_idx):
            if classification[face_idx].get("type") != "CYLINDER":
                return False
            try:
                surf = BRepAdaptor_Surface(faces[face_idx])
                if surf.GetType() != 1:  # 1 = GeomAbs_Cylinder
                    return False
                cyl = surf.Cylinder()
                u_min, u_max = surf.FirstUParameter(), surf.LastUParameter()
                angle_deg = abs(u_max - u_min) * (180.0 / 3.141592653589793)
                if angle_deg >= 350.0 or cyl.Radius() > 40.0:
                    return False

                neighbors = [n for n in raw_adj.get(face_idx, []) if classification[n["neighbor"]].get("type") == "PLANE"]
                if len(neighbors) < 2:
                    return False

                smooth_connections = 0
                cyl_face = faces[face_idx]
                for n in neighbors:
                    p_idx = n["neighbor"]
                    plane_face = faces[p_idx]
                    edge = n.get("edge")
                    if edge:
                        try:
                            cont = BRep_Tool.Continuity(topods.Edge(edge), cyl_face, plane_face)
                            if cont in (GeomAbs_G1, GeomAbs_C1):
                                smooth_connections += 1
                        except Exception:
                            pass

                if smooth_connections >= 2:
                    return True

                return angle_deg <= 170.0 and cyl.Radius() <= 35.0 and len(neighbors) >= 2
            except Exception:
                return False

        visited = set()
        components = []
        for idx in range(len(faces)):
            if idx not in visited:
                comp_faces = []
                q = [idx]
                visited.add(idx)
                while q:
                    curr = q.pop(0)
                    comp_faces.append(curr)
                    for neigh_info in raw_adj.get(curr, []):
                        neigh = neigh_info["neighbor"]
                        if neigh not in visited:
                            visited.add(neigh)
                            q.append(neigh)
                components.append(comp_faces)

        sheet_metal_faces = set()
        for comp in components:
            comp_class = [classification[i] for i in comp]
            comp_planars = [f_idx for f_idx in comp if f_idx in planar_indices]
            comp_cyls = [i for i in comp if classification[i].get("type") in ("CYLINDER", "HOLE_CYLINDER")]
            comp_others = [f_idx for f_idx in comp if classification[f_idx].get("type") not in ("PLANE", "CYLINDER", "HOLE_CYLINDER")]

            if not comp_planars:
                continue

            total_comp_area = sum(classification[i].get("area", 0.0) for i in comp)
            other_area = sum(classification[i].get("area", 0.0) for i in comp_others)
            if total_comp_area > 0 and (other_area / total_comp_area) > 0.15:
                continue

            comp_thick = detect_thickness([faces[i] for i in comp], comp_class)
            if comp_thick is None or comp_thick > 8.0 or comp_thick < 0.3:
                continue

            has_full_360_cyl = False
            for i in comp_cyls:
                try:
                    surf = BRepAdaptor_Surface(faces[i])
                    u_min, u_max = surf.FirstUParameter(), surf.LastUParameter()
                    angle_deg = abs(u_max - u_min) * (180.0 / 3.141592653589793)
                    if angle_deg >= 350.0:
                        has_full_360_cyl = True
                        break
                except Exception:
                    pass

            if has_full_360_cyl:
                continue

            true_bend_cyls = [i for i in comp_cyls if classification[i].get("type") == "CYLINDER" and is_true_bend_line(i)]
            is_purely_planar = len(comp_cyls) == 0 and len(comp_others) == 0

            if len(true_bend_cyls) == 0 and not is_purely_planar:
                normals = []
                for p in comp_planars:
                    n_vec = classification[p].get("normal")
                    if n_vec:
                        rounded = (round(n_vec[0], 1), round(n_vec[1], 1), round(n_vec[2], 1))
                        if not any(abs(r[0]*rounded[0] + r[1]*rounded[1] + r[2]*rounded[2]) > 0.9 for r in normals):
                            normals.append(rounded)

                if len(normals) >= 3 and len(comp_planars) >= 8:
                    continue

            comp_max_area = max(classification[i].get("area", 0.0) for i in comp_planars)
            if len(true_bend_cyls) == 0 and len(comp_planars) >= 10 and not is_purely_planar:
                continue

            if len(true_bend_cyls) == 0 and len(comp_cyls) > 30 and comp_max_area < 0.40 * total_comp_area:
                continue

            sheet_metal_faces.update(comp)

        return sheet_metal_faces
    except Exception:
        return set(range(len(faces) if faces else 0))


def auto_discover_base_faces(shape, faces, classification, thickness=None):
    if not faces or not classification:
        return "Face1"

    planar_indices = [i for i, c in enumerate(classification) if c.get("type") == "PLANE"]
    if not planar_indices:
        return "Face1"

    max_global_area = max(classification[idx].get("area", 0.0) for idx in planar_indices)
    if max_global_area <= 0:
        return f"Face{planar_indices[0] + 1}"

    # Try multi-component topological B-Rep discovery for multi-body STEP assemblies
    try:
        from unfold.face_graph import build_face_adjacency_graph
        from unfold.unfolder import find_thickness_partner, detect_thickness
        from OCC.Core.BRepAdaptor import BRepAdaptor_Surface
        from OCC.Core.BRep import BRep_Tool
        from OCC.Core.GeomAbs import GeomAbs_G1, GeomAbs_C1
        from OCC.Core.TopoDS import topods

        raw_adj = build_face_adjacency_graph(shape, faces)

        def get_face_wire_score(face_idx):
            try:
                from OCC.Core.TopExp import TopExp_Explorer
                from OCC.Core.TopAbs import TopAbs_EDGE
                exp_e = TopExp_Explorer(faces[face_idx], TopAbs_EDGE)
                cnt = 0
                while exp_e.More():
                    cnt += 1
                    exp_e.Next()
                return cnt
            except Exception:
                return 999

        def is_true_bend_line(face_idx):
            if classification[face_idx].get("type") != "CYLINDER":
                return False
            try:
                surf = BRepAdaptor_Surface(faces[face_idx])
                if surf.GetType() != 1:  # 1 = GeomAbs_Cylinder
                    return False
                cyl = surf.Cylinder()
                u_min, u_max = surf.FirstUParameter(), surf.LastUParameter()
                angle_deg = abs(u_max - u_min) * (180.0 / 3.141592653589793)
                if angle_deg >= 350.0 or cyl.Radius() > 40.0:
                    return False

                neighbors = [n for n in raw_adj.get(face_idx, []) if classification[n["neighbor"]].get("type") == "PLANE"]
                if len(neighbors) < 2:
                    return False

                smooth_connections = 0
                cyl_face = faces[face_idx]
                for n in neighbors:
                    p_idx = n["neighbor"]
                    plane_face = faces[p_idx]
                    edge = n.get("edge")
                    if edge:
                        try:
                            cont = BRep_Tool.Continuity(topods.Edge(edge), cyl_face, plane_face)
                            if cont in (GeomAbs_G1, GeomAbs_C1):
                                smooth_connections += 1
                        except Exception:
                            pass

                if smooth_connections >= 2:
                    return True

                return angle_deg <= 170.0 and cyl.Radius() <= 35.0 and len(neighbors) >= 2
            except Exception:
                return False

        visited = set()
        components = []
        for idx in range(len(faces)):
            if idx not in visited:
                comp_faces = []
                q = [idx]
                visited.add(idx)
                while q:
                    curr = q.pop(0)
                    comp_faces.append(curr)
                    for neigh_info in raw_adj.get(curr, []):
                        neigh = neigh_info["neighbor"]
                        if neigh not in visited:
                            visited.add(neigh)
                            q.append(neigh)
                components.append(comp_faces)

        valid_sheet_components = []
        for comp in components:
            comp_class = [classification[i] for i in comp]
            comp_planars = [f_idx for f_idx in comp if f_idx in planar_indices]
            comp_cyls = [i for i in comp if classification[i].get("type") in ("CYLINDER", "HOLE_CYLINDER")]
            comp_others = [f_idx for f_idx in comp if classification[f_idx].get("type") not in ("PLANE", "CYLINDER", "HOLE_CYLINDER")]

            if not comp_planars:
                continue

            # 1. Non-developable surface area ratio check (< 15%)
            total_comp_area = sum(classification[i].get("area", 0.0) for i in comp)
            other_area = sum(classification[i].get("area", 0.0) for i in comp_others)
            if total_comp_area > 0 and (other_area / total_comp_area) > 0.15:
                continue

            # 2. Strict sheet thickness check (0.3mm <= T <= 8.0mm)
            comp_thick = detect_thickness([faces[i] for i in comp], comp_class)
            if comp_thick is None or comp_thick > 8.0 or comp_thick < 0.3:
                continue

            # 3. Check for full 360-degree closed single cylinder (turned shafts / hubs)
            has_full_360_cyl = False
            for i in comp_cyls:
                try:
                    surf = BRepAdaptor_Surface(faces[i])
                    u_min, u_max = surf.FirstUParameter(), surf.LastUParameter()
                    angle_deg = abs(u_max - u_min) * (180.0 / 3.141592653589793)
                    if angle_deg >= 350.0:
                        has_full_360_cyl = True
                        break
                except Exception:
                    pass

            if has_full_360_cyl:
                continue

            # 4. Count true press-brake bend cylinders
            true_bend_cyls = [i for i in comp_cyls if classification[i].get("type") == "CYLINDER" and is_true_bend_line(i)]

            # 5. Check if component is a pillow block bearing housing
            # Skip this check for purely-planar components (flat blanks with chamfers)
            is_purely_planar = len(comp_cyls) == 0 and len(comp_others) == 0
            if len(true_bend_cyls) == 0 and not is_purely_planar:
                normals = []
                for p in comp_planars:
                    n_vec = classification[p].get("normal")
                    if n_vec:
                        rounded = (round(n_vec[0], 1), round(n_vec[1], 1), round(n_vec[2], 1))
                        if not any(abs(r[0]*rounded[0] + r[1]*rounded[1] + r[2]*rounded[2]) > 0.9 for r in normals):
                            normals.append(rounded)

                if len(normals) >= 3 and len(comp_planars) >= 8:
                    continue

            # 6. Check if component is a turned circular reel drum disc
            # Skip this check for purely-planar components (flat blanks with chamfers)
            comp_max_area = max(classification[i].get("area", 0.0) for i in comp_planars)
            if len(true_bend_cyls) == 0 and len(comp_planars) >= 10 and not is_purely_planar:
                continue

            # 7. Rejection for closed multi-facet 360-degree drum enclosures without sheet metal bends
            if len(true_bend_cyls) == 0 and len(comp_cyls) > 30 and comp_max_area < 0.40 * total_comp_area:
                continue

            candidates = [i for i in comp_planars if classification[i].get("area", 0.0) >= 0.50 * comp_max_area]
            valid_candidates = []
            for cand in candidates:
                partner = find_thickness_partner(cand, classification, faces, comp_thick)
                if partner is not None:
                    valid_candidates.append(cand)

            if not valid_candidates:
                valid_candidates = candidates

            if valid_candidates:
                max_cand_area = max(classification[i].get("area", 0.0) for i in valid_candidates)
                top_cands = [i for i in valid_candidates if classification[i].get("area", 0.0) >= 0.95 * max_cand_area]
                best_f = min(top_cands, key=lambda i: (get_face_wire_score(i), -classification[i].get("area", 0.0)))
                valid_sheet_components.append({
                    "best_face": best_f,
                    "max_area": comp_max_area,
                    "thickness": comp_thick
                })

        if not valid_sheet_components:
            # Fallback if no component passes strict filter — only consider sheet metal components
            sm_faces_set = get_component_sheet_metal_status(shape, faces, classification, thickness)
            for comp in components:
                if any(i in sm_faces_set for i in comp):
                    comp_planars = [f_idx for f_idx in comp if f_idx in planar_indices and f_idx in sm_faces_set]
                    if comp_planars:
                        comp_max_area = max(classification[i].get("area", 0.0) for i in comp_planars)
                        best_f = max(comp_planars, key=lambda i: classification[i].get("area", 0.0))
                        valid_sheet_components.append({
                            "best_face": best_f,
                            "max_area": comp_max_area,
                            "thickness": thickness or 2.0
                        })

        if not valid_sheet_components:
            return "Face1"

        max_valid_area = max(vc["max_area"] for vc in valid_sheet_components)
        best_root_faces = []
        for vc in valid_sheet_components:
            # Only include major sheet metal components (area >= 20% of largest component)
            if vc["max_area"] >= 0.20 * max_valid_area:
                best_root_faces.append((vc["best_face"], vc["thickness"]))

        # Deduplicate opposite-thickness partner faces across components
        covered = set()
        final_roots = []
        for r, t_val in best_root_faces:
            if r not in covered:
                final_roots.append(r)
                covered.add(r)
                partner = find_thickness_partner(r, classification, faces, t_val)
                if partner is not None:
                    covered.add(partner)

        if final_roots:
            return ",".join(f"Face{r + 1}" for r in final_roots)
    except Exception:
        pass

    # Single component fallback — restrict to sheet metal faces only
    try:
        sheet_metal_indices = get_component_sheet_metal_status(shape, faces, classification, thickness)
    except Exception:
        sheet_metal_indices = set(range(len(faces)))

    # Only consider sheet-metal planar faces for fallback
    sm_planar_indices = [i for i in planar_indices if i in sheet_metal_indices]
    if not sm_planar_indices:
        sm_planar_indices = planar_indices  # Last resort

    candidates = [idx for idx in sm_planar_indices if classification[idx].get("area", 0.0) >= 0.70 * max_global_area]
    if not candidates:
        candidates = sm_planar_indices

    best_f = candidates[0]
    best_area = -1.0
    min_edges = 999999

    for idx in candidates:
        area = classification[idx].get("area", 0.0)
        edges = get_face_wire_score(idx)
        if area > best_area * 0.98:
            if area > best_area * 1.02 or edges < min_edges:
                best_f = idx
                best_area = area
                min_edges = edges

    return f"Face{best_f + 1}"



def unfold_with_occ(step_path, kfactor, dxf_path, svg_path, base_face_name=None, exclude_bend_lines=False, bend_line_style=DEFAULT_BEND_STYLE, mirror=False, minimal_dimple_holes=True, bend_radius=None, etch_marker_position=DEFAULT_ETCH_MARKER_POSITION, etch_marker_length=DEFAULT_ETCH_MARKER_LENGTH_MM):
    _here = os.path.dirname(os.path.abspath(__file__))
    if _here not in sys.path:
        sys.path.insert(0, _here)

    from cache_manager import compute_file_hash, get_cached_json, set_cached_json, cleanup_memory

    cache_params = {
        "kfactor": float(kfactor),
        "base_face": base_face_name,
        "exclude_bend_lines": exclude_bend_lines,
        "bend_line_style": bend_line_style,
        "mirror": bool(mirror),
        "minimal_dimple_holes": bool(minimal_dimple_holes),
        "bend_radius": bend_radius,
        "etch_marker_position": etch_marker_position,
        "etch_marker_length": float(etch_marker_length)
    }
    cache_key = compute_file_hash(step_path, cache_params)
    cached_result = get_cached_json(cache_key)
    if cached_result and cached_result.get("status") == "success" and os.path.exists(dxf_path) and os.path.exists(svg_path):
        if not cached_result.get("svg_content") and os.path.exists(svg_path):
            try:
                with open(svg_path, "r", encoding="utf-8") as f:
                    cached_result["svg_content"] = f.read()
            except Exception:
                pass
        return cached_result

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
            thickness = DEFAULT_THICKNESS_MM

        faces_meta = []
        for i, c in enumerate(classification):
            faces_meta.append({"name": f"Face{i + 1}", "type": c["type"], "area": c["area"]})

        if not base_face_name or base_face_name == "auto":
            auto_base = auto_discover_base_faces(shape, faces, classification, thickness)
            target_base_name = auto_base
        else:
            target_base_name = base_face_name

        root_indices = []
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

        target_idx = root_indices[0] if root_indices else None

        # If shape is a multi-body STEP compound, isolate the specific sub-solid for target_idx
        # so unfolding takes < 0.05s instead of parsing all 1200+ compound faces.
        unfold_shape = shape
        local_root_idx = target_idx
        if target_idx is not None and 0 <= target_idx < len(faces):
            target_f = faces[target_idx]
            from OCC.Core.TopExp import TopExp_Explorer
            from OCC.Core.TopAbs import TopAbs_SOLID
            from OCC.Core.TopoDS import topods

            exp_sol = TopExp_Explorer(shape, TopAbs_SOLID)
            solids = []
            while exp_sol.More():
                solids.append(topods.Solid(exp_sol.Current()))
                exp_sol.Next()

            if len(solids) > 1:
                best_match = None
                for sol in solids:
                    sub_faces = extract_faces(sol)
                    for i, sf in enumerate(sub_faces):
                        if sf.IsSame(target_f) or sf.IsEqual(target_f) or sf.IsPartner(target_f):
                            best_match = (sol, i, sub_faces)
                            break
                    if best_match is not None:
                        break

                if best_match is not None:
                    unfold_shape, local_root_idx, sub_faces = best_match
                    try:
                        sub_class = [classify_face(sf) for sf in sub_faces]
                        sol_thick = detect_thickness(sub_faces, sub_class)
                        if sol_thick is not None and 0.3 <= sol_thick <= 8.0:
                            thickness = sol_thick
                    except Exception:
                        pass


        br_val = None
        if bend_radius is not None:
            try:
                br_val = float(bend_radius)
            except ValueError:
                pass

        flat_shape, bend_lines = unfold_sheet_metal(unfold_shape, thickness, float(kfactor), local_root_idx, mirror=bool(mirror), bend_radius=br_val)

        os.makedirs(os.path.dirname(os.path.abspath(dxf_path)), exist_ok=True)
        os.makedirs(os.path.dirname(os.path.abspath(svg_path)), exist_ok=True)

        export_to_dxf_and_svg(flat_shape, bend_lines, dxf_path, svg_path, exclude_bend_lines, bend_line_style, minimal_dimple_holes, etch_marker_position=etch_marker_position, etch_marker_length=float(etch_marker_length), kfactor=float(kfactor))

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
            "mirror": bool(mirror),
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


# Shared material alias catalog: (matched string, code, canonical name, density kg/m^3).
# Single source of truth for material name/code/density lookups — also imported by
# solid_edge_bridge.py so the two bridges can't drift out of sync.
MATERIAL_CATALOG = [
    ("Aluminum, 1060", "AL6061", "Aluminum 1060", 2700),
    ("Aluminum 1060", "AL6061", "Aluminum 1060", 2700),
    ("Aluminum 6061", "AL6061", "Aluminium 6061", 2700),
    ("Aluminium 6061", "AL6061", "Aluminium 6061", 2700),
    ("Aluminum 5052", "AL5052", "Aluminium 5052", 2680),
    ("Aluminium 5052", "AL5052", "Aluminium 5052", 2680),
    ("Aluminum", "AL6061", "Aluminium", 2700),
    ("Aluminium", "AL6061", "Aluminium", 2700),
    ("Steel, structural", "MS", "Steel, Structural", 7850),
    ("Structural Steel", "MS", "Steel, Structural", 7850),
    ("Stainless Steel 304", "SS304", "Stainless Steel 304", 7930),
    ("SS304", "SS304", "Stainless Steel 304", 7930),
    ("Stainless Steel 316", "SS316", "Stainless Steel 316", 8000),
    ("SS316", "SS316", "Stainless Steel 316", 8000),
    ("Copper", "Cu", "Copper", 8960),
    ("Brass", "Brass", "Brass", 8500),
    ("Galvanized Iron", "GI", "Galvanized Iron", 7850),
    ("Galvanized", "GI", "Galvanized Iron", 7850),
    ("CRCA Sheet", "CRCA", "CRCA Sheet", 7850),
    ("CRCA", "CRCA", "CRCA Sheet", 7850),
    ("Mild Steel", "MS", "Mild Steel", 7850),
    ("IS2062", "MS", "Mild Steel", 7850),
    ("Steel", "MS", "Mild Steel", 7850),
]


def extract_material_metadata(file_path, original_psm_path=None):
    """
    Extracts sheet metal material, code, and density from OLE streams in .psm / .par / .asm files,
    matching exact file target paths.
    """
    catalog = MATERIAL_CATALOG

    default_res = {"material_code": "MS", "material_name": "Mild Steel", "density": 7850}

    target_paths = []
    if original_psm_path and os.path.exists(original_psm_path):
        target_paths.append(original_psm_path)

    base, _ = os.path.splitext(file_path)
    psm_candidate = base + ".psm"
    if os.path.exists(psm_candidate) and psm_candidate not in target_paths:
        target_paths.append(psm_candidate)
        
    if os.path.exists(file_path) and file_path not in target_paths:
        target_paths.append(file_path)

    try:
        import olefile
        for target_path in target_paths:
            if olefile.isOleFile(target_path):
                ole = olefile.OleFileIO(target_path)
                raw_bytes = b"".join([ole.openstream(s).read() for s in ole.listdir()])
                ole.close()

                u16_text = raw_bytes.decode("utf-16le", errors="ignore").upper()
                u8_text = raw_bytes.decode("utf-8", errors="ignore").upper()

                for name, code, full_name, dens in catalog:
                    pattern = name.upper()
                    if pattern in u16_text or pattern in u8_text:
                        return {"material_code": code, "material_name": full_name, "density": dens}
    except Exception:
        pass

    return default_res


def analyze_only_with_occ(step_path, svg_preview_path=None, stl_preview_path=None, original_psm_path=None):
    """
    Fast in-memory OpenCASCADE 3D geometry analysis, face topology classification,
    thickness detection, OLE material metadata extraction, and STL preview mesh generation in < 0.1s.
    """
    try:
        _add_occ_paths()
        from unfold.step_loader import load_step_file, extract_faces
        from unfold.face_graph import classify_face
        from unfold.unfolder import detect_thickness

        shape = load_step_file(step_path)
        faces = extract_faces(shape)
        classification = [classify_face(f) for f in faces]
        thickness = detect_thickness(faces, classification)
        if thickness is None:
            thickness = DEFAULT_THICKNESS_MM

        sheet_metal_indices = get_component_sheet_metal_status(shape, faces, classification, thickness)
        faces_meta = [
            {
                "name": f"Face{i + 1}",
                "type": c["type"],
                "area": c["area"],
                "is_sheet_metal": (i in sheet_metal_indices)
            }
            for i, c in enumerate(classification)
        ]

        auto_base = auto_discover_base_faces(shape, faces, classification, thickness)

        from OCC.Core.Bnd import Bnd_Box
        from OCC.Core.BRepBndLib import brepbndlib
        bbox = Bnd_Box()
        brepbndlib.Add(shape, bbox)
        xmin, ymin, zmin, xmax, ymax, zmax = bbox.Get()
        dx = round(abs(xmax - xmin), 2)
        dy = round(abs(ymax - ymin), 2)
        dz = round(abs(zmax - zmin), 2)

        mat_meta = extract_material_metadata(step_path, original_psm_path)

        if stl_preview_path:
            try:
                from OCC.Core.BRepMesh import BRepMesh_IncrementalMesh
                from OCC.Core.StlAPI import StlAPI_Writer
                os.makedirs(os.path.dirname(os.path.abspath(stl_preview_path)), exist_ok=True)
                BRepMesh_IncrementalMesh(shape, 1.2)
                writer = StlAPI_Writer()
                writer.Write(shape, stl_preview_path)
            except Exception:
                pass

        # Extract bend cylindrical face topology metadata for calibration & R/T calculations
        cyl_faces = [c for c in classification if c["type"] in ("CYLINDER", "Cylinder")]
        bend_angles = [round(float(c.get("angle", 90.0)), 2) for c in cyl_faces if c.get("is_inner", True)]
        bend_radii = [round(float(c.get("radius", 1.0)), 3) for c in cyl_faces if c.get("is_inner", True)]
        if not bend_angles:
            # Fallback if inner/outer classification split not populated
            bend_angles = [round(float(c.get("angle", 90.0)), 2) for c in cyl_faces[::2]] if cyl_faces else []
            bend_radii = [round(float(c.get("radius", 1.0)), 3) for c in cyl_faces[::2]] if cyl_faces else []
        
        planar_areas = [c["area"] for c in classification if c["type"] in ("PLANE", "Plane")]
        # Estimate straight leg sum from major planar faces
        straight_flange_sum = round(sum(math.sqrt(a) for a in sorted(planar_areas, reverse=True)[:max(2, len(bend_angles) + 1)]), 2) if planar_areas else round(max(dx, dy), 2)

        bend_summary = {
            "bend_count": len(bend_angles),
            "bend_angles": bend_angles,
            "bend_radii": bend_radii,
            "straight_sum": straight_flange_sum,
            "avg_radius": round(sum(bend_radii) / len(bend_radii), 3) if bend_radii else 1.0
        }

        # Derive a material-specific K-factor default from the K_FACTORS
        # table in bend_math.py. This is the same table Fusion 360 / SigmaNEST
        # use as their per-material neutral-axis preset (mild steel → 0.44,
        # stainless → 0.45, aluminium → 0.40). The STEP file has no memory of
        # the originating CAD tool's K convention, so a material lookup is the
        # best available heuristic until the user calibrates per-part.
        default_kfactor = _get_k_factor(mat_meta["material_name"])

        return {
            "status": "success",
            "thickness": round(thickness, 2),
            "kfactor": default_kfactor,
            "material": mat_meta["material_code"],
            "material_name": mat_meta["material_name"],
            "density": mat_meta["density"],
            "base_face": auto_base,
            "planar_face_count": len([c for c in classification if c["type"] in ("PLANE", "Plane")]),
            "total_face_count": len(faces),
            "dimensions": {"x": dx, "y": dy, "z": dz},
            "faces": faces_meta,
            "bend_summary": bend_summary,
            "stl_preview_path": os.path.abspath(stl_preview_path) if stl_preview_path else None,
            "svg_preview_content": ""
        }
    except Exception as ex:
        import traceback
        return {
            "status": "error",
            "error": f"OCC analysis failed: {str(ex)}",
            "traceback": traceback.format_exc()
        }


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"status": "error", "error": "Missing arguments."}))
        sys.exit(1)

    mode = sys.argv[1]
    if mode == "analyze":
        step = sys.argv[2]
        svg_p = sys.argv[3] if len(sys.argv) > 3 else None
        stl_p = sys.argv[4] if len(sys.argv) > 4 else None
        orig_p = sys.argv[5] if len(sys.argv) > 5 else None
        res = analyze_only_with_occ(step, svg_p, stl_p, orig_p)
        print(json.dumps(res))
    elif mode == "unfold":
        step = sys.argv[2]
        k_fact = sys.argv[3]
        dxf_out = sys.argv[4]
        svg_out = sys.argv[5]
        b_face = sys.argv[6] if len(sys.argv) > 6 else None
        ex_bend = len(sys.argv) > 7 and sys.argv[7].lower() == "true"
        b_style = sys.argv[8] if len(sys.argv) > 8 else DEFAULT_BEND_STYLE
        mir = len(sys.argv) > 9 and sys.argv[9].lower() == "true"
        res = unfold_with_occ(step, k_fact, dxf_out, svg_out, b_face, ex_bend, b_style, mir)
        print(json.dumps(res))

