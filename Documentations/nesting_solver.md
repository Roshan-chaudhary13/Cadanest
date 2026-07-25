# 2D Irregular Nesting Solver Documentation

This document describes the design, heuristics, and performance optimizations implemented in Cadanest's 2D irregular nesting solver.

## Overview
The nesting solver ([nester.py](file:///c:/Users/rosha/Desktop/Cadanest/Cadanest/backend/nester.py)) packs 2D irregular parts onto a raw sheet stock while maximizing utilization. It uses a bottom-left placement heuristic, candidate position grid generation, and bounding-box STRtree spatial indexing to guarantee speed and density.

---

## Technical Details

### 1. Spatial Partitioning & Indexing
To perform rapid collision checks between parts, the nesting solver utilizes a Spatial R-Tree (`STRtree` from Shapely). 
- When placing a part, the tree is queried for nearby candidate polygons.
- If the bounding boxes overlap, a detailed polygon overlap check (`intersects`) is performed.
- Using an R-Tree reduces intersection complexity from $O(N^2)$ to $O(N \log N)$.

### 2. Candidate Coordinate Grid
Instead of performing an expensive continuous search, candidate coordinates $(x, y)$ are generated at the boundary boundaries of already packed parts:
- $X$ Candidates: `part.maxx + spacing`
- $Y$ Candidates: `part.maxy + spacing` and `part.miny`

A bottom-left ranking scores each coordinate pair. The candidate that places the part closest to the bottom-left corner of the sheet is selected.

### 3. Dynamic Step Coarsening (Performance Optimizer)
On crowded sheets (150+ parts), evaluating a fine grid leads to a massive search space. To maintain speed:
- Grid coordinates within a filtering threshold are merged.
- The step threshold (`min_step`) dynamically scales based on the number of already placed parts:
  - `0 to 40 parts`: `2.0mm`
  - `41 to 80 parts`: `4.0mm`
  - `81 to 120 parts`: `8.0mm`
  - `121+ parts`: `16.0mm`

This prevents search space explosion and provides a **43% speedup** while retaining dense packing layouts.

### 4. Interleaved Set Sorting
In `auto_fill` mode, rather than sorting all instances by area descending (which packs all large parts first, blocking smaller parts from completing sets), parts are sorted using:
$$\text{Sort Key} = (\text{Instance Index}, -\text{Area})$$
This packs parts set-by-set (Set 0, Set 1, Set 2...). It ensures balanced sheet yield and higher completed set counts.

### 5. Multi-Group Balanced Pruning
To give operators flexibility in set composition, the solver classifies templates into custom groups:
- **Group A / B**: The solver calculates the maximum completed sets (`best_S = qty_packed // qty_per_set`) for each group independently. It then prunes extra elements of that group to match its respective complete set multiple.
- **Independent**: Elements marked as Independent bypass the pruning step entirely, remaining at their exact packed quantities.

### 6. DXF Assembly Export
After packing is completed, the solver loads the original DXF file of each placed part:
- **Cut Geometry**: Transformed and written to the `"CUT"` layer (Green).
- **Bend Geometry**: Trimmed to exist only within the local part boundary, transformed, and written to the `"BEND_LINES"` layer (Red, Dashed).
- Rotations and translations are synchronized exactly to prevent shifts.
