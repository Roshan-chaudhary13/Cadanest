import ezdxf
from OCC.Core.BRepAdaptor import BRepAdaptor_Curve
from OCC.Core.GeomAbs import GeomAbs_Line
from OCC.Core.TopExp import TopExp_Explorer
from OCC.Core.TopAbs import TopAbs_EDGE, TopAbs_FACE
from OCC.Core.TopoDS import topods
import math
import os
import numpy as np
import shapely.geometry as sg
from shapely.ops import polygonize, unary_union
from .bend_math import calculate_outside_setback

def get_edge_points(edge, steps=30):
    """
    Evaluates points along a TopoDS_Edge curve.
    For straight lines, returns just start and end points.
    For curved edges, returns a list of discretized points.
    """
    curve = BRepAdaptor_Curve(edge)
    u_min = curve.FirstParameter()
    u_max = curve.LastParameter()
    
    p_start = curve.Value(u_min)
    p_end = curve.Value(u_max)
    
    if curve.GetType() == GeomAbs_Line:
        return [(p_start.X(), p_start.Y()), (p_end.X(), p_end.Y())]
        
    pts = []
    for i in range(steps + 1):
        u = u_min + (u_max - u_min) * (i / steps)
        p = curve.Value(u)
        pts.append((p.X(), p.Y()))
    return pts

def generate_bend_ticks(bend_lines, cut_edges, tick_length=4.5, style="tick"):
    """
    Generates clean bend indicators for 2D manufacturing drawings.
    - If style == 'tick': Renders precision bend tick marks at local bend edge boundaries.
    - If style == 'full': Renders full bend centerlines across the part width.
    """
    if not bend_lines:
        return []

    result_segments = []

    for bend in bend_lines:
        s = np.array([bend["start"][0], bend["start"][1]], dtype=float)
        e = np.array([bend["end"][0],   bend["end"][1]  ], dtype=float)
        d = e - s
        length = np.linalg.norm(d)
        if length < 1e-6:
            continue
        d_unit = d / length

        if style == "tick":
            tick_len = min(tick_length, max(1.5, length * 0.20))
            t1_start = s
            t1_end = s + d_unit * tick_len
            t2_start = e - d_unit * tick_len
            t2_end = e

            result_segments.append({
                "start": (t1_start[0], t1_start[1], 0),
                "end":   (t1_end[0],   t1_end[1],   0)
            })
            result_segments.append({
                "start": (t2_start[0], t2_start[1], 0),
                "end":   (t2_end[0],   t2_end[1],   0)
            })
        else:
            result_segments.append({
                "start": (s[0], s[1], 0),
                "end":   (e[0], e[1], 0)
            })

    return result_segments

def resolve_minimal_hole_loops(face_polys):
    """
    Intelligently analyzes holes across 3D faces (e.g. countersinks, counterbores, stepped holes).
    For concentric hole loops of varying diameters, retains ONLY the MINIMAL DIAMETER loop
    so 2D manufacturing drawings display accurate pilot cut sizes.
    """
    if not face_polys:
        return None

    try:
        combined = unary_union(face_polys)
    except Exception:
        return None

    if isinstance(combined, sg.Polygon):
        polys = [combined]
    elif hasattr(combined, "geoms"):
        polys = list(combined.geoms)
    else:
        return combined

    processed_polys = []
    for poly in polys:
        if not isinstance(poly, sg.Polygon):
            processed_polys.append(poly)
            continue

        exterior = poly.exterior
        interiors = list(poly.interiors)
        if not interiors:
            processed_polys.append(poly)
            continue

        hole_polys = []
        for ring in interiors:
            try:
                hp = sg.Polygon(ring)
                if hp.is_valid and hp.area > 0.001:
                    hole_polys.append(hp)
            except Exception:
                pass

        if not hole_polys:
            processed_polys.append(poly)
            continue

        clusters = []
        for hp in hole_polys:
            c = hp.centroid
            matched = False
            for cl in clusters:
                ref_c = cl[0].centroid
                dist = math.hypot(c.x - ref_c.x, c.y - ref_c.y)
                if dist <= 0.5:
                    cl.append(hp)
                    matched = True
                    break
            if not matched:
                clusters.append([hp])

        minimal_holes = []
        for cl in clusters:
            cl.sort(key=lambda h: h.area)
            minimal_holes.append(cl[0])

        refined = sg.Polygon(exterior)
        for mh in minimal_holes:
            try:
                refined = refined.difference(mh)
            except Exception:
                pass
        processed_polys.append(refined)

    return unary_union(processed_polys)

def simplify_bend_double_angles(poly, tolerance=0.8, bend_lines=None):
    """
    Creates a 100% single continuous straight line from top-left corner directly to the 
    middle bend centerline, removing all intermediate kink vertices and collinear points.
    """
    if not isinstance(poly, sg.Polygon) or not poly.exterior:
        return poly

    coords = list(poly.exterior.coords)
    n = len(coords) - 1
    if n < 4:
        return poly

    centerlines = []
    if bend_lines:
        for b in bend_lines:
            cp1 = np.array([b["start"][0], b["start"][1]])
            cp2 = np.array([b["end"][0], b["end"][1]])
            cdir = cp2 - cp1
            clen = np.linalg.norm(cdir)
            if clen > 1e-4:
                cu = cdir / clen
                centerlines.append(sg.LineString([cp1 - cu * 1000.0, cp2 + cu * 1000.0]))

    new_coords = []
    i = 0
    while i < n:
        p0 = np.array(coords[i][:2])
        p1 = np.array(coords[(i + 1) % n][:2])
        p2 = np.array(coords[(i + 2) % n][:2])
        p3 = np.array(coords[(i + 3) % n][:2])
        
        seg_len = np.linalg.norm(p2 - p1)
        if 0.5 <= seg_len <= 8.0:
            v_in = p1 - p0
            l_in = np.linalg.norm(v_in)
            if l_in > 1e-4 and centerlines:
                u_in = v_in / l_in
                ray1 = sg.LineString([p0 - u_in * 10.0, p0 + u_in * 1000.0])
                
                pt1 = sg.Point(p1)
                best_cl = min(centerlines, key=lambda cl: pt1.distance(cl))
                
                p_inter = ray1.intersection(best_cl)
                if isinstance(p_inter, sg.Point):
                    new_coords.append((round(p0[0], 3), round(p0[1], 3)))
                    new_coords.append((round(p_inter.x, 3), round(p_inter.y, 3)))
                    i += 2
                    continue
        new_coords.append((round(p0[0], 3), round(p0[1], 3)))
        i += 1
    new_coords.append(new_coords[0])

    # Merge collinear points along the top edge vector
    merged_coords = []
    m = len(new_coords) - 1
    for k in range(m):
        p_prev = np.array(new_coords[(k - 1) % m][:2])
        p_curr = np.array(new_coords[k][:2])
        p_next = np.array(new_coords[(k + 1) % m][:2])
        
        v1 = p_curr - p_prev
        v2 = p_next - p_curr
        l1, l2 = np.linalg.norm(v1), np.linalg.norm(v2)
        if l1 > 1e-4 and l2 > 1e-4:
            u1, u2 = v1 / l1, v2 / l2
            dot = np.clip(np.dot(u1, u2), -1.0, 1.0)
            angle_deg = np.degrees(np.arccos(dot))
            if angle_deg <= 1.0: # Collinear points
                continue
        merged_coords.append((round(p_curr[0], 3), round(p_curr[1], 3)))
    merged_coords.append(merged_coords[0])

    try:
        from shapely.validation import make_valid
        cleaned = sg.Polygon(merged_coords, poly.interiors)
        if not cleaned.is_valid:
            cleaned = make_valid(cleaned)
            if hasattr(cleaned, 'geoms'):
                cleaned = max(cleaned.geoms, key=lambda p: p.area)
        return cleaned
    except Exception:
        return poly

def export_to_dxf_and_svg(flat_shape, bend_lines, dxf_path: str, svg_path: str = None, exclude_bend_lines: bool = False, bend_line_style: str = "tick"):
    """
    Exports the flattened B-Rep shape and bend lines to DXF and optionally SVG.
    Supports intelligent minimal hole selection and single-angle bend boundary smoothing.
    """
    def face_to_shapely(face):
        exp_e = TopExp_Explorer(face, TopAbs_EDGE)
        edges = []
        while exp_e.More():
            edge = topods.Edge(exp_e.Current())
            pts = get_edge_points(edge)
            if len(pts) >= 2:
                edges.append(sg.LineString([(round(x, 3), round(y, 3)) for x, y in pts]))
            exp_e.Next()
        if not edges:
            return None
        try:
            unioned = unary_union(edges)
            polys = list(polygonize(unioned))
            if not polys:
                return None
            polys.sort(key=lambda p: p.area, reverse=True)
            outer = polys[0]
            for hole in polys[1:]:
                outer = outer.difference(hole)
            return outer
        except Exception:
            return None

    def resolve_minimal_hole_loops(face_polys):
        if not face_polys:
            return None
        valid_faces = [p for p in face_polys if p and p.is_valid]
        if not valid_faces:
            return None
        merged = unary_union(valid_faces)
        if hasattr(merged, 'geoms'):
            main_poly = max(merged.geoms, key=lambda p: p.area)
        else:
            main_poly = merged
        return main_poly

    face_polys = []
    exp_f = TopExp_Explorer(flat_shape, TopAbs_FACE)
    while exp_f.More():
        face = topods.Face(exp_f.Current())
        p = face_to_shapely(face)
        if p:
            face_polys.append(p)
        exp_f.Next()

    raw_edges = []
    exp_e = TopExp_Explorer(flat_shape, TopAbs_EDGE)
    while exp_e.More():
        edge = topods.Edge(exp_e.Current())
        if not edge.IsNull():
            pts = get_edge_points(edge)
            if len(pts) >= 2:
                raw_edges.append(pts)
        exp_e.Next()

    cut_edges = []
    try:
        if face_polys:
            blank_poly = resolve_minimal_hole_loops(face_polys)
            if isinstance(blank_poly, sg.Polygon):
                blank_poly = simplify_bend_double_angles(blank_poly, bend_lines=bend_lines, tolerance=0.8)
            
            def add_poly_contours(p):
                if isinstance(p, sg.Polygon):
                    cut_edges.append(list(p.exterior.coords))
                    for interior in p.interiors:
                        cut_edges.append(list(interior.coords))
                elif hasattr(p, 'geoms'):
                    for sub in p.geoms:
                        add_poly_contours(sub)
            
            if blank_poly:
                add_poly_contours(blank_poly)
            else:
                cut_edges = raw_edges
        else:
            cut_edges = raw_edges
    except Exception:
        cut_edges = raw_edges

    # Write DXF document using ezdxf
    doc = ezdxf.new('R2010')
    msp = doc.modelspace()
    
    # Standard sheet metal DXF layers
    doc.layers.new('OUTER_LOOP', dxfattribs={'color': 3})        # Green for outer boundary
    doc.layers.new('INTERIOR_LOOPS', dxfattribs={'color': 2})     # Yellow for interior cutouts/holes
    doc.layers.new('CUT', dxfattribs={'color': 3})               # Fallback profile layer
    try:
        doc.layers.new('UP_CENTERLINES', dxfattribs={'color': 5, 'linetype': 'CENTER2'})    # Blue dash-dot for UP bend
        doc.layers.new('DOWN_CENTERLINES', dxfattribs={'color': 1, 'linetype': 'CENTER2'})  # Red dash-dot for DOWN bend
        doc.layers.new('BEND_TANGENTS', dxfattribs={'color': 9, 'linetype': 'DASHED'})     # Light grey dashed for bend tangents
        doc.layers.new('BEND_LINES', dxfattribs={'color': 5, 'linetype': 'CENTER2'})
    except Exception:
        doc.layers.new('UP_CENTERLINES', dxfattribs={'color': 5})
        doc.layers.new('DOWN_CENTERLINES', dxfattribs={'color': 1})
        doc.layers.new('BEND_TANGENTS', dxfattribs={'color': 9})
        doc.layers.new('BEND_LINES', dxfattribs={'color': 5})
        
    def is_circular_pts(pts):
        if len(pts) < 5:
            return False, None, None
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        cx = sum(xs) / len(xs)
        cy = sum(ys) / len(ys)
        radii = [math.hypot(p[0] - cx, p[1] - cy) for p in pts]
        mean_r = sum(radii) / len(radii)
        if mean_r < 0.001:
            return False, None, None
        max_dev = max(abs(r - mean_r) for r in radii)
        if max_dev / mean_r < 0.05:
            return True, (round(cx, 3), round(cy, 3)), round(mean_r, 3)
        return False, None, None

    if cut_edges:
        for idx, pts in enumerate(cut_edges):
            layer_name = 'OUTER_LOOP' if idx == 0 else 'INTERIOR_LOOPS'
            if len(pts) == 2:
                msp.add_line(pts[0], pts[1], dxfattribs={'layer': layer_name})
            elif idx > 0:
                is_circ, center, radius = is_circular_pts(pts)
                if is_circ:
                    msp.add_circle(center, radius, dxfattribs={'layer': 'INTERIOR_LOOPS'})
                else:
                    for i_p in range(len(pts) - 1):
                        msp.add_line(pts[i_p], pts[i_p + 1], dxfattribs={'layer': layer_name})
            else:
                # Merge collinear line segments along OUTER_LOOP before writing DXF entities
                merged_pts = [pts[0]]
                m_n = len(pts)
                for i_p in range(1, m_n - 1):
                    p_prev = np.array(merged_pts[-1][:2])
                    p_curr = np.array(pts[i_p][:2])
                    p_next = np.array(pts[i_p + 1][:2])
                    v1 = p_curr - p_prev
                    v2 = p_next - p_curr
                    l1, l2 = np.linalg.norm(v1), np.linalg.norm(v2)
                    if l1 > 1e-4 and l2 > 1e-4:
                        u1, u2 = v1 / l1, v2 / l2
                        dot = np.clip(np.dot(u1, u2), -1.0, 1.0)
                        if np.degrees(np.arccos(dot)) <= 1.0:
                            continue
                    merged_pts.append(pts[i_p])
                merged_pts.append(pts[-1])
                
                for i_p in range(len(merged_pts) - 1):
                    p_a = (round(merged_pts[i_p][0], 3), round(merged_pts[i_p][1], 3))
                    p_b = (round(merged_pts[i_p + 1][0], 3), round(merged_pts[i_p + 1][1], 3))
                    if math.hypot(p_b[0] - p_a[0], p_b[1] - p_a[1]) > 1e-4:
                        msp.add_line(p_a, p_b, dxfattribs={'layer': 'OUTER_LOOP'})
            
    if not exclude_bend_lines:
        for bend in bend_lines:
            centerline_layer = 'UP_CENTERLINES'
            
            p1 = np.array([bend["start"][0], bend["start"][1]])
            p2 = np.array([bend["end"][0], bend["end"][1]])
            
            if blank_poly and isinstance(blank_poly, sg.Polygon):
                try:
                    d = p2 - p1
                    length = np.linalg.norm(d)
                    if length > 1e-6:
                        u = d / length
                        ext_line = sg.LineString([p1 - u * 500.0, p2 + u * 500.0])
                        inter = ext_line.intersection(blank_poly.exterior)
                        pts = []
                        if isinstance(inter, sg.Point):
                            pts.append((inter.x, inter.y))
                        elif isinstance(inter, sg.MultiPoint):
                            pts.extend([(p.x, p.y) for p in inter.geoms])
                        elif isinstance(inter, sg.LineString):
                            pts.extend([(p[0], p[1]) for p in inter.coords])
                        elif hasattr(inter, 'geoms'):
                            for g in inter.geoms:
                                if isinstance(g, sg.Point):
                                    pts.append((g.x, g.y))
                                elif isinstance(g, sg.LineString):
                                    pts.extend([(p[0], p[1]) for p in g.coords])
                        
                        if len(pts) >= 2:
                            ts = [np.dot(np.array(pt) - p1, u) for pt in pts]
                            neg_ts = [t for t in ts if t <= length / 2.0]
                            pos_ts = [t for t in ts if t >= length / 2.0]
                            if neg_ts and pos_ts:
                                t_s = max(neg_ts)
                                t_e = min(pos_ts)
                                p1 = p1 + t_s * u
                                p2 = p1 + (t_e - t_s) * u
                except Exception:
                    pass

            p1_tuple = (round(p1[0], 3), round(p1[1], 3))
            p2_tuple = (round(p2[0], 3), round(p2[1], 3))
            bend["start"] = p1_tuple
            bend["end"] = p2_tuple
            msp.add_line(p1_tuple, p2_tuple, dxfattribs={'layer': centerline_layer, 'linetype': 'CENTER2'})
        
    os.makedirs(os.path.dirname(os.path.abspath(dxf_path)), exist_ok=True)
    doc.saveas(dxf_path)
    
    # Export SVG preview if requested
    if svg_path:
        all_pts = []
        for pts in cut_edges:
            all_pts.extend(pts)
        if not exclude_bend_lines:
            for bend in bend_lines:
                all_pts.append((bend["start"][0], bend["start"][1]))
                all_pts.append((bend["end"][0], bend["end"][1]))
                if "tangent1_start" in bend:
                    all_pts.append((bend["tangent1_start"][0], bend["tangent1_start"][1]))
                    all_pts.append((bend["tangent1_end"][0], bend["tangent1_end"][1]))
                    all_pts.append((bend["tangent2_start"][0], bend["tangent2_start"][1]))
                    all_pts.append((bend["tangent2_end"][0], bend["tangent2_end"][1]))

        if not all_pts:
            return
            
        min_x = min(p[0] for p in all_pts)
        max_x = max(p[0] for p in all_pts)
        min_y = min(p[1] for p in all_pts)
        max_y = max(p[1] for p in all_pts)
        
        width = max_x - min_x
        height = max_y - min_y
        
        pad = max(width, height) * 0.05 if max(width, height) > 0 else 10.0
        min_x -= pad
        min_y -= pad
        width += 2 * pad
        height += 2 * pad
        
        svg_content = []
        svg_content.append(f'<svg viewBox="{min_x} {min_y} {width} {height}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">')
        svg_content.append('  <style>')
        svg_content.append('    svg { background: #1E1F29; }')
        svg_content.append('    .cut-outer { stroke: #38BDF8; stroke-width: 1.8; fill: #0EA5E9; fill-opacity: 0.15; stroke-linecap: round; stroke-linejoin: round; }')
        svg_content.append('    .cut-inner { stroke: #F59E0B; stroke-width: 1.2; fill: #1E1F29; stroke-linecap: round; stroke-linejoin: round; }')
        svg_content.append('    .bend-zone-band { fill: #FFFFFF; fill-opacity: 0.85; stroke: #94A3B8; stroke-width: 0.8; stroke-dasharray: 4,3; }')
        svg_content.append('    .bend-centerline-up { stroke: #0073CC; stroke-width: 1.8; stroke-dasharray: 10,3,2,3; stroke-linecap: round; }')
        svg_content.append('    .bend-centerline-down { stroke: #EF4444; stroke-width: 1.8; stroke-dasharray: 10,3,2,3; stroke-linecap: round; }')
        svg_content.append('  </style>')
        
        svg_content.append(f'  <g transform="scale(1, -1) translate(0, {-(min_y + max_y)})">')
        
        # 1. Render Outer & Inner Cut Contours
        for idx, pts in enumerate(cut_edges):
            css_class = "cut-outer" if idx == 0 else "cut-inner"
            if len(pts) == 2:
                svg_content.append(f'    <line x1="{pts[0][0]}" y1="{pts[0][1]}" x2="{pts[1][0]}" y2="{pts[1][1]}" class="{css_class}" />')
            else:
                pts_str = " ".join(f"{p[0]},{p[1]}" for p in pts)
                svg_content.append(f'    <polygon points="{pts_str}" class="{css_class}" />')
                
        # 2. Render Bend Centerlines (single-line convention, matching reference CAD output -
        # no separate raw tangent-point overlay band, since that would redraw the uncorrected
        # double-angle kink geometry directly on top of the already-fixed flange silhouette)
        if not exclude_bend_lines:
            for bend in bend_lines:
                direction = bend.get("direction", "UP").upper()
                centerline_class = "bend-centerline-up" if direction == "UP" else "bend-centerline-down"

                p1 = bend["start"]
                p2 = bend["end"]
                svg_content.append(f'    <line x1="{p1[0]}" y1="{p1[1]}" x2="{p2[0]}" y2="{p2[1]}" class="{centerline_class}" />')
            
        svg_content.append('  </g>')
        svg_content.append('</svg>')
        
        os.makedirs(os.path.dirname(os.path.abspath(svg_path)), exist_ok=True)
        with open(svg_path, 'w', encoding='utf-8') as f:
            f.write("\n".join(svg_content))
