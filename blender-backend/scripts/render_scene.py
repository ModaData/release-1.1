"""
render_scene.py — Camera + Lighting + Ground Plane + Cycles render -> PNG
Tuned for fashion/garment photography.

Error-hardened: import/setup wrapped in try/except, fallback to EEVEE if Cycles fails.

Usage: blender --background --python render_scene.py -- --input garment.glb --output render.glb --resolution 1024 --samples 128
"""

import bpy
import sys
import os
import math
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from blender_helpers import safe_op, safe_import_glb, wrap_main

from mathutils import Vector


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--resolution", type=int, default=1024)
    parser.add_argument("--samples", type=int, default=128)
    return parser.parse_args(argv)


@wrap_main
def render():
    args = parse_args()
    output_png = os.path.splitext(args.output)[0] + ".png"

    # Import garment
    meshes, err = safe_import_glb(args.input)
    if err:
        print(f"[render_scene] FATAL: {err}")
        sys.exit(1)

    if not meshes:
        print("[render_scene] FATAL: No mesh objects found")
        sys.exit(1)

    # Calculate bounding box of all objects for camera placement
    min_co = Vector((float("inf"),) * 3)
    max_co = Vector((float("-inf"),) * 3)

    for obj in meshes:
        for v in obj.bound_box:
            world_v = obj.matrix_world @ Vector(v)
            min_co.x = min(min_co.x, world_v.x)
            min_co.y = min(min_co.y, world_v.y)
            min_co.z = min(min_co.z, world_v.z)
            max_co.x = max(max_co.x, world_v.x)
            max_co.y = max(max_co.y, world_v.y)
            max_co.z = max(max_co.z, world_v.z)

    center = (min_co + max_co) / 2
    size = (max_co - min_co).length

    if size < 0.001:
        print("[render_scene] WARNING: Mesh bounding box is extremely small, render may be blank")

    # ── Camera setup — 85mm fashion photography lens ──
    cam_data = bpy.data.cameras.new(name="RenderCam")
    cam_data.lens = 85
    cam_obj = bpy.data.objects.new("RenderCam", cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj

    cam_distance = size * 2.5
    cam_obj.location = (
        center.x + cam_distance * 0.4,
        center.y - cam_distance,
        center.z + cam_distance * 0.2,
    )

    direction = center - cam_obj.location
    rot_quat = direction.to_track_quat("-Z", "Y")
    cam_obj.rotation_euler = rot_quat.to_euler()

    # ── Shadow catcher ground plane ──
    try:
        bpy.ops.mesh.primitive_plane_add(
            size=size * 10,
            location=(center.x, center.y, min_co.z),
        )
        ground = bpy.context.active_object
        ground.name = "GroundPlane"
        ground.is_shadow_catcher = True
    except Exception as e:
        print(f"[render_scene] WARNING: Could not create ground plane: {e}")

    # ── Lighting — three-point fashion setup ──
    try:
        key_data = bpy.data.lights.new(name="KeyLight", type="AREA")
        key_data.energy = 800
        key_data.size = size * 2
        key_obj = bpy.data.objects.new("KeyLight", key_data)
        key_obj.location = (center.x - size, center.y - size, center.z + size * 1.5)
        bpy.context.scene.collection.objects.link(key_obj)

        fill_data = bpy.data.lights.new(name="FillLight", type="AREA")
        fill_data.energy = 300
        fill_data.size = size * 1.5
        fill_obj = bpy.data.objects.new("FillLight", fill_data)
        fill_obj.location = (center.x + size * 1.5, center.y - size * 0.5, center.z + size * 0.5)
        bpy.context.scene.collection.objects.link(fill_obj)

        rim_data = bpy.data.lights.new(name="RimLight", type="AREA")
        rim_data.energy = 400
        rim_data.size = size
        rim_obj = bpy.data.objects.new("RimLight", rim_data)
        rim_obj.location = (center.x, center.y + size, center.z + size)
        bpy.context.scene.collection.objects.link(rim_obj)
    except Exception as e:
        print(f"[render_scene] WARNING: Lighting setup failed: {e}")

    # ── World background — gradient ──
    try:
        world = bpy.data.worlds.new(name="StudioWorld")
        bpy.context.scene.world = world
        world.use_nodes = True
        nodes = world.node_tree.nodes
        links = world.node_tree.links
        nodes.clear()

        tex_coord = nodes.new("ShaderNodeTexCoord")
        tex_coord.location = (-800, 0)
        separate = nodes.new("ShaderNodeSeparateXYZ")
        separate.location = (-600, 0)
        links.new(tex_coord.outputs["Generated"], separate.inputs["Vector"])
        ramp = nodes.new("ShaderNodeValToRGB")
        ramp.location = (-400, 0)
        ramp.color_ramp.elements[0].position = 0.3
        ramp.color_ramp.elements[0].color = (0.82, 0.80, 0.78, 1.0)
        ramp.color_ramp.elements[1].position = 0.8
        ramp.color_ramp.elements[1].color = (1.0, 1.0, 1.0, 1.0)
        links.new(separate.outputs["Z"], ramp.inputs["Fac"])
        bg_node = nodes.new("ShaderNodeBackground")
        bg_node.location = (-200, 0)
        bg_node.inputs["Strength"].default_value = 0.8
        links.new(ramp.outputs["Color"], bg_node.inputs["Color"])
        output_node = nodes.new("ShaderNodeOutputWorld")
        output_node.location = (0, 0)
        links.new(bg_node.outputs["Background"], output_node.inputs["Surface"])
    except Exception as e:
        print(f"[render_scene] WARNING: World setup failed: {e}")

    # ── Render settings ──
    scene = bpy.context.scene

    # Try Cycles first, fallback to EEVEE
    try:
        scene.render.engine = "CYCLES"
        scene.cycles.device = "GPU"
        scene.cycles.samples = args.samples
        scene.cycles.use_denoising = True
        print(f"[render_scene] Using Cycles GPU renderer")
    except Exception as e:
        print(f"[render_scene] WARNING: Cycles setup failed, trying EEVEE: {e}")
        try:
            scene.render.engine = "BLENDER_EEVEE"
            scene.eevee.taa_render_samples = args.samples
        except Exception as e2:
            print(f"[render_scene] WARNING: EEVEE setup also failed: {e2}")

    scene.render.resolution_x = args.resolution
    scene.render.resolution_y = args.resolution
    scene.render.resolution_percentage = 100

    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.compression = 15

    scene.render.filepath = output_png
    scene.render.film_transparent = True

    # ── Render ──
    print(f"[render_scene] Rendering {args.resolution}x{args.resolution} @ {args.samples} samples...")
    try:
        bpy.ops.render.render(write_still=True)
        print(f"[render_scene] Saved to {output_png}")
    except RuntimeError as e:
        print(f"[render_scene] FATAL: Render failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    render()
