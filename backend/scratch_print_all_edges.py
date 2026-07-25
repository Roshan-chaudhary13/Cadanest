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

for fpath in dxf_files:
    fname = os.path.basename(fpath)
    poly = load_polygon_from_dxf(fpath)
    coords = list(poly.exterior.coords)
    print(f"=== {fname} ({len(coords)} vertices) ===")
    for i in range(len(coords) - 1):
        p1, p2 = coords[i], coords[i+1]
        dist = ((p2[0]-p1[0])**2 + (p2[1]-p1[1])**2)**0.5
        print(f"  Edge {i+1:2d}: len={dist:8.3f} mm | ({p1[0]:8.2f}, {p1[1]:8.2f}) -> ({p2[0]:8.2f}, {p2[1]:8.2f})")
    print("-" * 60)
