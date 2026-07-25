from OCC.Core.BRepAdaptor import BRepAdaptor_Surface
from OCC.Core.GeomAbs import GeomAbs_Plane, GeomAbs_Cylinder
from OCC.Core.BRepGProp import brepgprop
from OCC.Core.GProp import GProp_GProps
from OCC.Core.TopTools import TopTools_IndexedDataMapOfShapeListOfShape
from OCC.Core.TopExp import topexp
from OCC.Core.TopAbs import TopAbs_EDGE, TopAbs_FACE
from OCC.Core.TopoDS import topods
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
    Classifies a face as PLANE, CYLINDER, or UNKNOWN.
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
        axis = cyl.Position().Axis()
        dir_vec = axis.Direction()
        loc = axis.Location()
        return {
            "type": "CYLINDER",
            "radius": radius,
            "axis_dir": (dir_vec.X(), dir_vec.Y(), dir_vec.Z()),
            "axis_loc": (loc.X(), loc.Y(), loc.Z()),
            "area": area
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
