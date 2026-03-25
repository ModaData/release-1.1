"""
blender_helpers.py — Shared error handling & prerequisite checking utilities
for all Blender garment pipeline scripts.

Provides:
  - safe_op(): Wraps any bpy.ops call with try/except + logging
  - ensure_mode(): Safely switch to EDIT/OBJECT mode
  - check_mesh(): Verify mesh has vertices/faces before operations
  - safe_modifier_apply(): Apply modifier with rollback on failure
  - log_mesh_stats(): Print vertex/face/edge counts
"""

import bpy
import sys
import traceback


def safe_op(op_func, *args, description="", **kwargs):
    """
    Safely call a bpy.ops function with error handling.
    Returns True if succeeded, False if failed.

    Usage:
        safe_op(bpy.ops.mesh.remove_doubles, threshold=0.001, description="Merge by distance")
    """
    try:
        result = op_func(*args, **kwargs)
        # Blender ops return {'FINISHED'} on success
        if result == {'FINISHED'} or result == {'CANCELLED'}:
            return True
        return True  # Some ops return None
    except RuntimeError as e:
        if description:
            print(f"[WARNING] {description} failed: {e}")
        return False
    except Exception as e:
        if description:
            print(f"[ERROR] {description} unexpected error: {e}")
        return False


def ensure_mode(mode="OBJECT"):
    """
    Safely switch to the given mode (OBJECT, EDIT, SCULPT, etc.).
    Handles case where no active object exists.
    """
    try:
        if bpy.context.active_object is None:
            # Find a mesh object to set as active
            for obj in bpy.context.scene.objects:
                if obj.type == "MESH":
                    bpy.context.view_layer.objects.active = obj
                    break
            else:
                return False  # No mesh objects at all

        current_mode = bpy.context.active_object.mode
        if current_mode != mode:
            bpy.ops.object.mode_set(mode=mode)
        return True
    except RuntimeError as e:
        print(f"[WARNING] Could not switch to {mode} mode: {e}")
        return False


def check_mesh(obj, require_faces=True, require_verts=True, min_verts=3):
    """
    Verify mesh object meets minimum requirements.
    Returns (ok: bool, reason: str).
    """
    if obj is None:
        return False, "Object is None"

    if obj.type != "MESH":
        return False, f"Object '{obj.name}' is not a mesh (type={obj.type})"

    if obj.data is None:
        return False, f"Object '{obj.name}' has no mesh data"

    vert_count = len(obj.data.vertices)
    face_count = len(obj.data.polygons)

    if require_verts and vert_count < min_verts:
        return False, f"Object '{obj.name}' has only {vert_count} vertices (need >= {min_verts})"

    if require_faces and face_count == 0:
        return False, f"Object '{obj.name}' has no faces"

    return True, f"OK ({vert_count} verts, {face_count} faces)"


def safe_modifier_apply(obj, modifier_name, description=""):
    """
    Safely apply a modifier to the object.
    Returns True if applied, False if failed.
    Removes the modifier if application fails.
    """
    try:
        # Ensure we're in object mode
        ensure_mode("OBJECT")

        # Make sure this object is active
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)

        # Check modifier exists
        if modifier_name not in obj.modifiers:
            print(f"[WARNING] Modifier '{modifier_name}' not found on '{obj.name}'")
            return False

        bpy.ops.object.modifier_apply(modifier=modifier_name)
        return True

    except RuntimeError as e:
        desc = description or modifier_name
        print(f"[WARNING] Could not apply modifier '{desc}' on '{obj.name}': {e}")

        # Try to remove the broken modifier
        try:
            mod = obj.modifiers.get(modifier_name)
            if mod:
                obj.modifiers.remove(mod)
                print(f"[WARNING] Removed failed modifier '{modifier_name}'")
        except Exception:
            pass

        return False


def log_mesh_stats(obj, prefix=""):
    """Print mesh statistics."""
    if obj is None or obj.type != "MESH":
        print(f"{prefix}[stats] No mesh data")
        return

    verts = len(obj.data.vertices)
    faces = len(obj.data.polygons)
    edges = len(obj.data.edges)
    print(f"{prefix}[stats] {verts} verts, {faces} faces, {edges} edges")


def safe_import_glb(filepath):
    """
    Safely import a GLB file and return list of imported mesh objects.
    Returns (meshes: list, error: str or None).
    """
    try:
        # Clear scene
        bpy.ops.wm.read_factory_settings(use_empty=True)

        # Import
        bpy.ops.import_scene.gltf(filepath=filepath)

        # Collect mesh objects
        meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]

        if not meshes:
            return [], "No mesh objects found in GLB file"

        return meshes, None

    except RuntimeError as e:
        return [], f"Failed to import GLB: {e}"
    except Exception as e:
        return [], f"Unexpected error importing GLB: {e}"


def safe_export_glb(filepath):
    """
    Safely export the scene to GLB format.
    Returns (success: bool, error: str or None).
    """
    try:
        # Ensure object mode
        ensure_mode("OBJECT")

        bpy.ops.export_scene.gltf(
            filepath=filepath,
            export_format="GLB",
            use_selection=False,
            export_apply=True,
            export_extras=True,
        )
        return True, None

    except RuntimeError as e:
        return False, f"Failed to export GLB: {e}"
    except Exception as e:
        return False, f"Unexpected error exporting GLB: {e}"


def wrap_main(main_func):
    """
    Decorator/wrapper for main script functions.
    Catches all exceptions and exits with appropriate code.
    """
    def wrapped():
        try:
            main_func()
        except SystemExit:
            raise  # Let sys.exit() through
        except Exception as e:
            print(f"[FATAL] Script crashed: {e}")
            traceback.print_exc()
            sys.exit(1)

    return wrapped
