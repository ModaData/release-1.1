"""
subdivide_mesh.py — Import GLB -> apply Subdivision Surface modifier -> export
Error-hardened: safe_modifier_apply + mesh validation.

Usage: blender --background --python subdivide_mesh.py -- --input mesh.glb --output subdivided.glb --levels 1
"""

import bpy
import sys
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
    parser.add_argument("--levels", type=int, default=2,
                        help="Subdivision levels (1-3)")
    parser.add_argument("--method", default="catmull_clark",
                        choices=["catmull_clark", "simple"],
                        help="Subdivision method: catmull_clark (smooth) or simple (flat)")
    parser.add_argument("--crease_seams", default="true",
                        help="Mark seam edges with crease=1.0 before subdividing "
                             "to keep them sharp (true/false)")
    return parser.parse_args(argv)


@wrap_main
def subdivide():
    args = parse_args()
    levels = max(1, min(args.levels, 3))
    use_catmull_clark = args.method == "catmull_clark"
    crease_seams = args.crease_seams.lower() not in ("false", "0", "no")

    # Import GLB
    meshes, err = safe_import_glb(args.input)
    if err:
        print(f"[subdivide] FATAL: {err}")
        sys.exit(1)

    for obj in meshes:
        ok, reason = check_mesh(obj)
        if not ok:
            print(f"[subdivide] Skipping '{obj.name}': {reason}")
            continue

        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)

        original_name = obj.name
        original_faces = len(obj.data.polygons)

        # ── Crease seam edges so they stay sharp after Catmull-Clark ──
        if use_catmull_clark and crease_seams:
            seam_count = 0
            for edge in obj.data.edges:
                if edge.use_seam:
                    edge.crease = 1.0
                    seam_count += 1
            if seam_count > 0:
                print(f"[subdivide] Creased {seam_count} seam edge(s) on '{obj.name}' "
                      f"(will stay sharp after subdivision)")

        mod = obj.modifiers.new(name="Subdivide", type="SUBSURF")
        mod.subdivision_type = "CATMULL_CLARK" if use_catmull_clark else "SIMPLE"
        mod.levels = levels
        mod.render_levels = levels

        if safe_modifier_apply(obj, "Subdivide", f"Subdivision Surface level {levels}"):
            new_faces = len(obj.data.polygons)
            print(f"[subdivide] '{obj.name}': {original_faces} → {new_faces} faces "
                  f"(level {levels}, method={args.method}, crease_seams={crease_seams})")
        else:
            print(f"[subdivide] WARNING: SubSurf failed for '{obj.name}'")

        ensure_mode("OBJECT")
        safe_op(bpy.ops.object.shade_smooth, description="Apply smooth shading")

        obj.name = original_name
        obj.select_set(False)

    # Export
    success, err = safe_export_glb(args.output)
    if not success:
        print(f"[subdivide] FATAL: Export failed: {err}")
        sys.exit(1)

    print(f"[subdivide] Exported to {args.output}")


if __name__ == "__main__":
    subdivide()
