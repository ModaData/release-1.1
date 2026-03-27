"""
generate_from_spec.py — Parametric garment generation from GarmentSpec JSON.

Called by the FastAPI server when a user provides a text prompt that's been
converted to a GarmentSpec by GPT-4.

Approach:
  1. Creates a base mesh programmatically (cylinder/plane → garment shape)
  2. Applies parametric modifications based on spec values
  3. Assigns material with correct color + fabric PBR properties
  4. Exports as GLB

Usage:
  blender --background --python generate_from_spec.py -- --spec_json '{"garment_type":"blazer",...}' --output /tmp/output.glb
"""

import bpy
import bmesh
import sys
import json
import os
import math
import argparse


# ── Fabric PBR properties ──
FABRIC_PBR = {
    "cotton":    {"roughness": 0.85, "metallic": 0.0, "specular": 0.3},
    "silk":      {"roughness": 0.35, "metallic": 0.0, "specular": 0.8},
    "wool":      {"roughness": 0.95, "metallic": 0.0, "specular": 0.2},
    "linen":     {"roughness": 0.80, "metallic": 0.0, "specular": 0.35},
    "denim":     {"roughness": 0.90, "metallic": 0.0, "specular": 0.25},
    "leather":   {"roughness": 0.55, "metallic": 0.0, "specular": 0.6},
    "velvet":    {"roughness": 0.98, "metallic": 0.0, "specular": 0.15},
    "chiffon":   {"roughness": 0.40, "metallic": 0.0, "specular": 0.7},
    "satin":     {"roughness": 0.25, "metallic": 0.0, "specular": 0.9},
    "tweed":     {"roughness": 0.92, "metallic": 0.0, "specular": 0.2},
    "jersey":    {"roughness": 0.75, "metallic": 0.0, "specular": 0.3},
    "nylon":     {"roughness": 0.50, "metallic": 0.0, "specular": 0.5},
    "polyester": {"roughness": 0.60, "metallic": 0.0, "specular": 0.45},
    "spandex":   {"roughness": 0.45, "metallic": 0.0, "specular": 0.55},
}

# ── Fit scale multipliers ──
FIT_SCALES = {"slim": 0.85, "regular": 1.0, "relaxed": 1.15, "oversized": 1.35}

# ── Body part proportions (relative to a standard body height of 1.7m) ──
BODY_HEIGHT = 1.7
SHOULDER_BASE = 0.44  # meters, natural shoulder width
TORSO_LENGTH = 0.55   # meters, shoulder to hip
SLEEVE_LENGTH_FULL = 0.60  # meters, shoulder to wrist


def hex_to_rgb(hex_str):
    """Convert hex color to RGB tuple (0-1 range)."""
    hex_str = hex_str.lstrip("#")
    if len(hex_str) != 6:
        return (0.2, 0.2, 0.2)
    r = int(hex_str[0:2], 16) / 255.0
    g = int(hex_str[2:4], 16) / 255.0
    b = int(hex_str[4:6], 16) / 255.0
    # Convert sRGB to linear for Blender
    return (pow(r, 2.2), pow(g, 2.2), pow(b, 2.2))


def clear_scene():
    """Remove all objects from the scene."""
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    # Remove orphan data
    for block in bpy.data.meshes:
        if not block.users:
            bpy.data.meshes.remove(block)


def create_fabric_material(color_hex, fabric_type):
    """Create a PBR material matching the fabric properties."""
    mat = bpy.data.materials.new(name=f"Fabric_{fabric_type}")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links

    # Clear defaults
    nodes.clear()

    # Principled BSDF
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (0, 0)

    rgb = hex_to_rgb(color_hex)
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)

    pbr = FABRIC_PBR.get(fabric_type, FABRIC_PBR["cotton"])
    bsdf.inputs["Roughness"].default_value = pbr["roughness"]
    bsdf.inputs["Metallic"].default_value = pbr["metallic"]
    bsdf.inputs["Specular IOR Level"].default_value = pbr["specular"]

    # Output
    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (300, 0)
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])

    return mat


def create_torso_mesh(spec):
    """Create the main body/torso of the garment."""
    garment_type = spec.get("garment_type", "tshirt")
    body_length_norm = spec.get("body_length", 0.7)
    fit = spec.get("fit", "regular")
    shoulder_width_norm = spec.get("shoulder_width", 0.5)

    # Calculate real dimensions
    fit_scale = FIT_SCALES.get(fit, 1.0)
    actual_body_length = TORSO_LENGTH * body_length_norm * 1.5  # 1.5 accounts for maxi
    shoulder_w = SHOULDER_BASE * (0.7 + shoulder_width_norm * 0.6) * fit_scale

    # Waist/hip ratio varies by garment type
    waist_ratio = {
        "blazer": 0.85, "jacket": 0.88, "coat": 0.95,
        "vest": 0.80, "shirt": 0.90, "blouse": 0.85,
        "tshirt": 0.95, "hoodie": 1.0, "sweater": 0.95,
        "dress": 0.75, "skirt": 0.80, "pants": 0.85,
        "shorts": 0.90, "jumpsuit": 0.85,
    }.get(garment_type, 0.90)

    hip_ratio = {
        "dress": 1.1, "skirt": 1.15, "coat": 1.05,
        "blazer": 1.0, "pants": 0.95,
    }.get(garment_type, 1.0)

    # Create a subdivided cylinder as the torso
    segments = 24
    rings = 8
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=segments,
        depth=actual_body_length,
        radius=shoulder_w / 2,
        location=(0, 0, actual_body_length / 2 + 0.85),  # Position at chest height
    )
    torso = bpy.context.active_object
    torso.name = "Garment_Body"

    # Enter edit mode to shape the torso
    bpy.ops.object.mode_set(mode="EDIT")
    bm = bmesh.from_edit_mesh(torso.data)

    # Loop cut for more geometry
    bpy.ops.mesh.loop_cut_and_slide(
        MESH_OT_loopcut={
            "number_cuts": rings - 1,
            "smoothness": 0,
            "falloff": "INVERSE_SQUARE",
        }
    )
    bm = bmesh.from_edit_mesh(torso.data)

    # Shape the torso — scale rings to create waist/hip curvature
    verts_by_z = {}
    for v in bm.verts:
        z_key = round(v.co.z, 3)
        if z_key not in verts_by_z:
            verts_by_z[z_key] = []
        verts_by_z[z_key].append(v)

    sorted_z = sorted(verts_by_z.keys())
    if len(sorted_z) >= 3:
        for i, z in enumerate(sorted_z):
            t = i / max(len(sorted_z) - 1, 1)  # 0=bottom, 1=top
            # Create a smooth profile: shoulders → waist → hips
            if t > 0.6:  # Upper body (shoulders)
                scale = 1.0
            elif t > 0.35:  # Waist area
                blend = (t - 0.35) / 0.25
                scale = waist_ratio + (1.0 - waist_ratio) * blend
            else:  # Hip area
                blend = t / 0.35
                scale = hip_ratio + (waist_ratio - hip_ratio) * blend

            for v in verts_by_z[z]:
                v.co.x *= scale
                v.co.y *= scale

    bmesh.update_edit_mesh(torso.data)
    bpy.ops.object.mode_set(mode="OBJECT")

    # Smooth shading
    bpy.ops.object.shade_smooth()

    # Add subdivision for smooth surface
    subsurf = torso.modifiers.new(name="Subsurf", type="SUBSURF")
    subsurf.levels = 2
    subsurf.render_levels = 2

    return torso


def create_sleeves(spec, torso):
    """Add sleeves to the garment."""
    sleeve_length_norm = spec.get("sleeve_length", 1.0)
    if sleeve_length_norm < 0.05:
        return None  # Sleeveless

    actual_length = SLEEVE_LENGTH_FULL * sleeve_length_norm
    fit = spec.get("fit", "regular")
    fit_scale = FIT_SCALES.get(fit, 1.0)
    sleeve_radius = 0.055 * fit_scale

    sleeves = []
    for side in [-1, 1]:
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=16,
            depth=actual_length,
            radius=sleeve_radius,
            location=(side * 0.22, 0, 1.35),
            rotation=(0, side * math.radians(15), 0),
        )
        sleeve = bpy.context.active_object
        sleeve.name = f"Garment_Sleeve_{'R' if side > 0 else 'L'}"

        # Taper the sleeve toward the wrist
        bpy.ops.object.mode_set(mode="EDIT")
        bm = bmesh.from_edit_mesh(sleeve.data)

        # Find the bottom ring (wrist end) and scale it down
        min_z = min(v.co.z for v in bm.verts)
        for v in bm.verts:
            if abs(v.co.z - min_z) < 0.01:
                v.co.x *= 0.7
                v.co.y *= 0.7

        bmesh.update_edit_mesh(sleeve.data)
        bpy.ops.object.mode_set(mode="OBJECT")
        bpy.ops.object.shade_smooth()

        subsurf = sleeve.modifiers.new(name="Subsurf", type="SUBSURF")
        subsurf.levels = 1
        sleeves.append(sleeve)

    return sleeves


def create_collar(spec, torso):
    """Add a collar based on the collar style."""
    collar_style = spec.get("collar_style", "none")
    if collar_style == "none":
        return None

    # Simple collar: a torus ring at the neckline
    collar_height = {
        "turtleneck": 0.08, "mandarin": 0.04, "band": 0.03,
    }.get(collar_style, 0.025)

    collar_radius = 0.09

    bpy.ops.mesh.primitive_torus_add(
        major_radius=collar_radius,
        minor_radius=collar_height / 2,
        major_segments=24,
        minor_segments=8,
        location=(0, 0, 1.55),
    )
    collar = bpy.context.active_object
    collar.name = "Garment_Collar"
    bpy.ops.object.shade_smooth()
    return collar


def assemble_and_export(spec, output_path):
    """Main function: create all parts, apply material, join, export GLB."""
    clear_scene()

    # Create garment parts
    torso = create_torso_mesh(spec)
    sleeves = create_sleeves(spec, torso)
    collar = create_collar(spec, torso)

    # Create and assign material
    color_hex = spec.get("color_hex", "#333333")
    fabric_type = spec.get("fabric_type", "cotton")
    mat = create_fabric_material(color_hex, fabric_type)

    # Collect all parts
    all_parts = [torso]
    if sleeves:
        all_parts.extend(sleeves)
    if collar:
        all_parts.append(collar)

    # Assign material to all parts
    for obj in all_parts:
        if obj.data.materials:
            obj.data.materials[0] = mat
        else:
            obj.data.materials.append(mat)

    # Join all parts into one mesh
    bpy.ops.object.select_all(action="DESELECT")
    for obj in all_parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = torso
    if len(all_parts) > 1:
        bpy.ops.object.join()

    garment = bpy.context.active_object
    garment.name = spec.get("name", spec.get("garment_type", "Garment"))

    # Apply modifiers for clean export
    for mod in garment.modifiers:
        try:
            bpy.ops.object.modifier_apply(modifier=mod.name)
        except Exception:
            pass

    # UV unwrap
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), margin_method="SCALED", island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")

    # Add Basis shape key for future morph compatibility
    bpy.ops.object.shape_key_add(from_mix=False)
    garment.data.shape_keys.key_blocks[-1].name = "Basis"

    # Export GLB
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_materials="EXPORT",
        export_colors=True,
        export_normals=True,
        export_morph=True,
        export_morph_normal=False,
    )

    # Write metadata sidecar
    meta_path = output_path.replace(".glb", "_spec.json")
    meta = {
        "garment_type": spec.get("garment_type"),
        "name": spec.get("name", ""),
        "fabric_type": fabric_type,
        "color_hex": color_hex,
        "fit": spec.get("fit", "regular"),
        "sleeve_length": spec.get("sleeve_length", 1.0),
        "body_length": spec.get("body_length", 0.7),
        "parts": [obj.name for obj in all_parts],
    }
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    print(f"[generate_from_spec] Exported: {output_path}")
    print(f"[generate_from_spec] Metadata: {meta_path}")


# ── CLI entry ──
if __name__ == "__main__":
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []

    parser = argparse.ArgumentParser()
    parser.add_argument("--spec_json", required=True, help="GarmentSpec as JSON string")
    parser.add_argument("--output", required=True, help="Output GLB path")
    args = parser.parse_args(argv)

    spec = json.loads(args.spec_json)
    assemble_and_export(spec, args.output)
