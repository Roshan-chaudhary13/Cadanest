import numpy as np
import shapely.geometry as sg
from shapely.geometry import LineString, Point

def replace_bend_contour_with_centerline_vertex(poly: sg.Polygon, bend_lines: list) -> sg.Polygon:
    if not isinstance(poly, sg.Polygon) or not poly.is_valid or not bend_lines:
        return poly

    coords = list(poly.exterior.coords)
    n = len(coords) - 1
    if n < 4:
        return poly

    centerlines = []
    for b in bend_lines:
        p1 = np.array([b["start"][0], b["start"][1]])
        p2 = np.array([b["end"][0], b["end"][1]])
        centerlines.append((p1, p2, LineString([p1, p2])))

    to_remove = set()
    snapped_vertices = {}

    for b_idx, (cp1, cp2, cl_geom) in enumerate(centerlines):
        near_indices = []
        for i in range(n):
            pt = Point(coords[i][:2])
            if pt.distance(cl_geom) <= 12.0:
                near_indices.append(i)

        if not near_indices:
            continue

        near_indices.sort()
        clusters = []
        curr_cl = [near_indices[0]]
        for idx in near_indices[1:]:
            if idx == curr_cl[-1] + 1:
                curr_cl.append(idx)
            else:
                clusters.append(curr_cl)
                curr_cl = [idx]
        clusters.append(curr_cl)

        for clus in clusters:
            first_idx = clus[0]
            last_idx = clus[-1]

            # Inbound edge ray leading into bend zone: (first_idx - 1) -> first_idx
            p_in_start = np.array(coords[(first_idx - 1) % n][:2])
            p_in_end   = np.array(coords[first_idx][:2])
            v_in = p_in_end - p_in_start
            len_in = np.linalg.norm(v_in)

            # Outbound edge ray leaving bend zone: last_idx -> (last_idx + 1)
            p_out_start = np.array(coords[last_idx][:2])
            p_out_end   = np.array(coords[(last_idx + 1) % n][:2])
            v_out = p_out_end - p_out_start
            len_out = np.linalg.norm(v_out)

            if len_in > 1e-6 and len_out > 1e-6:
                u_in = v_in / len_in
                u_out = v_out / len_out

                line1 = LineString([p_in_start, p_in_start + u_in * 400.0])
                line2 = LineString([p_out_end, p_out_end - u_out * 400.0])

                inter = line1.intersection(cl_geom)
                if not isinstance(inter, Point):
                    inter = line1.intersection(line2)

                if isinstance(inter, Point):
                    vertex_pt = (inter.x, inter.y)
                    for idx in clus:
                        to_remove.add(idx)
                    snapped_vertices[first_idx] = vertex_pt

    final_coords = []
    i = 0
    while i < n:
        if i in snapped_vertices:
            final_coords.append(snapped_vertices[i])
        elif i not in to_remove:
            final_coords.append(coords[i])
        i += 1

    final_coords.append(final_coords[0])
    try:
        cleaned = sg.Polygon(final_coords, poly.interiors)
        return cleaned if cleaned.is_valid else poly
    except Exception:
        return poly

# Test polygon with bend zone kinked vertices
poly = sg.Polygon([
    (0, 0),
    (0, 100),
    (38, 148), # Upper white tangent vertex (WRONG)
    (42, 152), # Right white tangent vertex (WRONG)
    (100, 170),
    (100, 0),
    (0, 0)
])
bend_lines = [{"start": (40, 0), "end": (40, 200)}]

cleaned = replace_bend_contour_with_centerline_vertex(poly, bend_lines)

print("Original polygon exterior coords:")
for c in poly.exterior.coords:
    print(f"  ({c[0]:.2f}, {c[1]:.2f})")

print("\nCleaned polygon exterior coords (Single angle vertex EXACTLY on Bend Centerline x=40):")
for c in cleaned.exterior.coords:
    print(f"  ({c[0]:.2f}, {c[1]:.2f})")
