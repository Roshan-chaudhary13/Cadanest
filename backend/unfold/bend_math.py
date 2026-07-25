import math

# Default K-Factors by material
K_FACTORS = {
    "steel": 0.44,
    "mild_steel": 0.44,
    "stainless_steel": 0.45,
    "stainless": 0.45,
    "aluminum": 0.40,
    "default": 0.44
}

def get_k_factor(material: str = "steel") -> float:
    """Returns standard K-Factor for a given material."""
    if not material:
        return K_FACTORS["default"]
    key = material.lower().replace(" ", "_")
    return K_FACTORS.get(key, K_FACTORS["default"])

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
