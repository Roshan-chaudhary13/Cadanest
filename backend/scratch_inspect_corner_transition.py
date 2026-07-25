import os, glob
import ezdxf
from ezdxf import path
import shapely.geometry as sg
from shapely.ops import polygonize, unary_union

_here = os.path.dirname(os.path.abspath(__file__))
import sys
if _here not in sys.path:
    sys.path.insert(0, _here)

from nester import load_polygon_from_dxf

sample_dir = r'C:\Users\rosha\Desktop\Cadanest\sample\Upravljacka jedinica\Razvijene povrsine pozicija dxf - file'
dxf_files = sorted(glob.glob(os.path.join(sample_dir, '*.dxf')))

for fpath in dxf_files[:3]:
    fname = os.path.basename(fpath)
    doc = ezdxf.readfile(fpath)
    msp = doc.modelspace()
    
    poly = load_polygon_from_dxf(fpath)
    print(f"=== {fname} Outer Boundary Analysis ===")
    coords = list(poly.exterior.coords)
    print(f"  Total outer boundary vertices: {len(coords)}")
    
    # Check line segment lengths along outer boundary
    short_segments = []
    for i in range(len(coords) - 1):
        p1, p2 = coords[i], coords[i+1]
        dist = ((p2[0]-p1[0])**2 + (p2[1]-p1[1])**2)**0.5
        if 0.5 <= dist <= 15.0: # Typical bend allowance transition length range!
            short_segments.append((round(dist, 3), (round(p1[0],2), round(p1[1],2)), (round(p2[0],2), round(p2[1],2))))
            
    print(f"  Bend zone transition edge segments (yellow lines in user drawing): {len(short_segments)}")
    for seg in short_segments[:5]:
        print(f"    - Length: {seg[0]} mm | From {seg[1]} to {seg[2]}")
    print()
