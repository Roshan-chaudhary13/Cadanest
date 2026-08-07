# CADANEST - Frontend Architecture & React Components

This document details the frontend React application architecture, component hierarchy, state orchestration, and WebGL rendering pipeline of CADANEST.

---

## 1. Frontend Architecture Overview

The frontend is built with React 18, TypeScript, Tailwind CSS, Lucide React icons, and Three.js. It runs inside Electron's renderer process with context isolation enabled.

```
src/
├── App.tsx                        # Main dashboard, state orchestration, menu bar, & modals
├── index.css                      # Industrial design system tokens & scrollbars
├── store/
│   └── useCadanestStore.ts        # Zustand state store (PartItem, FlatElementItem, JobGroup)
└── components/
    ├── FlatPreviewer.tsx          # 2D SVG flat pattern previewer with high-contrast canvas controls
    ├── Model3DViewer.tsx          # Three.js 3D WebGL B-Rep viewer with face raycasting & alignment
    ├── AssemblyTreeModal.tsx      # CAD Assembly structure modal for multi-body & assembly parsing
    ├── BatchMaterialGrid.tsx      # Batch material & thickness configuration grid
    └── JobGroupTab.tsx            # Material & thickness job grouping view for multi-group nesting
```

---

## 2. Main Dashboard Component (`App.tsx`)

`App.tsx` serves as the central state orchestrator and UI layout manager.

### Top Menu Bar
- **Settings**: Advanced Settings... (Opens modal to adjust Neutral Axis K-Factor slider `0.10 - 0.90` and Mirror Flat DXF toggle).
- **Edit**: Unfold All Flat Blanks, Undo Model Flattening, Reset Parameter Defaults.
- **View**: Themes (Dark Theme & Light Theme), 3D Source Viewport, Unfolded Flat Preview, Irregular Nesting Layout.
- **File**: Import STEP / DXF Files..., Export DXF Blank Profile, Clear Workspace.
- **Help**: Documentation & Guide, Keyboard Shortcuts Cheat Sheet, About CADANEST.
- **Customize Layout**: Show/Hide Left Sidebar, Reset Sidebar Width (320px), Toggle Full Screen Visualizer (`Alt+F`), Operator Terminal Logs.

### Left Sidebar Panels
- **ALL MODELS (COMBINED VIEW)**: Lists imported CAD models, quantities, material badges, face counts, and active check states.
- **PART CONFIG**: Shows active model `Qty per Set`, `Bend Line Style` selector (DOTTED-DASH vs TICKS), `Etch Marker Position` (`interior` vs `boundary`), `Etch Segment Length` (`1.0 - 15.0 mm`), and primary **⚡ FLATTEN / UNFOLD MODEL** action button.
- **SHEET STOCK** (Nesting Tab): Sheet dimensions dropdown, Capacity Exceeded Action preference (`+ SHEET COUNT` vs `+ SHEET SIZE`), clearance spacing, border margin, material alloy, rotation grain alignment, nesting mode (AUTO-FILL vs FIXED QTY), and **Start Nesting Solver** action button.

---

## 3. Component Library Details

### 3D WebGL Canvas (`components/Model3DViewer.tsx`)
- **Three.js Scene Setup**: Perspective camera with OrbitControls, directional lights, ambient light, grid floor helper, and view orientation gizmo.
- **PBR Material Rendering**: Maps model material alloy string (Steel, Stainless, Aluminum, Copper, Brass) to metallic/roughness values and color hex.
- **Sub-Mesh Face Overlay Alignment**: Stores `geometry.userData.center` during initial model centering and uses it when translating face sub-mesh STL geometries (`_face_X.stl`). Face overlays align 100% flush with the solid CAD body. Hides non-active sub-meshes (`faceMesh.visible = isActive || isHovered`) to prevent duplicate solid bodies.
- **Framed Camera View**: Bounding sphere calculation frames single parts and combined grid layouts automatically on scene load.

### 2D SVG Flat Pattern Previewer (`components/FlatPreviewer.tsx`)
- **Interactive Pan & Zoom**: Mouse drag pan and wheel zoom with transform matrix calculations.
- **High-Contrast Canvas Control Toolbar**: Positioned at top-right with backdrop blur (`bg-industrial-darker/95 border border-industrial-border`), fixed icon button sizing (`h-7 w-7`), and clean spacing (`Zoom +`, `Zoom -`, `Rotate`, `FIT`, `Expand ⤢`).
- **Dynamic Linetype Styling**: Preserves `stroke-dasharray="12,3,2,3"` for DOTTED-DASH centerlines and solid strokes for TICKS etch marks.
- **Visual Overlays**: Displays bounding dimension annotations ($W \times H$), bend angle labels, and highlighted inner cutouts.

### Assembly Structure Modal (`components/AssemblyTreeModal.tsx`)
- Displays recursive tree nodes (`AssemblyNode`) extracted from STEP assemblies or native Solid Edge `.asm` files.
- Provides search filtering, individual part selection, thickness inspection, material assignments, and bulk import to the nesting inventory.

### Batch Material Grid (`components/BatchMaterialGrid.tsx`)
- Groups imported components by material type and sheet thickness category.
- Enables batch parameter assignment (K-Factor mode, bend styling, material density) across all components within a material/thickness tier.

### Job Group Tab Bar (`components/JobGroupTab.tsx`)
- Organizes flat elements into distinct job groups (`JobGroup`) based on material grade and sheet thickness.
- Computes total element quantity, total weight (kg), and surface area per group to optimize sheet stock selection for nesting runs.
