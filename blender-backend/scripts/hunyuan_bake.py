"""
hunyuan_bake.py — PBR Texture Baking: project AI render onto mesh UVs, bake Normal + AO maps
Error-hardened: safe_import_glb + safe_export_glb + bake operation try/except.

Camera alignment matches Three.js viewer: FOV 45 deg, Position [0,0,3], LookAt [0,0,0]
Coordinate conversion: Three.js Y-up -> Blender Z-up

Usage: blender --background --python hunyuan_bake.py -- --input garment.glb --output baked.glb --texture render.png --resolution 2048
"""

import bpy
import sys
import os
import math
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from blender_helpers import (
    safe_op, ensure_mode, safe_import_glb, safe_export_glb, wrap_main,
)


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Input GLB garment mesh")
    parser.add_argument("--output", required=True, help="Output GLB with baked PBR textures")
    parser.add_argument("--texture", required=True, help="AI render PNG to project as BaseColor")
    parser.add_argument("--resolution", type=int, default=2048, help="Bake texture resolution")
    return parser.parse_args(argv)


@wrap_main
def bake_pbr():
    args = parse_args()

    print(f"[bake_pbr] Input: {args.input}")
    print(f"[bake_pbr] Texture: {args.texture}")
    print(f"[bake_pbr] Resolution: {args.resolution}")

    # Validate texture file exists
    if not os.path.exists(args.texture):
        print(f"[bake_pbr] FATAL: Texture file not found: {args.texture}")
        sys.exit(1)

    # Import garment
    meshes, err = safe_import_glb(args.input)
    if err:
        print(f"[bake_pbr] FATAL: {err}")
        sys.exit(1)

    if not meshes:
        print("[bake_pbr] FATAL: No mesh objects found in GLB")
        sys.exit(1)

    print(f"[bake_pbr] Found {len(meshes)} mesh(es)")

    # ── Camera setup — match Three.js viewer exactly ──
    cam_data = bpy.data.cameras.new("BakeCam")
    cam_data.type = "PERSP"
    cam_data.lens = 43.46
    cam_data.sensor_width = 36.0

    cam_obj = bpy.data.objects.new("BakeCam", cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj
    cam_obj.location = (0, -3, 0)
    cam_obj.rotation_euler = (math.radians(90), 0, 0)

    # ── Ensure all meshes have UVs ──
    for obj in meshes:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)

        if not obj.data.uv_layers:
            print(f"[bake_pbr] Mesh '{obj.name}' has no UVs - running Smart UV Project")
            ensure_mode("EDIT")
            safe_op(bpy.ops.mesh.select_all, action="SELECT", description="Select all")
            safe_op(bpy.ops.uv.smart_project, angle_limit=math.radians(66), island_margin=0.02,
                    description="Smart UV Project")
            ensure_mode("OBJECT")

        obj.select_set(False)

    # ── Load AI render texture ──
    try:
        ai_render = bpy.data.images.load(args.texture)
        print(f"[bake_pbr] Loaded texture: {ai_render.name} ({ai_render.size[0]}x{ai_render.size[1]})")
    except Exception as e:
        print(f"[bake_pbr] FATAL: Cannot load texture: {e}")
        sys.exit(1)

    # ── Create bake target images ──
    bake_res = args.resolution

    basecolor_img = bpy.data.images.new("BakedBaseColor", bake_res, bake_res, alpha=True)
    basecolor_img.colorspace_settings.name = "sRGB"

    normal_img = bpy.data.images.new("BakedNormal", bake_res, bake_res, alpha=False)
    normal_img.colorspace_settings.name = "Non-Color"

    ao_img = bpy.data.images.new("BakedAO", bake_res, bake_res, alpha=False)
    ao_img.colorspace_settings.name = "Non-Color"

    # ── Set up Cycles for baking ──
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "GPU"
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.render.bake.margin = 4
    scene.render.bake.margin_type = "EXTEND"

    # ── Apply PBR material with projected texture to each mesh ──
    bake_errors = []

    for obj in meshes:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)

        # Create or get material
        if not obj.data.materials:
            mat = bpy.data.materials.new(name=f"PBR_{obj.name}")
            obj.data.materials.append(mat)
        else:
            mat = obj.data.materials[0]

        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        links = mat.node_tree.links
        nodes.clear()

        # Create Principled BSDF
        principled = nodes.new("ShaderNodeBsdfPrincipled")
        principled.location = (300, 0)

        output = nodes.new("ShaderNodeOutputMaterial")
        output.location = (600, 0)
        links.new(principled.outputs["BSDF"], output.inputs["Surface"])

        # Project AI render via camera
        tex_coord = nodes.new("ShaderNodeTexCoord")
        tex_coord.location = (-600, 0)
        tex_coord.object = cam_obj

        mapping = nodes.new("ShaderNodeMapping")
        mapping.location = (-400, 0)
        mapping.inputs["Location"].default_value = (0.5, 0.5, 0)
        mapping.inputs["Scale"].default_value = (1, 1, 1)

        tex_image = nodes.new("ShaderNodeTexImage")
        tex_image.location = (-200, 0)
        tex_image.image = ai_render
        tex_image.extension = "CLIP"

        links.new(tex_coord.outputs["Window"], mapping.inputs["Vector"])
        links.new(mapping.outputs["Vector"], tex_image.inputs["Vector"])
        links.new(tex_image.outputs["Color"], principled.inputs["Base Color"])

        # Bake target node
        bake_node = nodes.new("ShaderNodeTexImage")
        bake_node.location = (-200, -300)
        bake_node.image = basecolor_img
        bake_node.name = "BakeTarget"
        nodes.active = bake_node

        # ── Bake BaseColor ──
        print(f"[bake_pbr] Baking BaseColor for '{obj.name}'...")
        try:
            bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"})
        except RuntimeError as e:
            print(f"[bake_pbr] WARNING: BaseColor bake failed for '{obj.name}': {e}")
            bake_errors.append(f"BaseColor/{obj.name}")

        # ── Bake Normal Map ──
        bake_node.image = normal_img
        print(f"[bake_pbr] Baking Normal for '{obj.name}'...")
        try:
            bpy.ops.object.bake(type="NORMAL")
        except RuntimeError as e:
            print(f"[bake_pbr] WARNING: Normal bake failed for '{obj.name}': {e}")
            bake_errors.append(f"Normal/{obj.name}")

        # ── Bake AO ──
        bake_node.image = ao_img
        print(f"[bake_pbr] Baking AO for '{obj.name}'...")
        try:
            bpy.ops.object.bake(type="AO")
        except RuntimeError as e:
            print(f"[bake_pbr] WARNING: AO bake failed for '{obj.name}': {e}")
            bake_errors.append(f"AO/{obj.name}")

        # ── Rebuild material with baked textures ──
        nodes.clear()

        principled_final = nodes.new("ShaderNodeBsdfPrincipled")
        principled_final.location = (300, 0)

        output_final = nodes.new("ShaderNodeOutputMaterial")
        output_final.location = (600, 0)
        links.new(principled_final.outputs["BSDF"], output_final.inputs["Surface"])

        basecolor_tex = nodes.new("ShaderNodeTexImage")
        basecolor_tex.location = (-200, 200)
        basecolor_tex.image = basecolor_img
        links.new(basecolor_tex.outputs["Color"], principled_final.inputs["Base Color"])

        normal_tex = nodes.new("ShaderNodeTexImage")
        normal_tex.location = (-400, -100)
        normal_tex.image = normal_img
        normal_tex.image.colorspace_settings.name = "Non-Color"

        normal_map_node = nodes.new("ShaderNodeNormalMap")
        normal_map_node.location = (-200, -100)
        links.new(normal_tex.outputs["Color"], normal_map_node.inputs["Color"])
        links.new(normal_map_node.outputs["Normal"], principled_final.inputs["Normal"])

        ao_tex = nodes.new("ShaderNodeTexImage")
        ao_tex.location = (-400, -400)
        ao_tex.image = ao_img
        ao_tex.image.colorspace_settings.name = "Non-Color"

        ao_mix = nodes.new("ShaderNodeMath")
        ao_mix.operation = "MULTIPLY"
        ao_mix.location = (-200, -400)
        ao_mix.inputs[1].default_value = 0.6
        links.new(ao_tex.outputs["Color"], ao_mix.inputs[0])
        links.new(ao_mix.outputs["Value"], principled_final.inputs["Roughness"])

        obj.select_set(False)

    # ── Pack images ──
    try:
        basecolor_img.pack()
        normal_img.pack()
        ao_img.pack()
    except Exception as e:
        print(f"[bake_pbr] WARNING: Could not pack images: {e}")

    # ── Export ──
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]

    success, err = safe_export_glb(args.output)
    if not success:
        print(f"[bake_pbr] FATAL: Export failed: {err}")
        sys.exit(1)

    if bake_errors:
        print(f"[bake_pbr] WARNING: {len(bake_errors)} bake(s) failed: {bake_errors}")

    print(f"[bake_pbr] PBR bake complete -> {args.output}")
    print(f"[bake_pbr]   BaseColor: {bake_res}x{bake_res}")
    print(f"[bake_pbr]   Normal: {bake_res}x{bake_res}")
    print(f"[bake_pbr]   AO: {bake_res}x{bake_res}")
    print(f"[bake_pbr]   UV Bleed: 4px EXTEND margin")


if __name__ == "__main__":
    bake_pbr()
