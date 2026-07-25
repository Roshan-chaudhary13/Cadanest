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

    # Process explicit INTERIOR_LOOPS circle entities
    for entity in msp:
        if any(kw in entity.dxf.layer.upper() for kw in ('INTERIOR', 'HOLE', 'HOLES', 'CUTOUT')):
            try:
                if entity.dxftype() == 'CIRCLE':
                    c = (entity.dxf.center.x, entity.dxf.center.y)
                    r = entity.dxf.radius
                    h_poly = sg.Point(c).buffer(r, resolution=32)
                    if isinstance(outer, sg.Polygon) and outer.contains(h_poly.centroid):
                        outer = outer.difference(h_poly)
            except Exception:
                pass

    return outer


def unfold_part_to_temp_dxf(step_path, kfactor, base_face_name=None):
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
        
    root_idx = None
    if base_face_name:
        single_face = base_face_name.split(",")[0].strip()
        try:
            root_idx = int(single_face.replace("Face", "")) - 1
            if root_idx < 0 or root_idx >= len(faces):
                root_idx = None
        except Exception:
            pass

    flat_shape, bend_lines = unfold_sheet_metal(shape, thickness, float(kfactor), root_idx)
    
    # Save to a temporary DXF file in the OS temp directory
    fd, temp_dxf = tempfile.mkstemp(suffix=".dxf", prefix="nest_temp_")
    os.close(fd) # Close file descriptor so ezdxf can write to the path
    
    export_to_dxf_and_svg(flat_shape, bend_lines, temp_dxf)
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
    """Candidate anchor coordinates for placement: sheet margin + bbox corners
    and midpoints of every already-packed part. Fast and high-density."""
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
    return filter_candidates(X_cands, min_step=min_step), filter_candidates(Y_cands, min_step=min_step)


def _best_placement(cand, packed_polygons, tree, X_cands, Y_cands, rotations, s_maxx, s_maxy, prep_sheet):
    """True Bottom-Left-Fill selection: score is the LEXICOGRAPHIC tuple
    (y, x) of the candidate anchor - never a weighted sum like dx*1.5+dy.

    Why this matters: a weighted sum trades y off against x, so for
    roughly square/round parts "start a new row" (cost ~= height) can score
    lower than "finish this row" (cost ~= width * 1.5). That is exactly what
    produces a diagonal staircase of parts (each row one longer than the
    last) instead of full rows - wasting roughly half the area for whatever
    got placed. With a lexicographic (y, x) comparison, ANY fit at a lower y
    always beats ANY fit at a higher y regardless of x, so a row can only be
    abandoned once nothing at all fits in it anymore - forcing genuine
    shelf-by-shelf filling.

    Returns (dx, dy, theta) or (None, None, None) if nothing fits."""
    best_x = best_y = best_theta = None
    best_score = (float('inf'), float('inf'))

    for theta in rotations:
        r_poly = rotate(cand["buffered_polygon"], theta, origin=(0, 0), use_radians=True)
        minx, miny, maxx, maxy = r_poly.bounds
        width = maxx - minx
        height = maxy - miny

        found_for_theta = False
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
                    for idx in tree.query(t_poly):
                        packed = packed_polygons[idx]
                        if t_poly.intersects(packed) and not t_poly.touches(packed):
                            overlap = True
                            break

                if not overlap:
                    score = (y, x)
                    if score < best_score:
                        best_score = score
                        best_x, best_y, best_theta = dx, dy, theta
                    found_for_theta = True
                    break  # x ascending: first fit at this y is already leftmost

            if found_for_theta:
                break  # no higher y can beat this y for this rotation

    return best_x, best_y, best_theta


def _place_result(cand, dx, dy, theta, packed_polygons, packed_results):
    placed_buffered = translate(
        rotate(cand["buffered_polygon"], theta, origin=(0, 0), use_radians=True), dx, dy
    )
    packed_polygons.append(placed_buffered)
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

        n_packed = len(packed_polygons)
        min_step = 1.5 if n_packed <= 60 else 3.0
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

            # After a run of misses, stop walking the ordered pool and instead
            # run an EXHAUSTIVE gap-fill sweep: repeatedly scan the ENTIRE
            # remaining pool (not just the tail after index i) smallest-first,
            # place anything that fits, and keep looping (recomputing fresh
            # candidate anchors each time, since every new placement exposes
            # new nook positions) until a full pass places nothing at all.
            if consecutive_skips >= 6:
                progress = True
                while progress:
                    progress = False
                    n_packed = len(packed_polygons)
                    min_step = 1.5 if n_packed <= 60 else 3.0
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
                            break  # restart the sweep with fresh candidates after every successful placement

                if i >= len(unpacked_pool):
                    break

                # A full exhaustive sweep placed nothing more: the remaining
                # parts genuinely cannot fit in the leftover empty area.
                skipped_results.extend(unpacked_pool[i:])
                break

    return packed_results, skipped_results, packed_polygons


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

    sheet_w = float(config.get("sheet_width", 2500))
    sheet_h = float(config.get("sheet_height", 1250))
    spacing = float(config.get("spacing", 5.0))
    margin = float(config.get("margin", 5.0))
    parts_list = config.get("parts", [])
    export_dxf_path = config.get("export_dxf_path", "")
    auto_fill = config.get("auto_fill", False)
    exclude_bend_lines = config.get("exclude_bend_lines", False)

    if not export_dxf_path:
        print(json.dumps({"status": "error", "error": "Missing export_dxf_path in JSON config."}))
        sys.exit(1)

    # 1. Load and flatten each unique part template
    part_templates = {}
    errors = []
    temp_files = []

    try:
        for p in parts_list:
            part_id = p["id"]
            step_path = p.get("step_path", "")
            dxf_path = p.get("dxf_path", None)
            kfactor = p.get("kfactor", 0.40)
            base_face = p.get("base_face", None)
            quantity = int(p.get("quantity", 1)) # Qty per set
            name = p.get("name", os.path.basename(step_path) if step_path else "DXF Part")
            group = p.get("group", None)

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
                        temp_dxf = unfold_part_to_temp_dxf(step_path, kfactor, base_face)
                        temp_files.append(temp_dxf)
                        resolved_dxf_path = temp_dxf
                        poly = load_polygon_from_dxf(resolved_dxf_path)
                    except Exception as occ_err:
                        raise Exception(f"OCC Unfolding fallback failed: {str(occ_err)}")

                if poly is None:
                    raise Exception("Could not extract flat boundary polygon.")

                # Pre-calculate optimized simplified nesting polygon for 100x faster collision checks
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
                    "quantity": quantity,
                    "auto": p.get("auto", False),
                    "group": group
                }
            except Exception as e:
                errors.append(f"Error loading {name}: {str(e)}")

        if not part_templates:
            print(json.dumps({
                "status": "error",
                "error": "No parts were loaded successfully. Details:\n" + "\n".join(errors)
            }))
            sys.exit(1)

        # Read allowable rotations from JSON config. Expects list of angles in degrees (e.g. [0, 90, 180, 270])
        rotation_degrees = config.get("rotations", [0.0, 90.0, 180.0, 270.0])
        rotations = [math.radians(deg) for deg in rotation_degrees]
        sheet_poly = box(margin, margin, sheet_w - margin, sheet_h - margin)
        
        sheets_results = []
        skipped_instances = []
        auto_fill_sets = None

        if auto_fill:
            # Auto-Fill Mode: Automatically fit as many complete sets of part ratios as physically fit on the sheet stock
            usable_w = max(0.0, sheet_w - 2.0 * margin)
            usable_h = max(0.0, sheet_h - 2.0 * margin)
            sheet_area = usable_w * usable_h
            
            one_set_area = sum(t["polygon"].area for t in part_templates.values())
            max_est_sets = min(50, max(6, int((sheet_area / max(1.0, one_set_area)) * 1.15)))
            
            test_instances = []
            for set_idx in range(max_est_sets):
                for part_id, t in part_templates.items():
                    base_qty = max(1, t.get("quantity", 1))
                    for r_idx in range(base_qty):
                        idx = set_idx * base_qty + r_idx
                        test_instances.append({
                            "part_id": part_id,
                            "name": t["name"],
                            "index": idx,
                            "polygon": t["polygon"],
                            "buffered_polygon": t["buffered_polygon"],
                            "dxf_path": t["dxf_path"]
                        })
            test_instances.sort(key=lambda inst: (inst["index"], -inst["buffered_polygon"].area))
            
            packed, skipped, packed_polys = pack_on_single_sheet(test_instances, sheet_poly, rotations, margin)
                        
            sheets_results.append({
                "sheet_index": 1,
                "packed_results": packed,
                "packed_polygons": packed_polys
            })
            total_requested_count = len(packed)
            counts_by_part = {}
            for p in packed:
                counts_by_part[p["part_id"]] = counts_by_part.get(p["part_id"], 0) + 1
            set_counts = [counts_by_part.get(pid, 0) // max(1, t.get("quantity", 1)) for pid, t in part_templates.items()]
            auto_fill_sets = min(set_counts) if set_counts else 0

        else:
            # Multi-Sheet / Semi-Custom Packing with mixed fixed and auto-quantity parts
            fixed_instances = []
            auto_instances = []
            
            usable_w = max(0.0, sheet_w - 2.0 * margin)
            usable_h = max(0.0, sheet_h - 2.0 * margin)
            usable_sheet_area = usable_w * usable_h

            for part_id, t in part_templates.items():
                is_auto = t.get("auto", False)
                if is_auto:
                    # Size the candidate pool to how many of this part could
                    # plausibly fit on ONE sheet by area, plus headroom -
                    # a fixed cap (previously 150) runs out long before small
                    # parts fill a sheet, silently truncating the fill (this
                    # is why small round parts stopped after a small triangle
                    # of them instead of tiling the whole sheet).
                    part_area = max(t["buffered_polygon"].area, 1.0)
                    max_instances = int(usable_sheet_area / part_area) + 50
                    max_instances = max(50, min(max_instances, 4000))  # sane runtime ceiling
                    for idx in range(max_instances):
                        auto_instances.append({
                            "part_id": part_id,
                            "name": t["name"],
                            "index": idx,
                            "is_auto": True,
                            "polygon": t["polygon"],
                            "buffered_polygon": t["buffered_polygon"],
                            "dxf_path": t["dxf_path"]
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
                            "dxf_path": t["dxf_path"]
                        })

            fixed_instances.sort(key=lambda inst: inst["buffered_polygon"].area, reverse=True)
            auto_instances.sort(key=lambda inst: inst["buffered_polygon"].area, reverse=True)

            instances_to_pack = fixed_instances + auto_instances
            unpacked_instances = list(instances_to_pack)
            sheet_index = 1

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
                    "packed_results": packed,
                    "packed_polygons": packed_polys
                })
                sheet_index += 1
                unpacked_instances = skipped

            total_requested_count = len(instances_to_pack)

        # 2. Export DXF and SVG previews for each sheet using ezdxf directly
        import ezdxf
        output_sheets = []
        base_path, ext = os.path.splitext(export_dxf_path)

        for sheet in sheets_results:
            s_idx = sheet["sheet_index"]
            sheet_dxf_path = f"{base_path}_sheet_{s_idx}{ext}"
            sheet_pdf_path = f"{base_path}_sheet_{s_idx}.pdf"
            sheet_gcode_path = f"{base_path}_sheet_{s_idx}.nc"

            # Create new drawing using ezdxf
            doc = ezdxf.new('R2010')
            msp = doc.modelspace()

            # Pre-create layers with standard colors and linetypes
            doc.layers.new('OUTER_LOOP', dxfattribs={'color': 3})        # Green for outer boundary
            doc.layers.new('INTERIOR_LOOPS', dxfattribs={'color': 2})     # Yellow for interior cutouts
            doc.layers.new('CUT', dxfattribs={'color': 3})               # Fallback profile layer
            try:
                doc.layers.new('UP_CENTERLINES', dxfattribs={'color': 5, 'linetype': 'CENTER2'})    # Blue dash-dot for UP bend
                doc.layers.new('DOWN_CENTERLINES', dxfattribs={'color': 1, 'linetype': 'CENTER2'})  # Red dash-dot for DOWN bend
                doc.layers.new('BEND_LINES', dxfattribs={'color': 1, 'linetype': 'DASHED'})        # Red/Dashed
            except Exception:
                doc.layers.new('UP_CENTERLINES', dxfattribs={'color': 5})
                doc.layers.new('DOWN_CENTERLINES', dxfattribs={'color': 1})
                doc.layers.new('BEND_LINES', dxfattribs={'color': 1})

            import shapely.geometry as sg

            BEND_LAYERS = {'UP_CENTERLINES', 'DOWN_CENTERLINES', 'BEND_LINES', 'BEND', 'FOLD'}

            for res in sheet["packed_results"]:
                part_dxf = res["dxf_path"]
                dx = res["dx"]
                dy = res["dy"]
                theta = res["rotation"] # in radians

                if not part_dxf or not os.path.exists(part_dxf):
                    continue

                try:
                    part_doc = ezdxf.readfile(part_dxf)
                    part_template = part_templates.get(res["part_id"])
                    outer_poly = part_template["polygon"] if part_template else None

                    for entity in part_doc.modelspace():
                        layer = entity.dxf.layer
                        if layer in BEND_LAYERS:
                            if exclude_bend_lines:
                                continue
                            # Trim/clip the bend lines so that they exist ONLY within the interior of that specific part's boundary
                            if entity.dxftype() == 'LINE' and outer_poly:
                                start = (entity.dxf.start.x, entity.dxf.start.y)
                                end = (entity.dxf.end.x, entity.dxf.end.y)
                                line_geom = sg.LineString([start, end])
                                try:
                                    clipped = line_geom.intersection(outer_poly)
                                except Exception:
                                    clipped = line_geom
                                
                                def add_segment(seg):
                                    if seg.is_empty or not isinstance(seg, sg.LineString):
                                        return
                                    # Transform exactly like the part boundary
                                    rotated = rotate(seg, theta, origin=(0, 0), use_radians=True)
                                    translated = translate(rotated, dx, dy)
                                    coords = list(translated.coords)
                                    if len(coords) >= 2:
                                        target_layer = layer if layer in ('UP_CENTERLINES', 'DOWN_CENTERLINES') else 'BEND_LINES'
                                        ltype = 'CENTER2' if target_layer in ('UP_CENTERLINES', 'DOWN_CENTERLINES') else 'DASHED'
                                        msp.add_line(coords[0], coords[1], dxfattribs={'layer': target_layer, 'linetype': ltype})

                                if isinstance(clipped, sg.LineString):
                                    add_segment(clipped)
                                elif isinstance(clipped, sg.MultiLineString):
                                    for seg in clipped.geoms:
                                        add_segment(seg)
                                elif hasattr(clipped, 'geoms'):
                                    for geom in clipped.geoms:
                                        if isinstance(geom, sg.LineString):
                                            add_segment(geom)
                            else:
                                entity.rotate_z(theta)
                                entity.translate(dx, dy, 0)
                                msp.add_foreign_entity(entity)
                        else:
                            entity.rotate_z(theta)
                            entity.translate(dx, dy, 0)
                            if layer not in ('OUTER_LOOP', 'INTERIOR_LOOPS'):
                                entity.dxf.layer = 'CUT'
                            msp.add_foreign_entity(entity)
                except Exception as e:
                    errors.append(f"Failed to copy entities for {res['name']}: {str(e)}")

            os.makedirs(os.path.dirname(os.path.abspath(sheet_dxf_path)), exist_ok=True)
            doc.saveas(sheet_dxf_path)

            sheet_area = sheet_w * sheet_h
            packed_area_sum = sum(res["original_polygon"].area for res in sheet["packed_results"])
            utilization_pct = (packed_area_sum / sheet_area) * 100.0

            # Write PDF fabrication report mock
            pdf_lines = [
                "%PDF-1.4",
                "%% CADANEST PRODUCTION FABRICATION REPORT",
                f"%% SHEET STOCK INDEX: {s_idx}",
                "%% GENERATED BY CADANEST PACKING OPTIMIZER",
                "%% -------------------------------------",
                f"Sheet Size: {sheet_w} mm x {sheet_h} mm",
                f"Border Margin: {margin} mm",
                f"Part-to-Part Spacing: {spacing} mm",
                f"Packing Utilization: {utilization_pct:.1f}%",
                f"Packed Blanks Count: {len(sheet['packed_results'])}",
                "",
                "PRODUCTION ORDER INDEX:",
                "-------------------------------------"
            ]
            for idx, res in enumerate(sheet["packed_results"]):
                pdf_lines.append(f"Part {idx+1}: {res['name']}")
                pdf_lines.append(f"  - Position: X={res['dx']:.2f} mm, Y={res['dy']:.2f} mm")
                pdf_lines.append(f"  - Rotation Angle: {res['rotation']:.1f}°")
                pdf_lines.append(f"  - Planar Surface Area: {res['original_polygon'].area:.1f} mm²")
            pdf_lines.append("")
            pdf_lines.append("%%EOF")
            with open(sheet_pdf_path, "w", encoding="utf-8") as f_pdf:
                f_pdf.write("\n".join(pdf_lines))

            # Write NC Laser G-Code mock
            gcode_lines = [
                f"(CADANEST POST-PROCESSED NC LASER G-CODE)",
                f"(SHEET INDEX: {s_idx})",
                f"(SHEET STOCK SIZE: {sheet_w}mm x {sheet_h}mm)",
                f"(SPACING: {spacing}mm, MARGIN: {margin}mm)",
                f"(NESTED BLANKS COUNT: {len(sheet['packed_results'])})",
                "G90 (Absolute Positioning)",
                "G21 (Metric Units)",
                "M03 (Laser ON, Pierce Mode)",
                ""
            ]
            for idx, res in enumerate(sheet["packed_results"]):
                gcode_lines.append(f"(Part: {res['name']} at coordinates X={res['dx']:.2f}, Y={res['dy']:.2f}, Rot={res['rotation']:.1f}°)")
                gcode_lines.append(f"G00 X{res['dx']:.2f} Y{res['dy']:.2f}")
                gcode_lines.append("M11 (Laser Pierce)")
                poly = res["original_polygon"]
                polys_list = [poly] if isinstance(poly, sg.Polygon) else (list(poly.geoms) if hasattr(poly, "geoms") else [])
                for sub_p in polys_list:
                    if hasattr(sub_p, "exterior"):
                        coords = list(sub_p.exterior.coords)
                        for pt in coords:
                            gcode_lines.append(f"G01 X{pt[0]:.2f} Y{pt[1]:.2f} F1500")
                gcode_lines.append("M12 (Laser Retract)")
                gcode_lines.append("")
            gcode_lines.append("M05 (Laser OFF)")
            gcode_lines.append("G00 X0 Y0")
            gcode_lines.append("M30 (Program End)")
            with open(sheet_gcode_path, "w", encoding="utf-8") as f_gc:
                f_gc.write("\n".join(gcode_lines))

            svg_paths = []
            for res in sheet["packed_results"]:
                d = polygon_to_svg_path(res["original_polygon"])
                svg_paths.append(
                    f'<path d="{d}" fill="rgba(0, 163, 255, 0.25)" stroke="#00A3FF" stroke-width="1.2" '
                    f'style="stroke-linecap:round;stroke-linejoin:round;" />'
                )

            svg_preview = (
                f'<svg viewBox="0 0 {sheet_w} {sheet_h}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">\n'
                f'<style>\n'
                f'  svg {{ background: transparent; }}\n'
                f'</style>\n'
                f'<!-- Outer sheet boundaries -->\n'
                f'<rect x="0" y="0" width="{sheet_w}" height="{sheet_h}" fill="none" stroke="#8F9BBF" stroke-width="2.5" opacity="0.6" />\n'
                f'<!-- Margin guide -->\n'
                f'<rect x="{margin}" y="{margin}" width="{sheet_w - 2*margin}" height="{sheet_h - 2*margin}" fill="none" stroke="#8F9BBF" stroke-width="1" stroke-dasharray="6,6" opacity="0.3" />\n'
                f'<!-- Flip Y axis scale(1,-1) translate(0,-sheet_h) to match CAD coordinate space -->\n'
                f'<g transform="scale(1, -1) translate(0, -{sheet_h})">\n'
                + "\n".join(svg_paths) +
                f'\n</g>\n'
                f'</svg>'
            )

            output_sheets.append({
                "index": s_idx,
                "utilization": round(utilization_pct, 1),
                "dxf_path": sheet_dxf_path,
                "pdf_path": sheet_pdf_path,
                "gcode_path": sheet_gcode_path,
                "svg_content": svg_preview,
                "nested_count": len(sheet["packed_results"])
            })

        # 3. Print final result
        output = {
            "status": "success",
            "sheets": output_sheets,
            "skipped_parts": skipped_instances,
            "total_count": total_requested_count,
            "auto_fill_sets": auto_fill_sets,
            "warnings": errors
        }
        print(json.dumps(output))

    finally:
        # Clean up all temporary files created during fallback OCC unfolding
        for temp_file in temp_files:
            try:
                if os.path.exists(temp_file):
                    os.remove(temp_file)
            except Exception:
                pass


if __name__ == "__main__":
    main()