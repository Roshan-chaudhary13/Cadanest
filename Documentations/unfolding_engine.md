# 3D Unfolding Engine Documentation

This document describes the design and mathematical implementation of Cadanest's in-memory 3D solid sheet metal unfolding engine.

## Overview
The unfolding engine is implemented in Python using the `pythonOCC` wrapper for Open CASCADE. It loads a 3D solid STEP file, classifies its face topology, builds a face adjacency graph, calculates K-factor bend allowances, recursively flattens adjacent faces, and exports a 2D blank profile.

---

## Processing Pipeline

```
[Import STEP] -> [Classify Faces] -> [Build Adjacency Graph] 
      -> [Determine Root Face] -> [Recursive Flattening] -> [Dissolve Internal Lines] -> [Export DXF]
```

### 1. Face Classification
The engine iterates over all faces (`TopoDS_Face`) in the shape and classifies them into:
- **PLANE**: Flat planar face segments.
- **CYLINDER**: Curved cylindrical faces representing bends.
- **OTHER**: Complex, non-sheet metal face geometries.
Thickness is detected by calculating the distance between opposing parallel planar faces.

### 2. Graph Adjacency
A face adjacency graph is built where nodes are faces and edges represent topologically shared `TopoDS_Edge` boundaries. Planar faces are connected to their adjacent planar faces *through* the intermediate cylindrical bend faces.

### 3. K-Factor Bend allowance
During flattening, the K-factor is used to calculate the neutral axis location:
$$\text{Bend Allowance} = \theta \times (R + K \times T)$$
where:
- $\theta$: Bend angle (radians).
- $R$: Inside bend radius.
- $K$: K-factor (typically `0.3` to `0.5`).
- $T$: Material thickness.

This bend allowance represents the unfolded length of the cylindrical bend face.

### 4. Recursive Face Transformation
Starting at the selected planar **root face** (which remains stationary at $Z=0$):
1. The engine traverses the face graph using a Breadth-First Search (BFS).
2. For each cylindrical bend face, it calculates the bend axis direction and location.
3. It creates a transformation matrix (`gp_Trsf`) combining rotation and translation to flatten the adjacent face onto the planar level of the current face.
4. The transformations are recursively multiplied and applied via `BRepBuilderAPI_Transform`.

### 5. Coplanar Edge Dissolution (Hole Preservation)
To remove internal tangent lines and bend boundaries on the cutting contour, a 2D geometry solver is executed in [dxf_export.py](file:///c:/Users/gaash/Desktop/Projects/Cadanest/backend/unfold/dxf_export.py):
1. Each flattened `TopoDS_Face` is converted to a Shapely Polygon.
2. If the face contains internal holes (such as screw slots), they are isolated and subtracted using a `difference` operation.
3. A `unary_union` is executed over all face polygons. This dissolves adjacent boundaries (coplanar seams and cylinder tangents) while preserving the slot/hole cutouts.
4. The final boundary coordinates are written to the `"CUT"` layer in the DXF file.

### 6. Multi-Face Independent Unfolding
When a solid model consists of multiple bendable sheets or flanges, the engine supports selecting and unfolding multiple base/root faces independently:
- Each selected base face builds its own tree starting from that specific root node.
- Each run writes its flattened drawing to a baseface-specific DXF/SVG output file (e.g. `[ModelName]_[BaseFace]_unfolded.dxf`).
- This decouples the flattened blanks, preventing overlapping files and allowing individual flanges to be nested together or assigned to different sets and groups.
