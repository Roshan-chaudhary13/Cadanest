import math
from typing import List, Optional, Union

# High-precision CAD system and manufacturing presets
CAD_PRESETS = {
    "solidworks_default": 0.500000,
    "inventor_default": 0.440000,
    "fusion360_default": 0.440000,
    "inventor_ansi": 0.446000,
    "solid_edge_tight": 0.330000,  # Exact Siemens Solid Edge neutral factor default for R <= 2T
    "solid_edge_std": 0.440000,
    "creo_y_050": 0.318310,  # Derived from Y = 0.50 -> K = 0.50 * (2/pi) = 0.318309886...
    "trumpf_air": 0.380000,
    "bystronic_air": 0.390000,
    "mild_steel": 0.440000,
    "stainless_304": 0.450000,
    "aluminum_5052": 0.400000,
    "copper": 0.380000,
    "brass": 0.400000,
    "galvanized": 0.420000,
}

K_FACTORS = {
    "default": 0.440000,
    "mild_steel": 0.440000,
    "stainless_steel": 0.450000,
    "stainless_304": 0.450000,
    "stainless": 0.450000,
    "aluminum_5052": 0.400000,
    "aluminum": 0.400000,
    "aluminium": 0.400000,
    "copper": 0.380000,
    "brass": 0.400000,
    "galvanized": 0.420000,
    "steel": 0.440000,
}

# Default sheet thickness (mm) used whenever thickness can't be estimated from geometry.
DEFAULT_THICKNESS_MM = 2.0

# Default etch/tick mark length (mm) for bend-line indicators in DXF/SVG export.
DEFAULT_ETCH_MARKER_LENGTH_MM = 4.5

# Default bend-line rendering style ("tick" = etch tick marks, "dashed"/"CENTER2" = centerline).
DEFAULT_BEND_STYLE = "tick"

# Default etch/tick marker placement relative to the bend line.
DEFAULT_ETCH_MARKER_POSITION = "interior"


def y_factor_to_k_factor(y: float) -> float:
    """Converts PTC Creo Y-Factor to K-Factor: K = Y * (2 / pi)"""
    return float(y) * (2.0 / math.pi)

def k_factor_to_y_factor(k: float) -> float:
    """Converts K-Factor to PTC Creo Y-Factor: Y = K * (pi / 2)"""
    return float(k) * (math.pi / 2.0)

def calculate_din_6935_kfactor(radius: float, thickness: float) -> float:
    """
    Calculates K-Factor according to European DIN 6935 standard curve:
    For R < 5T: K = 0.33 + 0.17 * log10(R / T)
    For R >= 5T: K = 0.50
    """
    if thickness <= 0 or radius <= 0:
        return 0.33
    ratio = radius / thickness
    if ratio >= 5.0:
        return 0.50
    k_val = 0.33 + 0.17 * math.log10(max(0.01, ratio))
    return max(0.33, min(0.50, k_val))

def get_k_factor(material: str = "steel") -> float:
    """Returns standard K-Factor for a given material."""
    if not material:
        return K_FACTORS["default"]
    key = material.lower().strip().replace(" ", "_").replace(",", "")
    if key in CAD_PRESETS:
        return CAD_PRESETS[key]
    if key in K_FACTORS:
        return K_FACTORS[key]
    for k, v in K_FACTORS.items():
        if k in key or key in k:
            return v
    return K_FACTORS["default"]

def get_k_factor_for_bend(radius: float, thickness: float) -> float:
    """
    Selects the neutral-axis K-factor from the bend's radius-to-thickness ratio.
    K=0.333333 for tight bends (inside radius < 2x thickness), K=0.50 for looser bends.
    """
    if thickness <= 0:
        return K_FACTORS["default"]
    return 0.333333 if radius < 2.0 * thickness else 0.500000

def get_effective_kfactor(
    mode: str = "material",
    material: str = "steel",
    radius: float = 1.0,
    thickness: float = 1.0,
    custom_k: Optional[float] = None,
    preset: Optional[str] = None,
    y_factor: Optional[float] = None
) -> float:
    """
    Returns effective K-factor according to selected mode:
    - 'preset': exact CAD system preset from CAD_PRESETS (e.g. 'solidworks_default', 'creo_y_050', 'din_6935')
    - 'y_factor': converts specified Y-Factor to K-Factor via K = Y * (2/pi)
    - 'din6935': DIN 6935 logarithmic formula based on R/T ratio
    - 'adaptive': uses bend R/T ratio heuristic (0.333333 vs 0.50)
    - 'manual': uses custom_k value (or material fallback if None)
    - 'material': uses material preset lookup table
    """
    m = (mode or "").lower().strip()
    if m == "preset" and preset and preset.lower() in CAD_PRESETS:
        return CAD_PRESETS[preset.lower()]
    elif m == "preset" and preset and preset.lower() == "din_6935":
        return calculate_din_6935_kfactor(radius, thickness)
    elif m == "y_factor" and y_factor is not None:
        return max(0.0, min(1.0, y_factor_to_k_factor(y_factor)))
    elif m in ("din6935", "din_6935"):
        return calculate_din_6935_kfactor(radius, thickness)
    elif m == "adaptive":
        return get_k_factor_for_bend(radius, thickness)
    elif m == "manual" and custom_k is not None:
        return max(0.0, min(1.0, float(custom_k)))
    else:
        return get_k_factor(material)

def calculate_bend_allowance(angle_deg: float, radius: float, thickness: float, k_factor: float = 0.44) -> float:
    """
    Calculates the Bend Allowance (BA) - developed length of the neutral axis across the bend arc.
    Formula: BA = (pi * angle_deg / 180) * (radius + K * thickness)
    """
    if radius < 0 or thickness < 0:
        raise ValueError("Radius and thickness must be non-negative.")
    if not (0 <= k_factor <= 1.0):
        raise ValueError("K-Factor must be between 0.0 and 1.0.")
        
    angle_rad = math.radians(abs(angle_deg))
    return angle_rad * (radius + k_factor * thickness)

def calculate_outside_setback(angle_deg: float, radius: float, thickness: float) -> float:
    """
    Calculates the Outside Setback (OSB) - distance from mold point to tangent point.
    Formula: OSB = (radius + thickness) * tan(angle_deg / 2)
    """
    angle_rad = math.radians(abs(angle_deg))
    return (radius + thickness) * math.tan(angle_rad / 2.0)

def calculate_bend_deduction(angle_deg: float, radius: float, thickness: float, k_factor: float = 0.44) -> float:
    """
    Calculates the Bend Deduction (BD) - amount deducted from outside flange leg lengths.
    Formula: BD = 2 * OSB - BA = 2 * (radius + thickness) * tan(angle_deg / 2) - BA
    """
    osb = calculate_outside_setback(angle_deg, radius, thickness)
    ba = calculate_bend_allowance(angle_deg, radius, thickness, k_factor)
    return 2.0 * osb - ba

def calculate_flat_length(outside_flange_1: float, outside_flange_2: float, angle_deg: float, radius: float, thickness: float, k_factor: float = 0.44) -> float:
    """
    Calculates total flat developed length for a bent flange.
    Formula: L_flat = L1 + L2 - BD
    """
    bd = calculate_bend_deduction(angle_deg, radius, thickness, k_factor)
    return outside_flange_1 + outside_flange_2 - bd

def calibrate_kfactor(
    target_flat_length: float,
    straight_flange_sum: float,
    bend_angles: List[float],
    bend_radii: List[float],
    thickness: float
) -> float:
    """
    Reverse-solves the exact effective K-factor required to match a known flat pattern dimension.
    
    Closed-form linear back-solver:
    BD_i = 2*(R_i + T)*tan(theta_i / 2) - (pi * theta_i / 180)*(R_i + K * T)
    L_target = Sum(L_leg) - Sum(BD_i)
    => K = [ L_target - Sum(L_leg) + Sum( 2*(R_i + T)*tan(theta_i / 2) - (pi * theta_i / 180)*R_i ) ] / [ (pi * T / 180) * Sum(theta_i) ]
    """
    if thickness <= 0:
        raise ValueError("Thickness must be greater than zero.")
    if not bend_angles or len(bend_angles) != len(bend_radii):
        raise ValueError("bend_angles and bend_radii must be non-empty lists of equal length.")

    denom_sum = 0.0
    radii_sum = 0.0
    osb_sum = 0.0

    for angle_deg, radius in zip(bend_angles, bend_radii):
        angle_rad = math.radians(abs(angle_deg))
        denom_sum += angle_rad * thickness
        radii_sum += angle_rad * abs(radius)
        osb_sum += 2.0 * (abs(radius) + thickness) * math.tan(angle_rad / 2.0)

    if abs(denom_sum) < 1e-9:
        return 0.44

    # If straight_flange_sum is larger than target_flat_length, it represents the sum of outside leg lengths.
    # Convert outside leg length sum to flat neutral straight length by deducting OSB sum.
    effective_straight = straight_flange_sum
    if straight_flange_sum > target_flat_length:
        effective_straight = max(0.0, straight_flange_sum - osb_sum)

    delta_target = target_flat_length - effective_straight
    k_solved = (delta_target - radii_sum) / denom_sum
    
    # Clamp K-factor to physically realistic sheet metal bounds [0.0, 1.0]
    return round(max(0.0, min(1.0, k_solved)), 4)


