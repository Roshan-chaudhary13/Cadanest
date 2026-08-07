# CAD Engine Parity Switcher & Geometry Unrolling Logic

This document defines the mathematical patterns, unrolling logic, and parity switching details used in CADANEST to match native outputs of industrial CAD software (Solid Edge, Fusion 360, SolidWorks, etc.) down to $0.000000\text{ mm}$ of precision.

---

## 📐 1. The Core Mathematics of K-Factor Parity

When unrolling sheet metal, different CAD suites use different default neutral axis offsets ($K$-factors) for tight bends ($R \le 2T$). These choices affect the unrolled length ($L_{flat}$) of the part:

$$BA = \theta \times (R + K \times T)$$

Where:
- $BA$ = Bend Allowance (unrolled flat length of the bend zone)
- $\theta$ = Bend angle in radians (e.g., $\pi/2$ for a $90^\circ$ bend)
- $R$ = Inside Bend Radius
- $T$ = Sheet Metal Thickness
- $K$ = $K$-Factor (neutral axis offset factor)

### 📌 CAD Engine Presets
1. **Siemens Solid Edge Parity (R <= 2T)**:
   - **$K = 0.330000$**
   - Solid Edge defaults to $0.33$ for tight bends. Select this mode to achieve $0.000\text{ mm}$ error margin with native Solid Edge `.psm` sheet flat patterns.
2. **Autodesk Fusion 360 / Inventor**:
   - **$K = 0.440000$**
   - Autodesk Standard air bend neutral factor. Select this to match Fusion 360 flat pattern DXF outputs.
3. **SolidWorks Default Air Bend**:
   - **$K = 0.500000$**
   - SolidWorks default air bend factor.

---

## ⚡ 2. Dynamic Geometry Unrolling

In the flat layout, cutout features (such as slots or holes) that span across bends must stretch dynamically according to the active $K$-factor.

### 🛑 Avoid Hardcoding Coordinates
Never introduce absolute coordinates or part-specific regression coefficients (like hardcoded offset dimensions) to "fix" cutout shapes. Instead:
- Always calculate unrolled feature dimensions relative to the unrolled bend centerline and the active $K$-factor.
- Dynamically detect stepped slots by scanning for distinct $X$ and $Y$ coordinates at runtime. Reconstruct them with their three-section step profile (bottom, middle, and unrolled top bend zone portion) and sharp vertical steps.
- Ensure simple unstepped rectangular slot cutouts fall back to clean uniform height stretching without degenerate geometry side-effects.

---

## 🧹 3. Generic Tessellation-Seam Cleanup

During unrolling, discretization of cylinder fillets can generate spurious extra vertices (seam artifacts).
- Do not use hardcoded edge length combinations (fingerprints) to remove them.
- Use generic geometric kink-removal algorithms like `_dissolve_isolated_small_kinks` which cleans up shallow kinks (e.g., turning angle $\le 15^\circ$) on short segments within a small area tolerance (e.g., $1.0\text{ mm}^2$).
