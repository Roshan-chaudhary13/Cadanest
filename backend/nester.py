import sys
import os
import json
import uuid
import math
import tempfile

# Append FreeCAD paths to sys.path so pythonOCC can be found
FREECAD_BIN_PATH = os.path.dirname(sys.executable)
if FREECAD_BIN_PATH not in sys.path:
    sys.path.append(FREECAD_BIN_PATH)

# Append current directory to sys.path to find the unfold package
_here = os.path.dirname(os.path.abspath(__file__))
if _here not in sys.path:
    sys.path.insert(0, _here)

try:
    from shapely.geometry import Polygon, box
    from shapely.affinity import translate, rotate
    from shapely.strtree import STRtree
except Exception as e:
    print(json.dumps({"status": "error", "error": f"Failed to import shapely libraries: {str(e)}"}))
    sys.exit(1)

try:
    from unfold.bend_math import DEFAULT_ETCH_MARKER_LENGTH_MM, DEFAULT_BEND_STYLE, DEFAULT_ETCH_MARKER_POSITION
except Exception:
    DEFAULT_ETCH_MARKER_LENGTH_MM = 4.5
    DEFAULT_BEND_STYLE = "tick"
    DEFAULT_ETCH_MARKER_POSITION = "interior"


def load_polygon_from_dxf(dxf_path):
    import ezdxf
    from ezdxf import path
    import shapely.geometry as sg
    from shapely.ops import polygonize, unary_union

    filename = os.path.basename(dxf_path)
    if '__MACOSX' in dxf_path or filename.startswith('._'):
        raise ValueError(f"File '{filename}' is inside a __MACOSX archive folder containing macOS metadata, not a 2D DXF vector drawing file. Please select the DXF file from the main extracted folder.")

    # Pre-check if file is a plain text summary file rather than a DXF drawing
    try:
        with open(dxf_path, 'r', encoding='utf-8', errors='ignore') as check_f:
            first_lines = [check_f.readline().strip() for _ in range(10)]
            non_empty = [l for l in first_lines if l]
            if non_empty and all(l.startswith('#') or l.startswith('//') for l in non_empty):
                raise ValueError(f"File '{filename}' is a plain text summary report rather than a 2D DXF vector drawing file.")
    except ValueError:
        raise
    except Exception:
        pass

    doc = None
    try:
        doc = ezdxf.readfile(dxf_path)
    except Exception as err1:
        try:
            from ezdxf import recover
            doc, auditor = recover.readfile(dxf_path)
        except Exception as err2:
            try:
                doc = ezdxf.readfile(dxf_path, encoding='cp1252')
            except Exception:
                raise ValueError(f"File '{filename}' is not a valid DXF vector file or has corrupt structure ({str(err1)}).")

    msp = doc.modelspace()

    BEND_LAYER_KEYWORDS = {
        'UP_CENTERLINES', 'DOWN_CENTERLINES', 'BEND', 'BENDS', 'BEND_UP', 
        'BEND_DOWN', 'BEND_LINES', 'BEND_LINE', 'CENTER', 'CENTERLINES', 
        'CENTERLINE', 'AXIS', 'ANNOTATION', 'DIMENSION', 'DIMS', 'TEXT'
    }

    PROFILE_LAYER_KEYWORDS = {
        'OUTER_LOOP', 'CUT', 'CONTOUR', 'PROFILE', 'OUTER'
    }

    layers_in_doc = set(e.dxf.layer for e in msp)

    # 1. Identify cut layers vs bend layers
    cut_layers = set()
    for l in layers_in_doc:
        l_upper = l.upper()
        if any(kw in l_upper for kw in PROFILE_LAYER_KEYWORDS):
            cut_layers.add(l)

    if not cut_layers:
        # Fallback: all layers EXCEPT bend layers
        for l in layers_in_doc:
            l_upper = l.upper()
            if not any(kw in l_upper for kw in BEND_LAYER_KEYWORDS):
                cut_layers.add(l)

    if not cut_layers:
        cut_layers = layers_in_doc

    cut_entities = [e for e in msp if e.dxf.layer in cut_layers and e.dxftype() in ('LINE', 'LWPOLYLINE', 'POLYLINE', 'ARC', 'CIRCLE', 'SPLINE', 'ELLIPSE', 'INSERT', 'SOLID', '3DFACE')]
    if not cut_entities:
        raise ValueError("No valid profile/cut curve entities found in the DXF file.")

    edges = []
    for entity in cut_entities:
        try:
            if entity.dxftype() == 'INSERT':
                # Decompose block references into virtual primitive entities
                try:
                    for sub_entity in entity.virtual_entities():
                        try:
                            p = path.make_path(sub_entity)
                            pts = [(round(v.x, 3), round(v.y, 3)) for v in p.flattening(distance=0.15)]
                            if len(pts) >= 2:
                                edges.append(sg.LineString(pts))
                        except Exception:
                            pass
                except Exception:
                    pass
            else:
                p = path.make_path(entity)
                pts = [(round(v.x, 3), round(v.y, 3)) for v in p.flattening(distance=0.15)]
                if len(pts) >= 2:
                    edges.append(sg.LineString(pts))
        except Exception:
            pass

    if not edges:
        raise ValueError("Could not extract any valid edges from the DXF file.")

    unioned = unary_union(edges)
    polys = list(polygonize(unioned))
    if not polys:
        convex_hull = unioned.convex_hull
        if isinstance(convex_hull, sg.Polygon):
            return convex_hull
        elif hasattr(unioned, 'envelope') and isinstance(unioned.envelope, sg.Polygon):
            return unioned.envelope
        else:
            raise ValueError("No closed polygons could be formed from the DXF file edges.")

    # Reconstruct the full outer boundary of parts split by internal lines (e.g. bend tangent lines)
    # A polygon is an outer region if it is not contained within the solid version of any other polygon.
    outer_regions = []
    holes = []
    for p in polys:
        is_hole = False
        for other in polys:
            if other != p:
                solid_other = sg.Polygon(other.exterior)
                if solid_other.contains(p):
                    is_hole = True
                    break
        if is_hole:
            holes.append(p)
        else:
            outer_regions.append(p)

    if not outer_regions:
        outer_regions = polys

    # Take exterior boundary union of outer regions to eliminate internal bend line cuts
    solid_outers = [sg.Polygon(p.exterior) for p in outer_regions]
    outer = unary_union(solid_outers)

    # Eliminate double-angle kink vertices across bend areas, leaving a single continuous edge / single angle vertex
    if isinstance(outer, sg.Polygon):
        try:
            from unfold.dxf_export import simplify_bend_double_angles
            outer = simplify_bend_double_angles(outer, tolerance=0.8)
        except Exception:
            pass

    for hole in holes:
        if outer.contains(hole.centroid):
            outer = outer.difference(hole)

    # Process explicit INTERIOR_LOOPS entities (circles, stadium slot holes, polylines)
    for entity in msp:
        if any(kw in entity.dxf.layer.upper() for kw in ('INTERIOR', 'HOLE', 'HOLES', 'CUTOUT')):
            try:
                if entity.dxftype() == 'CIRCLE':
                    c = (entity.dxf.center.x, entity.dxf.center.y)
                    r = entity.dxf.radius
                    h_poly = sg.Point(c).buffer(r, resolution=32)
                    if isinstance(outer, sg.Polygon) and outer.contains(h_poly.centroid):
                        outer = outer.difference(h_poly)
                elif entity.dxftype() == 'LWPOLYLINE':
                    pts = [(round(p[0], 4), round(p[1], 4)) for p in entity.get_points('xy')]
                    if len(pts) >= 3:
                        h_poly = sg.Polygon(pts)
                        if h_poly.is_valid and isinstance(outer, sg.Polygon) and outer.contains(h_poly.centroid):
                            outer = outer.difference(h_poly)
            except Exception:
                pass

    return outer


def unfold_part_to_temp_dxf(step_path, kfactor, base_face_name=None, minimal_dimple_holes=True, bend_radius=None, etch_marker_position=DEFAULT_ETCH_MARKER_POSITION, etch_marker_length=DEFAULT_ETCH_MARKER_LENGTH_MM):
    from occ_unfold_bridge import unfold_with_occ
    
    fd, temp_dxf = tempfile.mkstemp(suffix=".dxf", prefix="nest_temp_")
    os.close(fd)
    temp_svg = temp_dxf.replace(".dxf", ".svg")
    
    unfold_with_occ(
        step_path=step_path,
        kfactor=kfactor,
        dxf_path=temp_dxf,
        svg_path=temp_svg,
        base_face_name=base_face_name,
        minimal_dimple_holes=minimal_dimple_holes,
        bend_radius=bend_radius,
        etch_marker_position=etch_marker_position,
        etch_marker_length=etch_marker_length
    )
    return temp_dxf


def polygon_to_svg_path(poly):
    if poly.geom_type == "MultiPolygon":
        paths = []
        for sub_poly in poly.geoms:
            paths.append(polygon_to_svg_path(sub_poly))
        return " ".join(paths)
        
    coords = list(poly.exterior.coords)
    d = "M " + " L ".join(f"{x:.1f} {y:.1f}" for x, y in coords) + " Z"
    for interior in poly.interiors:
        icoords = list(interior.coords)
        d += " M " + " L ".join(f"{x:.1f} {y:.1f}" for x, y in icoords) + " Z"
    return d


def filter_candidates(cands, min_step=2.0):
    if not cands:
        return []
    sorted_cands = sorted(list(cands))
    filtered = [sorted_cands[0]]
    for c in sorted_cands[1:]:
        if c - filtered[-1] >= min_step:
            filtered.append(c)
    return filtered


def _build_candidates(packed_polygons, margin, min_step):
    """Candidate anchor coordinates for placement: sheet margin + bbox corners,
    midpoints, and interior hole bounds of every already-packed part for hole-in-hole packing."""
    X_cands = {margin}
    Y_cands = {margin}
    for packed in packed_polygons:
        minx, miny, maxx, maxy = packed.bounds
        X_cands.add(minx)
        X_cands.add(maxx)
        X_cands.add((minx + maxx) / 2.0)
        Y_cands.add(miny)
        Y_cands.add(maxy)
        Y_cands.add((miny + maxy) / 2.0)

        # Hole-in-Hole interior anchor support
        if hasattr(packed, 'interiors') and packed.interiors:
            for hole in packed.interiors:
                from shapely.geometry import Polygon
                hole_poly = Polygon(hole)
                h_minx, h_miny, h_maxx, h_maxy = hole_poly.bounds
                X_cands.add(h_minx)
                X_cands.add((h_minx + h_maxx) / 2.0)
                Y_cands.add(h_miny)
                Y_cands.add((h_miny + h_maxy) / 2.0)

    return filter_candidates(X_cands, min_step=min_step), filter_candidates(Y_cands, min_step=min_step)


def _squeeze_blf(r_poly, dx, dy, packed_polygons, tree, prep_sheet):
    """
    Squeezes placed polygon towards bottom-left origin as far as possible
    without colliding with existing polygons or sheet boundaries.
    """
    if not packed_polygons or tree is None:
        return dx, dy

    cur_x, cur_y = dx, dy
    packed_bounds = [p.bounds for p in packed_polygons]

    # Slide left (X)
    for step in [10.0, 5.0, 2.0, 1.0, 0.5]:
        while True:
            test_x = cur_x - step
            if test_x < 0:
                break
            t_poly = translate(r_poly, test_x, cur_y)
            if not prep_sheet.contains(t_poly):
                break
            tb = t_poly.bounds
            overlap = False
            for idx in tree.query(t_poly):
                pb = packed_bounds[idx]
                if tb[0] >= pb[2] - 1e-3 or tb[2] <= pb[0] + 1e-3 or tb[1] >= pb[3] - 1e-3 or tb[3] <= pb[1] + 1e-3:
                    continue
                if t_poly.intersects(packed_polygons[idx]) and not t_poly.touches(packed_polygons[idx]):
                    overlap = True
                    break
            if not overlap:
                cur_x = test_x
            else:
                break

    # Slide down (Y)
    for step in [10.0, 5.0, 2.0, 1.0, 0.5]:
        while True:
            test_y = cur_y - step
            if test_y < 0:
                break
            t_poly = translate(r_poly, cur_x, test_y)
            if not prep_sheet.contains(t_poly):
                break
            tb = t_poly.bounds
            overlap = False
            for idx in tree.query(t_poly):
                pb = packed_bounds[idx]
                if tb[0] >= pb[2] - 1e-3 or tb[2] <= pb[0] + 1e-3 or tb[1] >= pb[3] - 1e-3 or tb[3] <= pb[1] + 1e-3:
                    continue
                if t_poly.intersects(packed_polygons[idx]) and not t_poly.touches(packed_polygons[idx]):
                    overlap = True
                    break
            if not overlap:
                cur_y = test_y
            else:
                break

    return cur_x, cur_y


def _best_placement(cand, packed_polygons, tree, X_cands, Y_cands, rotations, s_maxx, s_maxy, prep_sheet):
    """True Bottom-Left-Fill selection using simplified outer boundary geometry for ultra-fast placement,
    retaining full exact vector accuracy for export."""
    best_x = best_y = best_theta = None
    best_score = (float('inf'), float('inf'))

    base_poly = cand.get("simplified_polygon")
    if base_poly is None:
        try:
            ext_poly = Polygon(cand["buffered_polygon"].exterior)
            base_poly = ext_poly.simplify(tolerance=0.5, preserve_topology=False)
        except Exception:
            base_poly = cand["buffered_polygon"]
        cand["simplified_polygon"] = base_poly

    packed_bounds = [p.bounds for p in packed_polygons] if packed_polygons else []

    for theta in rotations:
        r_poly = rotate(base_poly, theta, origin=(0, 0), use_radians=True)
        minx, miny, maxx, maxy = r_poly.bounds
        width = maxx - minx
        height = maxy - miny

        for y in Y_cands:
            if (y, X_cands[0]) >= best_score:
                break
            if y + height > s_maxy:
                continue
            dy = y - miny

            for x in X_cands:
                if (y, x) >= best_score:
                    break
                if x + width > s_maxx:
                    continue
                dx = x - minx

                t_poly = translate(r_poly, dx, dy)
                if not prep_sheet.contains(t_poly):
                    continue

                overlap = False
                if tree is not None:
                    tb = t_poly.bounds
                    for idx in tree.query(t_poly):
                        pb = packed_bounds[idx]
                        if tb[0] >= pb[2] - 1e-3 or tb[2] <= pb[0] + 1e-3 or tb[1] >= pb[3] - 1e-3 or tb[3] <= pb[1] + 1e-3:
                            continue
                        packed = packed_polygons[idx]
                        if t_poly.intersects(packed) and not t_poly.touches(packed):
                            overlap = True
                            break

                if not overlap:
                    # Squeeze towards origin for tightest fit
                    sq_x, sq_y = _squeeze_blf(r_poly, dx, dy, packed_polygons, tree, prep_sheet)
                    score = (sq_y, sq_x)
                    if score < best_score:
                        best_score = score
                        best_x, best_y, best_theta = sq_x, sq_y, theta
                    break

    return best_x, best_y, best_theta


def _place_result(cand, dx, dy, theta, packed_polygons, packed_results, allow_part_in_part=True):
    base_poly = cand.get("simplified_polygon", cand["buffered_polygon"])
    placed_simplified = translate(
        rotate(base_poly, theta, origin=(0, 0), use_radians=True), dx, dy
    )
    if not allow_part_in_part and hasattr(placed_simplified, 'exterior'):
        try:
            filled_poly = Polygon(placed_simplified.exterior.coords)
            packed_polygons.append(filled_poly)
        except Exception:
            packed_polygons.append(placed_simplified)
    else:
        packed_polygons.append(placed_simplified)

    placed_original = translate(
        rotate(cand["polygon"], theta, origin=(0, 0), use_radians=True), dx, dy
    )
    packed_results.append({
        "part_id": cand["part_id"],
        "name": cand["name"],
        "index": cand["index"],
        "dx": dx,
        "dy": dy,
        "rotation": theta,
        "original_polygon": placed_original,
        "dxf_path": cand["dxf_path"]
    })


def pack_on_single_sheet(instances, sheet_poly, rotations, margin, break_on_skip=False):
    from shapely.prepared import prep
    prep_sheet = prep(sheet_poly)
    packed_polygons = []
    packed_results = []
    skipped_results = []

    s_minx, s_miny, s_maxx, s_maxy = sheet_poly.bounds
    total_len = len(instances)
    unpacked_pool = list(instances)

    i = 0
    consecutive_skips = 0

    while i < len(unpacked_pool):
        inst = unpacked_pool[i]

        # Use fine min_step (1.5mm to 3.0mm) for maximum nesting density
        min_step = 1.5 if len(packed_polygons) <= 30 else 2.5
        X_cands, Y_cands = _build_candidates(packed_polygons, margin, min_step)
        tree = STRtree(packed_polygons) if packed_polygons else None

        best_x, best_y, best_theta = _best_placement(
            inst, packed_polygons, tree, X_cands, Y_cands, rotations, s_maxx, s_maxy, prep_sheet
        )

        if best_theta is not None:
            _place_result(inst, best_x, best_y, best_theta, packed_polygons, packed_results)
            unpacked_pool.pop(i)
            consecutive_skips = 0

            # Emit live dynamic progress JSON to stdout
            if len(packed_results) % 5 == 0 or not unpacked_pool:
                pct = min(99, int((len(packed_results) / max(1, total_len)) * 100))
                msg = f"Placed {len(packed_results)} / {total_len} blanks on sheet..."
                sys.stdout.write(json.dumps({"type": "progress", "pct": pct, "msg": msg, "packed": len(packed_results)}) + "\n")
                sys.stdout.flush()
        else:
            consecutive_skips += 1
            i += 1

            if consecutive_skips >= 3:
                progress = True
                while progress:
                    progress = False
                    n_packed = len(packed_polygons)
                    min_step = 1.0
                    X_cands, Y_cands = _build_candidates(packed_polygons, margin, min_step)
                    tree = STRtree(packed_polygons) if packed_polygons else None

                    remaining = unpacked_pool[i:]
                    order = sorted(range(len(remaining)), key=lambda k: remaining[k]["buffered_polygon"].area)

                    for rel_idx in order:
                        cand = remaining[rel_idx]
                        b_x, b_y, b_th = _best_placement(
                            cand, packed_polygons, tree, X_cands, Y_cands, rotations, s_maxx, s_maxy, prep_sheet
                        )
                        if b_th is not None:
                            _place_result(cand, b_x, b_y, b_th, packed_polygons, packed_results)
                            unpacked_pool.pop(i + rel_idx)
                            progress = True
                            consecutive_skips = 0
                            break

                break

    # Anything still in the pool here was never placed (every removal above
    # is paired with a packed_results append), so this is exactly what's
    # left over - covers both the early break above and the loop running to
    # its natural end without ever hitting the consecutive-skip streak.
    skipped_results.extend(unpacked_pool)
    return packed_results, skipped_results, packed_polygons


def run_nesting_from_dict(config: dict) -> dict:
    sheet_w = float(config.get("sheet_width", 2500))
    sheet_h = float(config.get("sheet_height", 1250))
    spacing = float(config.get("spacing", 5.0))
    margin = float(config.get("margin", 5.0))
    parts_list = config.get("parts", [])
    export_dxf_path = config.get("export_dxf_path", "")
    auto_fill = config.get("auto_fill", False)
    exclude_bend_lines = config.get("exclude_bend_lines", False)
    bend_style = str(config.get("bend_style") or config.get("bendStyle") or DEFAULT_BEND_STYLE).lower()
    rotations_deg = config.get("rotations", [0.0, 90.0, 180.0, 270.0])
    rotations = [math.radians(r) for r in rotations_deg]
    minimal_dimple_holes = config.get("export_minimal_dimple_holes", True)
    global_etch_pos = config.get("etch_marker_position") or config.get("etchMarkerPosition") or DEFAULT_ETCH_MARKER_POSITION
    global_etch_len = float(config.get("etch_marker_length") or config.get("etchMarkerLength") or DEFAULT_ETCH_MARKER_LENGTH_MM)
    
    if not export_dxf_path:
        return {"status": "error", "error": "Missing export_dxf_path in config."}

    # 1. Load and flatten each unique part template
    part_templates = {}
    errors = []
    temp_files = []

    try:
        for p in parts_list:
            part_id = p["id"]
            step_path = p.get("step_path", "")
            dxf_path = p.get("dxf_path", None)
            kfactor = p.get("kfactor", 0.44)
            base_face = p.get("base_face", None)
            quantity = int(p.get("quantity", 1)) # Qty per set
            name = p.get("name", os.path.basename(step_path) if step_path else "DXF Part")
            group = p.get("group", None)
            bend_radius = p.get("bend_radius", None)
            p_etch_pos = p.get("etch_marker_position") or p.get("etchMarkerPosition") or global_etch_pos
            p_etch_len = float(p.get("etch_marker_length") or p.get("etchMarkerLength") or global_etch_len)

            try:
                poly = None
                resolved_dxf_path = dxf_path

                # Try loading geometry from DXF if path provided and exists
                if resolved_dxf_path and os.path.exists(resolved_dxf_path):
                    try:
                        poly = load_polygon_from_dxf(resolved_dxf_path)
                    except Exception as dxf_err:
                        errors.append(f"Failed to load from DXF for {name}: {str(dxf_err)}. Trying OCC fallback.")

                # Fallback: Run OCC unfold to memory, write temporary DXF, and load
                if poly is None and step_path and os.path.exists(step_path):
                    try:
                        temp_dxf = unfold_part_to_temp_dxf(step_path, kfactor, base_face, minimal_dimple_holes, bend_radius, p_etch_pos, p_etch_len)
                        temp_files.append(temp_dxf)
                        resolved_dxf_path = temp_dxf
                        poly = load_polygon_from_dxf(resolved_dxf_path)
                    except Exception as occ_err:
                        raise Exception(f"OCC Unfolding fallback failed: {str(occ_err)}")

                # Normalize polygon coordinates to origin (0, 0) for 100% exact alignment
                bounds = poly.bounds
                minx_off, miny_off = bounds[0], bounds[1]
                if abs(minx_off) > 1e-4 or abs(miny_off) > 1e-4:
                    poly = translate(poly, -minx_off, -miny_off)
                    bounds = poly.bounds

                dim_min = min(bounds[2] - bounds[0], bounds[3] - bounds[1])
                simplify_tol = max(0.25, dim_min * 0.005)
                nesting_poly = poly.simplify(simplify_tol, preserve_topology=True)
                buffered_poly = nesting_poly.buffer(spacing / 2.0).simplify(simplify_tol, preserve_topology=True)
                
                part_templates[part_id] = {
                    "id": part_id,
                    "name": name,
                    "dxf_path": resolved_dxf_path,
                    "polygon": poly,
                    "buffered_polygon": buffered_poly,
                    "minx_offset": minx_off,
                    "miny_offset": miny_off,
                    "quantity": quantity,
                    "auto": p.get("auto", False),
                    "group": group,
                    "material": p.get("material", "Mild Steel"),
                    "thickness": float(p.get("thickness", 2.0))
                }
            except Exception as e:
                errors.append(f"Error loading {name}: {str(e)}")

        if not part_templates:
            return {"status": "error", "error": "No parts were loaded successfully. Details:\n" + "\n".join(errors)}

        sheet_poly = box(margin, margin, sheet_w - margin, sheet_h - margin)
        
        sheets_results = []
        skipped_instances = []
        auto_fill_sets = 0

        usable_w = max(0.0, sheet_w - 2.0 * margin)
        usable_h = max(0.0, sheet_h - 2.0 * margin)
        usable_sheet_area = usable_w * usable_h

        # Group part templates strictly by (Material, Thickness)
        material_groups = {}
        for pid, t in part_templates.items():
            mat_key = (t["material"], t["thickness"])
            if mat_key not in material_groups:
                material_groups[mat_key] = {}
            material_groups[mat_key][pid] = t

        sheet_index = 1
        total_requested_count = 0

        for (mat_name, thick_val), t_dict in material_groups.items():
            if auto_fill:
                one_set_area = sum(t["polygon"].area for t in t_dict.values())
                max_est_sets = min(50, max(6, int((usable_sheet_area / max(1.0, one_set_area)) * 1.15)))
                
                test_instances = []
                for set_idx in range(max_est_sets):
                    for part_id, t in t_dict.items():
                        base_qty = max(1, t.get("quantity", 1))
                        for r_idx in range(base_qty):
                            idx = set_idx * base_qty + r_idx
                            test_instances.append({
                                "part_id": part_id,
                                "name": t["name"],
                                "index": idx,
                                "polygon": t["polygon"],
                                "buffered_polygon": t["buffered_polygon"],
                                "dxf_path": t["dxf_path"],
                                "material": mat_name,
                                "thickness": thick_val
                            })
                test_instances.sort(key=lambda inst: (inst["index"], -inst["buffered_polygon"].area))
                
                packed, skipped, packed_polys = pack_on_single_sheet(test_instances, sheet_poly, rotations, margin)
                
                if packed:
                    sheets_results.append({
                        "sheet_index": sheet_index,
                        "material": mat_name,
                        "thickness": thick_val,
                        "packed_results": packed,
                        "packed_polygons": packed_polys
                    })
                    sheet_index += 1
                    total_requested_count += len(packed)
                    counts_by_part = {}
                    for p in packed:
                        counts_by_part[p["part_id"]] = counts_by_part.get(p["part_id"], 0) + 1
                    set_counts = [counts_by_part.get(pid, 0) // max(1, t.get("quantity", 1)) for pid, t in t_dict.items()]
                    group_sets = min(set_counts) if set_counts else 0
                    auto_fill_sets = max(auto_fill_sets or 0, group_sets)

            else:
                fixed_instances = []
                auto_instances = []

                for part_id, t in t_dict.items():
                    is_auto = t.get("auto", False)
                    if is_auto:
                        part_area = max(t["buffered_polygon"].area, 1.0)
                        max_instances = int(usable_sheet_area / part_area) + 50
                        max_instances = max(50, min(max_instances, 4000))
                        for idx in range(max_instances):
                            auto_instances.append({
                                "part_id": part_id,
                                "name": t["name"],
                                "index": idx,
                                "is_auto": True,
                                "polygon": t["polygon"],
                                "buffered_polygon": t["buffered_polygon"],
                                "dxf_path": t["dxf_path"],
                                "material": mat_name,
                                "thickness": thick_val
                            })
                    else:
                        for idx in range(t["quantity"]):
                            fixed_instances.append({
                                "part_id": part_id,
                                "name": t["name"],
                                "index": idx,
                                "is_auto": False,
                                "polygon": t["polygon"],
                                "buffered_polygon": t["buffered_polygon"],
                                "dxf_path": t["dxf_path"],
                                "material": mat_name,
                                "thickness": thick_val
                            })

                fixed_instances.sort(key=lambda inst: inst["buffered_polygon"].area, reverse=True)
                auto_instances.sort(key=lambda inst: inst["buffered_polygon"].area, reverse=True)

                instances_to_pack = fixed_instances + auto_instances
                total_requested_count += len(instances_to_pack)
                unpacked_instances = list(instances_to_pack)

                while unpacked_instances:
                    packed, skipped, packed_polys = pack_on_single_sheet(unpacked_instances, sheet_poly, rotations, margin)
                    
                    if not packed:
                        for inst in unpacked_instances:
                            skipped_instances.append({
                                "part_id": inst["part_id"],
                                "name": inst["name"],
                                "index": inst["index"],
                                "reason": "Could not be packed on a clean sheet"
                            })
                        break

                    sheets_results.append({
                        "sheet_index": sheet_index,
                        "material": mat_name,
                        "thickness": thick_val,
                        "packed_results": packed,
                        "packed_polygons": packed_polys
                    })
                    sheet_index += 1
                    unpacked_instances = skipped

        import ezdxf
        output_sheets = []
        base_path, ext = os.path.splitext(export_dxf_path)

        for sheet in sheets_results:
            s_idx = sheet["sheet_index"]
            sheet_dxf_path = f"{base_path}_sheet_{s_idx}{ext}"
            sheet_pdf_path = f"{base_path}_sheet_{s_idx}.pdf"
            sheet_gcode_path = f"{base_path}_sheet_{s_idx}.nc"

            doc = ezdxf.new('R2010')
            try:
                linetypes = [
                    ("CENTER2", "Center ._._._._._._._._.", [1.0, 0.5, -0.125, 0.125, -0.125]),
                    ("CENTER", "Center ____ _ ____ _ ____", [2.0, 1.25, -0.25, 0.25, -0.25]),
                    ("DASHDOT", "DashDot _._._._._._._._.", [1.0, 0.5, -0.125, 0.125, -0.125]),
                    ("DASHED", "Dashed __ __ __ __ __ __", [0.75, 0.5, -0.25]),
                    ("DOT", "Dot . . . . . . . . . . .", [0.375, 0.125, -0.25]),
                ]
                for lt_name, desc, pattern in linetypes:
                    if lt_name not in doc.linetypes:
                        doc.linetypes.new(lt_name, dxfattribs={"description": desc, "pattern": pattern})
                doc.header['$LTSCALE'] = 1.0
            except Exception:
                pass

            msp = doc.modelspace()
            b_ltype = 'CONTINUOUS' if bend_style == 'tick' else 'CENTER2'
            doc.layers.new('OUTER_LOOP', dxfattribs={'color': 3})
            doc.layers.new('INTERIOR_LOOPS', dxfattribs={'color': 2})
            doc.layers.new('CUT', dxfattribs={'color': 3})
            doc.layers.new('OTHER', dxfattribs={'color': 7})
            doc.layers.new('DOWN_FEATURES', dxfattribs={'color': 1})
            doc.layers.new('UP_FEATURES', dxfattribs={'color': 5})
            doc.layers.new('FORMING_FEATURES', dxfattribs={'color': 6})
            doc.layers.new('DIMPLE_HOLES', dxfattribs={'color': 4})
            try:
                doc.layers.new('UP_CENTERLINES', dxfattribs={'color': 5, 'linetype': b_ltype})
                doc.layers.new('DOWN_CENTERLINES', dxfattribs={'color': 1, 'linetype': b_ltype})
                doc.layers.new('BEND_TANGENTS', dxfattribs={'color': 9, 'linetype': 'DASHED'})
                doc.layers.new('BEND_LINES', dxfattribs={'color': 5, 'linetype': b_ltype})
            except Exception:
                doc.layers.new('UP_CENTERLINES', dxfattribs={'color': 5})
                doc.layers.new('DOWN_CENTERLINES', dxfattribs={'color': 1})

            import shapely.geometry as sg
            BEND_LAYERS = {'UP_CENTERLINES', 'DOWN_CENTERLINES', 'BEND_LINES', 'BEND', 'FOLD'}

            for res in sheet["packed_results"]:
                part_dxf = res["dxf_path"]
                dx = res["dx"]
                dy = res["dy"]
                theta = res["rotation"]
                if not part_dxf or not os.path.exists(part_dxf):
                    continue
                try:
                    part_doc = ezdxf.readfile(part_dxf)
                    part_template = part_templates.get(res["part_id"])
                    minx_off = part_template.get("minx_offset", 0.0) if part_template else 0.0
                    miny_off = part_template.get("miny_offset", 0.0) if part_template else 0.0

                    for entity in part_doc.modelspace():
                        layer = entity.dxf.layer
                        if layer in BEND_LAYERS and exclude_bend_lines:
                            continue

                        # 1. Normalize entity to (0,0), 2. Rotate by theta, 3. Translate to sheet placement (dx, dy)
                        entity.translate(-minx_off, -miny_off, 0)
                        entity.rotate_z(theta)
                        entity.translate(dx, dy, 0)
                        msp.add_foreign_entity(entity)
                except Exception as e:
                    errors.append(f"Failed to copy entities for {res['name']}: {str(e)}")

            os.makedirs(os.path.dirname(os.path.abspath(sheet_dxf_path)), exist_ok=True)
            doc.saveas(sheet_dxf_path)
            sheet_area = sheet_w * sheet_h
            packed_area_sum = sum(res["original_polygon"].area for res in sheet["packed_results"])
            utilization_pct = (packed_area_sum / sheet_area) * 100.0
            
            pdf_lines = [
                "%PDF-1.4", "%% CADANEST FABRICATION REPORT", f"%% SHEET INDEX: {s_idx}",
                f"Utilization: {utilization_pct:.1f}%", f"Packed Count: {len(sheet['packed_results'])}"
            ]
            with open(sheet_pdf_path, "w", encoding="utf-8") as f_pdf: f_pdf.write("\n".join(pdf_lines))
            
            gcode_lines = [f"(NC LASER G-CODE SHEET {s_idx})"]
            for res in sheet["packed_results"]:
                gcode_lines.append(f"(Part: {res['name']})")
                gcode_lines.append(f"G00 X{res['dx']:.2f} Y{res['dy']:.2f}")
                gcode_lines.append("M11")
                poly = res["original_polygon"]
                polys_list = [poly] if isinstance(poly, sg.Polygon) else (list(poly.geoms) if hasattr(poly, "geoms") else [])
                for sub_p in polys_list:
                    if hasattr(sub_p, "exterior"):
                        for pt in list(sub_p.exterior.coords): gcode_lines.append(f"G01 X{pt[0]:.2f} Y{pt[1]:.2f}")
                gcode_lines.append("M12")
            with open(sheet_gcode_path, "w", encoding="utf-8") as f_gc: f_gc.write("\n".join(gcode_lines))

            # Build full feature SVG preview from modelspace entities with universal curve flattener
            from ezdxf import path as ezdxf_path
            svg_elements = []
            svg_dash_attr = ' stroke-dasharray="12,3,2,3"' if bend_style != 'tick' else ''
            for e in msp:
                layer = e.dxf.layer.upper()
                if layer in ('UP_CENTERLINES', 'BEND_LINES', 'UP_CENTERLINE'):
                    css_class = "bend-centerline-up"
                    stroke_color = "#0073CC"
                    dash = svg_dash_attr
                elif layer in ('DOWN_CENTERLINES', 'DOWN_CENTERLINE'):
                    css_class = "bend-centerline-down"
                    stroke_color = "#EF4444"
                    dash = svg_dash_attr
                elif layer in ('INTERIOR_LOOPS', 'HOLES', 'HOLE'):
                    css_class = "layer-holes"
                    stroke_color = "#EAB308"
                    dash = ""
                elif layer in ('FORMING_FEATURES', 'DIMPLE_HOLES'):
                    css_class = "layer-forming"
                    stroke_color = "#C084FC"
                    dash = ""
                else:
                    css_class = "layer-cut"
                    stroke_color = "#00A3FF"
                    dash = ""

                try:
                    if e.dxftype() == 'LINE':
                        x1, y1 = e.dxf.start.x, e.dxf.start.y
                        x2, y2 = e.dxf.end.x, e.dxf.end.y
                        svg_elements.append(f'<line class="{css_class}" x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}" stroke="{stroke_color}" stroke-width="1.0" {dash} />')
                    elif e.dxftype() == 'CIRCLE':
                        cx, cy = e.dxf.center.x, e.dxf.center.y
                        r = e.dxf.radius
                        svg_elements.append(f'<circle class="{css_class}" cx="{cx:.2f}" cy="{cy:.2f}" r="{r:.2f}" fill="none" stroke="{stroke_color}" stroke-width="1.0" {dash} />')
                    else:
                        p_path = ezdxf_path.make_path(e)
                        pts = [(v.x, v.y) for v in p_path.flattening(distance=0.2)]
                        if len(pts) >= 2:
                            d_str = "M " + " L ".join(f"{pt[0]:.2f},{pt[1]:.2f}" for pt in pts)
                            if p_path.is_closed:
                                d_str += " Z"
                            fill_attr = 'fill="rgba(0,163,255,0.15)"' if css_class == 'layer-cut' and p_path.is_closed else 'fill="none"'
                            svg_elements.append(f'<path class="{css_class}" d="{d_str}" {fill_attr} stroke="{stroke_color}" stroke-width="1.0" {dash} />')
                except Exception:
                    pass

            svg_preview = f'<svg viewBox="0 0 {sheet_w} {sheet_h}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><g transform="scale(1,-1) translate(0,-{sheet_h})">{"".join(svg_elements)}</g></svg>'
            
            output_sheets.append({
                "index": s_idx, "material": sheet.get("material", "Mild Steel"), "thickness": sheet.get("thickness", 2.0),
                "utilization": round(utilization_pct, 1), "dxf_path": sheet_dxf_path, "pdf_path": sheet_pdf_path,
                "gcode_path": sheet_gcode_path, "svg_content": svg_preview, "nested_count": len(sheet["packed_results"])
            })

        return {
            "status": "success", "sheets": output_sheets, "skipped_parts": skipped_instances,
            "total_count": total_requested_count, "auto_fill_sets": auto_fill_sets, "warnings": errors
        }
    finally:
        for temp_file in temp_files:
            try:
                if os.path.exists(temp_file): os.remove(temp_file)
            except Exception: pass


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "error": "Missing input JSON configuration path."}))
        sys.exit(1)
    json_path = sys.argv[1]
    if not os.path.exists(json_path):
        print(json.dumps({"status": "error", "error": f"JSON config not found: {json_path}"}))
        sys.exit(1)
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
    except Exception as e:
        print(json.dumps({"status": "error", "error": f"Failed to parse JSON config: {str(e)}"}))
        sys.exit(1)
    res = run_nesting_from_dict(config)
    print(json.dumps(res))


if __name__ == "__main__":
    main()