"""
CLO3D-Compatible API Layer for Blender
=======================================
Mirrors CLO3D's Python API structure so garment construction code can target
both CLO3D and Blender with minimal changes.

Modules:
  pattern_api  — Create / query / move 2D pattern pieces
  fabric_api   — PBR material creation + assignment
  utility_api  — Cloth simulation, arrangement, frame control
  export_api   — GLB, OBJ, DXF, SVG, JSON export

Works in Blender background mode (bpy) and as a standalone importable module.
"""

import math
import json
import os
import sys
from typing import List, Tuple, Dict, Optional

try:
    import bpy
    import bmesh
    from mathutils import Vector, Matrix
    HAS_BPY = True
except ImportError:
    HAS_BPY = False

# ══════════════════════════════════════════════════════════════════════════════
# Fabric physics presets — maps to Blender cloth modifier settings
# ══════════════════════════════════════════════════════════════════════════════

FABRIC_PHYSICS = {
    "cotton":    {"mass": 0.150, "stiffness": 15.0,  "bending": 5.0,   "damping": 5.0,  "friction": 0.80, "air_drag": 1.0,  "thickness": 0.0018},
    "silk":      {"mass": 0.080, "stiffness": 5.0,   "bending": 1.0,   "damping": 2.0,  "friction": 0.30, "air_drag": 0.5,  "thickness": 0.0008},
    "wool":      {"mass": 0.250, "stiffness": 20.0,  "bending": 10.0,  "damping": 8.0,  "friction": 0.70, "air_drag": 1.5,  "thickness": 0.003},
    "denim":     {"mass": 0.350, "stiffness": 40.0,  "bending": 20.0,  "damping": 10.0, "friction": 0.90, "air_drag": 2.0,  "thickness": 0.0035},
    "leather":   {"mass": 0.600, "stiffness": 60.0,  "bending": 30.0,  "damping": 15.0, "friction": 0.95, "air_drag": 2.5,  "thickness": 0.005},
    "velvet":    {"mass": 0.300, "stiffness": 12.0,  "bending": 6.0,   "damping": 7.0,  "friction": 0.85, "air_drag": 1.2,  "thickness": 0.004},
    "chiffon":   {"mass": 0.050, "stiffness": 2.0,   "bending": 0.5,   "damping": 1.0,  "friction": 0.20, "air_drag": 0.3,  "thickness": 0.0005},
    "satin":     {"mass": 0.120, "stiffness": 8.0,   "bending": 2.0,   "damping": 3.0,  "friction": 0.25, "air_drag": 0.6,  "thickness": 0.001},
    "jersey":    {"mass": 0.180, "stiffness": 6.0,   "bending": 2.5,   "damping": 4.0,  "friction": 0.65, "air_drag": 0.8,  "thickness": 0.0015},
    "linen":     {"mass": 0.180, "stiffness": 18.0,  "bending": 8.0,   "damping": 6.0,  "friction": 0.75, "air_drag": 1.2,  "thickness": 0.0022},
    "tweed":     {"mass": 0.400, "stiffness": 35.0,  "bending": 18.0,  "damping": 12.0, "friction": 0.88, "air_drag": 2.0,  "thickness": 0.004},
    "polyester": {"mass": 0.130, "stiffness": 10.0,  "bending": 3.0,   "damping": 3.5,  "friction": 0.50, "air_drag": 0.7,  "thickness": 0.0012},
}

# ══════════════════════════════════════════════════════════════════════════════
# Fabric PBR presets — maps to Principled BSDF inputs + texture scales
# ══════════════════════════════════════════════════════════════════════════════

FABRIC_PBR = {
    "cotton":    {"roughness": 0.85, "metallic": 0.0, "specular": 0.3, "sheen": 0.2, "noise_scale": 120.0, "bump_strength": 0.15},
    "silk":      {"roughness": 0.25, "metallic": 0.0, "specular": 0.8, "sheen": 0.9, "noise_scale": 200.0, "bump_strength": 0.05},
    "wool":      {"roughness": 0.90, "metallic": 0.0, "specular": 0.2, "sheen": 0.5, "noise_scale": 60.0,  "bump_strength": 0.25},
    "denim":     {"roughness": 0.80, "metallic": 0.0, "specular": 0.3, "sheen": 0.1, "noise_scale": 80.0,  "bump_strength": 0.30},
    "leather":   {"roughness": 0.50, "metallic": 0.0, "specular": 0.5, "sheen": 0.0, "noise_scale": 40.0,  "bump_strength": 0.40},
    "velvet":    {"roughness": 0.95, "metallic": 0.0, "specular": 0.1, "sheen": 1.0, "noise_scale": 150.0, "bump_strength": 0.10},
    "chiffon":   {"roughness": 0.30, "metallic": 0.0, "specular": 0.6, "sheen": 0.4, "noise_scale": 250.0, "bump_strength": 0.03},
    "satin":     {"roughness": 0.20, "metallic": 0.0, "specular": 0.9, "sheen": 0.8, "noise_scale": 180.0, "bump_strength": 0.04},
    "jersey":    {"roughness": 0.75, "metallic": 0.0, "specular": 0.3, "sheen": 0.3, "noise_scale": 100.0, "bump_strength": 0.12},
    "linen":     {"roughness": 0.82, "metallic": 0.0, "specular": 0.3, "sheen": 0.2, "noise_scale": 90.0,  "bump_strength": 0.20},
    "tweed":     {"roughness": 0.92, "metallic": 0.0, "specular": 0.2, "sheen": 0.3, "noise_scale": 50.0,  "bump_strength": 0.35},
    "polyester": {"roughness": 0.55, "metallic": 0.0, "specular": 0.5, "sheen": 0.2, "noise_scale": 140.0, "bump_strength": 0.08},
}

# Tag used on Blender objects created by this API
PATTERN_TAG = "clo3d_pattern"


def _require_bpy():
    if not HAS_BPY:
        raise RuntimeError("This function requires Blender's bpy module. Run inside Blender.")


def _get_pattern_objects() -> list:
    """Return all mesh objects tagged as pattern pieces, sorted by creation order."""
    _require_bpy()
    objs = [o for o in bpy.data.objects if o.type == "MESH" and o.get(PATTERN_TAG)]
    objs.sort(key=lambda o: o.get("clo3d_index", 0))
    return objs


def _hex_to_rgba(hex_color: str) -> Tuple[float, float, float, float]:
    """Convert '#RRGGBB' or '#RGB' to linear RGBA tuple (0-1)."""
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    r, g, b = int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0
    # sRGB to linear approximation
    r, g, b = r ** 2.2, g ** 2.2, b ** 2.2
    return (r, g, b, 1.0)


# ══════════════════════════════════════════════════════════════════════════════
# pattern_api
# ══════════════════════════════════════════════════════════════════════════════

class pattern_api:
    """Create and manipulate 2D pattern pieces (flat meshes in Blender)."""

    @staticmethod
    def CreatePatternWithPoints(points_tuple: List[Tuple[float, float]]) -> int:
        """Create a flat Blender mesh from 2D coordinate tuples (in cm).

        Args:
            points_tuple: List of (x, y) tuples in centimetres.
                          Defines the outline of a pattern piece.

        Returns:
            Index of the newly created pattern in the pattern list.
        """
        _require_bpy()

        # Convert cm to Blender units (metres)
        scale = 0.01
        verts_3d = [(x * scale, y * scale, 0.0) for x, y in points_tuple]

        # Create mesh via bmesh for proper topology
        mesh = bpy.data.meshes.new("Pattern")
        bm = bmesh.new()

        bm_verts = [bm.verts.new(v) for v in verts_3d]
        bm.verts.ensure_lookup_table()

        # Create face from all vertices (polygon)
        try:
            face = bm.faces.new(bm_verts)
        except ValueError:
            # Duplicate vertices or degenerate polygon — try cleaning
            bmesh.ops.remove_doubles(bm, verts=bm_verts, dist=0.0001)
            bm.verts.ensure_lookup_table()
            bm_verts = list(bm.verts)
            if len(bm_verts) >= 3:
                face = bm.faces.new(bm_verts)
            else:
                bm.free()
                raise ValueError("Need at least 3 unique points to create a pattern piece")

        # Subdivide for cloth simulation resolution
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=4, use_grid_fill=True)

        # UV unwrap — project from top
        bm.faces.ensure_lookup_table()
        uv_layer = bm.loops.layers.uv.new("UVMap")
        for f in bm.faces:
            for loop in f.loops:
                co = loop.vert.co
                loop[uv_layer].uv = (co.x / scale, co.y / scale)

        bm.to_mesh(mesh)
        bm.free()
        mesh.update()

        # Create object
        patterns = _get_pattern_objects()
        idx = len(patterns)
        obj = bpy.data.objects.new(f"Pattern_{idx:03d}", mesh)
        obj[PATTERN_TAG] = True
        obj["clo3d_index"] = idx

        bpy.context.collection.objects.link(obj)
        bpy.context.view_layer.objects.active = obj

        return idx

    @staticmethod
    def GetPatternCount() -> int:
        """Return the number of pattern pieces in the scene."""
        return len(_get_pattern_objects())

    @staticmethod
    def GetPatternSize(pattern_index: int) -> Tuple[float, float]:
        """Return (width_cm, height_cm) of a pattern piece."""
        patterns = _get_pattern_objects()
        if pattern_index < 0 or pattern_index >= len(patterns):
            raise IndexError(f"Pattern index {pattern_index} out of range (have {len(patterns)})")
        obj = patterns[pattern_index]
        # Get bounding box in local space
        bbox = [Vector(v) for v in obj.bound_box]
        min_x = min(v.x for v in bbox)
        max_x = max(v.x for v in bbox)
        min_y = min(v.y for v in bbox)
        max_y = max(v.y for v in bbox)
        # Convert metres back to cm
        width_cm = (max_x - min_x) * 100.0
        height_cm = (max_y - min_y) * 100.0
        return (round(width_cm, 2), round(height_cm, 2))

    @staticmethod
    def GetPatternPieceIndex(name: str) -> int:
        """Find a pattern piece by name. Returns -1 if not found."""
        for i, obj in enumerate(_get_pattern_objects()):
            if obj.name == name:
                return i
        return -1

    @staticmethod
    def SetPatternName(index: int, name: str):
        """Rename a pattern piece."""
        patterns = _get_pattern_objects()
        if index < 0 or index >= len(patterns):
            raise IndexError(f"Pattern index {index} out of range")
        patterns[index].name = name
        patterns[index].data.name = name

    @staticmethod
    def MovePattern(index: int, x: float, y: float):
        """Reposition a 2D pattern piece (x, y in cm)."""
        patterns = _get_pattern_objects()
        if index < 0 or index >= len(patterns):
            raise IndexError(f"Pattern index {index} out of range")
        obj = patterns[index]
        obj.location.x = x * 0.01
        obj.location.y = y * 0.01


# ══════════════════════════════════════════════════════════════════════════════
# fabric_api
# ══════════════════════════════════════════════════════════════════════════════

class fabric_api:
    """Create PBR materials that mimic real fabric appearance."""

    @staticmethod
    def AddFabric(fabric_type: str, color_hex: str = "#808080") -> int:
        """Create a PBR Blender material with procedural texture nodes.

        Args:
            fabric_type: One of the FABRIC_PBR keys (cotton, silk, etc.)
            color_hex: Base color as '#RRGGBB'

        Returns:
            Index of the new material in bpy.data.materials.
        """
        _require_bpy()

        fabric_type = fabric_type.lower()
        pbr = FABRIC_PBR.get(fabric_type, FABRIC_PBR["cotton"])

        mat = bpy.data.materials.new(name=f"Fabric_{fabric_type}_{len(bpy.data.materials):03d}")
        mat.use_nodes = True
        mat["clo3d_fabric"] = True
        mat["fabric_type"] = fabric_type

        tree = mat.node_tree
        nodes = tree.nodes
        links = tree.links

        # Clear defaults
        for node in nodes:
            nodes.remove(node)

        # Output
        output = nodes.new("ShaderNodeOutputMaterial")
        output.location = (800, 0)

        # Principled BSDF
        bsdf = nodes.new("ShaderNodeBsdfPrincipled")
        bsdf.location = (400, 0)
        rgba = _hex_to_rgba(color_hex)
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Roughness"].default_value = pbr["roughness"]
        bsdf.inputs["Metallic"].default_value = pbr["metallic"]
        bsdf.inputs["Specular IOR Level"].default_value = pbr["specular"]
        links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])

        # Texture coordinate
        tex_coord = nodes.new("ShaderNodeTexCoord")
        tex_coord.location = (-600, 0)

        # Mapping
        mapping = nodes.new("ShaderNodeMapping")
        mapping.location = (-400, 0)
        links.new(tex_coord.outputs["UV"], mapping.inputs["Vector"])

        # ── Noise texture for weave pattern ──
        noise = nodes.new("ShaderNodeTexNoise")
        noise.location = (-200, 200)
        noise.inputs["Scale"].default_value = pbr["noise_scale"]
        noise.inputs["Detail"].default_value = 8.0
        noise.inputs["Roughness"].default_value = 0.6
        links.new(mapping.outputs["Vector"], noise.inputs["Vector"])

        # Bump node
        bump = nodes.new("ShaderNodeBump")
        bump.location = (200, -200)
        bump.inputs["Strength"].default_value = pbr["bump_strength"]
        bump.inputs["Distance"].default_value = 0.01
        links.new(noise.outputs["Fac"], bump.inputs["Height"])
        links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

        # ── Fabric-specific texture nodes ──
        if fabric_type == "leather":
            # Voronoi texture for leather grain
            voronoi = nodes.new("ShaderNodeTexVoronoi")
            voronoi.location = (-200, -100)
            voronoi.inputs["Scale"].default_value = 30.0
            voronoi.distance = "MINKOWSKI"
            links.new(mapping.outputs["Vector"], voronoi.inputs["Vector"])

            # Mix voronoi into bump
            mix_bump = nodes.new("ShaderNodeMix")
            mix_bump.data_type = "FLOAT"
            mix_bump.location = (0, -200)
            mix_bump.inputs["Factor"].default_value = 0.5
            links.new(noise.outputs["Fac"], mix_bump.inputs[2])      # A
            links.new(voronoi.outputs["Distance"], mix_bump.inputs[3])  # B
            links.new(mix_bump.outputs[0], bump.inputs["Height"])

        elif fabric_type == "denim":
            # Wave texture for twill weave
            wave = nodes.new("ShaderNodeTexWave")
            wave.location = (-200, -100)
            wave.inputs["Scale"].default_value = 50.0
            wave.inputs["Distortion"].default_value = 2.0
            wave.wave_type = "BANDS"
            wave.bands_direction = "DIAGONAL"
            links.new(mapping.outputs["Vector"], wave.inputs["Vector"])

            mix_wave = nodes.new("ShaderNodeMix")
            mix_wave.data_type = "FLOAT"
            mix_wave.location = (0, -200)
            mix_wave.inputs["Factor"].default_value = 0.6
            links.new(noise.outputs["Fac"], mix_wave.inputs[2])
            links.new(wave.outputs["Fac"], mix_wave.inputs[3])
            links.new(mix_wave.outputs[0], bump.inputs["Height"])

        elif fabric_type in ("silk", "satin", "chiffon"):
            # Anisotropic-like effect via wave
            wave = nodes.new("ShaderNodeTexWave")
            wave.location = (-200, -100)
            wave.inputs["Scale"].default_value = 200.0
            wave.inputs["Distortion"].default_value = 0.5
            wave.wave_type = "BANDS"
            links.new(mapping.outputs["Vector"], wave.inputs["Vector"])

            # Modulate roughness slightly for sheen
            mix_rough = nodes.new("ShaderNodeMix")
            mix_rough.data_type = "FLOAT"
            mix_rough.location = (200, 100)
            mix_rough.inputs["Factor"].default_value = 0.15
            mix_rough.inputs[2].default_value = pbr["roughness"]
            links.new(wave.outputs["Fac"], mix_rough.inputs[3])
            links.new(mix_rough.outputs[0], bsdf.inputs["Roughness"])

        elif fabric_type == "tweed":
            # Voronoi for speckle pattern
            voronoi = nodes.new("ShaderNodeTexVoronoi")
            voronoi.location = (-200, -100)
            voronoi.inputs["Scale"].default_value = 80.0
            links.new(mapping.outputs["Vector"], voronoi.inputs["Vector"])

            # Color variation
            mix_color = nodes.new("ShaderNodeMix")
            mix_color.data_type = "RGBA"
            mix_color.location = (100, 200)
            mix_color.inputs["Factor"].default_value = 0.15
            mix_color.inputs[6].default_value = rgba
            # Slightly lighter variant
            lighter = tuple(min(c * 1.3, 1.0) for c in rgba[:3]) + (1.0,)
            mix_color.inputs[7].default_value = lighter
            links.new(voronoi.outputs["Distance"], mix_color.inputs["Factor"])
            links.new(mix_color.outputs[2], bsdf.inputs["Base Color"])

        return list(bpy.data.materials).index(mat)

    @staticmethod
    def AssignFabricToPattern(fabric_index: int, pattern_index: int):
        """Assign a material to a pattern mesh."""
        _require_bpy()
        materials = list(bpy.data.materials)
        if fabric_index < 0 or fabric_index >= len(materials):
            raise IndexError(f"Fabric index {fabric_index} out of range")
        patterns = _get_pattern_objects()
        if pattern_index < 0 or pattern_index >= len(patterns):
            raise IndexError(f"Pattern index {pattern_index} out of range")

        obj = patterns[pattern_index]
        mat = materials[fabric_index]

        if obj.data.materials:
            obj.data.materials[0] = mat
        else:
            obj.data.materials.append(mat)

    @staticmethod
    def GetFabricCount() -> int:
        """Return the number of fabric materials in the scene."""
        _require_bpy()
        return len([m for m in bpy.data.materials if m.get("clo3d_fabric")])

    @staticmethod
    def SetFabricPBRMaterialBaseColor(colorway_idx: int, fabric_idx: int,
                                       r: float, g: float, b: float, a: float = 1.0):
        """Change the base colour of a fabric material.

        Args:
            colorway_idx: Colorway index (reserved for multi-colorway support, currently unused).
            fabric_idx: Index of the material in bpy.data.materials.
            r, g, b, a: Linear colour values 0-1.
        """
        _require_bpy()
        materials = list(bpy.data.materials)
        if fabric_idx < 0 or fabric_idx >= len(materials):
            raise IndexError(f"Fabric index {fabric_idx} out of range")
        mat = materials[fabric_idx]
        if not mat.use_nodes:
            return
        bsdf = None
        for node in mat.node_tree.nodes:
            if node.type == "BSDF_PRINCIPLED":
                bsdf = node
                break
        if bsdf:
            bsdf.inputs["Base Color"].default_value = (r, g, b, a)


# ══════════════════════════════════════════════════════════════════════════════
# utility_api
# ══════════════════════════════════════════════════════════════════════════════

class utility_api:
    """Simulation, arrangement, and scene control."""

    @staticmethod
    def Simulate(frame_count: int = 30):
        """Run cloth physics simulation on all pattern objects.

        Sets up cloth modifier on each pattern, creates a simple collision
        mannequin, pins top edges, and steps through frames.

        Args:
            frame_count: Number of simulation frames to bake.
        """
        _require_bpy()

        patterns = _get_pattern_objects()
        if not patterns:
            print("[clo3d] No patterns to simulate")
            return

        # Create simple mannequin collision body if not present
        mannequin = bpy.data.objects.get("Mannequin")
        if mannequin is None:
            bpy.ops.mesh.primitive_cylinder_add(
                radius=0.15, depth=0.6,
                location=(0, 0, 0.3)
            )
            mannequin = bpy.context.active_object
            mannequin.name = "Mannequin"
            mannequin[PATTERN_TAG] = False  # Not a pattern

            # Add collision modifier
            col_mod = mannequin.modifiers.new("Collision", "COLLISION")
            col_mod.settings.thickness_outer = 0.01
            col_mod.settings.cloth_friction = 5.0

        # Set up cloth on each pattern
        for obj in patterns:
            # Skip if already has cloth modifier
            if any(m.type == "CLOTH" for m in obj.modifiers):
                continue

            fabric_type = "cotton"
            if obj.data.materials:
                mat = obj.data.materials[0]
                fabric_type = mat.get("fabric_type", "cotton")

            phys = FABRIC_PHYSICS.get(fabric_type, FABRIC_PHYSICS["cotton"])

            cloth = obj.modifiers.new("Cloth", "CLOTH")
            cs = cloth.settings
            cs.mass = phys["mass"]
            cs.tension_stiffness = phys["stiffness"]
            cs.compression_stiffness = phys["stiffness"]
            cs.bending_stiffness = phys["bending"]
            cs.tension_damping = phys["damping"]
            cs.compression_damping = phys["damping"]
            cs.bending_damping = phys["damping"]
            cs.air_damping = phys["air_drag"]

            # Pin top edge vertices (vertex group)
            vg = obj.vertex_groups.new(name="Pin")
            mesh = obj.data
            max_y = max(v.co.y for v in mesh.vertices)
            threshold = (max_y - min(v.co.y for v in mesh.vertices)) * 0.05
            for v in mesh.vertices:
                if v.co.y >= max_y - threshold:
                    vg.add([v.index], 1.0, "REPLACE")

            cloth.settings.vertex_group_mass = "Pin"

            # Self-collision
            cloth.collision_settings.use_self_collision = True
            cloth.collision_settings.self_friction = phys["friction"]

        # Bake simulation
        scene = bpy.context.scene
        scene.frame_start = 1
        scene.frame_end = frame_count
        scene.frame_set(1)

        # Step through each frame to advance simulation
        for frame in range(1, frame_count + 1):
            scene.frame_set(frame)
            bpy.context.view_layer.update()

        print(f"[clo3d] Simulation complete: {frame_count} frames, {len(patterns)} patterns")

    @staticmethod
    def AutoArrange():
        """Position pattern panels around the mannequin body for sewing.

        Places panels in a ring around the origin, front panels facing forward,
        back panels behind, sleeves to the sides.
        """
        _require_bpy()

        patterns = _get_pattern_objects()
        if not patterns:
            return

        # Simple radial arrangement
        count = len(patterns)
        radius = 0.3  # metres from centre
        for i, obj in enumerate(patterns):
            name_lower = obj.name.lower()

            if "front" in name_lower:
                angle = 0.0
                z_off = 0.4
            elif "back" in name_lower:
                angle = math.pi
                z_off = 0.4
            elif "sleeve" in name_lower and "left" in name_lower:
                angle = math.pi * 0.5
                z_off = 0.5
            elif "sleeve" in name_lower and "right" in name_lower:
                angle = -math.pi * 0.5
                z_off = 0.5
            elif "collar" in name_lower:
                angle = 0.0
                z_off = 0.7
                radius = 0.15
            else:
                angle = (2 * math.pi * i) / count
                z_off = 0.3

            obj.location.x = radius * math.sin(angle)
            obj.location.y = radius * math.cos(angle)
            obj.location.z = z_off

            # Rotate to face inward
            obj.rotation_euler.z = -angle

        print(f"[clo3d] Auto-arranged {count} panels")

    @staticmethod
    def GetCurrentFrame() -> int:
        """Return the current animation frame."""
        _require_bpy()
        return bpy.context.scene.frame_current

    @staticmethod
    def SetCurrentFrame(frame: int):
        """Set the current animation frame."""
        _require_bpy()
        bpy.context.scene.frame_set(frame)


# ══════════════════════════════════════════════════════════════════════════════
# export_api
# ══════════════════════════════════════════════════════════════════════════════

class export_api:
    """Export garment data in various formats."""

    @staticmethod
    def ExportGLB(output_path: str):
        """Export the scene as GLB (glTF Binary)."""
        _require_bpy()
        bpy.ops.object.select_all(action="DESELECT")
        for obj in bpy.data.objects:
            if obj.type == "MESH" and obj.visible_get():
                obj.select_set(True)
        bpy.ops.export_scene.gltf(
            filepath=output_path,
            export_format="GLB",
            use_selection=True,
            export_apply=True,
            export_materials="EXPORT",
            export_normals=True,
        )
        print(f"[clo3d] Exported GLB: {output_path}")

    @staticmethod
    def ExportOBJ(output_path: str):
        """Export the scene as OBJ."""
        _require_bpy()
        bpy.ops.object.select_all(action="DESELECT")
        for obj in bpy.data.objects:
            if obj.type == "MESH" and obj.visible_get():
                obj.select_set(True)
        bpy.ops.wm.obj_export(
            filepath=output_path,
            export_selected_objects=True,
            export_materials=True,
            export_normals=True,
            export_uv=True,
        )
        print(f"[clo3d] Exported OBJ: {output_path}")

    @staticmethod
    def ExportDXF(output_path: str, panels: List[Dict]):
        """Export 2D patterns as DXF file for CLO3D / Gerber import.

        Args:
            output_path: File path for DXF output.
            panels: List of panel dicts with keys:
                    'name', 'vertices' (list of [x,y] in cm),
                    optional 'seam_allowance' (cm, default 1.0),
                    optional 'grain_angle' (degrees, default 0).
        """
        from scripts.export_dxf import write_dxf
        write_dxf(output_path, panels)
        print(f"[clo3d] Exported DXF: {output_path}")

    @staticmethod
    def ExportSVG(output_path: str, panels: List[Dict]):
        """Export 2D patterns as SVG.

        Args:
            output_path: File path for SVG output.
            panels: List of panel dicts (same format as ExportDXF).
        """
        from scripts.export_svg import write_svg
        write_svg(output_path, panels)
        print(f"[clo3d] Exported SVG: {output_path}")

    @staticmethod
    def ExportGarmentInformation() -> Dict:
        """Return a JSON-serializable dict with panels, measurements, and metadata."""
        _require_bpy()

        patterns = _get_pattern_objects()
        panels_info = []
        for i, obj in enumerate(patterns):
            mesh = obj.data
            verts_cm = [(round(v.co.x * 100, 2), round(v.co.y * 100, 2)) for v in mesh.vertices]
            edges = [(e.vertices[0], e.vertices[1]) for e in mesh.edges]
            w, h = pattern_api.GetPatternSize(i)

            mat_name = ""
            fabric_type = ""
            if obj.data.materials:
                mat_name = obj.data.materials[0].name
                fabric_type = obj.data.materials[0].get("fabric_type", "")

            panels_info.append({
                "name": obj.name,
                "index": i,
                "vertices": verts_cm,
                "edges": edges,
                "width_cm": w,
                "height_cm": h,
                "material": mat_name,
                "fabric_type": fabric_type,
                "location": [round(obj.location.x * 100, 2),
                              round(obj.location.y * 100, 2),
                              round(obj.location.z * 100, 2)],
            })

        total_area = 0.0
        for p in panels_info:
            total_area += p["width_cm"] * p["height_cm"]

        info = {
            "panel_count": len(panels_info),
            "panels": panels_info,
            "measurements": {
                "total_bounding_area_cm2": round(total_area, 2),
            },
            "metadata": {
                "source": "clo3d_api (Blender)",
                "version": "1.0.0",
                "frame": bpy.context.scene.frame_current,
            },
        }
        return info


# ══════════════════════════════════════════════════════════════════════════════
# Module-level convenience — allow running as standalone test
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("CLO3D API Module loaded")
    print(f"  Fabric physics presets: {list(FABRIC_PHYSICS.keys())}")
    print(f"  Fabric PBR presets:     {list(FABRIC_PBR.keys())}")
    if HAS_BPY:
        print(f"  Blender detected: {bpy.app.version_string}")
    else:
        print("  Running outside Blender (limited functionality)")
