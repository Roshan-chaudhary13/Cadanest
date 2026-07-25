import numpy as np
import shapely.geometry as sg

def simplify_bend_double_angles(poly: sg.Polygon, tolerance: float = 0.5) -> sg.Polygon:
    """
    Eliminates double-angle kink vertices at bend area tangent boundaries.
    Replaces 2-step kinked vertices across bend zones with a single clean continuous edge / single angle vertex.
    """
    if not isinstance(poly, sg.Polygon) or not poly.is_valid:
        return poly

    coords = list(poly.exterior.coords)
    if len(coords) < 4:
        return poly

    # Remove nearly-collinear or double-kinked vertices across short bend zone spans
    new_coords = [coords[0]]
    n = len(coords) - 1 # ignoring last duplicate closure point
    
    for i in range(1, n):
        prev_p = np.array(new_coords[-1][:2])
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
        
        # Check angle between adjacent edge segments
        dot = np.clip(np.dot(u1, u2), -1.0, 1.0)
        angle_deg = np.degrees(np.arccos(dot))
        
        # If angle between segments is very small (< 8 degrees) OR segment is a short bend-zone transition (< 3mm)
        # check distance of curr_p from straight chord line (prev_p -> next_p)
        chord_vec = next_p - prev_p
        chord_len = np.linalg.norm(chord_vec)
        
        if chord_len > 1e-6:
            chord_unit = chord_vec / chord_len
            perp_dist = abs(np.cross(chord_unit, curr_p - prev_p))
            
            if perp_dist <= tolerance and angle_deg < 15.0:
                # Skip double-angle intermediate vertex!
                continue
                
        new_coords.append(coords[i])
        
    new_coords.append(new_coords[0]) # close polygon
    
    try:
        cleaned_poly = sg.Polygon(new_coords, poly.interiors)
        return cleaned_poly if cleaned_poly.is_valid else poly
    except Exception:
        return poly

# Test on a double-kinked polygon
test_coords = [
    (0, 0),
    (0, 100),
    (40, 150),  # Top flange start
    (42, 152),  # Kink vertex 1 at bend tangent 1
    (44, 154),  # Kink vertex 2 at bend tangent 2
    (80, 180),  # Top flange end
    (100, 0),
    (0, 0)
]

orig_poly = sg.Polygon(test_coords)
simplified_poly = simplify_bend_double_angles(orig_poly, tolerance=1.0)

print(f"Original vertices: {len(orig_poly.exterior.coords)}")
print(f"Simplified vertices: {len(simplified_poly.exterior.coords)}")
print("Simplified exterior coords:")
for c in simplified_poly.exterior.coords:
    print(f"  ({c[0]:.2f}, {c[1]:.2f})")
