"""
uv_pack_nest.py — Fabric yield optimizer: nest UV islands on a virtual fabric roll.

Optimal nesting of pattern pieces on a fabric roll minimizes waste.
Even 2% improvement in fabric yield saves thousands per production run.
This script goes beyond Blender's built-in UV packing by supporting:
  - Fabric roll dimensions (width constraint)
  - Grain direction alignment (warp/weft)
  - Seam allowance gaps between islands
  - SVG export of the cutting layout
  - Yield % computation

Usage:
  blender --background --python uv_pack_nest.py -- \
    --input pattern.glb --output nested.glb \
    [--fabric_width 1.5] [--grain_direction warp] \
    [--seam_allowance 0.015] [--scale 1.0]
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


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input",           required=True)
    parser.add_argument("--output",          required=True)
    parser.add_argument("--fabric_width",    type=float, default=1.5,
                        help="Fabric roll width in meters (default: 1.5m = 150cm)")
    parser.add_argument("--grain_direction", default="warp",
                        help="Grain alignment: warp (vertical), weft (horizontal), none")
    parser.add_argument("--seam_allowance",  type=float, default=0.015,
                        help="Gap between islands in meters (default: 15mm)")
    parser.add_argument("--scale",           type=float, default=1.0,
                        help="UV-to-world scale factor")
    return parser.parse_args(argv)


def extract_uv_islands(obj):
    """Extract UV islands as lists of (loop_index, u, v) grouped by connected component."""
    mesh = obj.data
    uv_layer = mesh.uv_layers.active
    if not uv_layer:
        return []

    # Build face adjacency (non-seam edges connect faces within same island)
    edge_faces = defaultdict(list)
    for poly in mesh.polygons:
        for ek in poly.edge_keys:
            edge_faces[ek].append(poly.index)

    seam_edges = set()
    for edge in mesh.edges:
        if edge.use_seam:
            seam_edges.add(tuple(sorted(edge.vertices)))

    # Flood fill to find islands
    face_count = len(mesh.polygons)
    visited = [False] * face_count
    islands = []

    for start in range(face_count):
        if visited[start]:
            continue
        island_faces = []
        queue = [start]
        visited[start] = True
        while queue:
            fi = queue.pop()
            island_faces.append(fi)
            for ek in mesh.polygons[fi].edge_keys:
                if ek in seam_edges:
                    continue
                for adj in edge_faces[ek]:
                    if not visited[adj]:
                        visited[adj] = True
                        queue.append(adj)

        # Collect UV coords for this island
        island_uvs = []
        for fi in island_faces:
            poly = mesh.polygons[fi]
            for li in poly.loop_indices:
                uv = uv_layer.data[li].uv
                island_uvs.append((li, uv[0], uv[1]))

        islands.append({
            "face_indices": island_faces,
            "uvs": island_uvs,
        })

    return islands


def compute_island_bounds(island):
    """Compute bounding box of an island's UV coordinates."""
    uvs = island["uvs"]
    if not uvs:
        return (0, 0, 0, 0)
    min_u = min(uv[1] for uv in uvs)
    max_u = max(uv[1] for uv in uvs)
    min_v = min(uv[2] for uv in uvs)
    max_v = max(uv[2] for uv in uvs)
    return (min_u, min_v, max_u, max_v)


def compute_island_area(island):
    """Compute approximate area of an island from its UV bounding box."""
    min_u, min_v, max_u, max_v = compute_island_bounds(island)
    return (max_u - min_u) * (max_v - min_v)


def nest_islands_bottom_left(islands, fabric_width, seam_allowance, grain_direction, scale):
    """
    Bottom-left fill nesting: place islands largest-first into rows.
    Returns: list of (island_index, offset_u, offset_v, rotation) and layout metadata.
    """
    # Compute bounds and sort by area (largest first)
    island_data = []
    for i, island in enumerate(islands):
        bounds = compute_island_bounds(island)
        w = (bounds[2] - bounds[0]) * scale
        h = (bounds[3] - bounds[1]) * scale
        area = w * h
        island_data.append({
            "index": i,
            "bounds": bounds,
            "width": w,
            "height": h,
            "area": area,
        })

    island_data.sort(key=lambda x: x["area"], reverse=True)

    # Nesting state
    placements = []
    row_y = seam_allowance  # Current row Y position
    row_x = seam_allowance  # Current X position in row
    row_height = 0           # Max height in current row
    total_island_area = 0

    for item in island_data:
        w, h = item["width"], item["height"]
        total_island_area += w * h

        # Try rotations based on grain direction
        if grain_direction == "none":
            rotations = [0, 90, 180, 270]
        elif grain_direction == "warp":
            rotations = [0, 180]  # Only vertical grain-aligned rotations
        else:  # weft
            rotations = [90, 270]  # Only horizontal grain-aligned rotations

        best_fit = None
        for rot in rotations:
            rw = h if rot in (90, 270) else w
            rh = w if rot in (90, 270) else h

            # Check if it fits in current row
            if row_x + rw + seam_allowance <= fabric_width:
                best_fit = (row_x, row_y, rot, rw, rh)
                break
            # Check if it fits at start of new row
            elif seam_allowance + rw + seam_allowance <= fabric_width:
                best_fit = (seam_allowance, row_y + row_height + seam_allowance, rot, rw, rh)
                break

        if best_fit is None:
            # Force place at new row even if slightly oversized
            best_fit = (seam_allowance, row_y + row_height + seam_allowance, 0, w, h)

        px, py, rot, rw, rh = best_fit

        # Update row tracking
        if px <= seam_allowance + 0.001:
            # Starting new row
            row_y = py
            row_height = rh
            row_x = px + rw + seam_allowance
        else:
            row_x = px + rw + seam_allowance
            row_height = max(row_height, rh)

        placements.append({
            "island_index": item["index"],
            "offset_u": px / scale,
            "offset_v": py / scale,
            "rotation": rot,
            "bounds": item["bounds"],
        })

    # Compute fabric usage
    total_height = row_y + row_height + seam_allowance
    bounding_area = fabric_width * total_height
    yield_percent = (total_island_area / max(bounding_area, 1e-6)) * 100

    return placements, {
        "yield_percent": round(yield_percent, 1),
        "fabric_used_m2": round(bounding_area, 4),
        "waste_m2": round(bounding_area - total_island_area, 4),
        "roll_length_needed": round(total_height, 3),
        "num_panels": len(islands),
        "fabric_width": fabric_width,
    }


def apply_placements_to_uvs(obj, islands, placements, scale):
    """Remap UV coordinates to nested positions."""
    mesh = obj.data
    uv_layer = mesh.uv_layers.active
    if not uv_layer:
        return

    for placement in placements:
        island = islands[placement["island_index"]]
        bounds = placement["bounds"]
        origin_u, origin_v = bounds[0], bounds[1]
        off_u = placement["offset_u"]
        off_v = placement["offset_v"]
        rotation = placement["rotation"]

        island_w = bounds[2] - bounds[0]
        island_h = bounds[3] - bounds[1]

        for li, u, v in island["uvs"]:
            # Translate to origin
            lu = u - origin_u
            lv = v - origin_v

            # Rotate
            if rotation == 90:
                lu, lv = lv, island_w - lu
            elif rotation == 180:
                lu, lv = island_w - lu, island_h - lv
            elif rotation == 270:
                lu, lv = island_h - lv, lu

            # Translate to placement position
            uv_layer.data[li].uv[0] = off_u + lu
            uv_layer.data[li].uv[1] = off_v + lv


def generate_svg_layout(placements, islands, layout_meta, scale, output_path):
    """Generate an SVG cutting layout for printing."""
    svg_scale = 500  # pixels per meter
    width = layout_meta["fabric_width"] * svg_scale
    height = layout_meta["roll_length_needed"] * svg_scale

    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">',
        f'<rect width="{width}" height="{height}" fill="#f8f8f8" stroke="#ccc" stroke-width="1"/>',
    ]

    colors = ["#e8d5f5", "#d5e8f5", "#d5f5e8", "#f5e8d5", "#f5d5d5",
              "#d5f5f5", "#e8f5d5", "#f5f5d5"]

    for i, placement in enumerate(placements):
        island = islands[placement["island_index"]]
        bounds = compute_island_bounds(island)
        w = (bounds[2] - bounds[0]) * scale * svg_scale
        h = (bounds[3] - bounds[1]) * scale * svg_scale
        x = placement["offset_u"] * scale * svg_scale
        y = placement["offset_v"] * scale * svg_scale

        if placement["rotation"] in (90, 270):
            w, h = h, w

        color = colors[i % len(colors)]
        lines.append(
            f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" '
            f'fill="{color}" stroke="#666" stroke-width="0.5" rx="2"/>'
        )
        # Label
        cx = x + w / 2
        cy = y + h / 2
        lines.append(
            f'<text x="{cx:.1f}" y="{cy:.1f}" text-anchor="middle" '
            f'dominant-baseline="central" font-size="10" font-family="sans-serif" '
            f'fill="#333">Panel {i+1}</text>'
        )

    # Yield percentage label
    lines.append(
        f'<text x="10" y="{height - 10}" font-size="12" font-family="sans-serif" '
        f'fill="#666">Yield: {layout_meta["yield_percent"]}% | '
        f'Width: {layout_meta["fabric_width"]*100:.0f}cm | '
        f'Length: {layout_meta["roll_length_needed"]*100:.0f}cm</text>'
    )

    lines.append('</svg>')

    with open(output_path, "w") as f:
        f.write("\n".join(lines))


@wrap_main
def uv_pack_nest():
    args = parse_args()

    # Import
    meshes, err = safe_import_glb(args.input)
    if err:
        print(f"[uv_pack_nest] FATAL: {err}")
        sys.exit(1)
    if not meshes:
        print("[uv_pack_nest] FATAL: No mesh objects in GLB")
        sys.exit(1)

    print(f"[uv_pack_nest] Loaded {len(meshes)} mesh(es), "
          f"width={args.fabric_width}m, grain={args.grain_direction}, "
          f"allowance={args.seam_allowance*1000:.0f}mm")

    # Activate flat shape key if available
    for obj in meshes:
        if obj.data.shape_keys:
            for kb in obj.data.shape_keys.key_blocks:
                kb.value = 1.0 if kb.name == "Flat" else 0.0

    # Extract all UV islands across all objects
    all_islands = []
    island_obj_map = []  # (obj, island_local_index) for each global island
    for obj in meshes:
        islands = extract_uv_islands(obj)
        for local_idx, island in enumerate(islands):
            all_islands.append(island)
            island_obj_map.append((obj, local_idx))

    print(f"[uv_pack_nest] Found {len(all_islands)} UV islands total")

    if not all_islands:
        print("[uv_pack_nest] WARNING: No UV islands found — exporting unchanged")
        safe_export_glb(args.output)
        sys.exit(0)

    # Run nesting
    placements, layout_meta = nest_islands_bottom_left(
        all_islands, args.fabric_width, args.seam_allowance,
        args.grain_direction, args.scale
    )

    # Apply new UV positions
    for placement in placements:
        obj, _ = island_obj_map[placement["island_index"]]
        apply_placements_to_uvs(obj, all_islands, [placement], args.scale)

    print(f"[uv_pack_nest] Yield: {layout_meta['yield_percent']}%, "
          f"roll: {layout_meta['roll_length_needed']*100:.0f}cm × "
          f"{layout_meta['fabric_width']*100:.0f}cm")

    # Export GLB
    success, err = safe_export_glb(args.output)
    if not success:
        print(f"[uv_pack_nest] FATAL: Export failed: {err}")
        sys.exit(1)

    # Write sidecar JSON
    meta_path = str(args.output).rsplit(".", 1)[0] + "_nesting_meta.json"
    with open(meta_path, "w") as f:
        json.dump(layout_meta, f, indent=2)

    # Generate SVG cutting layout
    svg_path = str(args.output).rsplit(".", 1)[0] + "_nesting_layout.svg"
    generate_svg_layout(placements, all_islands, layout_meta, args.scale, svg_path)

    print(f"[uv_pack_nest] Done → {args.output} + {meta_path} + {svg_path}")


if __name__ == "__main__":
    uv_pack_nest()
