"""
turntable_render.py — 360° turntable camera orbit render → frame sequence → GIF

Renders N frames of a garment rotating (camera orbits) with the same fashion
lighting + gradient background from render_scene.py, then stitches into an
animated GIF using Pillow (installed in the Python env, NOT Blender's Python).

The script renders individual PNGs, then a post-processing step in server.py
converts them to GIF. Alternatively, if Pillow is available inside Blender's
Python, we stitch here.

Parameters:
  --frames       Number of frames in the turntable (default 36 = 10° steps)
  --resolution   Render resolution in px (default 512 for speed)
  --samples      Cycles samples per frame (default 32 for speed)

Usage:
  blender --background --python turntable_render.py -- \
    --input garment.glb --output /tmp/turntable.glb \
    --frames 36 --resolution 512 --samples 32
"""

import bpy
import sys
import os
import math
import argparse
import glob as glob_module
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
    parser.add_argument("--frames", type=int, default=36,
                        help="Number of frames (36 = 10° per frame)")
    parser.add_argument("--resolution", type=int, default=512,
                        help="Render resolution (default 512 for speed)")
    parser.add_argument("--samples", type=int, default=32,
                        help="Cycles samples per frame (lower = faster)")
    return parser.parse_args(argv)


def setup_scene(args):
    """Import garment, set up camera, lights, and world. Returns (center, size, cam_obj)."""

    # Clear scene
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # Import garment
    bpy.ops.import_scene.gltf(filepath=args.input)

    # Calculate bounding box of all mesh objects
    min_co = Vector((float("inf"),) * 3)
    max_co = Vector((float("-inf"),) * 3)

    mesh_found = False
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        mesh_found = True
        for v in obj.bound_box:
            world_v = obj.matrix_world @ Vector(v)
            min_co.x = min(min_co.x, world_v.x)
            min_co.y = min(min_co.y, world_v.y)
            min_co.z = min(min_co.z, world_v.z)
            max_co.x = max(max_co.x, world_v.x)
            max_co.y = max(max_co.y, world_v.y)
            max_co.z = max(max_co.z, world_v.z)

    if not mesh_found:
        print("[turntable] ERROR: No mesh found in GLB")
        sys.exit(1)

    center = (min_co + max_co) / 2
    size = (max_co - min_co).length

    # ── Camera setup — 85mm fashion lens ──
    cam_data = bpy.data.cameras.new(name="TurntableCam")
    cam_data.lens = 85
    cam_obj = bpy.data.objects.new("TurntableCam", cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj

    # ── Shadow catcher ground plane ──
    bpy.ops.mesh.primitive_plane_add(
        size=size * 10,
        location=(center.x, center.y, min_co.z),
    )
    ground = bpy.context.active_object
    ground.name = "GroundPlane"
    ground.is_shadow_catcher = True

    # ── Three-point fashion lighting ──
    # Key light
    key_data = bpy.data.lights.new(name="KeyLight", type="AREA")
    key_data.energy = 800
    key_data.size = size * 2
    key_obj = bpy.data.objects.new("KeyLight", key_data)
    key_obj.location = (center.x - size, center.y - size, center.z + size * 1.5)
    bpy.context.scene.collection.objects.link(key_obj)

    # Fill light
    fill_data = bpy.data.lights.new(name="FillLight", type="AREA")
    fill_data.energy = 300
    fill_data.size = size * 1.5
    fill_obj = bpy.data.objects.new("FillLight", fill_data)
    fill_obj.location = (center.x + size * 1.5, center.y - size * 0.5, center.z + size * 0.5)
    bpy.context.scene.collection.objects.link(fill_obj)

    # Rim light
    rim_data = bpy.data.lights.new(name="RimLight", type="AREA")
    rim_data.energy = 400
    rim_data.size = size
    rim_obj = bpy.data.objects.new("RimLight", rim_data)
    rim_obj.location = (center.x, center.y + size, center.z + size)
    bpy.context.scene.collection.objects.link(rim_obj)

    # ── World background — gradient (warm gray → white) ──
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

    # ── Render settings ──
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "GPU"
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = True

    scene.render.resolution_x = args.resolution
    scene.render.resolution_y = args.resolution
    scene.render.resolution_percentage = 100

    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.compression = 15
    scene.render.film_transparent = True

    return center, size, cam_obj


def render_turntable():
    args = parse_args()
    num_frames = max(4, min(args.frames, 120))  # Clamp 4-120

    # Output directory for frames
    output_base = os.path.splitext(args.output)[0]
    frames_dir = output_base + "_frames"
    os.makedirs(frames_dir, exist_ok=True)

    print(f"[turntable] Rendering {num_frames} frames at {args.resolution}x{args.resolution}, "
          f"{args.samples} samples")

    center, size, cam_obj = setup_scene(args)

    # Camera orbit radius — further back for 85mm lens
    cam_distance = size * 2.5
    # Camera height — slightly above center for fashion angle
    cam_height = center.z + size * 0.2

    # ── Render each frame ──
    for i in range(num_frames):
        angle = (2.0 * math.pi * i) / num_frames

        # Position camera on circular orbit
        cam_x = center.x + cam_distance * math.sin(angle)
        cam_y = center.y - cam_distance * math.cos(angle)
        cam_obj.location = (cam_x, cam_y, cam_height)

        # Point camera at garment center
        direction = center - cam_obj.location
        rot_quat = direction.to_track_quat("-Z", "Y")
        cam_obj.rotation_euler = rot_quat.to_euler()

        # Set output path for this frame
        frame_path = os.path.join(frames_dir, f"frame_{i:04d}.png")
        bpy.context.scene.render.filepath = frame_path

        # Render
        print(f"[turntable] Frame {i+1}/{num_frames} "
              f"(angle {math.degrees(angle):.0f}°)")
        bpy.ops.render.render(write_still=True)

    print(f"[turntable] All {num_frames} frames rendered to {frames_dir}")

    # ── Try to assemble GIF using Pillow (if available) ──
    gif_path = output_base + ".gif"
    try:
        from PIL import Image

        frame_files = sorted(glob_module.glob(os.path.join(frames_dir, "frame_*.png")))
        if frame_files:
            images = []
            for fp in frame_files:
                img = Image.open(fp).convert("RGBA")
                # Composite onto white background for GIF (no alpha in GIF)
                bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
                bg.paste(img, mask=img.split()[3])
                images.append(bg.convert("RGB"))

            # Save animated GIF — 80ms per frame ≈ 12.5 FPS
            images[0].save(
                gif_path,
                save_all=True,
                append_images=images[1:],
                duration=80,
                loop=0,
                optimize=True,
            )
            print(f"[turntable] GIF assembled: {gif_path}")
        else:
            print("[turntable] WARNING: No frame files found for GIF assembly")
    except ImportError:
        print("[turntable] Pillow not available in Blender Python — "
              "GIF will be assembled by server.py")

    # Write a marker file so server.py knows the frames directory
    marker_path = output_base + "_turntable.json"
    import json
    with open(marker_path, "w") as f:
        json.dump({
            "frames_dir": frames_dir,
            "gif_path": gif_path,
            "num_frames": num_frames,
            "resolution": args.resolution,
        }, f)
    print(f"[turntable] Marker written: {marker_path}")


if __name__ == "__main__":
    render_turntable()
