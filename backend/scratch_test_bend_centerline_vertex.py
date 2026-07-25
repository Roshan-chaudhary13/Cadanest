import numpy as np
import shapely.geometry as sg
from shapely.geometry import LineString, Point

def snap_vertex_to_centerline(poly: sg.Polygon, bend_lines: list) -> sg.Polygon:
    if not isinstance(poly, sg.Polygon) or not poly.is_valid or not bend_lines:
        return poly

    coords = list(poly.exterior.coords)
    n = len(coords) - 1
    if n < 3:
        return poly

    centerlines = []
    for b in bend_lines:
        p1 = (b["start"][0], b["start"][1])
        p2 = (b["end"][0], b["end"][1])
        centerlines.append(LineString([p1, p2]))

    new_coords = list(coords)

    for i in range(n):
        prev_p = np.array(coords[(i - 1) % n][:2])
        curr_p = np.array(coords[i][:2])
        next_p = np.array(coords[(i + 1) % n][:2])

        v1 = curr_p - prev_p
        v2 = next_p - curr_p
        
        len1 = np.linalg.norm(v1)
        len2 = np.linalg.norm(v2)
        if len1 < 1e-6 or len2 < 1e-6:
            continue

        u1 = v1 / len1
        u2 = v2 / len2
        dot = np.clip(np.dot(u1, u2), -1.0, 1.0)
        angle_deg = np.degrees(np.arccos(dot))

        # If vertex forms an angle (> 3 deg)
        if angle_deg > 3.0:
            pt_curr = Point(curr_p)
            for cl in centerlines:
                dist = pt_curr.distance(cl)
                # If vertex is within bend zone (<= 10mm from centerline)
                if dist <= 10.0:
                    # Ray 1: from prev_p through curr_p
                    # Ray 2: from next_p through curr_p
                    # Intersect Ray 1 with Bend Centerline line
                    r1_start = prev_p
                    r1_end = prev_p + u1 * 200.0
                    ray1 = LineString([r1_start, r1_end])
                    
                    inter = ray1.intersection(cl)
                    if isinstance(inter, Point):
                        new_coords[i] = (inter.x, inter.y)
                        break

    new_coords[-1] = new_coords[0]
    try:
        cleaned = sg.Polygon(new_coords, poly.interiors)
        return cleaned if cleaned.is_valid else poly
    except Exception:
        return poly

# Test on a dummy polygon with bend centerline
poly = sg.Polygon([(0,0), (0,100), (42, 150), (100, 160), (100,0), (0,0)])
bend_lines = [{"start": (40, 0), "end": (40, 200)}]

snapped = snap_vertex_to_centerline(poly, bend_lines)
print("Original vertex near bend:", poly.exterior.coords[2])
print("Snapped vertex on Bend Centerline:", snapped.exterior.coords[2])
