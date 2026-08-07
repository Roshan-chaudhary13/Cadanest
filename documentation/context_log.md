# CADANEST — Codebase Context & Development Log

This document provides a complete summary of the CADANEST codebase, directory hierarchy, component integration, and major features implemented across Phase 1 through Phase 6.

---

## Directory Structure

```text
c:\Users\gaash\Desktop\Cadanest\Cadanest\
├── src/                               # React 18 Frontend
│   ├── App.tsx                        # Dashboard, state orchestration, menu bar, and modals
│   ├── index.css                      # Industrial dark/light theme tokens and custom scrollbars
│   ├── store/
│   │   └── useCadanestStore.ts        # Zustand state store (PartItem, FlatElementItem, JobGroup)
│   └── components/
│       ├── FlatPreviewer.tsx          # 2D SVG flat pattern previewer with high-contrast controls
│       ├── Model3DViewer.tsx          # Three.js 3D WebGL B-Rep viewer with face raycasting & alignment
│       ├── JobGroupTab.tsx            # Material & thickness job grouping view
│       ├── BatchMaterialGrid.tsx      # Batch material & thickness configuration grid
│       └── AssemblyTreeModal.tsx      # CAD Assembly file structure modal
├── src-electron/
│   ├── main.ts                        # Electron main process (IPC handlers & stdio daemon control)
│   ├── preload.ts                     # Preload context bridge (window.electronAPI)
│   ├── daemon_client.ts               # IPC daemon process client wrapper
│   └── preload.cjs                    # CommonJS preload script for Electron runtime
├── backend/
│   ├── daemon.py                      # Persistent Stdio IPC JSON-RPC Python Daemon
│   ├── nester.py                      # 2D Irregular shape nesting solver (Shapely + STRtree)
│   ├── occ_unfold_bridge.py           # B-Rep geometry analysis and OCC unfolding engine
│   ├── solid_edge_bridge.py           # OLE metadata reader, COM converter, and assembly tree parser
│   ├── path_optimizer.py              # Toolpath optimization for NC G-Code export
│   ├── pdf_report_generator.py        # Shop floor PDF report generator
│   └── unfold/                        # Python OpenCASCADE Unfolding Package
│       ├── step_loader.py             # STEP file import & shape extraction
│       ├── face_graph.py              # Face classification, B-Rep adjacency graph, & thickness pairing
│       ├── bend_math.py               # K-Factor catalog, adaptive R/T heuristics & linear back-solver
│       ├── unfolder.py                # Recursive B-Rep face unfolding & bend surface unrolling
│       └── dxf_export.py              # Boundary dissolution, bend line clipping, & ezdxf export
├── Testing/                           # Empirical Verification & Benchmark Suite
│   ├── compare_models_with_solid_edge.py # Siemens Solid Edge automated 19-part benchmark test
│   └── compare_fusion.py              # Autodesk Fusion 360 benchmark comparison test
└── documentation/                     # Technical System Documentation
    ├── README.md                      # Comprehensive Master Guide & Documentation Index
    ├── getting_started.md             # Environment Setup & Build Instructions
    ├── architecture.md                # Technical Architecture & Stdio IPC Specs
    ├── unfolding_engine.md            # B-Rep Unfolding & K-Factor Calibration Math
    ├── nesting_solver.md              # 2D Irregular Nesting Solver & Dynamic Grid
    ├── backend.md                     # Python Services & CAD Bridges
    ├── frontend.md                    # React Dashboard, Three.js 3D Viewer & 2D Canvas
    ├── phases_roadmap.md              # Implementation Phase Matrix (Phase 1-6)
    ├── context_log.md                 # Development Context & Directory Index
    ├── design_system.md               # UI Styling & Theme System
    ├── rules.md                       # AI Guidelines & Development Constraints
    └── prd.md                         # Product Requirements Document
```

---

## Technical Stack

- **Frontend Framework**: React 18 with TypeScript, Tailwind CSS, Lucide React icons.
- **3D Graphics Engine**: Three.js WebGL with OrbitControls, PBR materials, and custom sub-mesh geometry centering.
- **Desktop Runtime**: Electron 32 (`contextIsolation: true`, `nodeIntegration: false`, IPC context bridge).
- **Backend CAD Engine**: Python 3.11 (FreeCAD 1.1 environment), OpenCASCADE 7.7.x (`pythonOCC`), Shapely 2.x, EzDXF, `olefile`.

---

## Benchmark Verification Summary

- **Siemens Solid Edge Benchmark**: 19 parts evaluated (`Bok 1-6`, `Lice 1-6`, `Pod 1`, `Unutrasnjost 1-3`).
  - Dimensional Margin: **0.00 mm**
  - Hole Count Accuracy: **100% (Up to 615 holes per blank)**
- **Autodesk Fusion 360 Benchmark**: `Part19.STEP` ($231.048\text{ mm}$), `Electrical Cabinet.STEP` ($391.087\text{ mm}$).
  - Dimensional Margin: **0.000 mm**

---

## Recent Technical Enhancements & Performance Optimizations

1. **Performance & Processing Optimizations**:
   - **Daemon Module Caching**: Removed `importlib.reload(...)` from stdio daemon request loops (`daemon.py`, `occ_unfold_bridge.py`), warm-loading libraries once at boot.
   - **Multi-Core Concurrency**: Upgraded daemon worker thread pool to `os.cpu_count()`.
   - **React State Side-Effect Decoupling**: Moved `addLog` side-effects outside of React state updater callbacks in `App.tsx`, preventing duplicate logs and unnecessary render cycles.
   - **BLF Gravity Squeezing**: Added Bottom-Left-Fill gravity slide (`_squeeze_blf`) and candidate step refinement ($1.0\text{ mm}$ - $2.5\text{ mm}$) to `nester.py` for high-density packing.

2. **Etch Tick Marker Customization Engine**:
   - **Position Strategies**: Added support for `position="interior"` (1-2 interior markers away from corners) and `position="boundary"` (classic corner edge ticks).
   - **Configurable Length**: Added customizable tick length in mm ($1.0\text{ mm}$ to $15.0\text{ mm}$, default $4.5\text{ mm}$).
   - **UI & Pipeline Synchronization**: Updated Pre-Flatten Settings Modal UI, IPC payload contracts (`runUnfold`, `runUnfoldBatch`, `runNesting`), and backend `generate_bend_ticks` DXF/SVG rendering.
