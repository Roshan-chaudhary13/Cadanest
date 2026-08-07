from OCC.Core.STEPControl import STEPControl_Reader
from OCC.Core.IFSelect import IFSelect_RetDone
from OCC.Core.TopExp import TopExp_Explorer
from OCC.Core.TopAbs import TopAbs_FACE
import os

_STEP_SHAPE_CACHE = {}

def load_step_file(file_path: str):
    """
    Loads a STEP file using STEPControl_Reader and returns the TopoDS_Shape.
    Caches parsed shapes in memory by path & mtime for instant sub-second reuse.
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"STEP file not found: {file_path}")

    abs_path = os.path.abspath(file_path)
    mtime = os.path.getmtime(abs_path)
    cache_key = (abs_path, mtime)

    if cache_key in _STEP_SHAPE_CACHE:
        return _STEP_SHAPE_CACHE[cache_key]

    reader = STEPControl_Reader()
    status = reader.ReadFile(abs_path)
    if status != IFSelect_RetDone:
        raise IOError(f"Failed to parse STEP file: {file_path} (Status error)")

    reader.TransferRoots()
    shape = reader.OneShape()
    if shape is None or (hasattr(shape, "IsNull") and shape.IsNull()):
        raise ValueError("Null or empty shape loaded from STEP file.")

    _STEP_SHAPE_CACHE[cache_key] = shape
    return shape

def extract_faces(shape):
    """
    Extracts all TopoDS_Face objects from the TopoDS_Shape.
    """
    faces = []
    if shape is None or (hasattr(shape, "IsNull") and shape.IsNull()):
        return faces
    from OCC.Core.TopoDS import topods
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    while explorer.More():
        curr = explorer.Current()
        if curr is not None and not curr.IsNull():
            faces.append(topods.Face(curr))
        explorer.Next()
    return faces
