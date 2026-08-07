# CADANEST — Implementation Roadmap & Phase Matrix

This document details the development roadmap, phase progression, and feature completion matrix of the CADANEST application.

---

## Progress Matrix

| Phase | Description | Key Deliverables | Status |
| :--- | :--- | :--- | :--- |
| **Phase 1** | Foundation & IPC Daemon Architecture | Electron wrapper, React UI, Python stdio IPC Daemon bridge, STEP B-Rep parser | **COMPLETED** |
| **Phase 2** | 3D Visualization & Geometry Analysis | Three.js WebGL 3D viewer, alloy PBR materials, planar face raycasting, thickness detection | **COMPLETED** |
| **Phase 3** | Analytical B-Rep Unfolding Engine | Recursive BFS unfolding, K-factor math, tangent-constrained thickness partnering, Solid Edge benchmark suite | **COMPLETED** |
| **Phase 4** | 2D Irregular Shape Nesting Solver | Bottom-Left packing solver, `STRtree` spatial indexing, multi-sheet generation, layer-preserving DXF export | **COMPLETED** |
| **Phase 5** | Production UI/UX & Refinement | Bend line customization (TICKS & DOTTED-DASH), confirmation-gated unfolding, dynamic sheet filter sync, 3D sub-mesh alignment | **COMPLETED** |
| **Phase 6** | Material Presets, Calibration & CAD Assembly Engine | 3-Tier material presets, adaptive $R/T$ engine, closed-form linear back-solver modal, native CAD assembly parsing | **COMPLETED** |

---

## Phase Milestones & Completed Deliverables

### Phase 1: Core Desktop Infrastructure & IPC (COMPLETED)
- [x] Electron application boilerplate with TypeScript support and frameless industrial window controls.
- [x] Persistent Python Stdio IPC Daemon (`backend/daemon.py`) running within FreeCAD 1.1 Python 3.11 environment.
- [x] Line-delimited JSON-RPC stdio protocol supporting `analyze`, `unfold`, `nest`, `calibrateKFactor`, and `reload` command payloads.

### Phase 2: 3D Visualization & Geometry Analysis (COMPLETED)
- [x] Three.js WebGL canvas (`Model3DViewer.tsx`) with OrbitControls, lighting, grid helper, and view orientation gizmo.
- [x] Automatic B-Rep planar face extraction (`extract_faces`, `classify_face`).
- [x] Automatic thickness detection and planar base face auto-discovery (`auto_discover_base_faces`).
- [x] Interactive face raycasting for manual base face selection from 3D view clicking.
- [x] Alloy PBR material rendering (Steel, Stainless, Aluminum, Copper, Brass).

### Phase 3: Analytical B-Rep Unfolding & Verification (COMPLETED)
- [x] OpenCASCADE recursive face tree unrolling (`unfolder.py`) with Neutral Axis K-Factor calculation.
- [x] Tangent-constrained 2D in-plane thickness partner matching to prevent dropping complex side flanges.
- [x] Siemens Solid Edge benchmark verification suite (`Testing/compare_models_with_solid_edge.py`) achieving 100% PASS rate (0.00mm dimension and hole count match across 19 benchmark parts).
- [x] Single-contour outer boundary dissolution using Shapely `unary_union`.

### Phase 4: 2D Irregular Shape Nesting & Layered DXF Export (COMPLETED)
- [x] Bottom-Left 2D irregular packing solver (`nester.py`) using Shapely `STRtree` bounding box spatial R-Tree indexing.
- [x] Support for Auto-Fill Sheet mode and Fixed Sets / Quantities.
- [x] Clearance spacing, border margins, and rotation grain options (Free 0/90/180/270°, 180° steps, No rotation).
- [x] Multi-sheet layout generation (`Sheet 1`, `Sheet 2`, `Sheet 3`...) for capacity overflow.
- [x] Export formats: DXF vector drawing with separated `CUT` and `BEND_LINES` layers, shop floor PDF report, and NC G-Code toolpath.

### Phase 5: Production Refinement & Customization (COMPLETED)
- [x] **Bend Line Style Customization**: TICKS mode (etch mark indicators at bend endpoints) and DOTTED-DASH mode (AutoCAD `CENTER2` linetype).
- [x] **Confirmation-Gated Execution**: Changing parameters or bend styles updates state without auto-running unfolding until explicit user confirmation (**FLATTEN / UNFOLD MODEL**).
- [x] **Dynamic Sheet Filter**: Sheet filter tab bar dynamically syncs with active sheet selection.
- [x] **3D Face Overlay Alignment**: Fixed sub-mesh geometry centering in `Model3DViewer.tsx` by storing `geometry.userData.center` and hiding non-active sub-meshes.
- [x] **Clean Industrial UI**: Relocated K-Factor and Mirror settings to Advanced Settings modal, Theme selection to View menu dropdown, and added high-contrast backdrop blur to canvas controls.

### Phase 6: Material Presets, Calibration & Native Assembly Engine (COMPLETED)
- [x] **3-Tier Material & $K$-Factor Resolution**: Material presets catalog (`Mild Steel` $0.44$, `Stainless` $0.45$, `Aluminum` $0.40$, `Galvanized` $0.42$, `Copper` $0.38$, `Brass` $0.40$), Adaptive $R/T$ ratio mode ($K = 0.33$ for $R < 2.0T$), and custom manual $K$-factor override.
- [x] **Precision $K$-Factor Calibration Solver**: Closed-form linear back-solver modal calculating exact $K$-factor with $10^{-4}$ precision from measured reference flat dimensions ($L_{\text{target}}$). Automatically handles neutral straight sums vs outside leg length sums.
- [x] **Native Solid Edge & CAD Assembly Parsing**: `extract_ole_metadata` and `resolve_assembly_psm_children` parsing assembly trees (`Konstrukcija.asm`) to discover all 24 sheet metal `.psm` parts while filtering non-sheet-metal hardware accessories (`.par`).
- [x] **Fusion 360 & Solid Edge Parity Verification**: Achieved **100% exact numerical match ($0.000\text{ mm}$ error margin)** across Fusion 360 reference files (`Part19.STEP`, `Electrical Cabinet.STEP`) and Solid Edge assemblies.

---

## Post-Phase 6 Expansion Opportunities

1. **Minkowski Sum No-Fit Polygon (NFP) Collision Engine**:
   - Implement exact NFP geometry calculation for ultra-tight irregular shape nesting and hole-in-hole part nesting.
2. **Zustand Modular State Refactoring**:
   - Modularize monolithic state in `App.tsx` into specialized Zustand stores (`usePartStore`, `useNestingStore`, `useUIStore`).
