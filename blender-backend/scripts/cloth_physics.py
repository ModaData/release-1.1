"""
cloth_physics.py — Cloth modifier + fabric-adaptive sim profiles + mannequin collision body
Supports 8 fabric types with tuned physics: cotton, silk, denim, leather, wool, linen, spandex, velvet.

Each fabric has a per-profile quality step count and frame count so silk jiggles long (150 frames,
quality 5) while leather settles fast (45 frames, quality 15). A --quality_preset multiplier
(fast/standard/high) scales both on top of the per-fabric baseline.

After cloth bake on the body object, Surface Deform modifiers are applied to attached parts
(collar, pocket, placket) so they follow body deformation automatically.

Error-hardened: cloth simulation bake and modifier apply wrapped in try/except,
mannequin cleanup guaranteed, mesh validated before processing.

Usage: blender --background --python cloth_physics.py -- --input garment.glb --output draped.glb --size M --fabric_type cotton [--frames N] [--quality_preset standard]
"""

import bpy
import sys
import math
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from blender_helpers import (
    safe_op, ensure_mode, check_mesh, safe_modifier_apply,
    safe_import_glb, safe_export_glb, wrap_main,
)


# Size-to-mannequin scale mapping
SIZE_SCALES = {
    "XS": 0.92,
    "S": 0.96,
    "M": 1.0,
    "L": 1.04,
    "XL": 1.08,
    "XXL": 1.14,
}

# Fabric-specific physics presets
# quality  = Cloth modifier quality steps (higher = more accurate, slower)
# frames   = Simulation frame count (silk needs 150 to settle; leather only 45)
# mass/tension/damping drive actual cloth behavior
FABRIC_PHYSICS = {
    "silk": {
        "quality": 5,   "frames": 150,
        "mass": 0.15,
        "tension_stiffness": 5.0,  "compression_stiffness": 5.0,
        "shear_stiffness": 2.0,    "bending_stiffness": 0.05,
        "tension_damping": 2.0,    "compression_damping": 2.0,
        "shear_damping": 2.0,      "bending_damping": 0.1,
        "air_damping": 1.0,
    },
    "spandex": {
        "quality": 5,   "frames": 120,
        "mass": 0.20,
        "tension_stiffness": 5.0,  "compression_stiffness": 5.0,
        "shear_stiffness": 1.0,    "bending_stiffness": 0.1,
        "tension_damping": 3.0,    "compression_damping": 3.0,
        "shear_damping": 3.0,      "bending_damping": 0.2,
        "air_damping": 1.0,
    },
    "linen": {
        "quality": 7,   "frames": 75,
        "mass": 0.25,
        "tension_stiffness": 12.0, "compression_stiffness": 12.0,
        "shear_stiffness": 4.0,    "bending_stiffness": 0.8,
        "tension_damping": 4.0,    "compression_damping": 4.0,
        "shear_damping": 4.0,      "bending_damping": 0.4,
        "air_damping": 1.0,
    },
    "cotton": {
        "quality": 8,   "frames": 60,
        "mass": 0.30,
        "tension_stiffness": 15.0, "compression_stiffness": 15.0,
        "shear_stiffness": 5.0,    "bending_stiffness": 0.5,
        "tension_damping": 5.0,    "compression_damping": 5.0,
        "shear_damping": 5.0,      "bending_damping": 0.5,
        "air_damping": 1.0,
    },
    "velvet": {
        "quality": 8,   "frames": 60,
        "mass": 0.35,
        "tension_stiffness": 18.0, "compression_stiffness": 18.0,
        "shear_stiffness": 6.0,    "bending_stiffness": 0.6,
        "tension_damping": 6.0,    "compression_damping": 6.0,
        "shear_damping": 6.0,      "bending_damping": 0.6,
        "air_damping": 0.8,
    },
    "wool": {
        "quality": 9,   "frames": 65,
        "mass": 0.40,
        "tension_stiffness": 20.0, "compression_stiffness": 20.0,
        "shear_stiffness": 8.0,    "bending_stiffness": 1.0,
        "tension_damping": 8.0,    "compression_damping": 8.0,
        "shear_damping": 8.0,      "bending_damping": 1.0,
        "air_damping": 0.8,
    },
    "denim": {
        "quality": 10,  "frames": 60,
        "mass": 0.50,
        "tension_stiffness": 40.0, "compression_stiffness": 40.0,
        "shear_stiffness": 20.0,   "bending_stiffness": 5.0,
        "tension_damping": 10.0,   "compression_damping": 10.0,
        "shear_damping": 10.0,     "bending_damping": 2.0,
        "air_damping": 0.5,
    },
    "leather": {
        "quality": 15,  "frames": 45,
        "mass": 0.80,
        "tension_stiffness": 80.0, "compression_stiffness": 80.0,
        "shear_stiffness": 40.0,   "bending_stiffness": 10.0,
        "tension_damping": 15.0,   "compression_damping": 15.0,
        "shear_damping": 15.0,     "bending_damping": 5.0,
        "air_damping": 0.3,
    },
}

# quality_preset multipliers applied on top of per-fabric baseline
QUALITY_PRESETS = {
    "fast":     {"quality": 0.6, "frames": 0.6},
    "standard": {"quality": 1.0, "frames": 1.0},
    "high":     {"quality": 1.5, "frames": 1.2},
}

# Part names that get Surface Deform binding (follow the cloth-simmed body)
ATTACHED_PART_TYPES = {"collar", "pocket", "placket", "hem", "waistband"}


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
    parser.add_argument("--frames", type=int, default=None,
                        help="Override frame count (default: per-fabric profile)")
    parser.add_argument("--fabric_type", default="cotton",
                        help=f"Fabric type: {', '.join(FABRIC_PHYSICS.keys())}")
    parser.add_argument("--quality_preset", default="standard",
                        choices=["fast", "standard", "high"],
                        help="Simulation quality multiplier on top of per-fabric baseline")
    return parser.parse_args(argv)


def create_mannequin_collision(center, height, radius, scale):
    """Create a simple cylinder mannequin as collision body."""
    try:
        bpy.ops.mesh.primitive_cylinder_add(
            radius=radius * scale,
            depth=height,
            location=(center[0], center[1], center[2]),
        )
        mannequin = bpy.context.active_object
        mannequin.name = "Mannequin_Collision"

        # Add collision modifier
        col_mod = mannequin.modifiers.new(name="Collision", type="COLLISION")
        col_mod.settings.thickness_outer = 0.01
        col_mod.settings.thickness_inner = 0.005
        col_mod.settings.damping = 0.5
        col_mod.settings.friction = 0.5

        return mannequin
    except Exception as e:
        print(f"[cloth_physics] WARNING: Could not create mannequin: {e}")
        return None


@wrap_main
def setup_cloth():
    args = parse_args()
    fabric_type = args.fabric_type.lower()
    physics = FABRIC_PHYSICS.get(fabric_type, FABRIC_PHYSICS["cotton"])

    if fabric_type not in FABRIC_PHYSICS:
        print(f"[cloth_physics] WARNING: Unknown fabric '{fabric_type}', using cotton")
        fabric_type = "cotton"

    # Compute fabric-adaptive quality and frame count
    preset_mults = QUALITY_PRESETS.get(args.quality_preset, QUALITY_PRESETS["standard"])
    sim_quality = max(1, int(physics["quality"] * preset_mults["quality"]))
    sim_frames = max(10, int(physics["frames"] * preset_mults["frames"]))
    # Explicit --frames arg overrides the profile
    if args.frames is not None:
        sim_frames = args.frames

    print(f"[cloth_physics] Fabric: {fabric_type}")
    print(f"[cloth_physics] Size: {args.size}, Quality: {sim_quality}, Frames: {sim_frames} "
          f"(preset: {args.quality_preset})")

    # Import GLB
    meshes, err = safe_import_glb(args.input)
    if err:
        print(f"[cloth_physics] FATAL: {err}")
        sys.exit(1)

    if not meshes:
        print("[cloth_physics] FATAL: No mesh found in GLB")
        sys.exit(1)

    # Collect mesh objects with original names
    mesh_objects = [(obj, obj.name) for obj in meshes]

    # Identify body object (cloth sim target) vs attached parts (Surface Deform followers)
    body_obj_candidate = None
    attached_objs = []
    for obj, name in mesh_objects:
        part_type = obj.get("garment_part_type", "")
        if part_type == "body" or "body" in name.lower():
            if body_obj_candidate is None:
                body_obj_candidate = obj
        elif part_type in ATTACHED_PART_TYPES or any(t in name.lower() for t in ATTACHED_PART_TYPES):
            attached_objs.append(obj)

    # Use primary mesh as cloth sim target (fall back to first mesh if no body found)
    garment = body_obj_candidate if body_obj_candidate else mesh_objects[0][0]

    # Pre-check garment
    ok, reason = check_mesh(garment, min_verts=10)
    if not ok:
        print(f"[cloth_physics] FATAL: Garment mesh invalid: {reason}")
        sys.exit(1)

    bpy.context.view_layer.objects.active = garment
    garment.select_set(True)

    # Calculate garment bounding box
    from mathutils import Vector
    min_co = Vector((float("inf"),) * 3)
    max_co = Vector((float("-inf"),) * 3)
    for v in garment.bound_box:
        world_v = garment.matrix_world @ Vector(v)
        min_co.x = min(min_co.x, world_v.x)
        min_co.y = min(min_co.y, world_v.y)
        min_co.z = min(min_co.z, world_v.z)
        max_co.x = max(max_co.x, world_v.x)
        max_co.y = max(max_co.y, world_v.y)
        max_co.z = max(max_co.z, world_v.z)

    center = (min_co + max_co) / 2
    height = max_co.z - min_co.z
    width = max(max_co.x - min_co.x, max_co.y - min_co.y)

    scale = SIZE_SCALES.get(args.size.upper(), 1.0)
    print(f"[cloth_physics] Applying size {args.size} (scale {scale})")

    # Create mannequin collision body
    mannequin = create_mannequin_collision(
        center=(center.x, center.y, center.z),
        height=height * 0.9,
        radius=width * 0.25,
        scale=scale,
    )
    if mannequin:
        print(f"[cloth_physics] Created mannequin collision body")
    else:
        print(f"[cloth_physics] WARNING: No mannequin - cloth sim will run without collision body")

    # Reselect garment
    bpy.context.view_layer.objects.active = garment
    garment.select_set(True)

    # ── Add "Basis" shape key (captures original assembled state) ─────────────
    # Must happen BEFORE the cloth modifier is added so "Basis" = undeformed mesh.
    bpy.ops.object.shape_key_add(from_mix=False)
    garment.data.shape_keys.key_blocks[-1].name = "Basis"
    print(f"[cloth_physics] Created 'Basis' shape key (original assembled state)")

    # Add Cloth modifier
    cloth_mod = garment.modifiers.new(name="Cloth", type="CLOTH")
    cloth = cloth_mod.settings

    # Apply fabric-adaptive quality + physics
    cloth.quality = sim_quality
    cloth.mass = physics["mass"]
    cloth.air_damping = physics["air_damping"]
    cloth.tension_stiffness = physics["tension_stiffness"]
    cloth.compression_stiffness = physics["compression_stiffness"]
    cloth.shear_stiffness = physics["shear_stiffness"]
    cloth.bending_stiffness = physics["bending_stiffness"]
    cloth.tension_damping = physics["tension_damping"]
    cloth.compression_damping = physics["compression_damping"]
    cloth.shear_damping = physics["shear_damping"]
    cloth.bending_damping = physics["bending_damping"]

    # Enable sewing springs
    cloth.use_sewing_springs = True
    cloth.sewing_force_max = 10.0

    # Self-collision
    cloth_mod.collision_settings.use_collision = True
    cloth_mod.collision_settings.collision_quality = 3
    cloth_mod.collision_settings.distance_min = 0.005
    cloth_mod.collision_settings.use_self_collision = True
    cloth_mod.collision_settings.self_distance_min = 0.005

    print(f"[cloth_physics] Physics: mass={physics['mass']}, "
          f"tension={physics['tension_stiffness']}, "
          f"bending={physics['bending_stiffness']}")

    # Set scene frame range
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = sim_frames

    # Bake cloth simulation
    print(f"[cloth_physics] Baking {sim_frames} frames of cloth sim...")
    try:
        override = bpy.context.copy()
        override["point_cache"] = cloth_mod.point_cache
        bpy.ops.ptcache.bake(override, bake=True)
        print(f"[cloth_physics] Bake complete")
    except RuntimeError as e:
        print(f"[cloth_physics] WARNING: Cloth bake failed: {e}")
        print(f"[cloth_physics] Continuing with unbaked cloth (will try to apply modifier)")

    # ── Go to last frame and bake cloth deformation as "Draped" shape key ────
    scene.frame_set(sim_frames)

    draped_key_created = False
    try:
        # Blender 3.3+ API: apply modifier as shape key (non-destructive for basis)
        bpy.context.view_layer.objects.active = garment
        garment.select_set(True)
        bpy.ops.object.modifier_apply_as_shapekey(
            keep_modifier=False,
            modifier=cloth_mod.name,
        )
        # The new shape key is named after the modifier (e.g. "Cloth")
        # Rename it to "Draped" for clarity
        for kb in garment.data.shape_keys.key_blocks:
            if kb.name not in ("Basis", "Flat", "Draped"):
                kb.name = "Draped"
                break
        # Set values: Basis=0 (reference), Draped=1 (export in draped pose)
        for kb in garment.data.shape_keys.key_blocks:
            kb.value = 1.0 if kb.name == "Draped" else 0.0
        draped_key_created = True
        print(f"[cloth_physics] Created 'Draped' shape key via modifier_apply_as_shapekey")
    except (RuntimeError, AttributeError) as e:
        # Fallback for Blender < 3.3 or if modifier_apply_as_shapekey is unavailable
        print(f"[cloth_physics] WARNING: modifier_apply_as_shapekey failed ({e}) — "
              f"falling back to destructive apply (no shape keys)")
        if not safe_modifier_apply(garment, cloth_mod.name, "Cloth modifier"):
            print(f"[cloth_physics] WARNING: Could not apply cloth modifier, exporting raw mesh")

    # Surface Deform: bind attached parts to deformed body
    if attached_objs and garment:
        print(f"[cloth_physics] Binding {len(attached_objs)} attached parts via Surface Deform")
        for attached in attached_objs:
            try:
                sd_mod = attached.modifiers.new("SurfaceDeform", "SURFACE_DEFORM")
                sd_mod.target = garment
                bpy.context.view_layer.objects.active = attached
                attached.select_set(True)
                bpy.ops.object.surfacedeform_bind(modifier=sd_mod.name)
                safe_modifier_apply(attached, sd_mod.name, "SurfaceDeform")
                attached.select_set(False)
                print(f"[cloth_physics]   Bound: {attached.name}")
            except Exception as e:
                print(f"[cloth_physics]   WARNING: Surface Deform failed for {attached.name}: {e}")
                try:
                    if "SurfaceDeform" in attached.modifiers:
                        attached.modifiers.remove(attached.modifiers["SurfaceDeform"])
                except Exception:
                    pass

    # Remove mannequin before export (guaranteed cleanup)
    if mannequin:
        try:
            bpy.data.objects.remove(mannequin, do_unlink=True)
            print(f"[cloth_physics] Removed mannequin collision body")
        except (ReferenceError, RuntimeError) as e:
            print(f"[cloth_physics] WARNING: Could not remove mannequin: {e}")

    # Restore original names
    for obj, original_name in mesh_objects:
        try:
            if obj and obj.name:
                obj.name = original_name
        except ReferenceError:
            pass  # Object was deleted

    # Export
    success, err = safe_export_glb(args.output)
    if not success:
        print(f"[cloth_physics] FATAL: Export failed: {err}")
        sys.exit(1)

    print(f"[cloth_physics] Exported to {args.output}")

    # ── Write metadata sidecar ────────────────────────────────────────────────
    import json as _json
    shape_keys = []
    if garment.data.shape_keys:
        shape_keys = [kb.name for kb in garment.data.shape_keys.key_blocks]
    meta = {
        "shape_keys":      shape_keys,
        "has_draped_state": draped_key_created,
        "fabric_type":     fabric_type,
        "size":            args.size,
        "quality_preset":  args.quality_preset,
        "sim_frames":      sim_frames,
    }
    meta_path = str(args.output).rsplit(".", 1)[0] + "_cloth_meta.json"
    try:
        with open(meta_path, "w") as f:
            _json.dump(meta, f, indent=2)
        print(f"[cloth_physics] Metadata written to {meta_path}")
    except Exception as e:
        print(f"[cloth_physics] WARNING: Could not write metadata: {e}")


if __name__ == "__main__":
    setup_cloth()
