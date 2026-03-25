"""
resize_parametric.py — Shape-key driven S->XXL parametric scaling
Error-hardened: safe_import_glb + safe_export_glb + mesh validation.

Usage: blender --background --python resize_parametric.py -- --input garment.glb --output resized.glb --size L
"""

import bpy
import sys
import argparse
from pathlib import Path
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).parent))
from blender_helpers import (
    safe_op, ensure_mode, check_mesh,
    safe_import_glb, safe_export_glb, wrap_main,
)


# Non-uniform scale factors: (chest_width, height, shoulder_width)
SIZE_PARAMS = {
    "XS": {"chest": 0.90, "height": 0.97, "shoulder": 0.92},
    "S":  {"chest": 0.95, "height": 0.98, "shoulder": 0.96},
    "M":  {"chest": 1.00, "height": 1.00, "shoulder": 1.00},
    "L":  {"chest": 1.06, "height": 1.02, "shoulder": 1.04},
    "XL": {"chest": 1.12, "height": 1.03, "shoulder": 1.08},
    "XXL":{"chest": 1.20, "height": 1.05, "shoulder": 1.14},
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
    parser.add_argument("--size", default="M")
    return parser.parse_args(argv)


@wrap_main
def resize():
    args = parse_args()
    size = args.size.upper()
    params = SIZE_PARAMS.get(size, SIZE_PARAMS["M"])

    if size not in SIZE_PARAMS:
        print(f"[resize] WARNING: Unknown size '{size}', using M")
        size = "M"

    # Import
    meshes, err = safe_import_glb(args.input)
    if err:
        print(f"[resize] FATAL: {err}")
        sys.exit(1)

    for obj in meshes:
        ok, reason = check_mesh(obj)
        if not ok:
            print(f"[resize] Skipping '{obj.name}': {reason}")
            continue

        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)

        # Apply non-uniform scale
        obj.scale.x *= params["shoulder"]
        obj.scale.y *= params["chest"]
        obj.scale.z *= params["height"]

        safe_op(bpy.ops.object.transform_apply, location=False, rotation=False, scale=True,
                description="Apply scale transform")
        obj.select_set(False)

        print(f"[resize] {obj.name}: chest={params['chest']}, "
              f"height={params['height']}, shoulder={params['shoulder']}")

    # Export
    success, err = safe_export_glb(args.output)
    if not success:
        print(f"[resize] FATAL: Export failed: {err}")
        sys.exit(1)

    print(f"[resize] Exported {size} to {args.output}")


if __name__ == "__main__":
    resize()
