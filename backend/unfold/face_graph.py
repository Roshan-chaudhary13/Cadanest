from OCC.Core.BRepAdaptor import BRepAdaptor_Surface
from OCC.Core.GeomAbs import (
    GeomAbs_Plane, GeomAbs_Cylinder, GeomAbs_Cone, GeomAbs_Torus,
    GeomAbs_BSplineSurface, GeomAbs_BezierSurface, GeomAbs_SurfaceOfRevolution,
    GeomAbs_SurfaceOfExtrusion
)
from OCC.Core.BRepGProp import brepgprop, BRepGProp_Face
from OCC.Core.GProp import GProp_GProps
from OCC.Core.TopTools import TopTools_IndexedDataMapOfShapeListOfShape
from OCC.Core.TopExp import topexp
from OCC.Core.TopAbs import TopAbs_EDGE, TopAbs_FACE
from OCC.Core.TopoDS import topods
from OCC.Core.gp import gp_Pnt, gp_Vec
import numpy as np

def get_face_area(face) -> float:
    """
    Computes the surface area of a TopoDS_Face.
    """
    gprops = GProp_GProps()
    brepgprop.SurfaceProperties(face, gprops)
    return gprops.Mass()

def get_face_center(face):
    """
    Returns the centre of mass coordinates of a TopoDS_Face as a numpy array.
    """
    gprops = GProp_GProps()
    brepgprop.SurfaceProperties(face, gprops)
    c = gprops.CentreOfMass()
    return np.array([c.X(), c.Y(), c.Z()])

def classify_face(face):
    """
    Classifies a face as PLANE, CYLINDER, CONE, TORUS, BSPLINE, or UNKNOWN with topological metadata.
    """
    adaptor = BRepAdaptor_Surface(face)
    stype = adaptor.GetType()
    area = get_face_area(face)
    
    if stype == GeomAbs_Plane:
        pln = adaptor.Plane()
        normal = pln.Position().Direction()
        n_vec = np.array([normal.X(), normal.Y(), normal.Z()])
        from OCC.Core.TopAbs import TopAbs_REVERSED
        if face.Orientation() == TopAbs_REVERSED:
            n_vec = -n_vec
        return {
            "type": "PLANE",
            "normal": (n_vec[0], n_vec[1], n_vec[2]),
            "area": area
        }
    elif stype == GeomAbs_Cylinder:
        cyl = adaptor.Cylinder()
        radius = cyl.Radius()
        u_span = abs(adaptor.LastUParameter() - adaptor.FirstUParameter())

        # Fast-path perforated holes (full 360-degree small cylindrical cutouts)
        if radius < 12.0 and u_span >= 6.0:
            return {
                "type": "HOLE_CYLINDER",
                "radius": radius,
                "area": 0.0,
                "is_inner": True
            }

        axis = cyl.Position().Axis()
        dir_vec = axis.Direction()
        loc = axis.Location()

        u_mid = (adaptor.FirstUParameter() + adaptor.LastUParameter()) / 2.0
        v_mid = (adaptor.FirstVParameter() + adaptor.LastVParameter()) / 2.0
        p_surf = gp_Pnt()
        n_surf = gp_Vec()
        BRepGProp_Face(face).Normal(u_mid, v_mid, p_surf, n_surf)

        axis_dir_vec = gp_Vec(dir_vec.X(), dir_vec.Y(), dir_vec.Z())
        to_surf = gp_Vec(loc, p_surf)
        radial_vec = to_surf - axis_dir_vec.Multiplied(to_surf.Dot(axis_dir_vec))
        is_inner = radial_vec.Dot(n_surf) < 0.0

        return {
            "type": "CYLINDER",
            "radius": radius,
            "axis_dir": (dir_vec.X(), dir_vec.Y(), dir_vec.Z()),
            "axis_loc": (loc.X(), loc.Y(), loc.Z()),
            "area": area,
            "is_inner": is_inner
        }
    elif stype == GeomAbs_Cone:
        cone = adaptor.Cone()
        semi_angle = cone.SemiAngle()
        ref_radius = cone.RefRadius()
        axis = cone.Position().Axis()
        dir_vec = axis.Direction()
        loc = axis.Location()
        return {
            "type": "CONE",
            "semi_angle": semi_angle,
            "radius": ref_radius,
            "axis_dir": (dir_vec.X(), dir_vec.Y(), dir_vec.Z()),
            "axis_loc": (loc.X(), loc.Y(), loc.Z()),
            "area": area,
            "is_inner": True
        }
    elif stype in (GeomAbs_BSplineSurface, GeomAbs_BezierSurface, GeomAbs_SurfaceOfRevolution, GeomAbs_SurfaceOfExtrusion):
        return {
            "type": "MICRO_WALL_SURFACE",
            "area": area,
            "is_inner": True
        }
    elif stype == GeomAbs_Torus:
        torus = adaptor.Torus()
        return {
            "type": "TORUS",
            "major_radius": torus.MajorRadius(),
            "minor_radius": torus.MinorRadius(),
            "area": area,
            "is_inner": True
        }
    else:
        return {
            "type": "UNKNOWN",
            "area": area
        }

def get_face_fingerprint(face, meta=None):
    """
    Generates a unique spatial key for face deduplication in assemblies.
    """
    if meta is None:
        meta = classify_face(face)
    c = get_face_center(face)
    c_key = (round(c[0], 2), round(c[1], 2), round(c[2], 2))
    a_key = round(meta["area"], 2)
    if meta["type"] == "PLANE":
        n = meta["normal"]
        n_key = (round(n[0], 2), round(n[1], 2), round(n[2], 2))
        return ("PLANE", c_key, n_key, a_key)
    elif meta["type"] == "CYLINDER":
        r_key = round(meta["radius"], 2)
        return ("CYLINDER", c_key, r_key, a_key)
    return ("UNKNOWN", c_key, a_key)

def find_face_index(face, faces_list):
    """
    Finds the index of a face in a list using the topological shape comparison IsSame.
    """
    for idx, f in enumerate(faces_list):
        if face.IsSame(f):
            return idx
    return None

def build_face_adjacency_graph(shape, faces_list):
    """
    Builds the adjacency graph of the faces in the shape.
    """
    edge_face_map = TopTools_IndexedDataMapOfShapeListOfShape()
    topexp.MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edge_face_map)
    
    adj = {idx: [] for idx in range(len(faces_list))}
    
    for i in range(1, edge_face_map.Size() + 1):
        edge = topods.Edge(edge_face_map.FindKey(i))
        ancestors = edge_face_map.FindFromIndex(i)
        
        if ancestors.Size() == 2:
            face1 = topods.Face(ancestors.First())
            face2 = topods.Face(ancestors.Last())
            
            idx1 = find_face_index(face1, faces_list)
            idx2 = find_face_index(face2, faces_list)
            
            if idx1 is not None and idx2 is not None:
                adj[idx1].append({
                    "neighbor": idx2,
                    "edge": edge
                })
                adj[idx2].append({
                    "neighbor": idx1,
                    "edge": edge
                })
    return adj


def is_sheet_metal_part(classification_list: list) -> bool:
    """
    Topology screening heuristic: determines whether a 3D model is a sheet metal component
    vs solid block, casting, bolt, or non-developable object.
    Checks for:
    - Dominance of PLANE and CYLINDER faces.
    - Lack of complex non-developable surface geometries.
    """
    if not classification_list or len(classification_list) < 3:
        return False

    planes = [c for c in classification_list if c["type"] == "PLANE"]
    cylinders = [c for c in classification_list if c["type"] in ("CYLINDER", "HOLE_CYLINDER")]
    unknowns = [c for c in classification_list if c["type"] == "UNKNOWN"]

    # Disqualify if unknown/complex non-developable surfaces dominate total area
    total_area = sum(c.get("area", 0.0) for c in classification_list)
    if total_area > 0:
        unknown_area = sum(c.get("area", 0.0) for c in unknowns)
        if (unknown_area / total_area) > 0.20:
            return False

    # A valid sheet metal blank must have at least 2 planar faces for front & back sheet flanges
    if len(planes) < 2:
        return False

    return True

