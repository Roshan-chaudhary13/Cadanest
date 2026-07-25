import os, glob, sys
import json

_here = os.path.dirname(os.path.abspath(__file__))
if _here not in sys.path:
    sys.path.insert(0, _here)

from nester import load_polygon_from_dxf

sample_dir = r'C:\Users\rosha\Desktop\Cadanest\sample\Upravljacka jedinica\Razvijene povrsine pozicija dxf - file'
dxf_files = sorted(glob.glob(os.path.join(sample_dir, '*.dxf')))

print(f"Testing end-to-end DXF polygon loading for {len(dxf_files)} files in nester.py...\n")

loaded_parts = []
for fpath in dxf_files:
    fname = os.path.basename(fpath)
    try:
        poly = load_polygon_from_dxf(fpath)
        bounds = poly.bounds
        w = round(bounds[2] - bounds[0], 3)
        h = round(bounds[3] - bounds[1], 3)
        area = round(poly.area, 2)
        loaded_parts.append({"name": fname, "width": w, "height": h, "area": area})
        print(f"  [LOADED] {fname:55s} | BBox: {w:8.3f} x {h:8.3f} mm | Area: {area:10.2f} mm²")
    except Exception as err:
        print(f"  [ERROR] {fname} -> {err}")

print(f"\nSuccessfully processed {len(loaded_parts)} / {len(dxf_files)} sample DXFs.")
