"""
smooth_mesh.py — Import GLB -> Laplacian Smooth -> Corrective Smooth -> auto smooth angle -> export
Tuned for garment meshes: preserves seam ridges and folds.

Error-hardened: modifier application uses safe_modifier_apply,
mesh validated before processing.

Usage: blender --background --python smooth_mesh.py -- --input mesh.glb --output smoothed.glb --iterations 2 --factor 0.3
"""

import bpy
import sys
import math
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from blender_helpers import (
    safe_op, ensure_mode, check_mesh, safe_modifier_apply,
    safe_import_glb, safe_export_glb, wrap_main,
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
    parser.add_argument("--iterations", type=int, default=2,
                        help="Smooth iterations (1-10)")
    parser.add_argument("--factor", type=float, default=0.3,
                        help="Smooth strength factor (0.0-2.0)")
    parser.add_argument("--preserve_borders", type=float, default=0.1,
                        help="Border smoothing factor (lower = more preserved, 0.0-1.0)")
    return parser.parse_args(argv)


@wrap_main
def smooth():
    args = parse_args()
    iterations = max(1, min(args.iterations, 10))
    factor = max(0.0, min(args.factor, 2.0))
    border_factor = max(0.0, min(args.preserve_borders, 1.0))

    # Import GLB
    meshes, err = safe_import_glb(args.input)
    if err:
        print(f"[smooth] FATAL: {err}")
        sys.exit(1)

    print(f"[smooth] Found {len(meshes)} mesh object(s)")

    for obj in meshes:
        # Pre-check
        ok, reason = check_mesh(obj)
        if not ok:
            print(f"[smooth] Skipping '{obj.name}': {reason}")
            continue

        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)

        original_name = obj.name
        vertex_count = len(obj.data.vertices)

        # ── Laplacian Smooth ──
        mod = obj.modifiers.new(name="LaplacianSmooth", type="LAPLACIANSMOOTH")
        mod.iterations = iterations
        mod.lambda_factor = factor
        mod.lambda_border = border_factor
        mod.use_volume_preserve = True
        mod.use_normalized = True
        if safe_modifier_apply(obj, "LaplacianSmooth", "Laplacian Smooth"):
            print(f"[smooth]   Laplacian smooth applied: iter={iterations}, factor={factor:.2f}")
        else:
            print(f"[smooth]   Laplacian smooth failed, trying corrective smooth only")

        # ── Corrective Smooth ──
        mod2 = obj.modifiers.new(name="CorrectiveSmooth", type="CORRECTIVE_SMOOTH")
        mod2.iterations = 5
        mod2.scale = 0.8
        mod2.smooth_type = "LENGTH_WEIGHTED"
        mod2.use_pin_boundary = True
        if safe_modifier_apply(obj, "CorrectiveSmooth", "Corrective Smooth"):
            print(f"[smooth]   Corrective smooth applied")
        else:
            print(f"[smooth]   Corrective smooth failed")

        # ── Smooth shading ──
        ensure_mode("OBJECT")
        safe_op(bpy.ops.object.shade_smooth, description="Apply smooth shading")

        # Auto smooth angle
        try:
            obj.data.use_auto_smooth = True
            obj.data.auto_smooth_angle = math.radians(60)
        except AttributeError:
            pass

        print(f"[smooth] {obj.name}: {vertex_count} vertices, "
              f"{iterations} iterations, factor={factor:.2f}, "
              f"border={border_factor:.2f}")

        obj.name = original_name
        obj.select_set(False)

    # Export
    success, err = safe_export_glb(args.output)
    if not success:
        print(f"[smooth] FATAL: Export failed: {err}")
        sys.exit(1)

    print(f"[smooth] Exported to {args.output}")


if __name__ == "__main__":
    smooth()
