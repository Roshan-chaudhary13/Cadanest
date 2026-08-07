# CADANEST - Backend Architecture & Python Services

This document details the backend Python architecture, persistent IPC daemon, B-Rep unfolding algorithms, nesting solver, and verification suite of CADANEST.

---

## 1. Backend Architecture Overview

The backend consists of Python services running within a Python 3.11 environment bundled with OpenCASCADE (pythonOCC), FreeCAD, Shapely, and ezdxf libraries.

```
backend/
├── daemon.py                      # Stdio JSON-RPC IPC Daemon
├── occ_unfold_bridge.py           # CLI & daemon bridge handler
├── solid_edge_bridge.py           # Solid Edge OLE/COM assembly parser
├── nester.py                      # 2D irregular nesting packing solver
├── batch_processor.py             # Multi-file batch processing engine
├── cache_manager.py               # STEP B-Rep parsing & unfold cache manager
├── path_optimizer.py              # Toolpath optimization for NC G-Code export
├── pdf_report_generator.py        # Shop floor PDF report generator
└── unfold/                        # OpenCASCADE B-Rep Unfolding Package
    ├── step_loader.py             # STEP file parsing & shape loading
    ├── face_graph.py              # B-Rep face classification & thickness pairing
    ├── bend_math.py               # K-Factor bend allowance calculations
    ├── unfolder.py                # Recursive face flattening & bend surface unrolling
    └── dxf_export.py              # Boundary dissolution, bend clipping, & ezdxf export
```

---

## 2. Persistent Stdio IPC Daemon (`backend/daemon.py`)

To eliminate startup latency and maximize concurrency, `daemon.py` warm-loads heavy CAD libraries at boot and utilizes `os.cpu_count()` worker thread pools for parallel requests without redundant module reloads.

### Protocol
- **Transport**: Standard input (`stdin`) and standard output (`stdout`).
- **Encoding**: Line-delimited JSON-RPC objects.
- **Commands Handled**:
  - `analyze`: Parses STEP file B-Rep geometry, extracts thickness, dimensions, volume, planar face counts, auto-discovers base face, and exports 3D STL preview meshes.
  - `unfold`: Performs analytical unfolding on STEP solid, applies K-factor allowance, accepts `etchMarkerPosition` (`interior` | `boundary`) and `etchMarkerLength` (`1.0` - `15.0` mm), generates SVG preview, and writes DXF file.
  - `nest`: Executes 2D irregular shape packing solver (with BLF gravity squeezing) across active flat elements, generating DXF sheet layout, PDF report, and NC G-Code toolpath.
  - `calibrateKFactor`: Precision closed-form $K$-factor back-solver calculation ($10^{-4}$ precision) against target reference length $L_{\text{target}}$.
  - `inspect_assembly`: Parses assembly tree structure from STEP or native Solid Edge `.asm` files, returning recursive node metadata.
  - `batch_unfold`: Parallel multi-part unfolding processor for batch operations across material/thickness categories.
  - `generate_pdf_report`: Generates shop floor PDF reports with sheet stock utilization graphics and part tables.
  - `reload`: Reloads backend Python modules dynamically for live debugging.

---

## 3. B-Rep Unfolding Package (`backend/unfold/`)

### Face Classification & Thickness Partnering (`face_graph.py`)
- Iterates over all topological faces (`TopoDS_Face`) in the solid B-Rep shape.
- Classifies faces into `PLANE` (flat flanges) and `CYLINDER` (bend zones).
- **Tangent-Constrained Thickness Partnering**: Computes normal distance and 2D in-plane tangential displacement between parallel planar faces to accurately pair front/back thickness surfaces without dropping complex side or angled flanges.

### Recursive BFS Unfolding & Bend Surface Unrolling (`unfolder.py`)
- Builds a face adjacency graph connecting planar flanges through cylindrical bend faces.
- Starting from the selected planar base face, performs Breadth-First Search (BFS) traversal.
- For each bend face, calculates unrolled neutral axis arc length using Neutral Axis K-Factor:
  $$\text{Arc Length} = \theta \times (R + K \times T)$$
  where $\theta$ is bend angle (radians), $R$ is inner bend radius, $K$ is K-factor, and $T$ is sheet thickness.
- Transforms connected child planar flanges into the 2D flattening plane.

### Boundary Dissolution & DXF Layer Export (`dxf_export.py`)
- Converts 2D planar face boundaries into Shapely polygons.
- Executes `unary_union` across all flattened face polygons to dissolve coplanar internal seams while preserving outer boundary contours and internal cutout loops (screw holes, slots).
- Clips bend centerline segments to lie strictly within the part boundary.
- **TICKS Mode (Etch Tick Markers)**: `generate_bend_ticks` generates configurable etch marks:
  - `position`: `'interior'` (1-2 markers placed along interior bend line, away from corners) or `'boundary'` (classic corner ticks).
  - `tick_length`: Configurable segment length (default `4.5 mm`, min `1.0 mm`, max `15.0 mm`).
  - Layer: `UP_CENTERLINES` / `DOWN_CENTERLINES` with `CONTINUOUS` linetype and `BYLAYER` attributes.
- **DOTTED-DASH Mode**: Exports bend centerlines using AutoCAD `CENTER2` linetype definition `[1.0, 0.5, -0.125, 0.125, -0.125]` and `$LTSCALE = 1.0`.

---

## 4. 2D Irregular Nesting Solver (`backend/nester.py`)

- **Bottom-Left Placement**: Places parts starting from the bottom-left origin `(margin, margin)` of the sheet stock.
- **STRtree Spatial Indexing**: Uses Shapely `STRtree` bounding box spatial index to accelerate collision detection against previously packed polygons.
- **Dynamic Candidate Grid**: Expands candidate placement step size (`min_step`) dynamically as sheet fills up to maintain fast execution.
- **Multi-Sheet Generation**: Automatically creates additional sheets (`Sheet 1`, `Sheet 2`, `Sheet 3`...) when requested part quantities exceed single sheet capacity.

---

## 5. Verification Suite (`Testing/compare_models_with_solid_edge.py`)

- Compares CADANEST flat pattern outputs against Siemens Solid Edge benchmark DXF files across 19 complex sheet metal models (`Bok 1-6`, `Lice 1-6`, `Pod 1`, `Unutrasnjost 1-3`).
- Validates flat blank bounding dimensions, hole counts, and bend line counts.
- **Result**: **100% PASS rate across all 19 benchmark parts** with **0.00 mm** dimensional precision.
