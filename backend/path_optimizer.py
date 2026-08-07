"""
path_optimizer.py - High-Speed Laser Traversal Path Optimization for Cadanest
Implements Nearest-Neighbor Traveling Salesperson Problem (TSP) algorithm
to re-order nested part cuts and minimize rapid G00 laser movement distances.
"""

import math
import numpy as np


def optimize_rapid_traversal_path(nested_results: list, start_point=(0.0, 0.0)) -> list:
    """
    Sorts nested part positions using a 2D Nearest Neighbor TSP heuristic.
    Minimizes non-cutting rapid G00 movements of the CNC laser head across the sheet stock.
    """
    if not nested_results or len(nested_results) <= 1:
        return nested_results

    unvisited = list(nested_results)
    current_pos = np.array(start_point, dtype=float)
    optimized_path = []

    while unvisited:
        # Find unvisited part whose position is closest to current laser head position
        best_idx = 0
        best_dist = float('inf')

        for idx, item in enumerate(unvisited):
            item_pos = np.array([item["dx"], item["dy"]], dtype=float)
            dist = np.linalg.norm(item_pos - current_pos)
            if dist < best_dist:
                best_dist = dist
                best_idx = idx

        next_item = unvisited.pop(best_idx)
        optimized_path.append(next_item)
        current_pos = np.array([next_item["dx"], next_item["dy"]], dtype=float)

    return optimized_path
