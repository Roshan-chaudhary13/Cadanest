# CADANEST — Comprehensive System Documentation & User Guide

CADANEST is a high-precision desktop CAD/CAM application for 3D B-Rep sheet metal unfolding, adaptive $K$-factor bend calculation, 2D irregular shape nesting, and production drawing export.

---

## Table of Contents
1. [System Overview & Architecture](#1-system-overview--architecture)
2. [Core Capabilities & Features](#2-core-capabilities--features)
   - [3D CAD Model Import & B-Rep Analysis](#3d-cad-model-import--b-rep-analysis)
   - [3-Tier Material & K-Factor Engine](#3-tier-material--k-factor-engine)
   - [Precision K-Factor Calibration Solver](#precision-k-factor-calibration-solver)
   - [Analytical B-Rep Unfolding Engine](#analytical-b-rep-unfolding-engine)
   - [Bend Line Style Customization & DXF Layer Management](#bend-line-style-customization--dxf-layer-management)
   - [2D Irregular Shape Nesting Solver](#2d-irregular-shape-nesting-solver)
   - [Multi-Format Manufacturing Exports](#multi-format-manufacturing-exports)
3. [User Interface & Navigation Guide](#3-user-interface--navigation-guide)
4. [Solid Edge & Fusion 360 Verification Benchmarks](#4-solid-edge--fusion-360-verification-benchmarks)
5. [Documentation Structure](#5-documentation-structure)

---

## 1. System Overview & Architecture

CADANEST uses a hybrid architecture combining an Electron desktop wrapper, a React 18 / TypeScript frontend renderer, and a persistent Python 3.11 stdio IPC daemon executing in an OpenCASCADE / FreeCAD CAD environment.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                             ELECTRON FRONTEND                            │
│                                                                          │
│  ┌───────────────────────┐                  ┌─────────────────────────┐  │
│  │   React 18 Dashboard  │                  │   Preload Context Bridge│  │
│  │  (App.tsx / Tailwind) │ ◄──────────────► │    (window.electronAPI) │  │
│  └───────────┬───────────┘                  └────────────┬────────────┘  │
│              │                                           │               │
│              ▼                                           ▼               │
│  ┌───────────────────────┐                  ┌─────────────────────────┐  │
│  │   Three.js 3D Canvas  │                  │  Electron Main Process  │  │
│  │  (Model3DViewer.tsx)  │                  │   (src-electron/main.ts)│  │
│  └───────────────────────┘                  └────────────┬────────────┘  │
└──────────────────────────────────────────────────────────┼───────────────┘
                                                           │ (stdio JSON-RPC)
┌──────────────────────────────────────────────────────────▼───────────────┐
│                      PERSISTENT PYTHON IPC DAEMON                        │
│                         (backend/daemon.py)                              │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                     OpenCASCADE 7.7.x (pythonOCC)                    │  │
│  │  • StepLoader: Parses B-Rep STEP solid geometry & topology         │  │
│  │  • FaceGraph: Classifies planar/cylindrical faces & thickness pairs│  │
│  │  • Unfolder: Recursive BFS flattening & Neutral Axis K-factor math │  │
│  │  • DxfExport: Dissolves internal seams & exports DXF cut/bends    │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                     Shapely + EzDXF Nesting Solver                 │  │
│  │  • Nester (nester.py): Bottom-Left placement with STRtree indexing │  │
│  │  • Multi-sheet generation & layer inheritance                      │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Capabilities & Features

### 3D CAD Model Import & B-Rep Analysis
- **Direct Multi-Format Import**: STEP (`.step`, `.stp`), Siemens Solid Edge (`.psm`, `.asm`), SolidWorks (`.sldprt`, `.sldasm`), IGES, and DXF.
- **Topology Extraction**: Analyzes B-Rep face geometry to automatically determine sheet thickness ($T$), volume, planar flange count, cylindrical bend count, and inner bend radii ($R$).
- **Interactive WebGL Visualizer**: Three.js WebGL viewer with OrbitControls, PBR material rendering per alloy (Steel, Stainless, Aluminum, Copper, Brass), planar face raycasting selection, snap views (Top, Front, Right, ISO), wireframe toggle, and exact sub-mesh overlay alignment (`0.00 mm` offset).

### 3-Tier Material & K-Factor Engine
- **Catalog Presets**: Built-in lookup table (`Mild Steel` $0.44$, `Stainless Steel` $0.45$, `Aluminum` $0.40$, `Galvanized` $0.42$, `Copper` $0.38$, `Brass` $0.40$).
- **Adaptive $R/T$ Heuristic**: Auto-selects $K = 0.33$ for tight bends ($R < 2.0 T$) and $K = 0.50$ for larger bend radii.
- **Manual Override**: Custom user-defined $K$-factor (`0.10` - `0.90`).

### Precision K-Factor Calibration Solver
- **Closed-Form Linear Back-Solver**: Calculates exact $K$-factor with $10^{-4}$ (4 decimal places) precision given a measured target flat blank length ($L_{\text{target}}$):
  $$K = \frac{L_{\text{target}} - \sum L_{\text{straight}} - \frac{\pi}{180} \sum \theta_i R_i}{\frac{\pi T}{180} \sum \theta_i}$$
- **Leg-Sum Auto-Conversion**: Detects whether the entered sum is neutral straight or outside leg length sum ($\sum L_{\text{leg}}$) and deducts outside setback sum ($\sum 2(R_i+T)\tan(\theta_i/2)$) automatically.

### Analytical B-Rep Unfolding Engine
- **OpenCASCADE BFS Flattening**: Traverses the topological face adjacency graph starting from the selected root base face.
- **Tangent-Constrained Partnering**: Uses 2D in-plane tangential distance bounds to pair front/back thickness surfaces without dropping complex side or angled flanges.
- **Mirror Flat Pattern**: Toggles top vs bottom face orientation.

### Bend Line Style Customization & DXF Layer Management
- **TICKS Mode (Etch Tick Markers)**: Customizable etch mark generator (`generate_bend_ticks`):
  - **Interior Centered (Default)**: Generates 1-2 interior etch tick markers away from outer boundary corners (1 marker for bend lines $< 80\text{ mm}$, 2 markers centered at $30\%$ and $70\%$ for bend lines $\ge 80\text{ mm}$).
  - **Boundary Ends (Classic)**: Generates 2 tick mark segments starting at outer boundary endpoints ($0\%$ and $100\%$) extending inward along the bend line axis.
  - **Customizable Length**: Segment length in millimeters ($1.0\text{ mm}$ to $15.0\text{ mm}$, default $4.5\text{ mm}$) adjustable in UI and backend exports.
- **DOTTED-DASH Mode**: AutoCAD `CENTER2` linetype definition `[1.0, 0.5, -0.125, 0.125, -0.125]` with `$LTSCALE = 1.0` header variable and `stroke-dasharray="12,3,2,3"` canvas rendering.
- **Confirmation-Gated Execution**: Selecting options updates `bendStyle` state without auto-running unfolding until user confirmation (**FLATTEN / UNFOLD MODEL**).

### High-Performance 2D Irregular Shape Nesting Solver
- **Bottom-Left-Fill (BLF) Gravity Squeezer**: Packing solver (`nester.py`) with BLF gravity sliding (`_squeeze_blf`), candidate step refinement ($1.0\text{ mm}$ - $2.5\text{ mm}$), and Spatial R-Tree (`STRtree`) indexing for high packing density.
- **Multi-Core & Warm Daemon Architecture**: Persistent Python IPC daemon warm-loads modules at boot with `os.cpu_count()` worker thread pools, eliminating reloads and delivering industry-standard response speed.
- **Multi-Sheet Generation**: Generates `Sheet 1`, `Sheet 2`, `Sheet 3`... when total requested part count exceeds a single sheet.
- **Capacity Overflow Action**:
  - `+ SHEET COUNT`: Automatically packs parts across multiple standard-sized sheet stock.
  - `+ SHEET SIZE`: Expands sheet stock dimensions to recommended larger sizes (`3000 x 1500` or `4000 x 2000` mm) and re-runs the solver.
- **Dynamic Sheet Filter Sync**: Sheet filter tab bar dynamically syncs with the active sheet's material and thickness category.

### Multi-Format Manufacturing Exports
- **DXF Vector Drawing**: Separated layers for laser cutting (`CUT` layer) and press brake bending (`UP_CENTERLINES` / `DOWN_CENTERLINES` layers).
- **Shop Floor PDF Report**: Visual PDF report containing sheet utilization %, stock summary, part count tables, and scaled graphics.
- **CNC NC G-Code**: Production CNC toolpath G-Code output.

---

## 3. User Interface & Navigation Guide

### Menu Bar
- **Settings**: Advanced Settings... (Neutral Axis K-Factor slider & Mirror Flat DXF toggle).
- **Edit**: Unfold All Flat Blanks, Undo Model Flattening, Reset Parameter Defaults.
- **View**: Themes (Dark & Light Theme), 3D Source Viewport, Unfolded Flat Preview, Irregular Nesting Layout.
- **File**: Import STEP / DXF Files..., Export DXF Blank Profile, Clear Workspace.
- **Help**: Documentation & Guide, Keyboard Shortcuts Cheat Sheet, About CADANEST.
- **Customize Layout**: Show/Hide Left Sidebar, Reset Sidebar Width (320px), Toggle Full Screen Visualizer (`Alt+F`), Operator Terminal Logs.

### Main Canvas Controls
- Backdrop-blurred high-contrast toolbar on top-right: `Zoom +`, `Zoom -`, `Rotate`, `FIT`, `Expand ⤢`.

---

## 4. Solid Edge & Fusion 360 Verification Benchmarks

| Benchmark Dataset | Models Evaluated | Dimensional Error | Hole Accuracy | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Siemens Solid Edge** | 19 Models (`Bok 1-6`, `Lice 1-6`, `Pod 1`, `Unutrasnjost 1-3`) | **0.00 mm** | **100% Match** | **PASS** |
| **Autodesk Fusion 360** | `Part19.STEP`, `Electrical Cabinet.STEP` | **0.000 mm** | **100% Match** | **PASS** |

---

## 5. Documentation Structure

- 🚀 **[getting_started.md](getting_started.md)** — Installation, dependencies, local server, and production packaging.
- 🏗️ **[architecture.md](architecture.md)** — System architecture, electron main process, and IPC JSON-RPC protocol.
- 📐 **[unfolding_engine.md](unfolding_engine.md)** — OpenCASCADE B-Rep unrolling, bend math, and $K$-factor calibration back-solver.
- 🧩 **[nesting_solver.md](nesting_solver.md)** — Spatial R-Tree 2D packing, candidate grid coarsening, and multi-sheet solver.
- 🐍 **[backend.md](backend.md)** — Python stdio IPC daemon, CAD bridges, and PDF report generator.
- ⚛️ **[frontend.md](frontend.md)** — React 18 dashboard, Zustand store, Three.js 3D WebGL renderer, and 2D canvas previewer.
- 🗺️ **[phases_roadmap.md](phases_roadmap.md)** — Roadmap phase matrix (Phases 1-6 completed).
- 📜 **[context_log.md](context_log.md)** — Development history, codebase context, and refactoring log.
- 🎨 **[design_system.md](design_system.md)** — Color palette, design tokens, and UI layout specifications.
- 📜 **[rules.md](rules.md)** — AI development standards and engineering rules.
- 📋 **[prd.md](prd.md)** — Technical product requirements document.
