"""
flatten_pattern.py — Morph UV: 3D garment → flat sewing patterns via shape keys.

Takes an assembled GLB (with UV maps already baked in by garment_builder.py),
adds two shape keys per mesh object:
  "Basis"  — original 3D garment position
  "Flat"   — vertex positions projected to UV coordinates (Z=0 plane, 1:1 real-world scale)

The resulting GLB contains morphTargetInfluences that the frontend slider drives from
0 (3D garment) to 1 (flat sewing panel). Each garment part unfolds as a separate
panel corresponding to its seam-bounded UV island.

Seam-preserving join mode (--join):
  Joins all part objects into a single mesh before morphing, but preserves seam marks
  at part boundaries so each part still unfolds as a separate flat panel.

Usage:
  blender --background --python flatten_pattern.py -- \\
    --input assembled.glb --output pattern.glb [--join] [--scale 1.0]
"""

import bpy
import sys
import math
import argparse
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from blender_helpers import safe_import_glb, safe_export_glb, wrap_main


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--join", action="store_true",
                        help="Join all parts into one mesh before flattening (multi-piece techpack)")
    parser.add_argument("--scale", type=float, default=1.0,
                        help="Scale factor for flat pattern (1.0 = real-world meters)")
    return parser.parse_args(argv)


def _ensure_uv_layer(obj):
    """Return the active UV layer data, or None if absent."""
    mesh = obj.data
    if not mesh.uv_layers:
        return None
    uv_layer = mesh.uv_layers.active
    if uv_layer is None:
        return None
    return uv_layer


def _get_vertex_uv_centers(obj):
    """
    Build a per-vertex UV position map by averaging all UV loops for each vertex.
    Returns a dict: vertex_index → (u, v) average.
    """
    mesh = obj.data
    uv_layer = _ensure_uv_layer(obj)
    if uv_layer is None:
        return {}

    uv_accum = {}   # vertex_index → [sum_u, sum_v, count]

    for poly in mesh.polygons:
        for loop_idx in poly.loop_indices:
            vert_idx = mesh.loops[loop_idx].vertex_index
            uv = uv_layer.data[loop_idx].uv
            if vert_idx not in uv_accum:
                uv_accum[vert_idx] = [0.0, 0.0, 0]
            uv_accum[vert_idx][0] += uv.x
            uv_accum[vert_idx][1] += uv.y
            uv_accum[vert_idx][2] += 1

    result = {}
    for v_idx, (su, sv, cnt) in uv_accum.items():
        if cnt > 0:
            result[v_idx] = (su / cnt, sv / cnt)
    return result


def _add_flatten_shape_keys(obj, scale):
    """
    Add 'Basis' and 'Flat' shape keys to obj.
    'Flat' maps each vertex to (uv.x * scale, uv.y * scale, 0.0).
    Returns True on success.
    """
    mesh = obj.data

    uv_map = _get_vertex_uv_centers(obj)
    if not uv_map:
        print(f"[flatten_pattern] WARNING: No UV data on '{obj.name}', skipping")
        return False

    # Activate object for shape key operations
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)

    # Add shape key basis (captures current 3D positions)
    bpy.ops.object.shape_key_add(from_mix=False)
    mesh.shape_keys.key_blocks[-1].name = "Basis"

    # Add Flat shape key
    bpy.ops.object.shape_key_add(from_mix=False)
    flat_key = mesh.shape_keys.key_blocks[-1]
    flat_key.name = "Flat"
    flat_key.value = 0.0  # Start at 0 (3D state)

    # Compute UV-space bounding box to determine scale factor
    all_u = [uv[0] for uv in uv_map.values()]
    all_v = [uv[1] for uv in uv_map.values()]
    if not all_u:
        obj.select_set(False)
        return False

    u_range = max(all_u) - min(all_u) or 1.0
    v_range = max(all_v) - min(all_v) or 1.0

    # Infer real-world scale from object bounding box
    # (1 Blender unit = 1m; UV space [0,1] → real garment dimensions)
    bb = obj.bound_box
    from mathutils import Vector
    world_bb = [obj.matrix_world @ Vector(c) for c in bb]
    obj_height = max(v.y for v in world_bb) - min(v.y for v in world_bb)
    obj_width  = max(v.x for v in world_bb) - min(v.x for v in world_bb)

    # Map UV [0,1] to real-world meters (keep aspect ratio)
    uv_to_m_x = (obj_width / u_range) * scale
    uv_to_m_y = (obj_height / v_range) * scale

    # Set Flat shape key vertex positions
    for v_idx, (u, v) in uv_map.items():
        flat_key.data[v_idx].co.x = u * uv_to_m_x
        flat_key.data[v_idx].co.y = v * uv_to_m_y
        flat_key.data[v_idx].co.z = 0.0

    # Fill any vertices with no UV data (keep in place at z=0)
    for v_idx in range(len(mesh.vertices)):
        if v_idx not in uv_map:
            orig = mesh.vertices[v_idx].co
            flat_key.data[v_idx].co.x = orig.x
            flat_key.data[v_idx].co.y = orig.y
            flat_key.data[v_idx].co.z = 0.0

    obj.select_set(False)
    print(f"[flatten_pattern] Added shape keys to '{obj.name}' "
          f"({len(uv_map)} UV-mapped verts)")
    return True


def _mark_boundary_seams_for_join(objs):
    """
    Before joining, mark edges at inter-part boundaries as seams
    so each part's UV island is preserved after the join.
    Boundary edges (edges with only one adjacent face in the object) are seams by definition.
    """
    for obj in objs:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="DESELECT")
        bpy.ops.mesh.select_non_manifold(extend=False, use_wire=False,
                                          use_boundary=True, use_multi_face=False,
                                          use_non_contiguous=False, use_verts=False)
        # Mark selected boundary edges as seams
        bpy.ops.mesh.mark_seam(clear=False)
        bpy.ops.object.mode_set(mode="OBJECT")
        obj.select_set(False)


@wrap_main
def flatten():
    args = parse_args()

    # Import GLB
    meshes, err = safe_import_glb(args.input)
    if err:
        print(f"[flatten_pattern] FATAL: {err}")
        sys.exit(1)

    if not meshes:
        print("[flatten_pattern] FATAL: No mesh objects found in GLB")
        sys.exit(1)

    print(f"[flatten_pattern] Loaded {len(meshes)} mesh object(s)")

    # Ensure all objects have UV layers (run unwrap if missing)
    for obj in meshes:
        if not obj.data.uv_layers:
            print(f"[flatten_pattern] WARNING: '{obj.name}' has no UV layer — running smart project")
            bpy.context.view_layer.objects.active = obj
            obj.select_set(True)
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.select_all(action="SELECT")
            bpy.ops.uv.smart_project(angle_limit=66.0, margin_method="SCALED",
                                      island_margin=0.02)
            bpy.ops.object.mode_set(mode="OBJECT")
            obj.select_set(False)

    if args.join and len(meshes) > 1:
        # Mark boundary edges as seams before joining
        _mark_boundary_seams_for_join(meshes)

        # Join all objects
        bpy.ops.object.select_all(action="DESELECT")
        for obj in meshes:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.join()

        joined_obj = bpy.context.view_layer.objects.active
        joined_obj.name = "GarmentPattern"
        print(f"[flatten_pattern] Joined into: {joined_obj.name}")

        # Re-run UV unwrap on joined mesh (seams now include inter-part boundaries)
        bpy.context.view_layer.objects.active = joined_obj
        joined_obj.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.unwrap(method="ANGLE_BASED", margin=0.02)
        bpy.ops.object.mode_set(mode="OBJECT")
        joined_obj.select_set(False)

        target_objs = [joined_obj]
    else:
        target_objs = meshes

    # Add shape keys to each target object
    success_count = 0
    for obj in target_objs:
        if _add_flatten_shape_keys(obj, args.scale):
            success_count += 1

    if success_count == 0:
        print("[flatten_pattern] FATAL: No objects received shape keys (UV data missing?)")
        sys.exit(1)

    print(f"[flatten_pattern] Added Flat shape key to {success_count} object(s)")

    # Export
    success, err = safe_export_glb(args.output)
    if not success:
        print(f"[flatten_pattern] FATAL: Export failed: {err}")
        sys.exit(1)

    print(f"[flatten_pattern] Exported pattern GLB to {args.output}")

    # Write metadata JSON for the frontend
    meta = {
        "objects": [obj.name for obj in target_objs],
        "shape_keys": ["Basis", "Flat"],
        "scale": args.scale,
        "joined": args.join,
    }
    meta_path = str(args.output).rsplit(".", 1)[0] + "_pattern_meta.json"
    try:
        import json as json_mod
        with open(meta_path, "w") as f:
            json_mod.dump(meta, f, indent=2)
        print(f"[flatten_pattern] Metadata written to {meta_path}")
    except Exception as e:
        print(f"[flatten_pattern] WARNING: Could not write metadata: {e}")


if __name__ == "__main__":
    flatten()
