"""
clean_mesh.py — Import GLB -> optional voxel remesh -> decimate -> SubSurf -> smooth shade -> export
Tuned for HunYuan 3D garment meshes (50K-500K+ noisy triangles).

Error-hardened: modifier application wrapped with safe_modifier_apply,
mesh validity checked before each step.

Pipeline order:
  1. Pre-decimate only if >3x target (noise reduction)
  2. Voxel remesh (converts triangle soup to clean quads)
  3. Final decimate to exact target count
  4. Optional SubSurf (capped at 2)
  5. Smooth shading + auto smooth

Usage: blender --background --python clean_mesh.py -- --input mesh.glb --output cleaned.glb --target_faces 12000 --voxel_size 0.005
"""

import bpy
import sys
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from blender_helpers import (
    safe_op, ensure_mode, check_mesh, safe_modifier_apply,
    log_mesh_stats, safe_import_glb, safe_export_glb, wrap_main,
)


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--target_faces", type=int, default=12000)
    parser.add_argument("--smooth_iterations", type=int, default=1)
    parser.add_argument("--voxel_size", type=float, default=0.005,
                        help="Voxel remesh resolution (smaller = more detail, 0 = skip)")
    parser.add_argument("--use_voxel_remesh", type=str, default="true",
                        help="Enable voxel remesh (true/false)")
    return parser.parse_args(argv)


@wrap_main
def clean():
    args = parse_args()
    use_voxel = args.use_voxel_remesh.lower() in ("true", "1", "yes")

    # Import GLB
    meshes, err = safe_import_glb(args.input)
    if err:
        print(f"[clean_mesh] FATAL: {err}")
        sys.exit(1)

    print(f"[clean_mesh] Found {len(meshes)} mesh object(s)")

    for obj in meshes:
        # Pre-check mesh validity
        ok, reason = check_mesh(obj)
        if not ok:
            print(f"[clean_mesh] Skipping '{obj.name}': {reason}")
            continue

        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)

        original_name = obj.name
        current_faces = len(obj.data.polygons)
        initial_faces = current_faces
        print(f"[clean_mesh] Processing '{obj.name}': {current_faces} faces")

        # ── Step 1: Pre-decimate if way over target (>3x) ──
        if current_faces > args.target_faces * 3:
            pre_target = args.target_faces * 2
            ratio = pre_target / current_faces
            mod = obj.modifiers.new(name="PreDecimate", type="DECIMATE")
            mod.ratio = max(ratio, 0.01)
            if safe_modifier_apply(obj, "PreDecimate", "Pre-decimate"):
                after = len(obj.data.polygons)
                print(f"[clean_mesh]   Pre-decimate: {current_faces} -> {after} faces")
                current_faces = after
            else:
                print(f"[clean_mesh]   Pre-decimate failed, continuing without it")

        # ── Step 2: Voxel Remesh ──
        if use_voxel and args.voxel_size > 0:
            mod = obj.modifiers.new(name="VoxelRemesh", type="REMESH")
            mod.mode = "VOXEL"
            mod.voxel_size = args.voxel_size
            mod.use_smooth_shade = True
            if safe_modifier_apply(obj, "VoxelRemesh", "Voxel remesh"):
                after = len(obj.data.polygons)
                print(f"[clean_mesh]   Voxel remesh (size={args.voxel_size}): {current_faces} -> {after} faces")
                current_faces = after
            else:
                print(f"[clean_mesh]   Voxel remesh failed, continuing with current mesh")

        # ── Step 3: Final decimate to exact target ──
        current_faces = len(obj.data.polygons)
        if current_faces > args.target_faces:
            ratio = args.target_faces / current_faces
            mod = obj.modifiers.new(name="Decimate", type="DECIMATE")
            mod.ratio = max(ratio, 0.01)
            if safe_modifier_apply(obj, "Decimate", "Final decimate"):
                after = len(obj.data.polygons)
                print(f"[clean_mesh]   Final decimate: {current_faces} -> {after} faces")
                current_faces = after
            else:
                print(f"[clean_mesh]   Final decimate failed, mesh may be over target")

        # ── Step 4: Optional SubSurf (capped at 2 levels) ──
        if args.smooth_iterations > 0:
            levels = min(args.smooth_iterations, 2)
            mod = obj.modifiers.new(name="SubSurf", type="SUBSURF")
            mod.levels = levels
            mod.render_levels = levels
            mod.subdivision_type = "CATMULL_CLARK"
            if safe_modifier_apply(obj, "SubSurf", f"SubSurf level {levels}"):
                after = len(obj.data.polygons)
                print(f"[clean_mesh]   SubSurf (level={levels}): {current_faces} -> {after} faces")
            else:
                print(f"[clean_mesh]   SubSurf failed, skipping")

        # ── Step 5: Smooth shading ──
        ensure_mode("OBJECT")
        safe_op(bpy.ops.object.shade_smooth, description="Apply smooth shading")

        # Auto smooth angle
        try:
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
        except (RuntimeError, AttributeError):
            pass

        # Final stats
        final_faces = len(obj.data.polygons)
        final_verts = len(obj.data.vertices)
        print(f"[clean_mesh]   Final: {final_verts} verts, {final_faces} faces "
              f"(was {initial_faces} faces)")

        # Restore name
        obj.name = original_name
        obj.select_set(False)

    # Export
    success, err = safe_export_glb(args.output)
    if not success:
        print(f"[clean_mesh] FATAL: Export failed: {err}")
        sys.exit(1)

    print(f"[clean_mesh] Exported to {args.output}")


if __name__ == "__main__":
    clean()
