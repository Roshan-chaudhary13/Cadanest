import os, glob
import ezdxf
import math
import numpy as np

sample_dir = r'C:\Users\rosha\Desktop\Cadanest\sample\Upravljacka jedinica\Razvijene povrsine pozicija dxf - file'
dxf_files = sorted(glob.glob(os.path.join(sample_dir, '*.dxf')))

print(f"Analyzing {len(dxf_files)} DXF files in detail...\n")

summary = []

for fpath in dxf_files:
    fname = os.path.basename(fpath)
    doc = ezdxf.readfile(fpath)
    msp = doc.modelspace()
    
    layers = set(e.dxf.layer for e in msp)
    
    outer_entities = [e for e in msp if e.dxf.layer == 'OUTER_LOOP']
    interior_entities = [e for e in msp if e.dxf.layer == 'INTERIOR_LOOPS']
    up_bends = [e for e in msp if e.dxf.layer == 'UP_CENTERLINES']
    down_bends = [e for e in msp if e.dxf.layer == 'DOWN_CENTERLINES']
    
    # Analyze bend line orientations and distances
    bends_info = []
    for b_list, dir_name in [(up_bends, 'UP'), (down_bends, 'DOWN')]:
        for e in b_list:
            if e.dxftype() == 'LINE':
                s, end = e.dxf.start, e.dxf.end
                length = math.hypot(end.x - s.x, end.y - s.y)
                angle_deg = math.degrees(math.atan2(end.y - s.y, end.x - s.x)) % 180
                bends_info.append({
                    'dir': dir_name,
                    'start': (round(s.x, 3), round(s.y, 3)),
                    'end': (round(end.x, 3), round(end.y, 3)),
                    'length': round(length, 3),
                    'angle': round(angle_deg, 1)
                })
                
    # Calculate outer bounding box
    xs, ys = [], []
    for e in outer_entities:
        if e.dxftype() == 'LINE':
            xs.extend([e.dxf.start.x, e.dxf.end.x])
            ys.extend([e.dxf.start.y, e.dxf.end.y])
            
    bbox_w = max(xs) - min(xs) if xs else 0
    bbox_h = max(ys) - min(ys) if ys else 0
    
    print(f"File: {fname}")
    print(f"  Layers present: {sorted(list(layers))}")
    print(f"  Outer loop lines: {len(outer_entities)}, Interior loop entities: {len(interior_entities)}")
    print(f"  Bends count: UP={len(up_bends)}, DOWN={len(down_bends)}, Total={len(bends_info)}")
    print(f"  Bounding Box: {bbox_w:.3f} x {bbox_h:.3f} mm")
    if bends_info:
        print("  Bend Lines details:")
        for b in bends_info:
            print(f"    - [{b['dir']}] ({b['start'][0]}, {b['start'][1]}) -> ({b['end'][0]}, {b['end'][1]}), len={b['length']}mm, angle={b['angle']}°")
    print("-" * 60)
