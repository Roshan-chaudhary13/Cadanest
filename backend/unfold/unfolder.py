from OCC.Core.gp import gp_Trsf, gp_Vec, gp_Dir, gp_Pnt, gp_Ax1, gp_Ax3
from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCC.Core.TopoDS import TopoDS_Compound
from OCC.Core.BRep import BRep_Builder
from OCC.Core.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCC.Core.GeomAbs import GeomAbs_Line, GeomAbs_Cylinder
import numpy as np
import math

from .face_graph import (
    classify_face,
    build_face_adjacency_graph,
    find_face_index,
    get_face_center
)
from .bend_math import calculate_bend_allowance, calculate_outside_setback

def find_shared_endpoints_and_geometry(face1, face2):
    """
    Finds all topologically shared edges between face1 and face2,
    merges them, and returns (p_start, p_end, length, direction, midpoint).
    """
    from OCC.Core.TopExp import TopExp_Explorer
    from OCC.Core.TopAbs import TopAbs_EDGE
    from OCC.Core.BRepAdaptor import BRepAdaptor_Curve
    import numpy as np
    
    edges1 = []
    exp1 = TopExp_Explorer(face1, TopAbs_EDGE)
    while exp1.More():
        edges1.append(exp1.Current())
        exp1.Next()
        
    shared_edges = []
    exp2 = TopExp_Explorer(face2, TopAbs_EDGE)
    while exp2.More():
        e2 = exp2.Current()
        for e1 in edges1:
            if e1.IsSame(e2):
                shared_edges.append(e1)
        exp2.Next()
        
    if not shared_edges:
        return None, None, 0.0, np.array([0.0, 0.0, 1.0]), np.array([0.0, 0.0, 0.0])
        
    points = []
    for e in shared_edges:
        curve = BRepAdaptor_Curve(e)
        p_start = curve.Value(curve.FirstParameter())
        p_end = curve.Value(curve.LastParameter())
        points.append(np.array([p_start.X(), p_start.Y(), p_start.Z()]))
        points.append(np.array([p_end.X(), p_end.Y(), p_end.Z()]))
        
    # Find the pair of points furthest apart
    max_dist = -1.0
    p_start_res = points[0]
    p_end_res = points[1] if len(points) > 1 else points[0]
    
    for i in range(len(points)):
        for j in range(i + 1, len(points)):
            d = np.linalg.norm(points[i] - points[j])
            if d > max_dist:
                max_dist = d
                p_start_res = points[i]
                p_end_res = points[j]
                
    length = max_dist if max_dist > 0.0 else 0.0
    midpoint = (p_start_res + p_end_res) / 2.0
    
    # Determine direction
    if length > 1e-6:
        direction = (p_end_res - p_start_res) / length
    else:
        direction = np.array([0.0, 0.0, 1.0])
        
    return p_start_res, p_end_res, length, direction, midpoint

def find_shared_edge(face1, face2):
    """
    Finds the topologically shared edge between two faces.
    """
    from OCC.Core.TopExp import TopExp_Explorer
    from OCC.Core.TopAbs import TopAbs_EDGE
    
    edges1 = []
    exp1 = TopExp_Explorer(face1, TopAbs_EDGE)
    while exp1.More():
        edges1.append(exp1.Current())
        exp1.Next()
        
    exp2 = TopExp_Explorer(face2, TopAbs_EDGE)
    while exp2.More():
        e2 = exp2.Current()
        for e1 in edges1:
            if e1.IsSame(e2):
                return e1
        exp2.Next()
    return None

def get_edge_line_geometry(edge):
    """
    Returns the direction, midpoint, and length of a straight edge.
    """
    curve = BRepAdaptor_Curve(edge)
    u_min = curve.FirstParameter()
    u_max = curve.LastParameter()
    mid_u = (u_min + u_max) / 2.0
    
    p_mid = curve.Value(mid_u)
    p_start = curve.Value(u_min)
    p_end = curve.Value(u_max)
    
    length = p_start.Distance(p_end)
    
    if curve.GetType() == GeomAbs_Line:
        line = curve.Line()
        direction = line.Position().Direction()
        return (direction.X(), direction.Y(), direction.Z()), (p_mid.X(), p_mid.Y(), p_mid.Z()), length
    else:
        # Fallback for slightly curved edges
        dx = p_end.X() - p_start.X()
        dy = p_end.Y() - p_start.Y()
        dz = p_end.Z() - p_start.Z()
        dist = math.sqrt(dx*dx + dy*dy + dz*dz)
        if dist > 1e-6:
            return (dx/dist, dy/dist, dz/dist), (p_mid.X(), p_mid.Y(), p_mid.Z()), length
        return (0.0, 0.0, 1.0), (p_mid.X(), p_mid.Y(), p_mid.Z()), length

def get_correct_rotation_angle(normal_curr, normal_neighbor, axis_dir, axis_loc, theta, c_parent=None, c_child=None):
    """
    Finds whether theta or -theta aligns the rotated neighbor face outward away from the current face.
    """
    if c_parent is not None and c_child is not None:
        p_edge = np.array(axis_loc)
        v_parent = np.array(c_parent) - p_edge
        v_child = np.array(c_child) - p_edge

        t1 = gp_Trsf()
        t1.SetRotation(gp_Ax1(gp_Pnt(*axis_loc), gp_Dir(*axis_dir)), theta)
        v1 = gp_Vec(float(v_child[0]), float(v_child[1]), float(v_child[2]))
        v1.Transform(t1)
        dot1 = np.dot([v1.X(), v1.Y(), v1.Z()], v_parent)

        t2 = gp_Trsf()
        t2.SetRotation(gp_Ax1(gp_Pnt(*axis_loc), gp_Dir(*axis_dir)), -theta)
        v2 = gp_Vec(float(v_child[0]), float(v_child[1]), float(v_child[2]))
        v2.Transform(t2)
        dot2 = np.dot([v2.X(), v2.Y(), v2.Z()], v_parent)

        # We want the child vector to point AWAY from the parent vector (dot < 0)
        return theta if dot1 < dot2 else -theta

    t_plus = gp_Trsf()
    t_plus.SetRotation(gp_Ax1(gp_Pnt(*axis_loc), gp_Dir(*axis_dir)), theta)
    n_plus = gp_Vec(*normal_neighbor)
    n_plus.Transform(t_plus)
    dot_plus = n_plus.Dot(gp_Vec(*normal_curr))
    
    t_minus = gp_Trsf()
    t_minus.SetRotation(gp_Ax1(gp_Pnt(*axis_loc), gp_Dir(*axis_dir)), -theta)
    n_minus = gp_Vec(*normal_neighbor)
    n_minus.Transform(t_minus)
    dot_minus = n_minus.Dot(gp_Vec(*normal_curr))
    
    return theta if dot_plus > dot_minus else -theta

def detect_thickness(faces_list, classification):
    """
    Auto-detects material thickness by finding parallel, opposite-normal planar face pairs.
    """
    planar_indices = [i for i, c in enumerate(classification) if c["type"] == "PLANE"]
    if len(planar_indices) < 2:
        return None
        
    candidates = []
    for idx_a in planar_indices:
        meta_a = classification[idx_a]
        n_a = np.array(meta_a["normal"])
        c_a = get_face_center(faces_list[idx_a])
        
        for idx_b in planar_indices:
            if idx_b <= idx_a:
                continue
            meta_b = classification[idx_b]
            n_b = np.array(meta_b["normal"])
            
            # Check if normals are opposite (dot product near -1)
            dot_val = np.dot(n_a, n_b)
            if dot_val < -0.95:
                c_b = get_face_center(faces_list[idx_b])
                # Compute distance along normal
                dist = abs(np.dot(c_b - c_a, n_a))
                # Reasonable sheet metal thickness range: 0.1mm to 20mm
                if 0.1 <= dist <= 20.0:
                    min_area = min(meta_a["area"], meta_b["area"])
                    candidates.append((dist, min_area))
                    
    if not candidates:
        return None
        
    # Sort candidates by area descending, choose the distance of the largest pair
    candidates.sort(key=lambda x: x[1], reverse=True)
    return round(candidates[0][0], 4)

def find_thickness_partner(face_idx, classification, faces_list, thickness):
    """
    Finds the index of the face that is the thickness partner of face_idx.
    """
    meta_curr = classification[face_idx]
    if meta_curr["type"] != "PLANE":
        return None
        
    n_curr = np.array(meta_curr["normal"])
    c_curr = get_face_center(faces_list[face_idx])
    
    for idx, meta in enumerate(classification):
        if idx == face_idx or meta["type"] != "PLANE":
            continue
            
        n_other = np.array(meta["normal"])
        # Normals must be opposite
        if np.dot(n_curr, n_other) < -0.95:
            c_other = get_face_center(faces_list[idx])
            dist = abs(np.dot(c_other - c_curr, n_curr))
            # Distance must be approximately the thickness (within 20% tolerance)
            if abs(dist - thickness) < 0.2 * thickness:
                # Area ratio sanity check: partner faces of a sheet metal part must have comparable surface areas
                min_a = min(meta_curr["area"], meta["area"])
                max_a = max(meta_curr["area"], meta["area"])
                if max_a > 0 and (min_a / max_a) >= 0.15:
                    return idx
    return None


def build_planar_adjacency(faces_list, classification, adj, thickness):
    """
    Builds a direct adjacency graph between planar faces, connected by cylindrical bends or sharp folds.
    Uses partner filtering to ignore side thickness profiles and prevent crossing shells.
    """
    planar_adj = {i: [] for i, c in enumerate(classification) if c["type"] == "PLANE"}
    
    # Pre-calculate partners
    partners = {}
    planar_indices = [i for i, c in enumerate(classification) if c["type"] == "PLANE"]
    for idx in planar_indices:
        partners[idx] = find_thickness_partner(idx, classification, faces_list, thickness)
        
    # 1. Cylinder chain connectivity
    for start_idx in planar_adj.keys():
        if partners.get(start_idx) is None:
            continue
            
        visited_cylinders = set()
        queue = []
        for edge_info in adj[start_idx]:
            n_idx = edge_info["neighbor"]
            if classification[n_idx]["type"] == "CYLINDER":
                edge = edge_info["edge"]
                curve = BRepAdaptor_Curve(edge)
                if curve.GetType() == GeomAbs_Line:
                    surf_adaptor = BRepAdaptor_Surface(faces_list[n_idx])
                    cyl = surf_adaptor.Cylinder()
                    axis_dir = cyl.Position().Direction()
                    axis_vec = np.array([axis_dir.X(), axis_dir.Y(), axis_dir.Z()])
                    n_normal = classification[start_idx]["normal"]
                    if abs(np.dot(axis_vec, n_normal)) < 0.15:
                        queue.append((n_idx, n_idx))
                        visited_cylinders.add(n_idx)
                        
        while queue:
            curr_idx, first_cyl = queue.pop(0)
            for edge_info in adj[curr_idx]:
                n_idx = edge_info["neighbor"]
                if classification[n_idx]["type"] == "PLANE":
                    if n_idx != start_idx and partners.get(n_idx) is not None:
                        edge = edge_info["edge"]
                        curve = BRepAdaptor_Curve(edge)
                        if curve.GetType() == GeomAbs_Line:
                            n_start = np.array(classification[start_idx]["normal"])
                            n_neigh = np.array(classification[n_idx]["normal"])
                            dot_faces = abs(np.dot(n_start, n_neigh))
                            if dot_faces <= 0.99:
                                if not any(item["neighbor"] == n_idx for item in planar_adj[start_idx]):
                                    planar_adj[start_idx].append({"neighbor": n_idx, "bend_face_idx": first_cyl})
                elif classification[n_idx]["type"] == "CYLINDER":
                    if n_idx not in visited_cylinders:
                        edge = edge_info["edge"]
                        curve = BRepAdaptor_Curve(edge)
                        if curve.GetType() == GeomAbs_Line:
                            visited_cylinders.add(n_idx)
                            queue.append((n_idx, first_cyl))
                            
    # 2. Sharp fold connectivity
    for idx, c in enumerate(classification):
        if c["type"] == "PLANE" and partners.get(idx) is not None:
            for edge_info in adj[idx]:
                n_idx = edge_info["neighbor"]
                if classification[n_idx]["type"] == "PLANE" and n_idx > idx and partners.get(n_idx) is not None:
                    edge = edge_info["edge"]
                    _, _, e_length = get_edge_line_geometry(edge)
                    if e_length > 2.0 * thickness:
                        n_curr = c["normal"]
                        n_neigh = classification[n_idx]["normal"]
                        dot_val = abs(np.dot(n_curr, n_neigh))
                        if dot_val <= 0.99:
                            planar_adj[idx].append({"neighbor": n_idx, "bend_face_idx": None})
                            planar_adj[n_idx].append({"neighbor": idx, "bend_face_idx": None})
                            
    return planar_adj

def make_flat_bend_face(p_start, p_end, u, BA, lateral_shift_vec=None):
    """
    Constructs a 2D flat face representing the developed bend region,
    accounting for lateral offset/slants.
    """
    from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_MakePolygon, BRepBuilderAPI_MakeFace
    from OCC.Core.gp import gp_Pnt
    
    p3 = p_end + BA * u
    p4 = p_start + BA * u
    if lateral_shift_vec is not None:
        p3 = p3 + lateral_shift_vec
        p4 = p4 + lateral_shift_vec
        
    poly = BRepBuilderAPI_MakePolygon()
    poly.Add(gp_Pnt(p_start[0], p_start[1], p_start[2]))
    poly.Add(gp_Pnt(p_end[0], p_end[1], p_end[2]))
    poly.Add(gp_Pnt(p3[0], p3[1], p3[2]))
    poly.Add(gp_Pnt(p4[0], p4[1], p4[2]))
    poly.Close()
    
    face_builder = BRepBuilderAPI_MakeFace(poly.Wire())
    return face_builder.Face()

def fuse_shapes_binary_tree(shapes):
    """
    Fuses a list of TopoDS_Shape objects using a binary tree structure.
    Highly numerically stable and avoids stack overflow or deep nested histories.
    """
    if not shapes:
        return None
    from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Fuse
    
    current_level = list(shapes)
    while len(current_level) > 1:
        next_level = []
        for i in range(0, len(current_level), 2):
            if i + 1 < len(current_level):
                fuse = BRepAlgoAPI_Fuse(current_level[i], current_level[i+1])
                fuse.Build()
                next_level.append(fuse.Shape())
            else:
                next_level.append(current_level[i])
        current_level = next_level
    return current_level[0]


def unfold_sheet_metal_single_root(faces, classification, planar_adj, thickness: float, k_factor: float, root_face_idx: int):
    """
    Performs recursive unfolding starting from a single specific root face index.
    """
    root_face = faces[root_face_idx]
    root_meta = classification[root_face_idx]
    root_center = get_face_center(root_face)
    root_normal = root_meta["normal"]
    
    # 2. Align root face to the XY plane at origin
    t_align = gp_Trsf()
    t_trans = gp_Trsf()
    t_trans.SetTranslation(gp_Vec(-root_center[0], -root_center[1], -root_center[2]))
    t_rot = gp_Trsf()
    from_ax = gp_Ax3(gp_Pnt(0, 0, 0), gp_Dir(*root_normal))
    to_ax = gp_Ax3(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1))
    t_rot.SetDisplacement(from_ax, to_ax)
    t_align.Multiply(t_rot)
    t_align.Multiply(t_trans)
    
    # Root face shape
    root_transformer = BRepBuilderAPI_Transform(root_face, t_align, True)
    flat_shapes = [root_transformer.Shape()]
    
    # 3. BFS Spanning Tree Traversal
    # Pre-calculate partners for all planar faces
    partners = {}
    planar_indices = [i for i, c in enumerate(classification) if c["type"] == "PLANE"]
    for idx in planar_indices:
        partners[idx] = find_thickness_partner(idx, classification, faces, thickness)
        
    visited = {root_face_idx}
    root_partner = partners.get(root_face_idx)
    if root_partner is not None:
        visited.add(root_partner)
        
    queue = [root_face_idx]
    trsf_map = {root_face_idx: t_align}
    bend_lines = []
    used_cylinders = set()  # Each physical cylinder only emits one fold line
    
    while queue:
        curr = queue.pop(0)
        curr_trsf = trsf_map[curr]
        curr_meta = classification[curr]
        
        for edge_info in planar_adj[curr]:
            neighbor = edge_info["neighbor"]
            if neighbor in visited:
                continue
                
            visited.add(neighbor)
            # Block the thickness partner of this neighbor immediately to prevent crossing shells
            neigh_partner = partners.get(neighbor)
            if neigh_partner is not None:
                visited.add(neigh_partner)
                
            queue.append(neighbor)

            
            bend_idx = edge_info["bend_face_idx"]
            
            # Case A: Cylindrical bend
            if bend_idx is not None:
                bend_face = faces[bend_idx]
                bend_meta = classification[bend_idx]
                # Extract combined endpoints and geometry (supporting split/quadrant edges)
                p_s_p, p_e_p, e_length, axis_dir, axis_loc = find_shared_endpoints_and_geometry(faces[curr], bend_face)
                p_s_n, p_e_n, _, _, mid_neigh = find_shared_endpoints_and_geometry(bend_face, faces[neighbor])
                
                if e_length < 1e-6 or p_s_n is None:
                    # Fallback direct transform
                    trsf_map[neighbor] = curr_trsf
                    neighbor_transformer = BRepBuilderAPI_Transform(faces[neighbor], curr_trsf, True)
                    flat_shapes.append(neighbor_transformer.Shape())
                    continue
                    
                # Compute dihedral angle
                n_curr = curr_meta["normal"]
                n_neigh = classification[neighbor]["normal"]
                
                dot_val = np.clip(np.dot(n_curr, n_neigh), -1.0, 1.0)
                theta = math.acos(dot_val)
                
                # Compute bend allowance & outside setback
                BA = calculate_bend_allowance(math.degrees(theta), bend_meta["radius"], thickness, k_factor)
                OSSB = calculate_outside_setback(math.degrees(theta), bend_meta["radius"], thickness)
                
                # Developed flat pattern translation shift from 3D tangent position:
                shift_dist = OSSB - (BA / 2.0)

                # Determine tangent direction u pointing towards the bend
                p_edge = np.array(axis_loc)
                p_bend = get_face_center(bend_face)
                d = p_bend - p_edge
                u = d - np.dot(d, n_curr) * np.array(n_curr)
                
                # IMPORTANT: Asymmetric bend reliefs can shift p_bend laterally along the axis.
                # To prevent this from pulling the unfold diagonally, force u to be 
                # strictly perpendicular to the bend axis as well!
                axis_dir_arr = np.array(axis_dir)
                u = u - np.dot(u, axis_dir_arr) * axis_dir_arr
                
                u_len = np.linalg.norm(u)
                if u_len > 1e-6:
                    u = u / u_len
                else:
                    u = np.array([1.0, 0.0, 0.0])
                    
                c_parent = get_face_center(faces[curr])
                c_child = get_face_center(faces[neighbor])
                rot_angle = get_correct_rotation_angle(n_curr, n_neigh, axis_dir, axis_loc, theta, c_parent, c_child)

                # True 3D rotation pivot transformed into cumulative flat-parent space
                gp_axis_loc_flat = gp_Pnt(*axis_loc)
                gp_axis_loc_flat.Transform(curr_trsf)

                gp_axis_dir_vec = gp_Vec(*axis_dir)
                gp_axis_dir_vec.Transform(curr_trsf)

                t_rot_flat = gp_Trsf()
                t_rot_flat.SetRotation(gp_Ax1(gp_axis_loc_flat, gp_Dir(gp_axis_dir_vec)), rot_angle)

                gp_u_vec = gp_Vec(*u)
                gp_u_vec.Transform(curr_trsf)

                t_trans_flat = gp_Trsf()
                t_trans_flat.SetTranslation(gp_Vec(shift_dist * gp_u_vec.X(), shift_dist * gp_u_vec.Y(), shift_dist * gp_u_vec.Z()))

                c_trsf = gp_Trsf()
                c_trsf.Multiply(t_trans_flat)
                c_trsf.Multiply(t_rot_flat)
                c_trsf.Multiply(curr_trsf)
                trsf_map[neighbor] = c_trsf

                # Add neighbor face shape to list
                neighbor_transformer = BRepBuilderAPI_Transform(faces[neighbor], c_trsf, True)
                flat_shapes.append(neighbor_transformer.Shape())

                # Quad/Polygon bend face in flat space with parent side edge extension
                gp_s_p = gp_Pnt(*p_s_p); gp_s_p.Transform(curr_trsf)
                gp_e_p = gp_Pnt(*p_e_p); gp_e_p.Transform(curr_trsf)
                # Match child edge endpoints (p_s_n, p_e_n) with parent (p_s_p, p_e_p) along cylinder axis_dir
                axis_dir_arr = np.array(axis_dir)
                t_s_p = np.dot(p_s_p, axis_dir_arr)
                t_s_n = np.dot(p_s_n, axis_dir_arr)
                t_e_n = np.dot(p_e_n, axis_dir_arr)
                if abs(t_s_n - t_s_p) > abs(t_e_n - t_s_p):
                    p_s_n, p_e_n = p_e_n, p_s_n

                gp_s_n = gp_Pnt(*p_s_n); gp_s_n.Transform(c_trsf)
                gp_e_n = gp_Pnt(*p_e_n); gp_e_n.Transform(c_trsf)

                # Bend face in flat space: 4-point quadrilateral unrolled cylindrical face
                from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_MakePolygon, BRepBuilderAPI_MakeFace
                poly = BRepBuilderAPI_MakePolygon()
                
                # Side 1: Parent edge (gp_s_p -> gp_e_p)
                poly.Add(gp_s_p)
                poly.Add(gp_e_p)

                # Side 2: Transition boundary across bend allowance (gp_e_p -> gp_e_n)
                poly.Add(gp_e_n)

                # Side 3: Child edge (gp_e_n -> gp_s_n)
                poly.Add(gp_s_n)

                poly.Close()

                local_bend = BRepBuilderAPI_MakeFace(poly.Wire()).Face()
                flat_shapes.append(local_bend)
                
                # Calculate bend centerline directly in flat pattern space from transformed endpoints
                gp_start = gp_Pnt(
                    (gp_s_p.X() + gp_s_n.X()) / 2.0,
                    (gp_s_p.Y() + gp_s_n.Y()) / 2.0,
                    (gp_s_p.Z() + gp_s_n.Z()) / 2.0
                )
                gp_end = gp_Pnt(
                    (gp_e_p.X() + gp_e_n.X()) / 2.0,
                    (gp_e_p.Y() + gp_e_n.Y()) / 2.0,
                    (gp_e_p.Z() + gp_e_n.Z()) / 2.0
                )
                
                # Only emit one fold line per physical cylinder face.
                # Also skip very small-area cylinders (< 150 mm²) which are corner fillets, not structural bends.
                if bend_idx not in used_cylinders and classification[bend_idx]["area"] >= 150.0:
                    used_cylinders.add(bend_idx)
                    direction = "UP" if rot_angle > 0 else "DOWN"
                    bend_lines.append({
                        "start": (gp_start.X(), gp_start.Y(), gp_start.Z()),
                        "end": (gp_end.X(), gp_end.Y(), gp_end.Z()),
                        "tangent1_start": (gp_s_p.X(), gp_s_p.Y(), gp_s_p.Z()),
                        "tangent1_end": (gp_e_p.X(), gp_e_p.Y(), gp_e_p.Z()),
                        "tangent2_start": (gp_s_n.X(), gp_s_n.Y(), gp_s_n.Z()),
                        "tangent2_end": (gp_e_n.X(), gp_e_n.Y(), gp_e_n.Z()),
                        "angle_deg": math.degrees(theta),
                        "ba": BA,
                        "radius": bend_meta["radius"],
                        "direction": direction
                    })
                
            # Case B: Sharp fold (Fallback)
            else:
                e_shared = find_shared_edge(faces[curr], faces[neighbor])
                if e_shared is None:
                    trsf_map[neighbor] = curr_trsf
                    neighbor_transformer = BRepBuilderAPI_Transform(faces[neighbor], curr_trsf, True)
                    flat_shapes.append(neighbor_transformer.Shape())
                    continue
                    
                axis_dir, axis_loc, e_length = get_edge_line_geometry(e_shared)
                n_curr = curr_meta["normal"]
                n_neigh = classification[neighbor]["normal"]
                
                dot_val = np.clip(np.dot(n_curr, n_neigh), -1.0, 1.0)
                theta = math.acos(dot_val)
                
                c_parent = get_face_center(faces[curr])
                c_child = get_face_center(faces[neighbor])
                rot_angle = get_correct_rotation_angle(n_curr, n_neigh, axis_dir, axis_loc, theta, c_parent, c_child)

                gp_axis_loc_flat = gp_Pnt(*axis_loc)
                gp_axis_loc_flat.Transform(curr_trsf)

                gp_axis_dir_vec = gp_Vec(*axis_dir)
                gp_axis_dir_vec.Transform(curr_trsf)

                t_rot_flat = gp_Trsf()
                t_rot_flat.SetRotation(gp_Ax1(gp_axis_loc_flat, gp_Dir(gp_axis_dir_vec)), rot_angle)

                c_trsf = gp_Trsf()
                c_trsf.Multiply(t_rot_flat)
                c_trsf.Multiply(curr_trsf)
                trsf_map[neighbor] = c_trsf
                trsf_map[neighbor] = c_trsf
                
                neighbor_transformer = BRepBuilderAPI_Transform(faces[neighbor], c_trsf, True)
                flat_shapes.append(neighbor_transformer.Shape())
                
                # Sharp folds are topology artifacts (co-planar sections of hooks etc.);
                # real laser-cut fold marks come only from cylinder bends.
                
    # 4. Fuse all flattened planar faces and bend faces into a single unified shape
    from OCC.Core.ShapeUpgrade import ShapeUpgrade_UnifySameDomain
    
    if flat_shapes:
        flat_shape = fuse_shapes_binary_tree(flat_shapes)
            
        # Simplify the shape by dissolving internal co-planar edges
        try:
            unifier = ShapeUpgrade_UnifySameDomain(flat_shape, True, False, True)
            unifier.Build()
            flat_shape = unifier.Shape()
        except Exception:
            pass # Fallback to un-simplified shape if simplification fails
            
    # 5. Deduplicate near-identical bend lines (multiple cylinder faces on same physical bend)
    deduped = []
    for bl in bend_lines:
        s1 = np.array(bl["start"][:2])
        e1 = np.array(bl["end"][:2])
        is_dup = False
        for existing in deduped:
            s2 = np.array(existing["start"][:2])
            e2 = np.array(existing["end"][:2])
            # Check both orientations
            if (np.linalg.norm(s1 - s2) < 2.0 and np.linalg.norm(e1 - e2) < 2.0) or \
               (np.linalg.norm(s1 - e2) < 2.0 and np.linalg.norm(e1 - s2) < 2.0):
                is_dup = True
                break
        if not is_dup:
            deduped.append(bl)
    bend_lines = deduped
    
    if not flat_shapes:
        from OCC.Core.TopoDS import TopoDS_Compound
        from OCC.Core.BRep import BRep_Builder
        flat_shape = TopoDS_Compound()
        builder = BRep_Builder()
        builder.MakeCompound(flat_shape)
        
    return flat_shape, bend_lines

def unfold_sheet_metal(shape, thickness: float = None, k_factor: float = 0.44, root_face_idx = None):
    """
    Performs recursive unfolding of the sheet metal shape and fuses the flat pattern.
    Automatically chooses the cleanest candidate root face based on flat edge count if not specified.
    Supports a list of integer indices for root_face_idx to flatten jointed/disjoint components side-by-side.
    """
    if isinstance(shape, str):
        from .step_loader import load_step_file
        shape = load_step_file(shape)

    from .step_loader import extract_faces
    faces = extract_faces(shape)
    if not faces:
        raise ValueError("No faces extracted from shape.")
        
    classification = [classify_face(f) for f in faces]
    
    if thickness is None:
        thickness = detect_thickness(faces, classification)
        if thickness is None:
            thickness = 2.0
            
    raw_adj = build_face_adjacency_graph(shape, faces)
    planar_adj = build_planar_adjacency(faces, classification, raw_adj, thickness)
    
    # Identify root planar face
    planar_indices = [i for i, c in enumerate(classification) if c["type"] == "PLANE"]
    if not planar_indices:
        raise ValueError("No planar faces found to act as root.")
        
    # Determine the list of root face indices to unfold
    max_area = max(classification[idx]["area"] for idx in planar_indices)
    root_indices = []
    if root_face_idx is not None:
        if isinstance(root_face_idx, list):
            root_indices = [idx for idx in root_face_idx if idx in planar_indices and classification[idx]["area"] >= 0.10 * max_area]
        else:
            if root_face_idx in planar_indices and classification[root_face_idx]["area"] >= 0.10 * max_area:
                root_indices = [root_face_idx]
                
    if not root_indices:
        # Discover all disconnected planar face components in multi-body STEP models and assemblies
        visited = set()
        components = []
        for idx in planar_indices:
            if idx not in visited:
                comp = []
                q = [idx]
                visited.add(idx)
                while q:
                    curr = q.pop(0)
                    comp.append(curr)
                    for info in planar_adj.get(curr, []):
                        neigh = info["neighbor"]
                        if neigh not in visited:
                            visited.add(neigh)
                            q.append(neigh)
                components.append(comp)

        auto_roots = []
        for comp in components:
            max_f = max(comp, key=lambda f_idx: classification[f_idx]["area"])
            if classification[max_f]["area"] >= max(100.0, 0.03 * max_area):
                auto_roots.append(max_f)

        # Deduplicate opposite-thickness partner faces
        partners = {idx: find_thickness_partner(idx, classification, faces, thickness) for idx in auto_roots}
        unique_roots = []
        covered = set()
        for r in auto_roots:
            if r not in covered:
                unique_roots.append(r)
                covered.add(r)
                if partners.get(r) is not None:
                    covered.add(partners[r])

        root_indices = unique_roots if unique_roots else [planar_indices[0]]

    # If there is only one root index, execute the single unfold
    if len(root_indices) == 1:
        return unfold_sheet_metal_single_root(faces, classification, planar_adj, thickness, k_factor, root_indices[0])

    # If there are multiple root indices, unfold each and translate them side-by-side to avoid overlap
    from OCC.Core.Bnd import Bnd_Box
    from OCC.Core.BRepBndLib import brepbndlib
    from OCC.Core.BRep import BRep_Builder
    from OCC.Core.TopoDS import TopoDS_Compound
    
    compound = TopoDS_Compound()
    builder = BRep_Builder()
    builder.MakeCompound(compound)
    
    all_bend_lines = []
    current_x_offset = 0.0
    spacing_between_components = 20.0  # 20mm gap between unfolded components
    
    for r_idx in root_indices:
        comp_shape, comp_bend_lines = unfold_sheet_metal_single_root(faces, classification, planar_adj, thickness, k_factor, r_idx)
        
        # Calculate bounds of the new component before translating it
        bbox = Bnd_Box()
        brepbndlib.Add(comp_shape, bbox)
        
        # If bounding box is empty/invalid, skip translation
        if not bbox.IsVoid():
            xmin, ymin, zmin, xmax, ymax, zmax = bbox.Get()
            x_width = xmax - xmin
            
            if current_x_offset > 0.0:
                dx = current_x_offset - xmin
                
                # Perform translation in OCC
                trsf = gp_Trsf()
                trsf.SetTranslation(gp_Vec(dx, 0.0, 0.0))
                transformer = BRepBuilderAPI_Transform(comp_shape, trsf, True)
                comp_shape = transformer.Shape()
                
                # Translate bend lines
                translated_bend_lines = []
                for bl in comp_bend_lines:
                    translated_bend_lines.append({
                        "start": (bl["start"][0] + dx, bl["start"][1], bl["start"][2]),
                        "end": (bl["end"][0] + dx, bl["end"][1], bl["end"][2]),
                        "angle_deg": bl["angle_deg"]
                    })
                    
                current_x_offset += x_width + spacing_between_components
                all_bend_lines.extend(translated_bend_lines)
            else:
                current_x_offset = x_width + spacing_between_components
                all_bend_lines.extend(comp_bend_lines)
        else:
            all_bend_lines.extend(comp_bend_lines)
            
        builder.Add(compound, comp_shape)
        
    return compound, all_bend_lines
