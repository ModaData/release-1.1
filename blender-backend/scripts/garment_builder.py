"""
garment_builder.py — Construct garments from structured JSON specs using bmesh.

Produces clean quad-based topology with:
  - Named parts compatible with GarmentViewer3D.jsx interactive selection
  - Automatic seam marking at component boundaries (side seams, neckline, hem, underarm)
  - Angle-based UV unwrap per part (clean UV islands for each sewable panel)
  - Full Principled BSDF PBR materials (sheen, subsurface, coat, anisotropic) matching
    swap_fabric.py presets, with per-garment pbr_values overrides from GPT-4o
  - Fabric normal map loading from textures/normals/ directory

Usage:
  blender --background --python garment_builder.py -- \\
    --output garment.glb --spec_json spec.json [--pbr_json '{"sheen_weight":0.8}']

Edit-part mode (rebuilds only one named part in an existing GLB):
  blender --background --python garment_builder.py -- \\
    --input assembled.glb --output updated.glb \\
    --edit_part collar --part_spec '{"type":"collar","variant":"mandarin","params":{"height":0.06}}'

Spec JSON format:
  {
    "garment_type": "shirt",
    "parts": [...],
    "fabric": "cotton",
    "color": [0.85, 0.83, 0.80],
    "pbr_values": { "sheen_weight": 0.8, "normal_map_id": "twill_weave" }
  }
"""

import bpy
import bmesh
import sys
import os
import json
import math
import argparse
from pathlib import Path
from mathutils import Vector, Matrix

sys.path.insert(0, str(Path(__file__).parent))
from blender_helpers import safe_export_glb, safe_import_glb, wrap_main, ensure_mode
from naming_convention import tag_object, PART_TYPES


# ═══════════════════════════════════════════════════════════════
# PATHS
# ═══════════════════════════════════════════════════════════════

TEXTURES_DIR = Path(__file__).parent.parent / "textures" / "normals"


# ═══════════════════════════════════════════════════════════════
# DEFAULT DIMENSIONS (meters, roughly human scale)
# ═══════════════════════════════════════════════════════════════

DEFAULTS = {
    "body": {
        "length": 0.65,
        "width": 0.42,
        "depth": 0.22,
        "taper": 0.04,
        "neckline_width": 0.12,
        "neckline_depth": 0.04,
        "segments_around": 16,
        "segments_height": 8,
    },
    "collar": {
        "height": 0.04,
        "width": 0.14,
        "spread_angle": 45,
        "segments": 12,
    },
    "sleeve": {
        "length": 0.55,
        "width_top": 0.11,
        "width_bottom": 0.07,
        "segments_around": 12,
        "segments_length": 6,
    },
    "cuff": {
        "height": 0.05,
        "width": 0.07,
        "segments": 12,
    },
    "pocket": {
        "width": 0.10,
        "height": 0.12,
        "depth": 0.005,
    },
    "hood": {
        "height": 0.30,
        "depth": 0.25,
        "width": 0.20,
        "segments": 8,
    },
    "placket": {
        "width": 0.025,
        "length": 0.60,
    },
    "button": {
        "radius": 0.006,
        "count": 6,
        "spacing": 0.08,
    },
    "waistband": {
        "height": 0.04,
        "width": 0.42,
    },
    "hem": {
        "height": 0.02,
    },
}


# ═══════════════════════════════════════════════════════════════
# FULL PBR FABRIC PRESETS  (mirrors swap_fabric.py FABRIC_PRESETS)
# ═══════════════════════════════════════════════════════════════

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
        "Coat Weight": 0.3,
        "Coat Roughness": 0.2,
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

# Default fabric → normal map ID mapping
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

# pbr_values key → Principled BSDF input name
PBR_KEY_MAP = {
    "roughness":         "Roughness",
    "sheen_weight":      "Sheen Weight",
    "sheen_roughness":   "Sheen Roughness",
    "subsurface_weight": "Subsurface Weight",
    "coat_weight":       "Coat Weight",
    "anisotropic":       "Anisotropic",
    "specular_ior_level":"Specular IOR Level",
}


# ═══════════════════════════════════════════════════════════════
# ARGUMENT PARSING
# ═══════════════════════════════════════════════════════════════

def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--spec_json", default=None,
                        help="Path to JSON spec file or JSON string (required for assembly mode)")
    parser.add_argument("--pbr_json", default=None,
                        help="JSON string of PBR override values from GPT-4o")
    # Edit-part mode args
    parser.add_argument("--input", default=None,
                        help="Existing GLB to edit (required for --edit_part mode)")
    parser.add_argument("--edit_part", default=None,
                        help="Part type name to replace (e.g. 'collar')")
    parser.add_argument("--part_spec", default=None,
                        help="JSON spec for the replacement part")
    parser.add_argument("--seam_overrides", default=None,
                        help="JSON list of edge indices to mark/unmark as seams post-build")
    return parser.parse_args(argv)


# ═══════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════

def get_param(params, key, part_type, default_key=None):
    """Get parameter with fallback to defaults."""
    if params and key in params:
        return params[key]
    defaults = DEFAULTS.get(part_type, {})
    return defaults.get(default_key or key, 0)


def _mark_ring_seam(bm, ring_verts):
    """Mark all edges forming a ring (boundary loop) as seams."""
    for i in range(len(ring_verts)):
        i_next = (i + 1) % len(ring_verts)
        e = bm.edges.get([ring_verts[i], ring_verts[i_next]])
        if e:
            e.seam = True


def _mark_vertical_seam(bm, rings, col_i):
    """Mark all vertical edges at column index col_i as seams."""
    for j in range(len(rings) - 1):
        e = bm.edges.get([rings[j][col_i], rings[j + 1][col_i]])
        if e:
            e.seam = True


def _mark_single_vertical_edge(bm, ring_a, ring_b, col_i):
    """Mark one vertical edge between two adjacent rings at col_i."""
    e = bm.edges.get([ring_a[col_i], ring_b[col_i]])
    if e:
        e.seam = True


def _unwrap_uv(obj):
    """Run angle-based UV unwrap (respects seam marks)."""
    try:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.unwrap(method="ANGLE_BASED", margin=0.02)
        bpy.ops.object.mode_set(mode="OBJECT")
        obj.select_set(False)
    except Exception as e:
        print(f"[garment_builder] WARNING: UV unwrap failed for {obj.name}: {e}")
        try:
            bpy.ops.object.mode_set(mode="OBJECT")
        except Exception:
            pass


def create_mesh_object(name, bm, do_unwrap=True):
    """Convert bmesh to Blender mesh object, link to scene, optionally UV-unwrap."""
    mesh = bpy.data.meshes.new(name + "_mesh")
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)

    if do_unwrap:
        _unwrap_uv(obj)

    return obj


def _apply_normal_map(mat, principled, normal_map_id):
    """Load a fabric normal map PNG and wire it to Principled BSDF Normal input."""
    map_path = TEXTURES_DIR / f"{normal_map_id}.png"
    if not map_path.exists():
        print(f"[garment_builder] INFO: Normal map not found: {map_path} (skipping)")
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
    except Exception as e:
        print(f"[garment_builder] WARNING: Could not wire normal map {normal_map_id}: {e}")


def apply_material(obj, fabric, color=None, pbr_values=None):
    """Apply full Principled BSDF material with fabric preset + optional PBR overrides + normal map."""
    mat = bpy.data.materials.new(name=f"Fabric_{fabric}_{obj.name}")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes

    principled = None
    for node in nodes:
        if node.type == "BSDF_PRINCIPLED":
            principled = node
            break
    if not principled:
        principled = nodes.new("ShaderNodeBsdfPrincipled")

    # Build effective preset: start from fabric base
    preset = dict(FABRIC_PRESETS.get(fabric, FABRIC_PRESETS["cotton"]))

    # Override base color if explicit color provided
    if color and len(color) >= 3:
        c = list(color) + [1.0] if len(color) == 3 else list(color[:4])
        preset["Base Color"] = tuple(c)

    # Apply pbr_values overrides (from GPT-4o)
    if pbr_values:
        for key, bsdf_name in PBR_KEY_MAP.items():
            if key in pbr_values:
                preset[bsdf_name] = pbr_values[key]

    # Set all Principled BSDF inputs
    for param, value in preset.items():
        if param in principled.inputs:
            try:
                principled.inputs[param].default_value = value
            except (TypeError, AttributeError) as e:
                print(f"[garment_builder] WARNING: Could not set {param}: {e}")

    # Fabric normal map
    normal_map_id = (pbr_values or {}).get("normal_map_id") or FABRIC_NORMAL_MAP.get(fabric)
    if normal_map_id:
        _apply_normal_map(mat, principled, normal_map_id)

    obj.data.materials.append(mat)


# ═══════════════════════════════════════════════════════════════
# PART BUILDERS — seam marks embedded, UV unwrap applied
# ═══════════════════════════════════════════════════════════════

def build_body(params):
    """
    Garment body (torso) as a tapered cylinder with open top and bottom.
    Seams: vertical side seams at 0° and 180°, top ring (neckline), bottom ring (hem).
    """
    p = params or {}
    length = get_param(p, "length", "body")
    width = get_param(p, "width", "body")
    depth = get_param(p, "depth", "body")
    taper = get_param(p, "taper", "body")
    seg_around = int(get_param(p, "segments_around", "body"))
    seg_height = int(get_param(p, "segments_height", "body"))

    bm = bmesh.new()
    rings = []

    for j in range(seg_height + 1):
        t = j / seg_height
        y_pos = -t * length
        waist_factor = 1.0 - taper * math.sin(math.pi * t)
        ring_width = width * waist_factor
        ring_depth = depth * waist_factor

        ring_verts = []
        for i in range(seg_around):
            angle = 2.0 * math.pi * i / seg_around
            x = ring_width * math.cos(angle)
            z = ring_depth * math.sin(angle)
            v = bm.verts.new((x, y_pos, z))
            ring_verts.append(v)
        rings.append(ring_verts)

    bm.verts.ensure_lookup_table()

    for j in range(len(rings) - 1):
        ring_a = rings[j]
        ring_b = rings[j + 1]
        for i in range(seg_around):
            i_next = (i + 1) % seg_around
            try:
                bm.faces.new([ring_a[i], ring_a[i_next], ring_b[i_next], ring_b[i]])
            except ValueError:
                pass

    for f in bm.faces:
        f.smooth = True

    # ── Seam marking ──
    bm.edges.ensure_lookup_table()
    # Side seams: vertical columns at 0° (i=0) and 180° (i=seg_around//2)
    _mark_vertical_seam(bm, rings, 0)
    _mark_vertical_seam(bm, rings, seg_around // 2)
    # Boundary rings: neckline (top) and hem (bottom)
    _mark_ring_seam(bm, rings[0])
    _mark_ring_seam(bm, rings[-1])

    obj = create_mesh_object("body_temp", bm)

    info = {
        "top_y": 0,
        "bottom_y": -length,
        "width": width,
        "depth": depth,
        "shoulder_y": 0,
        "waist_y": -length * 0.45,
        "hip_y": -length * 0.65,
    }
    return obj, info


def build_collar(params, body_info):
    """Collar strip around the neckline. Seams: center-back, top boundary, bottom boundary."""
    p = params or {}
    height = get_param(p, "height", "collar")
    col_width = get_param(p, "width", "collar")
    segments = int(get_param(p, "segments", "collar"))

    body_width = body_info.get("width", 0.42)
    neck_radius = body_width * 0.3

    bm = bmesh.new()
    ring0 = []
    ring1 = []

    for ring_idx, ring_list in enumerate([ring0, ring1]):
        y_offset = ring_idx * height
        for i in range(segments):
            angle = 2.0 * math.pi * i / segments
            x = neck_radius * math.cos(angle)
            z = neck_radius * 0.6 * math.sin(angle)
            v = bm.verts.new((x, y_offset, z))
            ring_list.append(v)

    bm.verts.ensure_lookup_table()

    for i in range(segments):
        i_next = (i + 1) % segments
        try:
            bm.faces.new([ring0[i], ring0[i_next], ring1[i_next], ring1[i]])
        except ValueError:
            pass

    for f in bm.faces:
        f.smooth = True

    # ── Seam marking ──
    bm.edges.ensure_lookup_table()
    cb_i = segments // 2  # center-back index
    e = bm.edges.get([ring0[cb_i], ring1[cb_i]])
    if e:
        e.seam = True
    _mark_ring_seam(bm, ring0)  # neckline boundary
    _mark_ring_seam(bm, ring1)  # collar top edge

    obj = create_mesh_object("collar_temp", bm)
    obj.location.y = body_info.get("top_y", 0)
    return obj


def build_sleeve(params, body_info, side="left"):
    """Tapered sleeve cylinder. Seams: underarm longitudinal, shoulder ring, wrist ring."""
    p = params or {}
    length = get_param(p, "length", "sleeve")
    width_top = get_param(p, "width_top", "sleeve")
    width_bottom = get_param(p, "width_bottom", "sleeve")
    seg_around = int(get_param(p, "segments_around", "sleeve"))
    seg_length = int(get_param(p, "segments_length", "sleeve"))

    bm = bmesh.new()
    rings = []

    for j in range(seg_length + 1):
        t = j / seg_length
        radius = width_top + (width_bottom - width_top) * t
        x_offset = -(body_info.get("width", 0.42) + t * length) if side == "left" \
            else (body_info.get("width", 0.42) + t * length)

        ring_verts = []
        for i in range(seg_around):
            angle = 2.0 * math.pi * i / seg_around
            local_y = radius * math.cos(angle)
            local_z = radius * math.sin(angle)
            v = bm.verts.new((x_offset, local_y + body_info.get("top_y", 0) * 0.1, local_z))
            ring_verts.append(v)
        rings.append(ring_verts)

    bm.verts.ensure_lookup_table()

    for j in range(seg_length):
        for i in range(seg_around):
            i_next = (i + 1) % seg_around
            a = j * seg_around + i
            b = j * seg_around + i_next
            c = (j + 1) * seg_around + i_next
            d = (j + 1) * seg_around + i
            try:
                bm.faces.new([bm.verts[a], bm.verts[b], bm.verts[c], bm.verts[d]])
            except ValueError:
                pass

    for f in bm.faces:
        f.smooth = True

    # ── Seam marking ──
    bm.edges.ensure_lookup_table()
    # Underarm seam: bottom of arc (angle = 3π/2, i = 3*seg_around//4)
    underarm_i = 3 * seg_around // 4
    _mark_vertical_seam(bm, rings, underarm_i)
    # Shoulder attachment ring (first) and wrist ring (last)
    _mark_ring_seam(bm, rings[0])
    _mark_ring_seam(bm, rings[-1])

    obj = create_mesh_object(f"sleeve_{side}_temp", bm)
    obj.location.y = body_info.get("top_y", 0) * 0.15
    return obj


def build_cuff(params, body_info, side="left"):
    """Cuff band at wrist. Seams: center-back, sleeve boundary ring, wrist boundary ring."""
    p = params or {}
    height = get_param(p, "height", "cuff")
    width = get_param(p, "width", "cuff")
    segments = int(get_param(p, "segments", "cuff"))
    is_french = p.get("fold", False) or p.get("variant") == "french"
    if is_french:
        height *= 2.0

    bm = bmesh.new()
    sleeve_length = DEFAULTS["sleeve"]["length"]
    body_width = body_info.get("width", 0.42)
    x_base = -(body_width + sleeve_length) if side == "left" else (body_width + sleeve_length)

    ring0 = []
    ring1 = []
    for ring_idx, ring_list in enumerate([ring0, ring1]):
        offset = ring_idx * height
        for i in range(segments):
            angle = 2.0 * math.pi * i / segments
            local_y = width * math.cos(angle)
            local_z = width * math.sin(angle)
            v = bm.verts.new((x_base + (offset if side == "right" else -offset), local_y, local_z))
            ring_list.append(v)

    bm.verts.ensure_lookup_table()

    for i in range(segments):
        i_next = (i + 1) % segments
        try:
            bm.faces.new([ring0[i], ring0[i_next], ring1[i_next], ring1[i]])
        except ValueError:
            pass

    for f in bm.faces:
        f.smooth = True

    # ── Seam marking ──
    bm.edges.ensure_lookup_table()
    cb_i = segments // 2
    e = bm.edges.get([ring0[cb_i], ring1[cb_i]])
    if e:
        e.seam = True
    _mark_ring_seam(bm, ring0)  # sleeve attachment boundary
    _mark_ring_seam(bm, ring1)  # wrist end boundary

    obj = create_mesh_object(f"cuff_{side}_temp", bm)
    return obj


def build_pocket(params, body_info, suffix="chest"):
    """Flat pocket patch. Seams: all 4 border edges (trivial flat UV panel)."""
    p = params or {}
    width = get_param(p, "width", "pocket")
    height = get_param(p, "height", "pocket")

    bm = bmesh.new()
    body_width = body_info.get("width", 0.42)
    body_depth = body_info.get("depth", 0.22)

    positions = {
        "chest":     (-body_width * 0.4, body_info.get("top_y", 0) - 0.15, body_depth + 0.005),
        "hip_left":  (-body_width * 0.5, body_info.get("hip_y", -0.42), body_depth * 0.5 + 0.005),
        "hip_right": (body_width * 0.5,  body_info.get("hip_y", -0.42), body_depth * 0.5 + 0.005),
    }
    pos = positions.get(suffix, positions["chest"])

    hw = width / 2
    hh = height / 2
    v1 = bm.verts.new((pos[0] - hw, pos[1] - hh, pos[2]))
    v2 = bm.verts.new((pos[0] + hw, pos[1] - hh, pos[2]))
    v3 = bm.verts.new((pos[0] + hw, pos[1] + hh, pos[2]))
    v4 = bm.verts.new((pos[0] - hw, pos[1] + hh, pos[2]))
    bm.faces.new([v1, v2, v3, v4])

    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=2)

    for f in bm.faces:
        f.smooth = True

    # ── Seam marking: all 4 original border edges ──
    bm.edges.ensure_lookup_table()
    for e in bm.edges:
        if e.is_boundary:
            e.seam = True

    obj = create_mesh_object(f"pocket_{suffix}_temp", bm)
    return obj


def build_hood(params, body_info):
    """Hood shape. Seams: center crown edge strip, neckline boundary ring."""
    p = params or {}
    height = get_param(p, "height", "hood")
    depth = get_param(p, "depth", "hood")
    hood_width = get_param(p, "width", "hood")
    segments = int(get_param(p, "segments", "hood"))

    bm = bmesh.new()
    rows = []

    for j in range(segments + 1):
        t = j / segments
        arc_angle = math.pi * t
        arc_y = body_info.get("top_y", 0) + height * math.sin(arc_angle)
        arc_z = -depth * math.cos(arc_angle)

        row_verts = []
        for i in range(segments):
            side_angle = math.pi * i / (segments - 1) - math.pi / 2
            x = hood_width * math.sin(side_angle)
            v = bm.verts.new((x, arc_y, arc_z))
            row_verts.append(v)
        rows.append(row_verts)

    bm.verts.ensure_lookup_table()

    for j in range(segments):
        for i in range(segments - 1):
            a = j * segments + i
            b = j * segments + i + 1
            c = (j + 1) * segments + i + 1
            d = (j + 1) * segments + i
            try:
                bm.faces.new([bm.verts[a], bm.verts[b], bm.verts[c], bm.verts[d]])
            except ValueError:
                pass

    for f in bm.faces:
        f.smooth = True

    # ── Seam marking ──
    bm.edges.ensure_lookup_table()
    # Center crown: vertical strip at i = segments // 2
    crown_i = segments // 2
    for j in range(segments):
        e = bm.edges.get([rows[j][crown_i], rows[j + 1][crown_i]])
        if e:
            e.seam = True
    # Neckline boundary (bottom row)
    for i in range(segments - 1):
        e = bm.edges.get([rows[0][i], rows[0][i + 1]])
        if e:
            e.seam = True

    obj = create_mesh_object("hood_temp", bm)
    return obj


def build_placket(params, body_info):
    """Narrow center-front strip. Seams: both long edges."""
    p = params or {}
    width = get_param(p, "width", "placket")
    length = abs(body_info.get("bottom_y", -0.65) - body_info.get("top_y", 0)) * 0.9

    bm = bmesh.new()
    body_depth = body_info.get("depth", 0.22)
    hw = width / 2
    top_y = body_info.get("top_y", 0) - 0.04
    bot_y = top_y - length

    rows = 5
    left_verts = []
    right_verts = []
    for j in range(rows):
        t = j / (rows - 1)
        y = top_y + (bot_y - top_y) * t
        v1 = bm.verts.new((-hw, y, body_depth + 0.003))
        v2 = bm.verts.new((hw, y, body_depth + 0.003))
        left_verts.append(v1)
        right_verts.append(v2)

    bm.verts.ensure_lookup_table()

    for j in range(rows - 1):
        try:
            bm.faces.new([left_verts[j], right_verts[j], right_verts[j + 1], left_verts[j + 1]])
        except ValueError:
            pass

    for f in bm.faces:
        f.smooth = True

    # ── Seam marking: both long edges ──
    bm.edges.ensure_lookup_table()
    for j in range(rows - 1):
        e_left = bm.edges.get([left_verts[j], left_verts[j + 1]])
        e_right = bm.edges.get([right_verts[j], right_verts[j + 1]])
        if e_left:
            e_left.seam = True
        if e_right:
            e_right.seam = True

    obj = create_mesh_object("placket_temp", bm)
    return obj


def build_button(params, body_info, index=0):
    """Small button cylinder (no seams needed — small decorative part)."""
    p = params or {}
    radius = get_param(p, "radius", "button")
    spacing = p.get("spacing", DEFAULTS["button"]["spacing"])

    bm = bmesh.new()
    body_depth = body_info.get("depth", 0.22)
    top_y = body_info.get("top_y", 0) - 0.06
    y_pos = top_y - (index * spacing)

    segments = 8
    ring0 = []
    ring1 = []
    for ring_idx, ring_list in enumerate([ring0, ring1]):
        z_off = body_depth + 0.005 + ring_idx * 0.003
        for i in range(segments):
            angle = 2.0 * math.pi * i / segments
            x = radius * math.cos(angle)
            y_local = radius * math.sin(angle)
            v = bm.verts.new((x, y_pos + y_local, z_off))
            ring_list.append(v)

    bm.verts.ensure_lookup_table()

    for i in range(segments):
        i_next = (i + 1) % segments
        try:
            bm.faces.new([ring0[i], ring0[i_next], ring1[i_next], ring1[i]])
        except ValueError:
            pass
    try:
        bm.faces.new(ring0)
    except ValueError:
        pass
    try:
        bm.faces.new(ring1)
    except ValueError:
        pass

    obj = create_mesh_object(f"button_{index}_temp", bm, do_unwrap=False)
    return obj


def build_waistband(params, body_info):
    """Waistband strip. Seams: center-back, top boundary, bottom boundary."""
    p = params or {}
    height = get_param(p, "height", "waistband")
    wb_width = body_info.get("width", 0.42)
    segments = 16
    waist_y = body_info.get("waist_y", -0.29)

    bm = bmesh.new()
    ring0 = []
    ring1 = []

    for ring_idx, ring_list in enumerate([ring0, ring1]):
        y_off = waist_y + ring_idx * height
        for i in range(segments):
            angle = 2.0 * math.pi * i / segments
            x = wb_width * math.cos(angle)
            z = body_info.get("depth", 0.22) * math.sin(angle)
            v = bm.verts.new((x, y_off, z))
            ring_list.append(v)

    bm.verts.ensure_lookup_table()

    for i in range(segments):
        i_next = (i + 1) % segments
        try:
            bm.faces.new([ring0[i], ring0[i_next], ring1[i_next], ring1[i]])
        except ValueError:
            pass

    for f in bm.faces:
        f.smooth = True

    # ── Seam marking ──
    bm.edges.ensure_lookup_table()
    cb_i = segments // 2
    e = bm.edges.get([ring0[cb_i], ring1[cb_i]])
    if e:
        e.seam = True
    _mark_ring_seam(bm, ring0)  # body attachment boundary
    _mark_ring_seam(bm, ring1)  # top edge boundary

    obj = create_mesh_object("waistband_temp", bm)
    return obj


def build_hem(params, body_info):
    """Hem strip at garment bottom. Seams: center-back, top and bottom rings."""
    p = params or {}
    height = get_param(p, "height", "hem")
    body_width = body_info.get("width", 0.42)
    segments = 16
    bottom_y = body_info.get("bottom_y", -0.65)

    bm = bmesh.new()
    ring0 = []
    ring1 = []

    for ring_idx, ring_list in enumerate([ring0, ring1]):
        y_off = bottom_y + ring_idx * height
        for i in range(segments):
            angle = 2.0 * math.pi * i / segments
            x = body_width * math.cos(angle)
            z = body_info.get("depth", 0.22) * math.sin(angle)
            v = bm.verts.new((x, y_off, z))
            ring_list.append(v)

    bm.verts.ensure_lookup_table()

    for i in range(segments):
        i_next = (i + 1) % segments
        try:
            bm.faces.new([ring0[i], ring0[i_next], ring1[i_next], ring1[i]])
        except ValueError:
            pass

    for f in bm.faces:
        f.smooth = True

    # ── Seam marking ──
    bm.edges.ensure_lookup_table()
    cb_i = segments // 2
    e = bm.edges.get([ring0[cb_i], ring1[cb_i]])
    if e:
        e.seam = True
    _mark_ring_seam(bm, ring0)
    _mark_ring_seam(bm, ring1)

    obj = create_mesh_object("hem_temp", bm)
    return obj


# ═══════════════════════════════════════════════════════════════
# MAIN ASSEMBLY
# ═══════════════════════════════════════════════════════════════

def _build_and_tag_part(part_spec, body_info, fabric, color, pbr_values):
    """Build a single part, tag it, apply material, return the object (or None)."""
    part_type = part_spec.get("type", "")
    variant = part_spec.get("variant", "")
    suffix = part_spec.get("suffix", "")
    params = part_spec.get("params", {})

    obj = None

    if part_type == "body":
        obj, _ = build_body(params)

    elif part_type == "collar":
        # body_info must exist; use empty dict if not available
        obj = build_collar(params, body_info)

    elif part_type == "sleeve":
        side = suffix if suffix in ("left", "right") else "left"
        obj = build_sleeve(params, body_info, side)

    elif part_type == "cuff":
        side = suffix if suffix in ("left", "right") else "left"
        obj = build_cuff(params, body_info, side)

    elif part_type == "pocket":
        obj = build_pocket(params, body_info, suffix or "chest")

    elif part_type == "hood":
        obj = build_hood(params, body_info)

    elif part_type == "placket":
        obj = build_placket(params, body_info)

    elif part_type == "waistband":
        obj = build_waistband(params, body_info)

    elif part_type == "hem":
        obj = build_hem(params, body_info)

    elif part_type == "button":
        # Buttons are handled separately in the caller (multiple per spec)
        return None

    else:
        print(f"[garment_builder]   WARNING: Unknown part type '{part_type}', skipping")
        return None

    if obj is not None:
        tag_object(obj, part_type, suffix=suffix, variant=variant)
        apply_material(obj, fabric, color, pbr_values)

    return obj


@wrap_main
def assemble():
    args = parse_args()

    # ── Edit-part mode ──
    if args.edit_part:
        _edit_part_mode(args)
        return

    # ── Full assembly mode ──
    if not args.spec_json:
        print("[garment_builder] FATAL: --spec_json required for assembly mode")
        sys.exit(1)

    if os.path.isfile(args.spec_json):
        with open(args.spec_json, "r", encoding="utf-8") as f:
            spec = json.load(f)
    else:
        spec = json.loads(args.spec_json)

    garment_type = spec.get("garment_type", "shirt")
    parts_list = spec.get("parts", [])
    fabric = spec.get("fabric", "cotton")
    color = spec.get("color", None)

    # Parse pbr_values: from spec, or from --pbr_json CLI arg
    pbr_values = spec.get("pbr_values", None)
    if args.pbr_json:
        try:
            cli_pbr = json.loads(args.pbr_json)
            pbr_values = {**(pbr_values or {}), **cli_pbr}
        except json.JSONDecodeError as e:
            print(f"[garment_builder] WARNING: Could not parse --pbr_json: {e}")

    print(f"[garment_builder] Garment type: {garment_type}")
    print(f"[garment_builder] Parts: {len(parts_list)}, Fabric: {fabric}")
    if pbr_values:
        print(f"[garment_builder] PBR overrides: {list(pbr_values.keys())}")

    # Clear scene
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # ── Phase 1: Build body first ──
    body_info = {}
    body_obj = None

    for part_spec in parts_list:
        if part_spec.get("type") == "body":
            body_obj, body_info = build_body(part_spec.get("params"))
            tag_object(body_obj, "body",
                       suffix=part_spec.get("suffix", "full"),
                       variant=part_spec.get("variant", garment_type))
            apply_material(body_obj, fabric, color, pbr_values)
            print(f"[garment_builder]   Built body: {body_obj.name} "
                  f"({len(body_obj.data.vertices)} verts)")
            break

    if body_obj is None:
        body_obj, body_info = build_body(None)
        tag_object(body_obj, "body", suffix="full", variant=garment_type)
        apply_material(body_obj, fabric, color, pbr_values)
        print(f"[garment_builder]   Built default body: {body_obj.name}")

    # ── Phase 2: Build all other parts ──
    built_parts = [body_obj]

    for part_spec in parts_list:
        part_type = part_spec.get("type", "")
        variant = part_spec.get("variant", "")
        suffix = part_spec.get("suffix", "")
        params = part_spec.get("params", {})

        if part_type == "body":
            continue

        try:
            if part_type == "button":
                count = params.get("count", DEFAULTS["button"]["count"])
                for idx in range(count):
                    btn_obj = build_button(params, body_info, idx)
                    tag_object(btn_obj, "button", suffix=str(idx), variant=variant)
                    apply_material(btn_obj, fabric, color, pbr_values)
                    built_parts.append(btn_obj)
                continue

            obj = _build_and_tag_part(part_spec, body_info, fabric, color, pbr_values)
            if obj is not None:
                built_parts.append(obj)
                print(f"[garment_builder]   Built {part_type}: {obj.name} "
                      f"({len(obj.data.vertices)} verts, {len(obj.data.polygons)} faces)")

        except Exception as e:
            print(f"[garment_builder]   ERROR building '{part_type}': {e}")

    # ── Phase 3: Smooth shading ──
    for obj in built_parts:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        try:
            bpy.ops.object.shade_smooth()
        except RuntimeError:
            pass
        obj.select_set(False)

    # ── Phase 4: Export ──
    print(f"[garment_builder] Assembled {len(built_parts)} parts")

    success, err = safe_export_glb(args.output)
    if not success:
        print(f"[garment_builder] FATAL: Export failed: {err}")
        sys.exit(1)

    print(f"[garment_builder] Exported to {args.output}")

    # Config JSON for the frontend
    config = {
        "garment_type": garment_type,
        "parts": [
            {
                "name": obj.name,
                "part_type": obj.get("garment_part_type", "unknown"),
                "variant": obj.get("garment_variant", ""),
                "suffix": obj.get("garment_suffix", ""),
                "vertices": len(obj.data.vertices),
                "faces": len(obj.data.polygons),
            }
            for obj in built_parts
        ],
        "fabric": fabric,
        "total_vertices": sum(len(obj.data.vertices) for obj in built_parts),
        "total_faces": sum(len(obj.data.polygons) for obj in built_parts),
    }
    config_path = os.path.splitext(args.output)[0] + "_config.json"
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)
    print(f"[garment_builder] Config written to {config_path}")


# ═══════════════════════════════════════════════════════════════
# EDIT-PART MODE
# ═══════════════════════════════════════════════════════════════

def _edit_part_mode(args):
    """
    Load an existing GLB, remove the named part object, rebuild it from --part_spec,
    re-apply material, re-export. Avoids full re-assembly for single-part edits.
    """
    if not args.input or not args.edit_part or not args.part_spec:
        print("[garment_builder] FATAL: --edit_part requires --input and --part_spec")
        sys.exit(1)

    # Parse replacement spec
    try:
        new_part_spec = json.loads(args.part_spec)
    except json.JSONDecodeError as e:
        print(f"[garment_builder] FATAL: Could not parse --part_spec: {e}")
        sys.exit(1)

    # Load GLB
    meshes, err = safe_import_glb(args.input)
    if err:
        print(f"[garment_builder] FATAL: {err}")
        sys.exit(1)

    # Find and remove the target part (match by part_type or name substring)
    target_type = args.edit_part.lower()
    removed = []
    remaining = []
    body_obj = None
    body_info = {}

    for obj in meshes:
        part_type = obj.get("garment_part_type", "")
        if part_type == "body" or "body" in obj.name.lower():
            body_obj = obj
            # Reconstruct body_info from bounding box
            from mathutils import Vector as V
            bb = [obj.matrix_world @ V(c) for c in obj.bound_box]
            min_y = min(v.y for v in bb)
            max_y = max(v.y for v in bb)
            max_x = max(v.x for v in bb)
            max_z = max(v.z for v in bb)
            body_info = {
                "top_y": max_y, "bottom_y": min_y,
                "width": max_x, "depth": max_z,
                "waist_y": min_y + (max_y - min_y) * 0.55,
                "hip_y": min_y + (max_y - min_y) * 0.35,
            }
        if part_type == target_type or target_type in obj.name.lower():
            removed.append(obj)
        else:
            remaining.append(obj)

    for obj in removed:
        bpy.data.objects.remove(obj, do_unlink=True)
        print(f"[garment_builder] Removed: {obj.name}")

    # Infer fabric from remaining objects' material name
    fabric = "cotton"
    if remaining and remaining[0].data.materials:
        mat_name = remaining[0].data.materials[0].name
        for f_name in FABRIC_PRESETS:
            if f_name in mat_name.lower():
                fabric = f_name
                break

    # Rebuild the part
    new_part_spec.setdefault("type", target_type)
    try:
        new_obj = _build_and_tag_part(new_part_spec, body_info, fabric, None, None)
        if new_obj is None and new_part_spec.get("type") == "button":
            count = new_part_spec.get("params", {}).get("count", DEFAULTS["button"]["count"])
            for idx in range(count):
                btn = build_button(new_part_spec.get("params", {}), body_info, idx)
                tag_object(btn, "button", suffix=str(idx),
                           variant=new_part_spec.get("variant", ""))
                apply_material(btn, fabric)
        elif new_obj:
            print(f"[garment_builder] Rebuilt {target_type}: {new_obj.name}")
    except Exception as e:
        print(f"[garment_builder] ERROR rebuilding {target_type}: {e}")

    # Export
    success, err = safe_export_glb(args.output)
    if not success:
        print(f"[garment_builder] FATAL: Export failed: {err}")
        sys.exit(1)
    print(f"[garment_builder] Edit-part result exported to {args.output}")


if __name__ == "__main__":
    assemble()
