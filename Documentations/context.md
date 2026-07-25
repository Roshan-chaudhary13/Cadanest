# Cadanest Project Context

This document provides a comprehensive overview of the Cadanest codebase, its architecture, recent major refactorings, and setup guidelines for future agents.

## Project Overview
Cadanest is an industrial-grade 3D Sheet Metal CAD/CAM application. It allows sheet metal design engineers to:
1. **Import 3D STEP Solid Models** of sheet metal parts.
2. **Analyze Geometry** to detect thickness, materials, volume, dimensions, and planar flanges.
3. **Flatten/Unfold** 3D parts into 2D flat patterns (B-Rep boundaries and bend lines) using an in-memory pythonOCC engine.
4. **Nest 2D Profiles** onto raw sheet stock (`2500x1250` mm by default) using an optimized 2D irregular shape packing solver.
5. **Export Production DXF Files** including separated layers for profiling (`CUT` layer) and bending (`BEND_LINES` layer).

---

## Directory Structure

```
c:\Users\rosha\Desktop\Cadanest\
├── Cadanest\                          # Electron app root
│   ├── src\                           # React frontend
│   │   ├── App.tsx                    # Main dashboard, sidebar, state, and logs
│   │   ├── index.css                  # Tailored industrial dark mode styles
│   │   └── components\
│   │       ├── FlatPreviewer.tsx      # 2D SVG flat pattern previewer (pan/zoom)
│   │       └── Model3DViewer.tsx      # Three.js 3D STL viewer
│   ├── src-electron\
│   │   ├── main.ts                    # Electron main process (IPC handlers & process control)
│   │   └── preload.ts                 # Preload context bridge (IPC APIs)
│   ├── backend\
│   │   ├── nester.py                  # Irregular shape 2D nesting solver CLI
│   │   ├── occ_unfold_bridge.py       # CLI bridge for STEP analysis & unfolding
│   │   └── unfold\                    # Python OCC unfolding engine package
│   │       ├── step_loader.py         # STEP file parsing
│   │       ├── face_graph.py          # Adjacency graph & thickness detection
│   │       ├── bend_math.py           # K-factor bend allowance & deduction
│   │       ├── unfolder.py            # Recursive face flattening & unfolding
│   │       └── dxf_export.py          # DXF output and boundary-dissolve logic
```

---

## Technical Stack & Dependencies
- **Frontend**: React (TypeScript), Tailwind CSS, Lucide React icons, Three.js (for 3D STL rendering).
- **Desktop Wrapper**: Electron (configured with `nodeIntegration: false`, `contextIsolation: true`, and IPC preload APIs).
- **Backend (Python)**: Python 3.11 (bundled inside the FreeCAD environment), pythonOCC (Open CASCADE wrapper), Shapely (geometric operations), EzDXF (DXF read/write).

---

## Major Refactorings (July 2026)

### 1. Removal of FreeCAD Document Dependency
The system previously invoked the FreeCAD GUI/CLI environment to run `SMUnfold` and export DXFs. This was highly unstable, slow (~120s execution time), and prone to freezing. 
- **Solution**: Removed FreeCAD dependencies.
- **Unfolding**: Replaced with a direct, in-memory **pythonOCC-based unfolding package** located in `backend/unfold/`.
- **DXF Processing**: Replaced with **ezdxf** for direct parsing and writing of dxf coordinates, reducing nesting export time from 120s to <3s.

### 2. Internal Bend Tangent Dissolution (Hole Preservation)
Flattened CAD models include internal line boundaries between planar faces and bend tangent zones. If left on the cutting layer, lasers would slice the part in half.
- **Solution**: Implemented a 2D boundary union in [dxf_export.py](file:///c:/Users/rosha/Desktop/Cadanest/Cadanest/backend/unfold/dxf_export.py). 
- Converts each `TopoDS_Face` to a Shapely Polygon (subtracting internal holes using `outer.difference(hole)`).
- Performs a `unary_union` on the face polygons. This dissolves all adjacent internal bend tangent lines while preserving outer profiles and screw/slot cutout holes perfectly.

### 3. Bend Line Trimming & Layer Isolation
- Bend line segments are clipped using Shapely `intersection` to ensure they lie **only within** the part boundary.
- They are rotated/translated with the exact same coordinate transformation matrices as the outer profile to stay aligned.
- Profiles are exported to the `"CUT"` layer (Green). Trimmed bend lines are exported to the `"BEND_LINES"` layer (Red, Dashed).

### 4. Nesting Solver Performance Optimizations
- **Dynamic Step Scaling**: In [nester.py](file:///c:/Users/gaash/Desktop/Projects/Cadanest/backend/nester.py), candidate grid positioning dynamically expands from `2.0mm` up to `16.0mm` as the sheet fills up. This limits search space complexity and gives a **43% speedup** on dense layouts.
- **Interleaved Set Packing**: Sorting key changed to `(inst["index"], -area)` to pack parts set-by-set (Set 0, Set 1, etc.) instead of all large parts first. Increases set yields significantly.

### 5. Multi-Face Unfolding & Nesting Groups
- **Multi-Face Unfolding**: The app now supports selecting and flattening multiple base faces from a single STEP file independently. To prevent output files from overwriting each other, output DXF/SVG filenames incorporate the base face name (e.g. `[ModelName]_[BaseFace]_unfolded.dxf`).
- **Nesting Groups**: Implemented configurable Nesting Groups (Group A, Group B, and Independent) for balanced set nesting:
  - Grouped elements (A or B) are packed and pruned to complete set multiples.
  - Independent elements are nested in their exact fixed quantity.
  - The Python nester computes set sizes (`best_S`) and prunes individually per group, keeping independent parts unpruned.

### 6. Interactive Sheet Capacity & Paginator UX
- **Sheet Capacity Confirmation Dialog**: Intercepts multi-sheet nesting runs, offering choices to automatically upsize the sheet to a larger standard stock (e.g. 3000x1500 mm), proceed with multiple sheets, or cancel and revert quantities to the last single-sheet fitting state.
- **Below-Canvas Pagination Controls**: The multi-sheet selector tabs were relocated from the header to directly below the canvas viewer for a clean PDF/CAD-style interface, showing active sheet metadata (utilization %, part counts) inline.
- **Workflow Wizard overlay**: Selection screen displayed on the nesting tab canvas (Full Auto vs Semi-Auto) to prevent background solvers from auto-nesting instantly on entry.
- **Stuck-1 Edit Fix**: Clamped state changes to `0` and rendered as `''` in inputs, allowing backspace clearing and typing freely, with validation checks when solving.

---

## Setup & Running Guide

### Running React Dev Server
```powershell
cd C:\Users\rosha\Desktop\Cadanest\Cadanest
npm run dev
```

### Running Electron App
```powershell
cd C:\Users\rosha\Desktop\Cadanest\Cadanest
npm run electron
```

### Manual Backend Testing
To run unfolding directly via Python:
```powershell
& "C:\Users\rosha\Desktop\Cadanest\FreeCAD_1.1.1-Windows-x86_64-py311\bin\python.exe" occ_unfold_bridge.py unfold "path/to/model.step" 0.40 "dxf_out.dxf" "svg_out.svg"
```

To run nesting directly:
```powershell
& "C:\Users\rosha\Desktop\Cadanest\FreeCAD_1.1.1-Windows-x86_64-py311\bin\python.exe" nester.py "path/to/config.json"
```
