# CADANEST — Industrial 3D Sheet Metal CAD/CAM Unfolding & 2D Irregular Nesting System

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/Roshan-chaudhary13/Cadanest)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)](https://microsoft.com/windows)
[![Accuracy](https://img.shields.io/badge/verification-100%25%20PASS%20(0.00mm)-brightgreen.svg)](documentation/unfolding_engine.md)

**CADANEST** is a high-precision desktop CAD/CAM software engineered for sheet metal design engineers, laser cutting operators, and metal fabrication facilities. It provides full 3D B-Rep CAD model visualization, exact analytical sheet metal unfolding, adaptive $K$-factor bend allowance calculations, interactive $K$-factor calibration, bend line style customization, 2D irregular shape nesting, and multi-format manufacturing exports (DXF, PDF, NC G-Code).

---

## 🌟 Key Features & Capabilities

### 1. 3D B-Rep CAD Import & Interactive Visualization
- **Multi-Format CAD Import**: STEP (`.step`, `.stp`), native Siemens Solid Edge (`.psm`, `.asm`), SolidWorks (`.sldprt`, `.sldasm`), IGES, and DXF.
- **B-Rep Geometry Parsing**: Automatic extraction of sheet thickness ($T$), volume, surface area, bounding dimensions, planar flanges, and cylindrical bend radii ($R$).
- **Interactive 3D WebGL Canvas**: Built with Three.js featuring OrbitControls, PBR material rendering per alloy (Steel, Stainless, Aluminum, Copper, Brass), planar face raycasting selection & highlighting, snap orientation views (Top, Front, Right, ISO), wireframe toggle, and sub-mesh face overlay alignment (`0.00 mm` offset).

### 2. Analytical B-Rep Unfolding & Adaptive $K$-Factor Engine
- **In-Memory pythonOCC Engine**: Exact OpenCASCADE 7.7.x B-Rep surface analysis and recursive BFS face unrolling running on a persistent warm Python stdio IPC daemon.
- **3-Tier Material & $K$-Factor Resolution**:
  - **Material Presets**: Built-in alloy catalog (`Mild Steel` $0.44$, `Stainless Steel 304/316` $0.45$, `Aluminum 1060/5052/6061` $0.40$, `Galvanized` $0.42$, `Copper` $0.38$, `Brass` $0.40$).
  - **Adaptive $R/T$ Heuristic**: Automatically selects $K = 0.33$ for tight radius bends ($R < 2.0 T$) and $K = 0.50$ for larger radius bends.
  - **Manual Override**: Precise user-specified $K$-factor input (`0.10` - `0.90`).
- **Precision $K$-Factor Calibration Solver**: Closed-form linear back-solver modal calculating exact $K$-factor with $10^{-4}$ (4 decimal places) precision from measured target reference flat length ($L_{\text{target}}$).
- **Tangent-Constrained Thickness Partnering**: In-plane tangential distance matching preventing distant parallel faces from misidentifying as thickness partners, preserving complex side and angled flanges.

### 3. Bend Line Style Customization & DXF Layer Management
- **TICKS Mode (Etch Tick Markers)**: Customizable etch mark generator (`generate_bend_ticks`) with configurable position strategies and lengths:
  - **Interior Centered (Default)**: 1 or 2 interior etch tick markers away from outer boundary corners (1 marker for bend lines $< 80\text{ mm}$, 2 markers centered at $30\%$ and $70\%$ for bend lines $\ge 80\text{ mm}$).
  - **Boundary Ends (Classic)**: 2 tick mark segments starting at outer boundary endpoints ($0\%$ and $100\%$) extending inward along the bend line axis.
  - **Configurable Length**: Custom tick segment length in millimeters ($1.0\text{ mm}$ to $15.0\text{ mm}$, default $4.5\text{ mm}$) adjustable in UI and backend exports.
- **DOTTED-DASH Mode**: AutoCAD `CENTER2` linetype definition `[1.0, 0.5, -0.125, 0.125, -0.125]` with `$LTSCALE = 1.0` header variables and `stroke-dasharray="12,3,2,3"` canvas visualization.
- **Confirmation-Gated Execution**: Style and etch settings update state without auto-triggering unfolding until explicit user confirmation (**FLATTEN / UNFOLD MODEL**).
- **Single-Contour Outer Profile**: Dissolves internal coplanar seams while preserving outer loop connectivity and interior cutouts via Shapely `unary_union`.

### 4. High-Performance 2D Irregular Shape Nesting Solver
- **Bottom-Left-Fill (BLF) Gravity Squeezer**: Optimized packing engine (`nester.py`) featuring BLF gravity sliding (`_squeeze_blf`), candidate coordinate step refinement ($1.0\text{ mm}$ - $2.5\text{ mm}$), and Shapely `STRtree` spatial bounding box indexing for high packing density.
- **Multi-Core & Warm Daemon Architecture**: Persistent Python IPC daemon warm-loads modules at application boot with `os.cpu_count()` worker pools, eliminating reloads and delivering industry-standard response speed.
- **Capacity Overflow Handling**:
  - `+ SHEET COUNT`: Packs parts across multiple standard-sized sheet stock (`Sheet 1`, `Sheet 2`, `Sheet 3`...).
  - `+ SHEET SIZE`: Automatically expands sheet stock dimensions to recommended larger standard sizes (`3000 x 1500` or `4000 x 2000` mm) and re-runs the solver.
- **Dynamic Sheet Filter Sync**: Sheet filter tab bar (`SHEET FILTER: [All Sheets] [Aluminum (1mm)]...`) dynamically syncs with active sheet selection.

### 5. Multi-Format Manufacturing Exports
- **DXF Vector Drawing**: Separated layers for laser cutting (`CUT` layer) and press brake bending (`UP_CENTERLINES` / `DOWN_CENTERLINES` layers).
- **Shop Floor PDF Report**: Visual PDF report containing sheet utilization %, sheet stock summary, part count tables, and scaled graphics.
- **CNC NC G-Code**: Production CNC toolpath G-Code output.

---

## 📊 Verification & Accuracy Benchmarks

CADANEST includes an automated verification suite ([compare_models_with_solid_edge.py](file:///c:/Users/gaash/Desktop/Cadanest/Cadanest/Testing/compare_models_with_solid_edge.py)) that evaluates CADANEST flat pattern outputs against reference DXFs from Siemens Solid Edge and Autodesk Fusion 360:

| Dataset | Benchmark Models | Dimensional Margin | Hole Count Match | Pass Rate |
| :--- | :--- | :--- | :--- | :--- |
| **Siemens Solid Edge Benchmark** | 19 Models (`Bok 1-6`, `Lice 1-6`, `Pod 1`, `Unutrasnjost 1-3`) | **0.00 mm** | **100% (Up to 615 holes)** | **100% PASS** |
| **Autodesk Fusion 360 Benchmark** | `Part19.STEP` ($231.048\text{ mm}$), `Electrical Cabinet.STEP` ($391.087\text{ mm}$) | **0.000 mm** | **100% Match** | **100% PASS** |

---

## 📂 Documentation Directory Index

All technical documentation and user guides are organized under the [`documentation/`](file:///c:/Users/gaash/Desktop/Cadanest/Cadanest/documentation) folder:

- 📖 **[Master Documentation & User Guide](file:///c:/Users/gaash/Desktop/Cadanest/Cadanest/documentation/README.md)**: Overview of user interface, menu options, and workflow steps.
- 🚀 **[Setup & Development Guide](file:///c:/Users/gaash/Desktop/Cadanest/Cadanest/documentation/getting_started.md)**: System requirements, FreeCAD/Python dependencies, local running, and production packaging.
- 🏗️ **[System Architecture & IPC Protocol](file:///c:/Users/gaash/Desktop/Cadanest/Cadanest/documentation/architecture.md)**: Hybrid Electron/Python stdio IPC architecture and JSON-RPC message specs.
- 📐 **[3D Unfolding Engine & Bend Math](file:///c:/Users/gaash/Desktop/Cadanest/Cadanest/documentation/unfolding_engine.md)**: OpenCASCADE topology traversal, thickness partnering, $K$-factor formulas, and closed-form back-solver.
- 🧩 **[2D Irregular Nesting Solver](file:///c:/Users/gaash/Desktop/Cadanest/Cadanest/documentation/nesting_solver.md)**: Spatial R-Tree indexing, dynamic candidate grid coarsening, multi-group balancing, and multi-sheet generation.
- 🐍 **[Backend Python Services](file:///c:/Users/gaash/Desktop/Cadanest/Cadanest/documentation/backend.md)**: Python daemon, CAD bridges (Solid Edge OLE/COM, STEP loader), and PDF report generator.
- ⚛️ **[Frontend Architecture](file:///c:/Users/gaash/Desktop/Cadanest/Cadanest/documentation/frontend.md)**: React 18 component structure, Zustand state management, Three.js 3D WebGL viewer, and SVG flat previewer.
- 🗺️ **[Development Roadmap & Milestones](file:///c:/Users/gaash/Desktop/Cadanest/Cadanest/documentation/phases_roadmap.md)**: Detailed phase completion matrix (Phases 1 through 6).
- 📜 **[Development Context & Refactoring Log](file:///c:/Users/gaash/Desktop/Cadanest/Cadanest/documentation/context_log.md)**: Historical codebase context, refactoring notes, and API reference.
- 🎨 **[UI Design System](file:///c:/Users/gaash/Desktop/Cadanest/Cadanest/documentation/design_system.md)**: Industrial color tokens, typography, and styling guidelines.

---

## ⚡ Quick Start

```powershell
# 1. Install Node.js dependencies
npm install

# 2. Run React development server (Vite)
npm run dev

# 3. Launch Electron desktop shell (in a separate terminal)
npm run electron
```

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
