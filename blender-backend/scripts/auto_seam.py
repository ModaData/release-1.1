"""
auto_seam.py — Garment-aware automatic seam placement.

Detects optimal seam lines based on dihedral angles (high curvature = natural fold)
and garment-industry visibility heuristics (prefer hidden areas: underarms, side seams,
inner legs). Produces clean UV islands via ANGLE_BASED unwrap after seam marking.

Usage:
  blender --background --python auto_seam.py -- \
    --input garment.glb --output seamed.glb \
    [--garment_type shirt] [--max_islands 8]
"""

import bpy
import bmesh
import json
import math
import sys
import argparse
from pathlib import Path
from collections import defaultdict

sys.path.insert(0, str(Path(__file__).parent))
from blender_helpers import safe_import_glb, safe_export_glb, wrap_main


# Visibility heuristics: garment-type → axis ranges where seams are preferred
# Coordinates are in normalized bounding-box space (0-1)
VISIBILITY_ZONES = {
    "shirt": [
        {"name": "side_seam",  "axis": "x", "range": (0.0, 0.15), "bonus": 0.3},
        {"name": "side_seam",  "axis": "x", "range": (0.85, 1.0), "bonus": 0.3},
        {"name": "underarm",   "axis": "z", "range": (0.55, 0.75), "bonus": 0.4},
    ],
    "pants": [
        {"name": "inseam",     "axis": "x", "range": (0.35, 0.65), "bonus": 0.4},
        {"name": "side_seam",  "axis": "x", "range": (0.0, 0.1),  "bonus": 0.3},
        {"name": "side_seam",  "axis": "x", "range": (0.9, 1.0),  "bonus": 0.3},
    ],
    "jacket": [
        {"name": "side_seam",  "axis": "x", "range": (0.0, 0.12), "bonus": 0.3},
        {"name": "side_seam",  "axis": "x", "range": (0.88, 1.0), "bonus": 0.3},
        {"name": "underarm",   "axis": "z", "range": (0.55, 0.75), "bonus": 0.4},
        {"name": "back_seam",  "axis": "y", "range": (0.0, 0.15), "bonus": 0.2},
    ],
    "dress": [
        {"name": "side_seam",  "axis": "x", "range": (0.0, 0.12), "bonus": 0.3},
        {"name": "side_seam",  "axis": "x", "range": (0.88, 1.0), "bonus": 0.3},
        {"name": "back_zip",   "axis": "y", "range": (0.0, 0.1),  "bonus": 0.35},
    ],
    "skirt": [
        {"name": "side_seam",  "axis": "x", "range": (0.0, 0.12), "bonus": 0.3},
        {"name": "side_seam",  "axis": "x", "range": (0.88, 1.0), "bonus": 0.3},
    ],
    "coat": [
        {"name": "side_seam",  "axis": "x", "range": (0.0, 0.12), "bonus": 0.3},
        {"name": "side_seam",  "axis": "x", "range": (0.88, 1.0), "bonus": 0.3},
        {"name": "back_seam",  "axis": "y", "range": (0.0, 0.15), "bonus": 0.25},
    ],
}


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input",        required=True)
    parser.add_argument("--output",       required=True)
    parser.add_argument("--garment_type", default="shirt",
                        help="Garment type: shirt/pants/jacket/dress/skirt/coat")
    parser.add_argument("--max_islands",  type=int, default=8,
                        help="Maximum number of UV islands to create")
    return parser.parse_args(argv)


def compute_edge_scores(bm, obj, garment_type):
    """Compute a score for each edge: higher = better candidate for seam cut."""
    # Compute bounding box for normalized coordinates
    bbox_min = [float('inf')] * 3
    bbox_max = [float('-inf')] * 3
    for v in bm.verts:
        co = obj.matrix_world @ v.co
        for i in range(3):
            bbox_min[i] = min(bbox_min[i], co[i])
            bbox_max[i] = max(bbox_max[i], co[i])

    bbox_size = [max(bbox_max[i] - bbox_min[i], 1e-6) for i in range(3)]
    zones = VISIBILITY_ZONES.get(garment_type, VISIBILITY_ZONES["shirt"])

    scores = {}
    for edge in bm.edges:
        # 1. Dihedral angle score (higher angle = better seam candidate)
        if len(edge.link_faces) == 2:
            n0 = edge.link_faces[0].normal
            n1 = edge.link_faces[1].normal
            dot = max(-1.0, min(1.0, n0.dot(n1)))
            dihedral = math.acos(dot)
            angle_score = dihedral / math.pi  # normalize to 0-1
        elif len(edge.link_faces) == 1:
            angle_score = 0.8  # boundary edges are good seam candidates
        else:
            angle_score = 0.0

        # 2. Visibility bonus (edges in hidden zones get higher score)
        midpoint = obj.matrix_world @ ((edge.verts[0].co + edge.verts[1].co) / 2)
        norm_pos = [(midpoint[i] - bbox_min[i]) / bbox_size[i] for i in range(3)]

        visibility_bonus = 0.0
        axis_map = {"x": 0, "y": 1, "z": 2}
        for zone in zones:
            ax = axis_map.get(zone["axis"], 0)
            lo, hi = zone["range"]
            if lo <= norm_pos[ax] <= hi:
                visibility_bonus = max(visibility_bonus, zone["bonus"])

        # Combined score
        scores[edge.index] = angle_score + visibility_bonus

    return scores


def select_seam_edges_by_score(bm, scores, max_islands):
    """Select top-scoring edges as seams, limiting to produce ~max_islands UV islands."""
    # Sort edges by score descending
    sorted_edges = sorted(scores.items(), key=lambda x: x[1], reverse=True)

    # Start with boundary edges (always seams)
    seam_indices = set()
    for edge in bm.edges:
        if len(edge.link_faces) == 1:
            seam_indices.add(edge.index)

    # Estimate: each seam cut that forms a loop creates ~1 new island
    # Heuristic: pick top edges until we'd exceed max_islands
    # Start conservative — pick edges above a threshold
    threshold = 0.4
    for edge_idx, score in sorted_edges:
        if score < threshold:
            break
        seam_indices.add(edge_idx)

    # If too many seams, raise threshold
    # Simple heuristic: limit total seam edges to ~max_islands * avg_edges_per_loop
    max_seam_edges = max_islands * 20  # rough estimate
    if len(seam_indices) > max_seam_edges:
        # Keep only the top max_seam_edges scoring non-boundary edges
        boundary = {e.index for e in bm.edges if len(e.link_faces) == 1}
        non_boundary_seams = [(idx, scores.get(idx, 0)) for idx in seam_indices if idx not in boundary]
        non_boundary_seams.sort(key=lambda x: x[1], reverse=True)
        seam_indices = boundary | {idx for idx, _ in non_boundary_seams[:max_seam_edges]}

    return seam_indices


@wrap_main
def auto_seam():
    args = parse_args()

    # Import
    meshes, err = safe_import_glb(args.input)
    if err:
        print(f"[auto_seam] FATAL: {err}")
        sys.exit(1)
    if not meshes:
        print("[auto_seam] FATAL: No mesh objects in GLB")
        sys.exit(1)

    print(f"[auto_seam] Loaded {len(meshes)} mesh(es), type={args.garment_type}, max_islands={args.max_islands}")

    all_seam_indices = []
    total_island_count = 0

    for obj in meshes:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)

        # Create bmesh for analysis
        bpy.ops.object.mode_set(mode="EDIT")
        bm = bmesh.from_edit_mesh(obj.data)
        bm.edges.ensure_lookup_table()
        bm.faces.ensure_lookup_table()

        # Compute edge scores
        scores = compute_edge_scores(bm, obj, args.garment_type)

        # Select seam edges
        seam_indices = select_seam_edges_by_score(bm, scores, args.max_islands)

        # Apply seam marks
        for edge in bm.edges:
            edge.seam = edge.index in seam_indices

        bmesh.update_edit_mesh(obj.data)

        # Unwrap with ANGLE_BASED
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.unwrap(method="ANGLE_BASED", margin=0.02)

        bpy.ops.object.mode_set(mode="OBJECT")
        obj.select_set(False)

        # Count UV islands (approximate via connected UV components)
        island_count = count_uv_islands(obj)
        total_island_count += island_count

        all_seam_indices.extend(seam_indices)
        print(f"[auto_seam] '{obj.name}': {len(seam_indices)} seam edges → {island_count} UV islands")

    # Export
    success, err = safe_export_glb(args.output)
    if not success:
        print(f"[auto_seam] FATAL: Export failed: {err}")
        sys.exit(1)

    # Write sidecar
    meta_path = str(args.output).rsplit(".", 1)[0] + "_auto_seam_meta.json"
    meta = {
        "seam_count": len(all_seam_indices),
        "island_count": total_island_count,
        "seam_edge_indices": all_seam_indices[:500],  # cap for JSON size
        "garment_type": args.garment_type,
        "max_islands_requested": args.max_islands,
    }
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    print(f"[auto_seam] Done → {args.output} + {meta_path}")


def count_uv_islands(obj):
    """Count UV islands by flood-filling connected UV faces."""
    mesh = obj.data
    uv_layer = mesh.uv_layers.active
    if not uv_layer:
        return 1

    face_count = len(mesh.polygons)
    if face_count == 0:
        return 0

    # Build adjacency: faces sharing non-seam edges
    edge_faces = defaultdict(list)
    for poly in mesh.polygons:
        for ek in poly.edge_keys:
            edge_faces[ek].append(poly.index)

    seam_edges = set()
    for edge in mesh.edges:
        if edge.use_seam:
            seam_edges.add(tuple(sorted(edge.vertices)))

    # Flood fill
    visited = [False] * face_count
    islands = 0
    for start in range(face_count):
        if visited[start]:
            continue
        islands += 1
        queue = [start]
        visited[start] = True
        while queue:
            fi = queue.pop()
            for ek in mesh.polygons[fi].edge_keys:
                if ek in seam_edges:
                    continue
                for adj in edge_faces[ek]:
                    if not visited[adj]:
                        visited[adj] = True
                        queue.append(adj)
    return islands


if __name__ == "__main__":
    auto_seam()
