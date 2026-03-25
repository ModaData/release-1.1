"""
repair_mesh.py — Import GLB -> fill holes -> fix non-manifold -> merge doubles -> recalc normals -> export
Tuned for HunYuan 3D garment meshes with holes, non-manifold geometry, and poor normals.

Error-hardened: every Blender operator is wrapped in try/except, mesh is validated
before and after operations, graceful degradation on failures.

Usage: blender --background --python repair_mesh.py -- --input mesh.glb --output repaired.glb --merge_threshold 0.001
"""

import bpy
import bmesh
import sys
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from blender_helpers import (
    safe_op, ensure_mode, check_mesh, safe_modifier_apply,
    log_mesh_stats, safe_import_glb, safe_export_glb, wrap_main,
)


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--merge_threshold", type=float, default=0.001,
                        help="Distance threshold for merging duplicate vertices")
    parser.add_argument("--max_hole_edges", type=int, default=64,
                        help="Skip holes with more edges than this (too large to repair)")
    parser.add_argument("--fabric_mode", default="false",
                        help="Fabric-specific repair: seam-aware weld pass + targeted hole fill (true/false)")
    return parser.parse_args(argv)


def fill_holes_bmesh(obj, max_hole_edges):
    """Use bmesh to find and fill holes with grid fill (cleaner quads) or fallback to fill."""
    ensure_mode("OBJECT")

    try:
        bm = bmesh.new()
        bm.from_mesh(obj.data)
    except Exception as e:
        print(f"[repair_mesh]   Could not create bmesh: {e}")
        return 0

    # Find boundary edges (holes)
    boundary_edges = [e for e in bm.edges if e.is_boundary]
    if not boundary_edges:
        bm.free()
        return 0

    # Group boundary edges into loops (individual holes)
    visited = set()
    holes = []
    for edge in boundary_edges:
        if edge.index in visited:
            continue
        loop_edges = []
        current = edge
        start_vert = edge.verts[0]
        current_vert = start_vert
        max_iterations = len(boundary_edges) + 1  # Safety limit
        iteration = 0
        while iteration < max_iterations:
            iteration += 1
            visited.add(current.index)
            loop_edges.append(current)
            next_vert = current.other_vert(current_vert)
            found_next = False
            for e in next_vert.link_edges:
                if e.is_boundary and e.index not in visited:
                    current = e
                    current_vert = next_vert
                    found_next = True
                    break
            if not found_next:
                break
        if len(loop_edges) > 0:
            holes.append(loop_edges)

    bm.free()

    filled = 0
    ensure_mode("EDIT")

    for hole in holes:
        edge_count = len(hole)
        if edge_count > max_hole_edges:
            print(f"[repair_mesh]   Skipping hole with {edge_count} edges (> max {max_hole_edges})")
            continue

        # Select the hole boundary verts
        safe_op(bpy.ops.mesh.select_all, action="DESELECT", description="Deselect all")
        ensure_mode("OBJECT")

        try:
            for edge in hole:
                for v_idx in [edge.verts[0].index, edge.verts[1].index]:
                    if v_idx < len(obj.data.vertices):
                        obj.data.vertices[v_idx].select = True
        except (IndexError, ReferenceError) as e:
            print(f"[repair_mesh]   Could not select hole vertices: {e}")
            continue

        ensure_mode("EDIT")

        # Try grid fill first, fallback to basic fill
        if safe_op(bpy.ops.mesh.fill_grid, description=f"Grid fill hole ({edge_count} edges)"):
            filled += 1
            print(f"[repair_mesh]   Filled hole ({edge_count} edges) with grid fill")
        elif safe_op(bpy.ops.mesh.fill, description=f"Basic fill hole ({edge_count} edges)"):
            filled += 1
            print(f"[repair_mesh]   Filled hole ({edge_count} edges) with basic fill")
        else:
            print(f"[repair_mesh]   Could not fill hole ({edge_count} edges)")

    return filled


def fabric_seam_weld(obj, merge_threshold=0.0005):
    """
    Fabric mode: select vertices adjacent to seam edges and merge near-coincident
    ones (disconnected fabric strips / UV split artifacts). Then fill small gaps.
    """
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    ensure_mode("EDIT")

    # Deselect everything first
    safe_op(bpy.ops.mesh.select_all, action="DESELECT", description="Deselect all")
    ensure_mode("OBJECT")

    # Select only vertices adjacent to seam edges
    seam_vert_indices = set()
    for edge in obj.data.edges:
        if edge.use_seam:
            seam_vert_indices.add(edge.vertices[0])
            seam_vert_indices.add(edge.vertices[1])

    if not seam_vert_indices:
        print(f"[repair_mesh/fabric] '{obj.name}' has no seam edges — skipping seam weld")
        ensure_mode("OBJECT")
        obj.select_set(False)
        return 0

    for v_idx in seam_vert_indices:
        if v_idx < len(obj.data.vertices):
            obj.data.vertices[v_idx].select = True

    ensure_mode("EDIT")
    initial_verts = len(obj.data.vertices)

    # Merge near-coincident seam vertices (only among selected)
    safe_op(bpy.ops.mesh.remove_doubles, threshold=merge_threshold,
            use_unselected=False,
            description=f"Fabric seam weld (δ={merge_threshold*1000:.1f}mm)")

    ensure_mode("OBJECT")
    welded = initial_verts - len(obj.data.vertices)

    if welded > 0:
        print(f"[repair_mesh/fabric] '{obj.name}': welded {welded} disconnected seam vert(s)")

    ensure_mode("EDIT")

    # Fill any remaining small holes at seam boundaries (sides ≤ 4 for fabric gaps)
    safe_op(bpy.ops.mesh.select_all, action="DESELECT", description="Deselect all")
    safe_op(bpy.ops.mesh.select_non_manifold,
            extend=False, use_wire=False, use_boundary=True,
            use_multi_face=False, use_non_contiguous=False, use_verts=False,
            description="Select seam-area non-manifold boundary")
    safe_op(bpy.ops.mesh.fill_holes, sides=4,
            description="Fill fabric gaps (sides≤4)")

    ensure_mode("OBJECT")
    obj.select_set(False)
    return welded


@wrap_main
def repair():
    args = parse_args()
    fabric_mode = args.fabric_mode.lower() not in ("false", "0", "no")

    # Import GLB
    meshes, err = safe_import_glb(args.input)
    if err:
        print(f"[repair_mesh] FATAL: {err}")
        sys.exit(1)

    print(f"[repair_mesh] Found {len(meshes)} mesh object(s) "
          f"(fabric_mode={fabric_mode})")
    repaired_count = 0

    for obj in meshes:
        # Pre-check mesh validity
        ok, reason = check_mesh(obj)
        if not ok:
            print(f"[repair_mesh] Skipping '{obj.name}': {reason}")
            continue

        print(f"[repair_mesh] Processing: {obj.name}")

        # Make active and select
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)

        # Get initial stats
        initial_verts = len(obj.data.vertices)
        initial_faces = len(obj.data.polygons)
        print(f"[repair_mesh]   Initial: {initial_verts} verts, {initial_faces} faces")

        # ── Step 0 (fabric mode): Seam-aware weld pass before generic repair ──
        if fabric_mode:
            fabric_seam_weld(obj, merge_threshold=min(args.merge_threshold, 0.0005))
            # Re-activate object after fabric weld
            bpy.context.view_layer.objects.active = obj
            obj.select_set(True)

        # ── Step 1: Merge by distance ──
        ensure_mode("EDIT")
        safe_op(bpy.ops.mesh.select_all, action="SELECT", description="Select all")
        safe_op(bpy.ops.mesh.remove_doubles, threshold=args.merge_threshold,
                description=f"Merge by distance ({args.merge_threshold})")
        merged_verts = len(obj.data.vertices)
        print(f"[repair_mesh]   Merge by distance: {initial_verts} -> {merged_verts} verts")

        # ── Step 2: Delete loose geometry ──
        safe_op(bpy.ops.mesh.select_all, action="DESELECT", description="Deselect all")
        safe_op(bpy.ops.mesh.select_loose, description="Select loose geometry")
        safe_op(bpy.ops.mesh.delete, type="VERT", description="Delete loose verts")

        # ── Step 3: Dissolve degenerate faces ──
        safe_op(bpy.ops.mesh.select_all, action="SELECT", description="Select all")
        safe_op(bpy.ops.mesh.dissolve_degenerate, threshold=0.001,
                description="Dissolve degenerate faces")

        # ── Step 4: Fill holes ──
        safe_op(bpy.ops.mesh.select_all, action="DESELECT", description="Deselect all")
        safe_op(bpy.ops.mesh.select_non_manifold,
                extend=False, use_wire=True, use_boundary=True,
                use_multi_face=False, use_non_contiguous=False, use_verts=False,
                description="Select non-manifold boundary")

        if not safe_op(bpy.ops.mesh.fill_grid, description="Grid fill holes"):
            if not safe_op(bpy.ops.mesh.fill, description="Basic fill holes"):
                print(f"[repair_mesh]   No holes to fill or fill failed (ok)")

        # ── Step 5: Post-fill vertex smoothing ──
        safe_op(bpy.ops.mesh.select_all, action="SELECT", description="Select all")
        safe_op(bpy.ops.mesh.vertices_smooth, factor=0.5, repeat=2,
                description="Post-fill vertex smoothing")

        # ── Step 6: Fix remaining non-manifold ──
        safe_op(bpy.ops.mesh.select_all, action="DESELECT", description="Deselect all")
        safe_op(bpy.ops.mesh.select_non_manifold,
                extend=False, use_wire=True, use_boundary=True,
                use_multi_face=True, use_non_contiguous=True, use_verts=True,
                description="Select all non-manifold")
        safe_op(bpy.ops.mesh.remove_doubles, threshold=args.merge_threshold * 5,
                description="Second-pass merge (5x threshold)")

        # ── Step 7: Recalculate normals ──
        safe_op(bpy.ops.mesh.select_all, action="SELECT", description="Select all")
        safe_op(bpy.ops.mesh.normals_make_consistent, inside=False,
                description="Recalculate normals")

        # ── Step 8: Final cleanup merge ──
        safe_op(bpy.ops.mesh.remove_doubles, threshold=args.merge_threshold,
                description="Final cleanup merge")

        ensure_mode("OBJECT")
        safe_op(bpy.ops.object.shade_smooth, description="Apply smooth shading")

        # Final stats
        final_verts = len(obj.data.vertices)
        final_faces = len(obj.data.polygons)
        print(f"[repair_mesh]   Final: {final_verts} verts, {final_faces} faces")
        print(f"[repair_mesh]   Reduction: {initial_verts} -> {final_verts} verts "
              f"({(1 - final_verts/max(initial_verts, 1))*100:.0f}%)")

        obj.select_set(False)
        repaired_count += 1

    # Export
    success, err = safe_export_glb(args.output)
    if not success:
        print(f"[repair_mesh] FATAL: Export failed: {err}")
        sys.exit(1)

    print(f"[repair_mesh] Repaired {repaired_count} mesh(es), exported to {args.output}")


if __name__ == "__main__":
    repair()
