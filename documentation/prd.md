# CADANEST — Product Requirements Document (PRD)

## 1. Product Scope
CADANEST is a desktop CAD/CAM software designed for 3D B-Rep sheet metal unfolding, bend calculation, irregular 2D shape nesting, and production drawing export.

## 2. Core Functional Requirements

### FR-1: 3D CAD File Support
- Support STEP (`.step`, `.stp`), native Siemens Solid Edge (`.psm`, `.asm`), SolidWorks (`.sldprt`, `.sldasm`), IGES, and DXF files.

### FR-2: Analytical Unfolding & $K$-Factor Engine
- Perform OpenCASCADE 7.7.x B-Rep analytical face unrolling.
- Support 3-tier $K$-factor resolution: catalog presets, adaptive $R/T$ heuristic ($K=0.33$ for $R<2.0T$), and manual override.
- Provide interactive $K$-factor calibration solver with $10^{-4}$ precision.

### FR-3: Bend Styling & Layer Management
- Support TICKS mode (4.5mm etch mark indicators at bend endpoints) and DOTTED-DASH mode (AutoCAD `CENTER2` linetype).
- Export production DXF files with separated `CUT` and `UP_CENTERLINES` / `DOWN_CENTERLINES` layers.

### FR-4: 2D Irregular Nesting Solver
- Implement Bottom-Left packing with `STRtree` spatial indexing and dynamic candidate grid coarsening.
- Generate multi-sheet stock layouts (`Sheet 1`, `Sheet 2`...) when part counts exceed single sheet capacity.
- Export DXF layout, PDF shop floor report, and NC G-Code.

### FR-5: Automated Verification Benchmark Suite
- Maintain 100% pass rate across 19 Siemens Solid Edge benchmark models and Autodesk Fusion 360 models with **0.00 mm** dimensional error.
