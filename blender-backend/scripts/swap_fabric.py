"""
swap_fabric.py — Principled BSDF parameter sets for different fabric types.
Supports full Principled BSDF inputs (sheen, subsurface, coat, anisotropic) plus
optional per-call PBR override params and fabric normal map loading.

Error-hardened: safe_import_glb + safe_export_glb + graceful param application.

Usage:
  blender --background --python swap_fabric.py -- \\
    --input garment.glb --output fabric_denim.glb --fabric_type denim \\
    [--roughness 0.95] [--sheen_weight 0.8] [--base_color_r 0.08 --base_color_g 0.12 --base_color_b 0.28]
"""

import bpy
import sys
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from blender_helpers import safe_import_glb, safe_export_glb, wrap_main

TEXTURES_DIR = Path(__file__).parent.parent / "textures" / "normals"

FABRIC_NORMAL_MAP = {
    "denim":   "twill_weave",
    "linen":   "twill_weave",
    "cotton":  "plain_weave",
    "silk":    "satin_weave",
    "velvet":  "satin_weave",
    "wool":    "jersey_knit",
    "spandex": "jersey_knit",
    "leather": "leather_grain",
}


# PBR material presets for common fabric types
FABRIC_PRESETS = {
    "cotton": {
        "Base Color": (0.85, 0.83, 0.80, 1.0),
        "Roughness": 0.85,
        "Specular IOR Level": 0.3,
        "Sheen Weight": 0.3,
        "Sheen Roughness": 0.5,
        "Subsurface Weight": 0.05,
    },
    "denim": {
        "Base Color": (0.15, 0.22, 0.45, 1.0),
        "Roughness": 0.9,
        "Specular IOR Level": 0.25,
        "Sheen Weight": 0.4,
        "Sheen Roughness": 0.6,
        "Subsurface Weight": 0.02,
    },
    "silk": {
        "Base Color": (0.92, 0.88, 0.85, 1.0),
        "Roughness": 0.25,
        "Specular IOR Level": 0.8,
        "Sheen Weight": 0.8,
        "Sheen Roughness": 0.3,
        "Anisotropic": 0.5,
        "Subsurface Weight": 0.1,
    },
    "leather": {
        "Base Color": (0.18, 0.10, 0.06, 1.0),
        "Roughness": 0.55,
        "Specular IOR Level": 0.6,
        "Sheen Weight": 0.1,
        "Clearcoat Weight": 0.3,
        "Clearcoat Roughness": 0.2,
        "Subsurface Weight": 0.0,
    },
    "spandex": {
        "Base Color": (0.05, 0.05, 0.05, 1.0),
        "Roughness": 0.3,
        "Specular IOR Level": 0.7,
        "Sheen Weight": 0.6,
        "Sheen Roughness": 0.2,
        "Subsurface Weight": 0.15,
    },
    "linen": {
        "Base Color": (0.88, 0.85, 0.78, 1.0),
        "Roughness": 0.92,
        "Specular IOR Level": 0.2,
        "Sheen Weight": 0.2,
        "Sheen Roughness": 0.7,
        "Subsurface Weight": 0.03,
    },
    "velvet": {
        "Base Color": (0.25, 0.05, 0.10, 1.0),
        "Roughness": 0.95,
        "Specular IOR Level": 0.15,
        "Sheen Weight": 1.0,
        "Sheen Roughness": 0.3,
        "Sheen Tint": (0.8, 0.3, 0.4, 1.0),
        "Subsurface Weight": 0.08,
    },
    "wool": {
        "Base Color": (0.55, 0.50, 0.42, 1.0),
        "Roughness": 0.95,
        "Specular IOR Level": 0.2,
        "Sheen Weight": 0.5,
        "Sheen Roughness": 0.8,
        "Subsurface Weight": 0.1,
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
    parser.add_argument("--fabric_type", default="cotton")
    # Per-call PBR override params (applied on top of the fabric base preset)
    parser.add_argument("--roughness",         type=float, default=None)
    parser.add_argument("--sheen_weight",      type=float, default=None)
    parser.add_argument("--sheen_roughness",   type=float, default=None)
    parser.add_argument("--subsurface_weight", type=float, default=None)
    parser.add_argument("--coat_weight",       type=float, default=None)
    parser.add_argument("--anisotropic",       type=float, default=None)
    parser.add_argument("--specular_ior_level",type=float, default=None)
    parser.add_argument("--base_color_r",      type=float, default=None)
    parser.add_argument("--base_color_g",      type=float, default=None)
    parser.add_argument("--base_color_b",      type=float, default=None)
    parser.add_argument("--normal_map_id",     default=None,
                        help="Override fabric normal map (e.g. twill_weave, jersey_knit)")
    return parser.parse_args(argv)


def _apply_normal_map(mat, principled, normal_map_id):
    """Load PNG normal map and connect to Principled BSDF Normal input."""
    map_path = TEXTURES_DIR / f"{normal_map_id}.png"
    if not map_path.exists():
        print(f"[swap_fabric] INFO: Normal map not found: {map_path} (skipping)")
        return

    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    try:
        tex_node = nodes.new("ShaderNodeTexImage")
        tex_node.image = bpy.data.images.load(str(map_path))
        tex_node.image.colorspace_settings.name = "Non-Color"
        tex_node.location = (-600, -300)

        nmap_node = nodes.new("ShaderNodeNormalMap")
        nmap_node.space = "TANGENT"
        nmap_node.inputs["Strength"].default_value = 0.8
        nmap_node.location = (-300, -300)

        links.new(tex_node.outputs["Color"], nmap_node.inputs["Color"])
        links.new(nmap_node.outputs["Normal"], principled.inputs["Normal"])
        principled.location = (0, 0)
        print(f"[swap_fabric] Wired normal map: {normal_map_id}")
    except Exception as e:
        print(f"[swap_fabric] WARNING: Could not wire normal map {normal_map_id}: {e}")


@wrap_main
def swap():
    args = parse_args()
    fabric = args.fabric_type.lower()
    base_preset = FABRIC_PRESETS.get(fabric)

    if not base_preset:
        print(f"[swap_fabric] WARNING: Unknown fabric '{fabric}'. "
              f"Available: {list(FABRIC_PRESETS.keys())}. Using cotton.")
        fabric = "cotton"
        base_preset = FABRIC_PRESETS["cotton"]

    # Build effective preset: base + CLI override params
    effective_preset = dict(base_preset)

    override_map = {
        "Roughness":          args.roughness,
        "Sheen Weight":       args.sheen_weight,
        "Sheen Roughness":    args.sheen_roughness,
        "Subsurface Weight":  args.subsurface_weight,
        "Coat Weight":        args.coat_weight,
        "Anisotropic":        args.anisotropic,
        "Specular IOR Level": args.specular_ior_level,
    }
    for bsdf_name, val in override_map.items():
        if val is not None:
            effective_preset[bsdf_name] = val

    # Base color override
    if args.base_color_r is not None or args.base_color_g is not None or args.base_color_b is not None:
        orig = base_preset.get("Base Color", (0.8, 0.8, 0.8, 1.0))
        r = args.base_color_r if args.base_color_r is not None else orig[0]
        g = args.base_color_g if args.base_color_g is not None else orig[1]
        b = args.base_color_b if args.base_color_b is not None else orig[2]
        effective_preset["Base Color"] = (r, g, b, 1.0)

    # Normal map: CLI override > fabric default
    normal_map_id = args.normal_map_id or FABRIC_NORMAL_MAP.get(fabric)

    # Import
    meshes, err = safe_import_glb(args.input)
    if err:
        print(f"[swap_fabric] FATAL: {err}")
        sys.exit(1)

    # Apply to all mesh objects
    applied_count = 0
    for obj in meshes:
        if not obj.data.materials:
            mat = bpy.data.materials.new(name=f"Fabric_{fabric}")
            obj.data.materials.append(mat)
        else:
            mat = obj.data.materials[0]

        mat.use_nodes = True
        nodes = mat.node_tree.nodes

        principled = None
        for node in nodes:
            if node.type == "BSDF_PRINCIPLED":
                principled = node
                break
        if not principled:
            principled = nodes.new("ShaderNodeBsdfPrincipled")

        # Apply effective preset values
        for param, value in effective_preset.items():
            if param in principled.inputs:
                try:
                    principled.inputs[param].default_value = value
                except (TypeError, AttributeError) as e:
                    print(f"[swap_fabric] WARNING: Could not set {param} on '{obj.name}': {e}")

        # Wire normal map
        if normal_map_id:
            _apply_normal_map(mat, principled, normal_map_id)

        applied_count += 1
        print(f"[swap_fabric] Applied '{fabric}' to '{obj.name}'")

    # Export
    success, err = safe_export_glb(args.output)
    if not success:
        print(f"[swap_fabric] FATAL: Export failed: {err}")
        sys.exit(1)

    print(f"[swap_fabric] Applied '{fabric}' to {applied_count} mesh(es) -> {args.output}")


if __name__ == "__main__":
    swap()
