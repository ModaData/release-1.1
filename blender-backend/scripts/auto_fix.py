"""
auto_fix.py — One-click pipeline: repair -> voxel remesh -> smooth (no intermediate I/O)
Chains the three most important operations in correct order for HunYuan 3D meshes.

Error-hardened: every phase wrapped in try/except, modifiers use safe_modifier_apply,
mesh validated before each phase.

Quality presets:
  fast     — merge=0.002, 8K faces,  voxel=0.008, smooth=0.2 x1
  standard — merge=0.001, 12K faces, voxel=0.005, smooth=0.3 x2
  high     — merge=0.0005, 20K faces, voxel=0.003, smooth=0.2 x2

Usage: blender --background --python auto_fix.py -- --input mesh.glb --output fixed.glb --quality standard
"""

import bpy
import bmesh
import sys
import math
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from blender_helpers import (
    safe_op, ensure_mode, check_mesh, safe_modifier_apply,
    safe_import_glb, safe_export_glb, wrap_main,
)


QUALITY_PRESETS = {
    "fast": {
        "merge_threshold": 0.002,
        "target_faces": 8000,
        "voxel_size": 0.008,
        "smooth_factor": 0.2,
        "smooth_iterations": 1,
    },
    "standard": {
        "merge_threshold": 0.001,
        "target_faces": 12000,
        "voxel_size": 0.005,
        "smooth_factor": 0.3,
        "smooth_iterations": 2,
    },
    "high": {
        "merge_threshold": 0.0005,
        "target_faces": 20000,
        "voxel_size": 0.003,
        "smooth_factor": 0.2,
        "smooth_iterations": 2,
    },
}


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--quality", default="standard",
                        choices=list(QUALITY_PRESETS.keys()),
                        help="Quality preset: fast, standard, high")
    return parser.parse_args(argv)


@wrap_main
def auto_fix():
    args = parse_args()
    preset = QUALITY_PRESETS[args.quality]

    print(f"[auto_fix] Quality: {args.quality}")
    print(f"[auto_fix] Params: {preset}")

    # Import GLB
    meshes, err = safe_import_glb(args.input)
    if err:
        print(f"[auto_fix] FATAL: {err}")
        sys.exit(1)

    print(f"[auto_fix] Found {len(meshes)} mesh object(s)")

    for obj in meshes:
        # Pre-check
        ok, reason = check_mesh(obj)
        if not ok:
            print(f"[auto_fix] Skipping '{obj.name}': {reason}")
            continue

        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)

        original_name = obj.name
        initial_faces = len(obj.data.polygons)
        initial_verts = len(obj.data.vertices)
        print(f"[auto_fix] Processing '{obj.name}': {initial_verts} verts, {initial_faces} faces")

        # ═══════════════════════════════════════════
        # PHASE 1: REPAIR
        # ═══════════════════════════════════════════
        ensure_mode("EDIT")

        # 1a. Merge duplicate vertices
        safe_op(bpy.ops.mesh.select_all, action="SELECT", description="Select all")
        safe_op(bpy.ops.mesh.remove_doubles, threshold=preset["merge_threshold"],
                description=f"Merge by distance ({preset['merge_threshold']})")

        # 1b. Delete loose geometry
        safe_op(bpy.ops.mesh.select_all, action="DESELECT", description="Deselect all")
        safe_op(bpy.ops.mesh.select_loose, description="Select loose geometry")
        safe_op(bpy.ops.mesh.delete, type="VERT", description="Delete loose verts")

        # 1c. Dissolve degenerate faces
        safe_op(bpy.ops.mesh.select_all, action="SELECT", description="Select all")
        safe_op(bpy.ops.mesh.dissolve_degenerate, threshold=0.001,
                description="Dissolve degenerate faces")

        # 1d. Fill holes
        safe_op(bpy.ops.mesh.select_all, action="DESELECT", description="Deselect all")
        safe_op(bpy.ops.mesh.select_non_manifold,
                extend=False, use_wire=True, use_boundary=True,
                use_multi_face=False, use_non_contiguous=False, use_verts=False,
                description="Select non-manifold boundary")

        if not safe_op(bpy.ops.mesh.fill_grid, description="Grid fill holes"):
            if not safe_op(bpy.ops.mesh.fill, description="Basic fill holes"):
                print(f"[auto_fix]   No holes to fill")

        # 1e. Post-fill smoothing
        safe_op(bpy.ops.mesh.select_all, action="SELECT", description="Select all")
        safe_op(bpy.ops.mesh.vertices_smooth, factor=0.5, repeat=2,
                description="Post-fill vertex smoothing")

        # 1f. Recalculate normals
        safe_op(bpy.ops.mesh.normals_make_consistent, inside=False,
                description="Recalculate normals")

        # 1g. Final cleanup merge
        safe_op(bpy.ops.mesh.remove_doubles, threshold=preset["merge_threshold"],
                description="Final cleanup merge")

        ensure_mode("OBJECT")

        repaired_faces = len(obj.data.polygons)
        print(f"[auto_fix]   After repair: {repaired_faces} faces")

        # ═══════════════════════════════════════════
        # PHASE 2: REMESH
        # ═══════════════════════════════════════════

        # 2a. Pre-decimate if way over target
        current_faces = len(obj.data.polygons)
        if current_faces > preset["target_faces"] * 3:
            pre_target = preset["target_faces"] * 2
            ratio = pre_target / current_faces
            mod = obj.modifiers.new(name="PreDecimate", type="DECIMATE")
            mod.ratio = max(ratio, 0.01)
            if safe_modifier_apply(obj, "PreDecimate", "Pre-decimate"):
                print(f"[auto_fix]   Pre-decimate: {current_faces} -> {len(obj.data.polygons)}")

        # 2b. Voxel remesh
        mod = obj.modifiers.new(name="VoxelRemesh", type="REMESH")
        mod.mode = "VOXEL"
        mod.voxel_size = preset["voxel_size"]
        mod.use_smooth_shade = True
        if safe_modifier_apply(obj, "VoxelRemesh", "Voxel remesh"):
            remeshed_faces = len(obj.data.polygons)
            print(f"[auto_fix]   Voxel remesh (size={preset['voxel_size']}): -> {remeshed_faces} faces")
        else:
            print(f"[auto_fix]   Voxel remesh failed, continuing with current mesh")

        # 2c. Final decimate to target
        current_faces = len(obj.data.polygons)
        if current_faces > preset["target_faces"]:
            ratio = preset["target_faces"] / current_faces
            mod = obj.modifiers.new(name="Decimate", type="DECIMATE")
            mod.ratio = max(ratio, 0.01)
            if safe_modifier_apply(obj, "Decimate", "Final decimate"):
                print(f"[auto_fix]   Decimate: {current_faces} -> {len(obj.data.polygons)} faces")

        # ═══════════════════════════════════════════
        # PHASE 3: SMOOTH
        # ═══════════════════════════════════════════

        # 3a. Laplacian smooth
        mod = obj.modifiers.new(name="LaplacianSmooth", type="LAPLACIANSMOOTH")
        mod.iterations = preset["smooth_iterations"]
        mod.lambda_factor = preset["smooth_factor"]
        mod.lambda_border = 0.1
        mod.use_volume_preserve = True
        mod.use_normalized = True
        if safe_modifier_apply(obj, "LaplacianSmooth", "Laplacian Smooth"):
            print(f"[auto_fix]   Laplacian smooth: factor={preset['smooth_factor']}, "
                  f"iter={preset['smooth_iterations']}")

        # 3b. Corrective smooth
        mod = obj.modifiers.new(name="CorrectiveSmooth", type="CORRECTIVE_SMOOTH")
        mod.iterations = 5
        mod.scale = 0.8
        mod.smooth_type = "LENGTH_WEIGHTED"
        mod.use_pin_boundary = True
        safe_modifier_apply(obj, "CorrectiveSmooth", "Corrective Smooth")

        # 3c. Smooth shading
        ensure_mode("OBJECT")
        safe_op(bpy.ops.object.shade_smooth, description="Apply smooth shading")

        final_faces = len(obj.data.polygons)
        final_verts = len(obj.data.vertices)
        print(f"[auto_fix]   Final: {final_verts} verts, {final_faces} faces")
        print(f"[auto_fix]   Reduction: {initial_faces} -> {final_faces} faces "
              f"({(1 - final_faces/max(initial_faces, 1))*100:.0f}% reduction)")

        obj.name = original_name
        obj.select_set(False)

    # Export
    success, err = safe_export_glb(args.output)
    if not success:
        print(f"[auto_fix] FATAL: Export failed: {err}")
        sys.exit(1)

    print(f"[auto_fix] Exported to {args.output}")


if __name__ == "__main__":
    auto_fix()
