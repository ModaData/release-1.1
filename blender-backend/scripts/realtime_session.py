"""
realtime_session.py — Persistent Blender session for real-time mesh editing.

This script runs inside a Blender subprocess and communicates via stdin/stdout
using a JSON-lines protocol. Each line is a JSON command; each response is a JSON line.

Commands:
  load_glb        — Load a GLB file into the session
  get_mesh_data   — Return full vertex/face data for Three.js sync
  select_face     — Select a face by index
  select_vertex   — Select a vertex by index
  translate_verts — Move selected vertices by delta
  sculpt_stroke   — Apply a sculpt-like deformation along a path
  extrude_faces   — Extrude selected faces along normal
  smooth_verts    — Smooth selected vertex neighborhood
  subdivide_sel   — Subdivide selected faces
  delete_faces    — Delete selected faces
  get_delta       — Return only changed vertex positions since last sync
  export_glb      — Export current state as GLB
  ping            — Health check

Usage:
  blender --background --python realtime_session.py
  Then send JSON commands on stdin, read JSON responses on stdout.
"""

import bpy
import bmesh
import sys
import json
import math
import struct
import base64
from mathutils import Vector


# ── Session state ──
class Session:
    def __init__(self):
        self.active_object = None
        self.bm = None  # bmesh for edit operations
        self.selected_verts = set()
        self.selected_faces = set()
        self.last_sync_positions = {}  # vertex_id → (x, y, z) at last sync
        self.dirty_verts = set()  # vertices changed since last sync

    def get_obj(self):
        if self.active_object and self.active_object.name in bpy.data.objects:
            return self.active_object
        # Fallback: first mesh object
        for obj in bpy.data.objects:
            if obj.type == "MESH":
                self.active_object = obj
                return obj
        return None

    def ensure_bmesh(self):
        """Get or create bmesh from active object."""
        obj = self.get_obj()
        if not obj:
            return None
        if self.bm is None or not self.bm.is_valid:
            self.bm = bmesh.new()
            self.bm.from_mesh(obj.data)
            self.bm.verts.ensure_lookup_table()
            self.bm.faces.ensure_lookup_table()
            self.bm.edges.ensure_lookup_table()
        return self.bm

    def commit_bmesh(self):
        """Write bmesh changes back to the Blender mesh."""
        obj = self.get_obj()
        if obj and self.bm and self.bm.is_valid:
            self.bm.to_mesh(obj.data)
            obj.data.update()

    def snapshot_positions(self):
        """Record current vertex positions for delta tracking."""
        bm = self.ensure_bmesh()
        if not bm:
            return
        self.last_sync_positions = {}
        for v in bm.verts:
            self.last_sync_positions[v.index] = (v.co.x, v.co.y, v.co.z)
        self.dirty_verts.clear()


session = Session()


# ── Command handlers ──

def cmd_load_glb(data):
    """Load a GLB file into the scene."""
    path = data.get("path")
    if not path:
        return {"error": "Missing 'path'"}

    # Clear scene
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()

    # Import GLB
    bpy.ops.import_scene.gltf(filepath=path)

    # Find the mesh object
    mesh_obj = None
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            mesh_obj = obj
            break

    if not mesh_obj:
        return {"error": "No mesh found in GLB"}

    session.active_object = mesh_obj
    session.bm = None  # Reset bmesh
    session.selected_verts.clear()
    session.selected_faces.clear()

    bm = session.ensure_bmesh()
    session.snapshot_positions()

    return {
        "ok": True,
        "object_name": mesh_obj.name,
        "vertex_count": len(bm.verts),
        "face_count": len(bm.faces),
        "edge_count": len(bm.edges),
    }


def cmd_get_mesh_data(data):
    """Return full mesh data for initial Three.js sync."""
    bm = session.ensure_bmesh()
    if not bm:
        return {"error": "No mesh loaded"}

    # Vertices: flat array [x,y,z, x,y,z, ...]
    verts = []
    for v in bm.verts:
        verts.extend([round(v.co.x, 6), round(v.co.y, 6), round(v.co.z, 6)])

    # Faces: array of vertex index arrays
    faces = []
    for f in bm.faces:
        faces.append([v.index for v in f.verts])

    # Edges: flat array [v1, v2, v1, v2, ...]
    edges = []
    for e in bm.edges:
        edges.extend([e.verts[0].index, e.verts[1].index])

    # Normals
    normals = []
    for v in bm.verts:
        normals.extend([round(v.normal.x, 4), round(v.normal.y, 4), round(v.normal.z, 4)])

    session.snapshot_positions()

    return {
        "ok": True,
        "vertices": verts,
        "faces": faces,
        "edges": edges,
        "normals": normals,
        "vertex_count": len(bm.verts),
        "face_count": len(bm.faces),
    }


def cmd_select_face(data):
    """Select a face by index."""
    face_idx = data.get("face_index")
    add = data.get("add", False)

    bm = session.ensure_bmesh()
    if not bm:
        return {"error": "No mesh loaded"}

    if face_idx < 0 or face_idx >= len(bm.faces):
        return {"error": f"Face index {face_idx} out of range"}

    if not add:
        session.selected_faces.clear()
        session.selected_verts.clear()
        for f in bm.faces:
            f.select = False
        for v in bm.verts:
            v.select = False

    face = bm.faces[face_idx]
    face.select = True
    session.selected_faces.add(face_idx)

    for v in face.verts:
        v.select = True
        session.selected_verts.add(v.index)

    return {
        "ok": True,
        "selected_faces": list(session.selected_faces),
        "selected_verts": list(session.selected_verts),
    }


def cmd_select_vertex(data):
    """Select a vertex by index."""
    vert_idx = data.get("vertex_index")
    add = data.get("add", False)

    bm = session.ensure_bmesh()
    if not bm:
        return {"error": "No mesh loaded"}

    if vert_idx < 0 or vert_idx >= len(bm.verts):
        return {"error": f"Vertex index {vert_idx} out of range"}

    if not add:
        session.selected_verts.clear()
        for v in bm.verts:
            v.select = False

    bm.verts[vert_idx].select = True
    session.selected_verts.add(vert_idx)

    return {
        "ok": True,
        "selected_verts": list(session.selected_verts),
    }


def cmd_translate_verts(data):
    """Translate selected vertices by a delta vector."""
    dx = data.get("dx", 0)
    dy = data.get("dy", 0)
    dz = data.get("dz", 0)
    vert_indices = data.get("vertex_indices")  # Optional: specific verts to move

    bm = session.ensure_bmesh()
    if not bm:
        return {"error": "No mesh loaded"}

    delta = Vector((dx, dy, dz))
    moved = []

    if vert_indices:
        targets = [bm.verts[i] for i in vert_indices if 0 <= i < len(bm.verts)]
    else:
        targets = [bm.verts[i] for i in session.selected_verts]

    for v in targets:
        v.co += delta
        session.dirty_verts.add(v.index)
        moved.append(v.index)

    session.commit_bmesh()

    return {
        "ok": True,
        "moved_count": len(moved),
        "moved_verts": moved,
    }


def cmd_sculpt_stroke(data):
    """Apply a sculpt-like deformation along a path.
    Displaces vertices near the stroke path based on brush radius and strength.
    """
    path = data.get("path", [])  # [[x,y,z], [x,y,z], ...]
    radius = data.get("radius", 0.05)
    strength = data.get("strength", 0.5)
    mode = data.get("mode", "push")  # push, smooth, flatten, inflate

    bm = session.ensure_bmesh()
    if not bm:
        return {"error": "No mesh loaded"}

    affected = set()

    for point in path:
        center = Vector(point)

        for v in bm.verts:
            dist = (v.co - center).length
            if dist > radius:
                continue

            # Falloff: smooth hermite interpolation
            t = 1.0 - (dist / radius)
            falloff = t * t * (3.0 - 2.0 * t)
            displacement = falloff * strength * 0.01  # Scale down for precision

            if mode == "push":
                # Push along vertex normal
                v.co += v.normal * displacement
            elif mode == "smooth":
                # Average with neighbors
                if v.link_edges:
                    avg = Vector((0, 0, 0))
                    for e in v.link_edges:
                        other = e.other_vert(v)
                        avg += other.co
                    avg /= len(v.link_edges)
                    v.co = v.co.lerp(avg, falloff * strength * 0.1)
            elif mode == "flatten":
                # Project onto average plane of neighbors
                if v.link_edges:
                    avg_pos = Vector((0, 0, 0))
                    for e in v.link_edges:
                        avg_pos += e.other_vert(v).co
                    avg_pos /= len(v.link_edges)
                    avg_normal = v.normal
                    proj = v.co - avg_normal * avg_normal.dot(v.co - avg_pos)
                    v.co = v.co.lerp(proj, falloff * strength * 0.1)
            elif mode == "inflate":
                # Push along normal (inflate/deflate)
                v.co += v.normal * displacement

            affected.add(v.index)
            session.dirty_verts.add(v.index)

    session.commit_bmesh()

    return {
        "ok": True,
        "affected_count": len(affected),
    }


def cmd_extrude_faces(data):
    """Extrude selected faces along their average normal."""
    distance = data.get("distance", 0.01)

    bm = session.ensure_bmesh()
    if not bm:
        return {"error": "No mesh loaded"}

    faces_to_extrude = [bm.faces[i] for i in session.selected_faces
                        if 0 <= i < len(bm.faces)]

    if not faces_to_extrude:
        return {"error": "No faces selected"}

    # Calculate average normal
    avg_normal = Vector((0, 0, 0))
    for f in faces_to_extrude:
        avg_normal += f.normal
    avg_normal.normalize()

    # Extrude
    result = bmesh.ops.extrude_face_region(bm, geom=faces_to_extrude)
    new_verts = [e for e in result["geom"] if isinstance(e, bmesh.types.BMVert)]

    # Translate extruded verts
    for v in new_verts:
        v.co += avg_normal * distance
        session.dirty_verts.add(v.index)

    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    bm.edges.ensure_lookup_table()

    session.commit_bmesh()

    # Update selection to new faces
    new_faces = [e for e in result["geom"] if isinstance(e, bmesh.types.BMFace)]
    session.selected_faces = {f.index for f in new_faces}
    session.selected_verts = {v.index for v in new_verts}

    return {
        "ok": True,
        "new_vert_count": len(new_verts),
        "new_face_count": len(new_faces),
        "vertex_count": len(bm.verts),
        "face_count": len(bm.faces),
    }


def cmd_smooth_verts(data):
    """Smooth selected vertices by averaging with neighbors."""
    iterations = data.get("iterations", 1)
    factor = data.get("factor", 0.5)

    bm = session.ensure_bmesh()
    if not bm:
        return {"error": "No mesh loaded"}

    targets = [bm.verts[i] for i in session.selected_verts
               if 0 <= i < len(bm.verts)]

    if not targets:
        return {"error": "No vertices selected"}

    for _ in range(iterations):
        new_positions = {}
        for v in targets:
            if not v.link_edges:
                continue
            avg = Vector((0, 0, 0))
            for e in v.link_edges:
                avg += e.other_vert(v).co
            avg /= len(v.link_edges)
            new_positions[v.index] = v.co.lerp(avg, factor)

        for idx, pos in new_positions.items():
            bm.verts[idx].co = pos
            session.dirty_verts.add(idx)

    session.commit_bmesh()

    return {
        "ok": True,
        "smoothed_count": len(targets),
    }


def cmd_subdivide_sel(data):
    """Subdivide selected faces."""
    cuts = data.get("cuts", 1)

    bm = session.ensure_bmesh()
    if not bm:
        return {"error": "No mesh loaded"}

    edges_to_cut = set()
    for fi in session.selected_faces:
        if 0 <= fi < len(bm.faces):
            for e in bm.faces[fi].edges:
                edges_to_cut.add(e)

    if not edges_to_cut:
        return {"error": "No faces selected for subdivision"}

    bmesh.ops.subdivide_edges(bm, edges=list(edges_to_cut), cuts=cuts, use_grid_fill=True)

    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    bm.edges.ensure_lookup_table()

    session.commit_bmesh()

    # Mark all new verts as dirty
    for v in bm.verts:
        if v.index not in session.last_sync_positions:
            session.dirty_verts.add(v.index)

    return {
        "ok": True,
        "vertex_count": len(bm.verts),
        "face_count": len(bm.faces),
        "topology_changed": True,
    }


def cmd_delete_faces(data):
    """Delete selected faces."""
    bm = session.ensure_bmesh()
    if not bm:
        return {"error": "No mesh loaded"}

    faces_to_delete = [bm.faces[i] for i in session.selected_faces
                       if 0 <= i < len(bm.faces)]

    if not faces_to_delete:
        return {"error": "No faces selected"}

    bmesh.ops.delete(bm, geom=faces_to_delete, context="FACES")

    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    bm.edges.ensure_lookup_table()

    session.commit_bmesh()
    session.selected_faces.clear()
    session.selected_verts.clear()

    return {
        "ok": True,
        "vertex_count": len(bm.verts),
        "face_count": len(bm.faces),
        "topology_changed": True,
    }


def cmd_get_delta(data):
    """Return only vertex positions that changed since last sync.
    This is the key to real-time performance — send diffs, not full meshes.
    """
    bm = session.ensure_bmesh()
    if not bm:
        return {"error": "No mesh loaded"}

    # Check for topology changes (new/deleted verts)
    current_count = len(bm.verts)
    last_count = len(session.last_sync_positions)
    topology_changed = current_count != last_count

    if topology_changed:
        # Full resync needed
        session.snapshot_positions()
        return {
            "ok": True,
            "topology_changed": True,
            "vertex_count": current_count,
            "face_count": len(bm.faces),
        }

    # Collect position deltas for dirty vertices
    deltas = {}
    for vi in session.dirty_verts:
        if 0 <= vi < len(bm.verts):
            v = bm.verts[vi]
            deltas[vi] = [round(v.co.x, 6), round(v.co.y, 6), round(v.co.z, 6)]

    # Update snapshot
    for vi, pos in deltas.items():
        session.last_sync_positions[vi] = tuple(pos)
    session.dirty_verts.clear()

    return {
        "ok": True,
        "topology_changed": False,
        "delta_count": len(deltas),
        "deltas": deltas,  # { vertex_index: [x, y, z] }
    }


def cmd_export_glb(data):
    """Export current state as GLB."""
    output_path = data.get("path", "/tmp/blender-work/output/realtime_export.glb")

    obj = session.get_obj()
    if not obj:
        return {"error": "No mesh loaded"}

    # Make sure bmesh is committed
    session.commit_bmesh()

    # Select only our object
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_materials="EXPORT",
        export_normals=True,
    )

    return {"ok": True, "path": output_path}


def cmd_ping(data):
    return {"ok": True, "pong": True}


# ── Command dispatcher ──
COMMANDS = {
    "load_glb": cmd_load_glb,
    "get_mesh_data": cmd_get_mesh_data,
    "select_face": cmd_select_face,
    "select_vertex": cmd_select_vertex,
    "translate_verts": cmd_translate_verts,
    "sculpt_stroke": cmd_sculpt_stroke,
    "extrude_faces": cmd_extrude_faces,
    "smooth_verts": cmd_smooth_verts,
    "subdivide_sel": cmd_subdivide_sel,
    "delete_faces": cmd_delete_faces,
    "get_delta": cmd_get_delta,
    "export_glb": cmd_export_glb,
    "ping": cmd_ping,
}


def main():
    """Main loop: read JSON commands from stdin, write responses to stdout."""
    # Signal ready
    sys.stdout.write(json.dumps({"ready": True}) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            cmd_data = json.loads(line)
        except json.JSONDecodeError:
            sys.stdout.write(json.dumps({"error": "Invalid JSON"}) + "\n")
            sys.stdout.flush()
            continue

        cmd_name = cmd_data.get("cmd")
        if cmd_name not in COMMANDS:
            sys.stdout.write(json.dumps({"error": f"Unknown command: {cmd_name}"}) + "\n")
            sys.stdout.flush()
            continue

        try:
            result = COMMANDS[cmd_name](cmd_data)
        except Exception as e:
            result = {"error": str(e)}

        sys.stdout.write(json.dumps(result) + "\n")
        sys.stdout.flush()

        # Exit on quit command
        if cmd_name == "quit":
            break


if __name__ == "__main__":
    main()
