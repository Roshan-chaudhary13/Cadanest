# CADANEST — System Architecture & Data Flows

This document details the hybrid system architecture, persistent IPC daemon, protocol specification, and data flows of the CADANEST application.

---

## 1. System Architecture

CADANEST operates as a high-performance desktop application combining an **Electron + React 18 Renderer** with a **Persistent Python Stdio IPC Daemon** running within an OpenCASCADE / FreeCAD 1.1 Python 3.11 environment.

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

## 2. IPC JSON-RPC Protocol (`main.ts` ↔ `daemon.py`)

The IPC daemon (`backend/daemon.py`) remains warm in memory throughout the application lifecycle, eliminating the ~1.5-second Python import overhead on every operation.

### Request Payload Format
```json
{
  "id": "req_1042",
  "command": "unfold",
  "payload": {
    "stepPath": "C:/models/part.step",
    "kfactor": 0.33,
    "bendStyle": "tick",
    "etchMarkerPosition": "interior",
    "etchMarkerLength": 4.5,
    "mirror": true,
    "baseFace": "Face1"
  }
}
```

### Response Payload Format
```json
{
  "id": "req_1042",
  "status": "success",
  "dxf_path": "C:/exports/part_unfolded.dxf",
  "svg_content": "<svg ...></svg>",
  "unfolded_kfactor": 0.33,
  "unfolded_mirror": true,
  "unfolded_bend_style": "tick"
}
```

### Supported IPC Endpoints
- `analyze`: B-Rep geometry classification, thickness detection, planar base face discovery, and 3D preview STL generation.
- `unfold`: Analytical OpenCASCADE BFS face unrolling, $K$-factor calculation, bend line generation (TICKS with `etchMarkerPosition` / `etchMarkerLength` or DOTTED-DASH CENTER2), and SVG/DXF export.
- `nest`: 2D irregular shape packing solver (with BLF gravity squeezing) execution, generating DXF sheet layout, PDF shop floor report, and CNC G-Code.
- `calibrateKFactor`: Precision closed-form $K$-factor back-solver calculation ($10^{-4}$ precision) against target reference length $L_{\text{target}}$.
- `inspect_assembly`: Assembly tree topology parsing for multi-body STEP files and native Solid Edge `.asm` assemblies, returning recursive `AssemblyNode` structure.
- `batch_unfold`: Parallel multi-part unfolding processor for batch operations across material/thickness categories.
- `generate_pdf_report`: Shop floor PDF report generator building scaled sheet visualizations, nesting metrics, utilization %, and part count summaries.
- `reload`: Live module reloading for dynamic backend updates without restarting the application.

---

## 3. Data Processing Pipelines

### A. 3D CAD STEP Import & B-Rep Analysis Pipeline
```
STEP File / Native CAD ──► OpenCASCADE STEP Control Reader ──► Extract TopoDS_Shape
                                                                    │
                                                                    ▼
                                                         Classify TopoDS_Face items
                                                         (PLANE vs CYLINDER)
                                                                    │
                                                                    ▼
                                                         Build B-Rep Adjacency Graph
                                                         & Tangent Thickness Pairs
                                                                    │
                                                                    ▼
                                                         Auto-Discover Base Flange
                                                         & Export Preview STL Meshes
```

### B. Analytical Unfolding & DXF Export Pipeline
```
Base Face & K-Factor ──► Recursive BFS Traversal of Planar Flanges
                                     │
                                     ▼
                        unroll_bend_face_boundary (Cylinders)
                        & Align Flanges into 2D Coordinate Plane
                                     │
                                     ▼
                        Shapely unary_union Dissolves Seams
                        & Preserves Internal Cutout Loops
                                     │
                                     ▼
                        Clip & Align Bend Centerline Segments
                        (TICKS etch marks or DOTTED-DASH CENTER2)
                                     │
                                     ▼
                        Write DXF via ezdxf (CUT & BEND Layers)
                        & Generate Scaled 2D SVG Preview
```

### C. Precision $K$-Factor Calibration Flow
```
User Enters Target Flat Length L_target ──► IPC Call (calibrateKFactor)
                                                       │
                                                       ▼
                                            Linear Closed-Form Solver
                                            (Deducts straight/leg sums)
                                                       │
                                                       ▼
                                            Exact K-Factor (10^-4) Computed
                                                       │
                                                       ▼
                                            Apply to Part or Set Material Default
```

---

## 4. Frontend Component & State Architecture

- **State Store (`src/store/useCadanestStore.ts`)**: Zustand store managing active `parts`, `flatElements`, `jobGroups`, active tab, sheet stock settings, and modal visibility.
- **Main Dashboard (`App.tsx`)**: Menu bar, top action headers, layout toggles, tab switching (`import`, `flatten`, `nesting`), and calibration/settings modals.
- **3D Canvas (`src/components/Model3DViewer.tsx`)**:
  - Three.js WebGL canvas with OrbitControls and view orientation gizmo.
  - Sub-mesh geometry centering via `geometry.userData.center` ensuring face overlays (`_face_X.stl`) align flush with solid CAD model bodies.
  - Hides non-active face sub-meshes (`faceMesh.visible = isActive || isHovered`) to prevent duplicate solid rendering.
- **2D Canvas (`src/components/FlatPreviewer.tsx`)**:
  - High-contrast, non-overlapping canvas toolbar (`Zoom +`, `Zoom -`, `Rotate`, `FIT`, `Expand ⤢`).
  - Interactive pan/zoom SVG viewbox transformation.
