"""
apply_logo.py — Image Texture on UV island via Shader Nodes for logo/print placement
Error-hardened: safe_import_glb + safe_export_glb + mesh/texture validation.

Usage: blender --background --python apply_logo.py -- --input garment.glb --output with_logo.glb --logo logo.png --position chest_center --scale 0.15
"""

import bpy
import sys
import argparse
from pathlib import Path
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).parent))
from blender_helpers import safe_import_glb, safe_export_glb, wrap_main


# Predefined UV positions for common garment placements
POSITION_PRESETS = {
    "chest_center":  (0.5, 0.7),
    "chest_left":    (0.3, 0.7),
    "chest_right":   (0.7, 0.7),
    "back_center":   (0.5, 0.5),
    "back_upper":    (0.5, 0.7),
    "sleeve_left":   (0.15, 0.6),
    "sleeve_right":  (0.85, 0.6),
    "hem_center":    (0.5, 0.15),
    "pocket":        (0.35, 0.55),
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
    parser.add_argument("--logo", required=True)
    parser.add_argument("--position", default="chest_center")
    parser.add_argument("--scale", type=float, default=0.15)
    parser.add_argument("--target_part", default=None, help="Apply logo to specific named garment part")
    return parser.parse_args(argv)


@wrap_main
def apply_logo():
    args = parse_args()

    # Import garment
    meshes, err = safe_import_glb(args.input)
    if err:
        print(f"[apply_logo] FATAL: {err}")
        sys.exit(1)

    if not meshes:
        print("[apply_logo] FATAL: No mesh found")
        sys.exit(1)

    # Find target mesh
    garment = None
    for obj in meshes:
        if args.target_part and obj.name == args.target_part:
            garment = obj
            break
        if garment is None:
            garment = obj

    if not garment:
        print("[apply_logo] FATAL: No target mesh found")
        sys.exit(1)

    print(f"[apply_logo] Target mesh: {garment.name}")
    bpy.context.view_layer.objects.active = garment

    # Get or create material
    if not garment.data.materials:
        mat = bpy.data.materials.new(name="GarmentMaterial")
        garment.data.materials.append(mat)
    else:
        mat = garment.data.materials[0]

    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links

    # Find the Principled BSDF
    principled = None
    for node in nodes:
        if node.type == "BSDF_PRINCIPLED":
            principled = node
            break

    if not principled:
        principled = nodes.new("ShaderNodeBsdfPrincipled")

    # Load logo texture
    logo_tex = nodes.new("ShaderNodeTexImage")
    try:
        logo_tex.image = bpy.data.images.load(args.logo)
    except Exception as e:
        print(f"[apply_logo] FATAL: Cannot load logo '{args.logo}': {e}")
        sys.exit(1)

    # UV mapping for logo placement
    uv_map = nodes.new("ShaderNodeUVMap")
    mapping = nodes.new("ShaderNodeMapping")

    uv_pos = POSITION_PRESETS.get(args.position, (0.5, 0.5))
    if args.position not in POSITION_PRESETS:
        print(f"[apply_logo] WARNING: Unknown position '{args.position}', using (0.5, 0.5)")

    logo_scale = args.scale

    mapping.inputs["Location"].default_value[0] = uv_pos[0] - logo_scale / 2
    mapping.inputs["Location"].default_value[1] = uv_pos[1] - logo_scale / 2
    mapping.inputs["Scale"].default_value[0] = 1.0 / logo_scale
    mapping.inputs["Scale"].default_value[1] = 1.0 / logo_scale

    # Mix logo with base color using alpha
    mix_node = nodes.new("ShaderNodeMixRGB")
    mix_node.blend_type = "MIX"

    base_color_link = None
    for link in links:
        if link.to_socket == principled.inputs["Base Color"]:
            base_color_link = link
            break

    links.new(uv_map.outputs["UV"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], logo_tex.inputs["Vector"])
    links.new(logo_tex.outputs["Alpha"], mix_node.inputs["Fac"])
    links.new(logo_tex.outputs["Color"], mix_node.inputs["Color2"])

    if base_color_link:
        links.new(base_color_link.from_socket, mix_node.inputs["Color1"])
        links.remove(base_color_link)
    else:
        mix_node.inputs["Color1"].default_value = principled.inputs["Base Color"].default_value

    links.new(mix_node.outputs["Color"], principled.inputs["Base Color"])

    # Export
    success, err = safe_export_glb(args.output)
    if not success:
        print(f"[apply_logo] FATAL: Export failed: {err}")
        sys.exit(1)

    print(f"[apply_logo] Logo applied at {args.position} (scale {args.scale}) -> {args.output}")


if __name__ == "__main__":
    apply_logo()
