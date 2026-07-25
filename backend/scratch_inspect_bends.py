import os, glob
import ezdxf

sample_dir = r'C:\Users\rosha\Desktop\Cadanest\sample\Upravljacka jedinica\Razvijene povrsine pozicija dxf - file'
dxf_files = glob.glob(os.path.join(sample_dir, '*.dxf'))

for fpath in dxf_files[:3]:
    fname = os.path.basename(fpath)
    doc = ezdxf.readfile(fpath)
    msp = doc.modelspace()
    print(f"=== DETAILED ANALYSIS: {fname} ===")
    
    # Outer loop bounding box
    outer_lines = [e for e in msp if e.dxf.layer == 'OUTER_LOOP']
    print(f"Outer loop count: {len(outer_lines)}")
    min_x, min_y, max_x, max_y = float('inf'), float('inf'), float('-inf'), float('-inf')
    for e in outer_lines:
        if e.dxftype() == 'LINE':
            start, end = e.dxf.start, e.dxf.end
            min_x = min(min_x, start.x, end.x)
            max_x = max(max_x, start.x, end.x)
            min_y = min(min_y, start.y, end.y)
            max_y = max(max_y, start.y, end.y)
    print(f"  Outer Bounds: X=[{min_x:.3f}, {max_x:.3f}] (width={max_x-min_x:.3f}), Y=[{min_y:.3f}, {max_y:.3f}] (height={max_y-min_y:.3f})")
    
    for b_layer in ['UP_CENTERLINES', 'DOWN_CENTERLINES']:
        bend_lines = [e for e in msp if e.dxf.layer == b_layer]
        if bend_lines:
            print(f"  Bend layer '{b_layer}' count: {len(bend_lines)}")
            for b in bend_lines:
                if b.dxftype() == 'LINE':
                    print(f"    Line from ({b.dxf.start.x:.3f}, {b.dxf.start.y:.3f}) to ({b.dxf.end.x:.3f}, {b.dxf.end.y:.3f})")
