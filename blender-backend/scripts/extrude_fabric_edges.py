"""
extrude_fabric_edges.py — Extrude garment boundary/hem edges by a given offset.

Useful for:
  - Adding seam allowance (e.g. 15mm flange on jacket hem)
  - Adding collar/cuff turnback allowance (e.g. 8mm fold)
  - Adding facing panels from neckline or armhole edges

The extrusion targets boundary edges (edges with only one adjacent face — open
fabric edges). After extruding, the new boundary is:
  - Marked as a seam (keeps UV island boundaries clean)
  - Given a crease weight of 1.0 if --crease_extrusion true (stays sharp under
    Catmull-Clark subdivision)
  - Followed by a UV re-unwrap so the new geometry has valid UV coordinates

Usage:
  blender --background --python extrude_fabric_edges.py -- \\
    --input assembled.glb --output extruded.glb \\
    --offset 0.015 [--object_name collar] [--crease_extrusion true]
"""

import bpy
import bmesh
import sys
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from blender_helpers import safe_import_glb, safe_export_glb, wrap_main


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input",              required=True)
    parser.add_argument("--output",             required=True)
    parser.add_argument("--offset",             type=float, default=0.015,
                        help="Extrusion offset in meters (e.g. 0.015 = 15mm seam allowance)")
    parser.add_argument("--object_name",        default=None,
                        help="Target only this mesh object (default: all mesh objects)")
    parser.add_argument("--crease_extrusion",   default="true",
                        help="Add crease weight to new extruded edges (true/false)")
    return parser.parse_args(argv)


def _extrude_boundary_edges(obj, offset, add_crease):
    """
    Extrude open boundary edges of obj outward by offset meters,
    mark new boundary as seam, optionally add crease.
    Returns the count of extruded edge loops.
    """
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)

    # Work in bmesh for precise edge classification
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.edges.ensure_lookup_table()
    bm.verts.ensure_lookup_table()

    # Find boundary edges (linked to exactly 1 face)
    boundary_edges = [e for e in bm.edges if len(e.link_faces) == 1]

    if not boundary_edges:
        print(f"[extrude_fabric_edges] '{obj.name}' has no boundary edges — skipping")
        bm.free()
        obj.select_set(False)
        return 0

    print(f"[extrude_fabric_edges] '{obj.name}': {len(boundary_edges)} boundary edge(s) "
          f"→ extruding {offset*1000:.1f}mm")

    # Select only boundary edges
    for e in bm.edges:
        e.select = False
    for v in bm.verts:
        v.select = False
    for e in boundary_edges:
        e.select = True
        for v in e.verts:
            v.select = True

    # Extrude the selected edges along their face normals
    # bmesh.ops.extrude_edge_only creates new geometry along the edge loop
    ret = bmesh.ops.extrude_edge_only(bm, edges=boundary_edges)
    new_geom = ret["geom"]

    # Translate the new verts outward along averaged face normals
    # For fabric hems, we want the extrusion to go perpendicular to the boundary
    # Use the mean of adjacent face normals for each new vert
    new_verts = [g for g in new_geom if isinstance(g, bmesh.types.BMVert)]
    new_edges = [g for g in new_geom if isinstance(g, bmesh.types.BMEdge)]

    # Build a map: original vert → corresponding new vert
    # The extruded verts correspond 1:1 with the original boundary verts
    # Move them outward by averaging the normals of their original adjacent faces
    if new_verts:
        # Collect face normals for the original boundary
        vert_normals = {}
        for e in boundary_edges:
            for f in e.link_faces:
                for v in e.verts:
                    if v.index not in vert_normals:
                        vert_normals[v.index] = f.normal.copy()
                    else:
                        vert_normals[v.index] += f.normal

        # The extrusion duplicates verts; the new verts are at the same position.
        # Translate them along the stored direction.
        # bmesh.ops.extrude_edge_only puts new verts at the same co as originals.
        # We need to find which new vert matches which old vert (same position).
        from mathutils import Vector
        for nv in new_verts:
            # Find the closest original boundary vert by position
            closest = min(
                (v for e in boundary_edges for v in e.verts),
                key=lambda v: (v.co - nv.co).length
            )
            direction = vert_normals.get(closest.index, Vector((0, 0, 1))).normalized()
            nv.co += direction * offset

    bm.normal_update()

    # Mark new boundary edges as seams + optionally add crease
    seam_layer  = bm.edges.layers.int.get("seam") or bm.edges.layers.int.new("seam")
    for e in new_edges:
        e.seam = True  # bmesh seam attribute
        if add_crease:
            e.smooth = False   # sharp edge for viewport

    if add_crease:
        crease_layer = bm.edges.layers.crease.verify()
        for e in new_edges:
            e[crease_layer] = 1.0

    # Write back to mesh
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()

    # Re-unwrap to include new geometry in UV map
    try:
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.unwrap(method="ANGLE_BASED", margin=0.02)
        bpy.ops.object.mode_set(mode="OBJECT")
        print(f"[extrude_fabric_edges] Re-ran UV unwrap for '{obj.name}'")
    except Exception as e:
        print(f"[extrude_fabric_edges] WARNING: UV re-unwrap failed for '{obj.name}': {e}")
        try:
            bpy.ops.object.mode_set(mode="OBJECT")
        except Exception:
            pass

    obj.select_set(False)
    return len(boundary_edges)


@wrap_main
def extrude_fabric_edges():
    args = parse_args()

    add_crease = args.crease_extrusion.lower() not in ("false", "0", "no")

    # Import
    meshes, err = safe_import_glb(args.input)
    if err:
        print(f"[extrude_fabric_edges] FATAL: {err}")
        sys.exit(1)
    if not meshes:
        print("[extrude_fabric_edges] FATAL: No mesh objects in GLB")
        sys.exit(1)

    # Filter targets
    if args.object_name:
        targets = [o for o in meshes if o.name == args.object_name]
        if not targets:
            print(f"[extrude_fabric_edges] WARNING: '{args.object_name}' not found; "
                  f"applying to all {len(meshes)} objects")
            targets = meshes
    else:
        targets = meshes

    print(f"[extrude_fabric_edges] Extruding {args.offset*1000:.1f}mm on "
          f"{len(targets)} object(s), crease={add_crease}")

    total_loops = 0
    for obj in targets:
        total_loops += _extrude_boundary_edges(obj, args.offset, add_crease)

    if total_loops == 0:
        print("[extrude_fabric_edges] WARNING: No boundary edges found on any target object")

    # Export
    success, err = safe_export_glb(args.output)
    if not success:
        print(f"[extrude_fabric_edges] FATAL: Export failed: {err}")
        sys.exit(1)

    print(f"[extrude_fabric_edges] Done → {args.output} ({total_loops} edge loops extruded)")


if __name__ == "__main__":
    extrude_fabric_edges()
