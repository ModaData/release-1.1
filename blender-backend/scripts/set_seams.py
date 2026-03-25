"""
set_seams.py — Apply user-defined seam overrides to an assembled GLB.

Accepts a GLB + a JSON list of edge indices + operation (mark/unmark).
After applying overrides, re-runs UV unwrap so the flat pattern reflects
the user's custom seam placement.

Usage:
  blender --background --python set_seams.py -- \\
    --input assembled.glb --output seamed.glb \\
    --edge_indices '[12, 45, 78]' [--operation mark|unmark] [--object_name collar_v1]
"""

import bpy
import sys
import json
import argparse
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
    parser.add_argument("--input",        required=True)
    parser.add_argument("--output",       required=True)
    parser.add_argument("--edge_indices", required=True,
                        help="JSON list of edge indices to mark/unmark, e.g. '[12,45,78]'")
    parser.add_argument("--operation",    default="mark", choices=["mark", "unmark"],
                        help="Whether to mark or unmark the specified edges as seams")
    parser.add_argument("--object_name",  default=None,
                        help="Target only this mesh object (default: all mesh objects)")
    return parser.parse_args(argv)


@wrap_main
def apply_seams():
    args = parse_args()

    # Parse edge indices
    try:
        edge_indices = json.loads(args.edge_indices)
        if not isinstance(edge_indices, list):
            raise ValueError("edge_indices must be a JSON array")
    except (json.JSONDecodeError, ValueError) as e:
        print(f"[set_seams] FATAL: Invalid --edge_indices: {e}")
        sys.exit(1)

    mark_as_seam = args.operation == "mark"

    # Import GLB
    meshes, err = safe_import_glb(args.input)
    if err:
        print(f"[set_seams] FATAL: {err}")
        sys.exit(1)

    # Filter to target objects
    if args.object_name:
        targets = [obj for obj in meshes if obj.name == args.object_name]
        if not targets:
            print(f"[set_seams] WARNING: Object '{args.object_name}' not found; "
                  f"applying to all {len(meshes)} objects")
            targets = meshes
    else:
        targets = meshes

    total_modified = 0

    for obj in targets:
        mesh = obj.data
        modified = 0

        for idx in edge_indices:
            if 0 <= idx < len(mesh.edges):
                mesh.edges[idx].use_seam = mark_as_seam
                modified += 1
            else:
                print(f"[set_seams] WARNING: Edge index {idx} out of range "
                      f"for '{obj.name}' ({len(mesh.edges)} edges)")

        print(f"[set_seams] {args.operation.capitalize()}ed {modified} edges "
              f"on '{obj.name}'")
        total_modified += modified

        # Re-run UV unwrap to reflect new seam placement
        if modified > 0:
            try:
                bpy.context.view_layer.objects.active = obj
                obj.select_set(True)
                bpy.ops.object.mode_set(mode="EDIT")
                bpy.ops.mesh.select_all(action="SELECT")
                bpy.ops.uv.unwrap(method="ANGLE_BASED", margin=0.02)
                bpy.ops.object.mode_set(mode="OBJECT")
                obj.select_set(False)
                print(f"[set_seams] Re-ran UV unwrap for '{obj.name}'")
            except Exception as e:
                print(f"[set_seams] WARNING: UV re-unwrap failed for '{obj.name}': {e}")
                try:
                    bpy.ops.object.mode_set(mode="OBJECT")
                except Exception:
                    pass

    print(f"[set_seams] Total edges modified: {total_modified}")

    # Export
    success, err = safe_export_glb(args.output)
    if not success:
        print(f"[set_seams] FATAL: Export failed: {err}")
        sys.exit(1)

    print(f"[set_seams] Exported to {args.output}")


if __name__ == "__main__":
    apply_seams()
