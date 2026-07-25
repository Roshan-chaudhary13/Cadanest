import os, glob
import ezdxf
from ezdxf import path
import shapely.geometry as sg
from shapely.ops import polygonize, unary_union

sample_dir = r'C:\Users\rosha\Desktop\Cadanest\sample\Upravljacka jedinica\Razvijene povrsine pozicija dxf - file'
dxf_files = sorted(glob.glob(os.path.join(sample_dir, '*.dxf')))

BEND_LAYER_KEYWORDS = {
    'UP_CENTERLINES', 'DOWN_CENTERLINES', 'BEND', 'BENDS', 'BEND_UP', 
    'BEND_DOWN', 'BEND_LINES', 'BEND_LINE', 'CENTER', 'CENTERLINES', 
    'CENTERLINE', 'AXIS', 'ANNOTATION', 'DIMENSION', 'DIMS', 'TEXT'
}

PROFILE_LAYER_KEYWORDS = {
    'OUTER_LOOP', 'CUT', 'CONTOUR', 'PROFILE', 'OUTER', 'INTERIOR_LOOPS'
}

def load_polygon_improved(dxf_path):
    doc = ezdxf.readfile(dxf_path)
    msp = doc.modelspace()
    
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
    
    edges = []
    for entity in cut_entities:
        try:
            if entity.dxftype() == 'INSERT':
                for sub_entity in entity.virtual_entities():
                    try:
                        p = path.make_path(sub_entity)
                        pts = [(round(v.x, 3), round(v.y, 3)) for v in p.flattening(distance=0.15)]
                        if len(pts) >= 2:
                            edges.append(sg.LineString(pts))
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
        raise ValueError("No edges extracted.")

    unioned = unary_union(edges)
    polys = list(polygonize(unioned))
    if not polys:
        return unioned.convex_hull
        
    # Separate outer regions and holes
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

    # Take exterior boundary union of outer regions
    solid_outers = [sg.Polygon(p.exterior) for p in outer_regions]
    outer = unary_union(solid_outers)
    
    # Subtract holes
    for hole in holes:
        if outer.contains(hole.centroid):
            outer = outer.difference(hole)

    return outer

print("Testing improved DXF loader on all sample files...\n")
for fpath in dxf_files:
    fname = os.path.basename(fpath)
    try:
        poly = load_polygon_improved(fpath)
        bounds = poly.bounds
        w = bounds[2] - bounds[0]
        h = bounds[3] - bounds[1]
        area = poly.area
        print(f"OK: {fname:55s} | BBox: {w:8.3f} x {h:8.3f} mm | Area: {area:10.2f} mm² | Type: {poly.geom_type}")
    except Exception as err:
        print(f"FAIL: {fname} -> {err}")
