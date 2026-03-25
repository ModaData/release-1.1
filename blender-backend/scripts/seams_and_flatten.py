"""
seams_and_flatten.py — Atomic seam marking + shape-key flatten in one Blender call.

Combines set_seams.py (Phase 1: mark edges + re-unwrap) and flatten_pattern.py
(Phase 2: Basis + Flat shape keys) into a single subprocess call, cutting the
round-trip time for the split-view seam editor from ~40s to ~20s.

Handles three input states gracefully:
  1. Plain assembled GLB (no shape keys)        → adds Basis + Flat
  2. Cloth-sim GLB ("Basis" + "Draped" keys)    → adds Flat as 3rd key
  3. Previously flattened GLB (stale "Flat" key) → removes old Flat, re-adds fresh

Usage:
  blender --background --python seams_and_flatten.py -- \\
    --input assembled.glb --output seamed_flat.glb \\
    --edge_indices '[12, 45, 78]' [--operation mark|unmark] \\
    [--object_name collar_v1] [--scale 1.0] [--join]
"""

import bpy
import sys
import json
import argparse
from pathlib import Path
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).parent))
from blender_helpers import safe_import_glb, safe_export_glb, wrap_main


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input",        required=True)
    parser.add_argument("--output",       required=True)
    parser.add_argument("--edge_indices", required=True,
                        help="JSON list of edge indices to mark/unmark")
    parser.add_argument("--operation",    default="mark", choices=["mark", "unmark"])
    parser.add_argument("--object_name",  default=None,
                        help="Target only this mesh object (default: all mesh objects)")
    parser.add_argument("--scale",        type=float, default=1.0,
                        help="Scale factor for flat pattern (1.0 = real-world meters)")
    parser.add_argument("--join",         action="store_true",
                        help="Join all parts before flattening (techpack mode)")
    return parser.parse_args(argv)


# ─────────────────────────────────────────────────────────────────────────────
# Phase 1 helpers (from set_seams.py)
# ─────────────────────────────────────────────────────────────────────────────

def _apply_seams_and_unwrap(obj, edge_indices, mark_as_seam):
    """Mark/unmark edges, then re-run ANGLE_BASED UV unwrap."""
    mesh = obj.data
    modified = 0
    for idx in edge_indices:
        if 0 <= idx < len(mesh.edges):
            mesh.edges[idx].use_seam = mark_as_seam
            modified += 1
        else:
            print(f"[seams_and_flatten] WARNING: Edge {idx} out of range for "
                  f"'{obj.name}' ({len(mesh.edges)} edges)")

    print(f"[seams_and_flatten] {'Mark' if mark_as_seam else 'Unmark'}ed "
          f"{modified} edges on '{obj.name}'")

    if modified > 0:
        try:
            bpy.context.view_layer.objects.active = obj
            obj.select_set(True)
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.select_all(action="SELECT")
            bpy.ops.uv.unwrap(method="ANGLE_BASED", margin=0.02)
            bpy.ops.object.mode_set(mode="OBJECT")
            obj.select_set(False)
            print(f"[seams_and_flatten] Re-ran UV unwrap for '{obj.name}'")
        except Exception as e:
            print(f"[seams_and_flatten] WARNING: UV re-unwrap failed for '{obj.name}': {e}")
            try:
                bpy.ops.object.mode_set(mode="OBJECT")
            except Exception:
                pass

    return modified


# ─────────────────────────────────────────────────────────────────────────────
# Phase 2 helpers (from flatten_pattern.py)
# ─────────────────────────────────────────────────────────────────────────────

def _ensure_uv_layer(obj):
    mesh = obj.data
    if not mesh.uv_layers:
        return None
    return mesh.uv_layers.active


def _get_vertex_uv_centers(obj):
    """Average all UV loops per vertex → dict: vertex_index → (u, v)."""
    mesh = obj.data
    uv_layer = _ensure_uv_layer(obj)
    if uv_layer is None:
        return {}

    uv_accum = {}
    for poly in mesh.polygons:
        for loop_idx in poly.loop_indices:
            v_idx = mesh.loops[loop_idx].vertex_index
            uv = uv_layer.data[loop_idx].uv
            if v_idx not in uv_accum:
                uv_accum[v_idx] = [0.0, 0.0, 0]
            uv_accum[v_idx][0] += uv.x
            uv_accum[v_idx][1] += uv.y
            uv_accum[v_idx][2] += 1

    return {v: (su / cnt, sv / cnt) for v, (su, sv, cnt) in uv_accum.items() if cnt > 0}


def _add_flat_shape_key(obj, scale):
    """
    Add (or replace) the 'Flat' shape key on obj.
    Respects existing shape keys ('Basis', 'Draped') — does NOT duplicate them.
    Returns True on success.
    """
    mesh = obj.data

    uv_map = _get_vertex_uv_centers(obj)
    if not uv_map:
        print(f"[seams_and_flatten] WARNING: No UV data on '{obj.name}', skipping")
        return False

    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)

    # Collect existing shape key names
    existing_keys = []
    if mesh.shape_keys:
        existing_keys = [kb.name for kb in mesh.shape_keys.key_blocks]

    # Add 'Basis' only if not already present
    if "Basis" not in existing_keys:
        bpy.ops.object.shape_key_add(from_mix=False)
        mesh.shape_keys.key_blocks[-1].name = "Basis"
        print(f"[seams_and_flatten] Added 'Basis' shape key to '{obj.name}'")

    # Remove stale 'Flat' key if re-running after seam change
    if "Flat" in existing_keys:
        flat_kb = mesh.shape_keys.key_blocks.get("Flat")
        if flat_kb:
            obj.shape_key_remove(flat_kb)
            print(f"[seams_and_flatten] Removed stale 'Flat' key from '{obj.name}'")

    # Add fresh 'Flat' shape key
    bpy.ops.object.shape_key_add(from_mix=False)
    flat_key = mesh.shape_keys.key_blocks[-1]
    flat_key.name = "Flat"
    flat_key.value = 0.0  # Start at 0 (3D / draped state)

    # Compute UV-space → real-world scale
    all_u = [uv[0] for uv in uv_map.values()]
    all_v = [uv[1] for uv in uv_map.values()]
    if not all_u:
        obj.select_set(False)
        return False

    u_range = max(all_u) - min(all_u) or 1.0
    v_range = max(all_v) - min(all_v) or 1.0

    bb = obj.bound_box
    world_bb = [obj.matrix_world @ Vector(c) for c in bb]
    obj_height = max(v.y for v in world_bb) - min(v.y for v in world_bb)
    obj_width  = max(v.x for v in world_bb) - min(v.x for v in world_bb)

    uv_to_m_x = (obj_width  / u_range) * scale
    uv_to_m_y = (obj_height / v_range) * scale

    # Set Flat vertex positions from UV
    for v_idx, (u, v) in uv_map.items():
        flat_key.data[v_idx].co.x = u * uv_to_m_x
        flat_key.data[v_idx].co.y = v * uv_to_m_y
        flat_key.data[v_idx].co.z = 0.0

    # Vertices with no UV data: project flat at their current XY, z=0
    for v_idx in range(len(mesh.vertices)):
        if v_idx not in uv_map:
            orig = mesh.vertices[v_idx].co
            flat_key.data[v_idx].co.x = orig.x
            flat_key.data[v_idx].co.y = orig.y
            flat_key.data[v_idx].co.z = 0.0

    obj.select_set(False)
    all_keys = [kb.name for kb in mesh.shape_keys.key_blocks]
    print(f"[seams_and_flatten] Shape keys on '{obj.name}': {all_keys} "
          f"({len(uv_map)} UV-mapped verts)")
    return True


def _mark_boundary_seams_for_join(objs):
    """Mark inter-part boundary edges as seams before joining."""
    for obj in objs:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="DESELECT")
        bpy.ops.mesh.select_non_manifold(extend=False, use_wire=False,
                                          use_boundary=True, use_multi_face=False,
                                          use_non_contiguous=False, use_verts=False)
        bpy.ops.mesh.mark_seam(clear=False)
        bpy.ops.object.mode_set(mode="OBJECT")
        obj.select_set(False)


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

@wrap_main
def seams_and_flatten():
    args = parse_args()

    # Parse edge indices
    try:
        edge_indices = json.loads(args.edge_indices)
        if not isinstance(edge_indices, list):
            raise ValueError("edge_indices must be a JSON array")
    except (json.JSONDecodeError, ValueError) as e:
        print(f"[seams_and_flatten] FATAL: Invalid --edge_indices: {e}")
        sys.exit(1)

    mark_as_seam = args.operation == "mark"

    # ── Import ────────────────────────────────────────────────────────────────
    meshes, err = safe_import_glb(args.input)
    if err:
        print(f"[seams_and_flatten] FATAL: {err}")
        sys.exit(1)
    if not meshes:
        print("[seams_and_flatten] FATAL: No mesh objects in GLB")
        sys.exit(1)

    print(f"[seams_and_flatten] Loaded {len(meshes)} mesh object(s)")

    # ── Determine targets ─────────────────────────────────────────────────────
    if args.object_name:
        targets = [o for o in meshes if o.name == args.object_name]
        if not targets:
            print(f"[seams_and_flatten] WARNING: '{args.object_name}' not found; "
                  f"applying to all {len(meshes)} objects")
            targets = meshes
    else:
        targets = meshes

    # ── Phase 1: Apply seams + re-unwrap ─────────────────────────────────────
    total_modified = 0
    for obj in targets:
        total_modified += _apply_seams_and_unwrap(obj, edge_indices, mark_as_seam)

    print(f"[seams_and_flatten] Phase 1 complete: {total_modified} edge(s) modified")

    # ── Ensure UV layers exist (fallback smart project) ───────────────────────
    for obj in targets:
        if not obj.data.uv_layers:
            print(f"[seams_and_flatten] WARNING: '{obj.name}' has no UV — running smart project")
            bpy.context.view_layer.objects.active = obj
            obj.select_set(True)
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.select_all(action="SELECT")
            bpy.ops.uv.smart_project(angle_limit=66.0, margin_method="SCALED",
                                      island_margin=0.02)
            bpy.ops.object.mode_set(mode="OBJECT")
            obj.select_set(False)

    # ── Optional join (techpack mode) ─────────────────────────────────────────
    if args.join and len(targets) > 1:
        _mark_boundary_seams_for_join(targets)

        bpy.ops.object.select_all(action="DESELECT")
        for obj in targets:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = targets[0]
        bpy.ops.object.join()

        joined = bpy.context.view_layer.objects.active
        joined.name = "GarmentPattern"
        print(f"[seams_and_flatten] Joined {len(targets)} objects → '{joined.name}'")

        # Re-unwrap joined mesh with inter-part boundary seams
        bpy.context.view_layer.objects.active = joined
        joined.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.unwrap(method="ANGLE_BASED", margin=0.02)
        bpy.ops.object.mode_set(mode="OBJECT")
        joined.select_set(False)

        target_objs = [joined]
    else:
        target_objs = targets

    # ── Phase 2: Add / update Flat shape key ──────────────────────────────────
    success_count = 0
    for obj in target_objs:
        if _add_flat_shape_key(obj, args.scale):
            success_count += 1

    if success_count == 0:
        print("[seams_and_flatten] FATAL: No objects received Flat shape key (UV data missing?)")
        sys.exit(1)

    print(f"[seams_and_flatten] Phase 2 complete: Flat shape key added to "
          f"{success_count}/{len(target_objs)} object(s)")

    # ── Export ────────────────────────────────────────────────────────────────
    success, err = safe_export_glb(args.output)
    if not success:
        print(f"[seams_and_flatten] FATAL: Export failed: {err}")
        sys.exit(1)

    print(f"[seams_and_flatten] Exported to {args.output}")

    # ── Metadata sidecar ──────────────────────────────────────────────────────
    shape_key_names = []
    if target_objs and target_objs[0].data.shape_keys:
        shape_key_names = [kb.name for kb in target_objs[0].data.shape_keys.key_blocks]

    meta = {
        "objects":      [o.name for o in target_objs],
        "shape_keys":   shape_key_names,
        "seam_indices": edge_indices,
        "operation":    args.operation,
        "scale":        args.scale,
        "joined":       args.join,
    }
    meta_path = str(args.output).rsplit(".", 1)[0] + "_pattern_meta.json"
    try:
        import json as _json
        with open(meta_path, "w") as f:
            _json.dump(meta, f, indent=2)
        print(f"[seams_and_flatten] Metadata written to {meta_path}")
    except Exception as e:
        print(f"[seams_and_flatten] WARNING: Could not write metadata: {e}")


if __name__ == "__main__":
    seams_and_flatten()
