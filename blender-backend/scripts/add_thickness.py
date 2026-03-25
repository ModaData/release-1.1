"""
add_thickness.py — Add physical fabric thickness to garment meshes via Solidify modifier.

Single-layer garment panels become physically accurate double-sided shells.
Thickness is fabric-type-aware (silk ≈ 0.8 mm, leather ≈ 5.5 mm).
The modifier extrudes inward (offset=-1.0) so the outer silhouette stays accurate,
closes rim edges (seam allowance cut edge), and uses even-thickness mode to
prevent pinching on curved collar/sleeve panels.

Usage:
  blender --background --python add_thickness.py -- \\
    --input assembled.glb --output thick.glb \\
    [--fabric_type cotton] [--thickness_multiplier 1.0] [--use_rim true]
"""

import bpy
import sys
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from blender_helpers import safe_import_glb, safe_export_glb, safe_modifier_apply, wrap_main


# Real-world fabric thickness in meters (sourced from textile engineering standards)
FABRIC_THICKNESS = {
    "silk":    0.0008,   # 0.8 mm  — ultra-sheer
    "spandex": 0.0010,   # 1.0 mm  — stretch knit
    "cotton":  0.0018,   # 1.8 mm  — standard woven
    "linen":   0.0022,   # 2.2 mm  — medium weight
    "wool":    0.0030,   # 3.0 mm  — mid-weight suiting
    "denim":   0.0035,   # 3.5 mm  — 12oz denim
    "velvet":  0.0040,   # 4.0 mm  — pile fabric
    "leather": 0.0055,   # 5.5 mm  — full-grain leather
}
DEFAULT_THICKNESS = 0.0020  # 2.0 mm fallback


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input",                required=True)
    parser.add_argument("--output",               required=True)
    parser.add_argument("--fabric_type",          default="cotton",
                        help="Fabric type for auto-thickness (silk/spandex/cotton/linen/"
                             "wool/denim/velvet/leather)")
    parser.add_argument("--thickness_multiplier", type=float, default=1.0,
                        help="Multiplier on the base fabric thickness (0.5=thinner, 2.0=thicker)")
    parser.add_argument("--use_rim",              default="true",
                        help="Close the fabric cut edge with a rim face (true/false)")
    return parser.parse_args(argv)


@wrap_main
def add_thickness():
    args = parse_args()

    # Resolve thickness
    base_thickness = FABRIC_THICKNESS.get(args.fabric_type.lower(), DEFAULT_THICKNESS)
    thickness = base_thickness * args.thickness_multiplier
    use_rim = args.use_rim.lower() not in ("false", "0", "no")

    print(f"[add_thickness] Fabric: {args.fabric_type} → "
          f"thickness={thickness*1000:.2f}mm × {args.thickness_multiplier} multiplier")

    # Import
    meshes, err = safe_import_glb(args.input)
    if err:
        print(f"[add_thickness] FATAL: {err}")
        sys.exit(1)
    if not meshes:
        print("[add_thickness] FATAL: No mesh objects in GLB")
        sys.exit(1)

    print(f"[add_thickness] Loaded {len(meshes)} mesh object(s)")

    for obj in meshes:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)

        # Add Solidify modifier
        mod = obj.modifiers.new(name="Thickness", type="SOLIDIFY")
        mod.thickness        = -thickness   # negative = inward extrusion
        mod.offset           = -1.0         # extrude inward, outer surface unchanged
        mod.use_even_offset  = True         # even thickness on curved panels
        mod.use_rim          = use_rim      # close the cut-edge faces
        mod.use_rim_only     = False
        mod.use_flip_normals = False        # keep normals pointing outward

        print(f"[add_thickness] Applied Solidify to '{obj.name}' "
              f"(thickness={thickness*1000:.2f}mm, rim={use_rim})")

        # Apply modifier
        applied = safe_modifier_apply(obj, "Thickness", "Solidify thickness")
        if not applied:
            print(f"[add_thickness] WARNING: Could not apply Solidify on '{obj.name}' "
                  f"— leaving modifier in stack")

        # Fix any inverted normals from solidify
        try:
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.select_all(action="SELECT")
            bpy.ops.mesh.normals_make_consistent(inside=False)
            bpy.ops.object.mode_set(mode="OBJECT")
        except Exception as e:
            print(f"[add_thickness] WARNING: Normal recalculation failed for '{obj.name}': {e}")
            try:
                bpy.ops.object.mode_set(mode="OBJECT")
            except Exception:
                pass

        obj.select_set(False)

    # Export
    success, err = safe_export_glb(args.output)
    if not success:
        print(f"[add_thickness] FATAL: Export failed: {err}")
        sys.exit(1)

    print(f"[add_thickness] Done → {args.output}")


if __name__ == "__main__":
    add_thickness()
