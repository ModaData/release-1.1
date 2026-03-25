#!/usr/bin/env python3
"""
deploy_runpod.py — Self-extracting deployment script for RunPod GPU pod.
Paste this entire file into the RunPod Web Terminal to set up the Blender API backend.

Usage (in RunPod web terminal):
  python3 << 'SCRIPT_END'
  <paste this file content>
  SCRIPT_END

Or:
  python3 deploy_runpod.py

What it does:
  1. Creates /workspace/blender-api/ with server.py + all scripts
  2. Installs Python dependencies (FastAPI, uvicorn, etc.)
  3. Downloads and installs Blender 4.0.2 to /opt/blender/
  4. Installs system libraries needed by Blender
  5. Prints the uvicorn start command
"""

import os
import subprocess
import sys

WORKSPACE = "/workspace/blender-api"
SCRIPTS_DIR = f"{WORKSPACE}/scripts"
WORK_DIR = "/tmp/blender-work"

# ── All files to deploy ──
FILES = {}

# ──────────────────────────────────────────
# server.py  (with RunPod paths + --addons flag + better logging)
# ──────────────────────────────────────────
FILES[f"{WORKSPACE}/server.py"] = r'''"""
Blender FastAPI Backend — Headless Blender 4.0 for garment processing.
Endpoints: auto-fix, repair-mesh, clean-mesh, subdivide, smooth, apply-cloth-physics, resize-garment, apply-logo, swap-fabric, render-scene, bake-pbr
"""

import os
import uuid
import subprocess
import tempfile
import shutil
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

app = FastAPI(title="Blender Garment Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BLENDER_BIN = os.environ.get("BLENDER_BIN", "/opt/blender/blender")
SCRIPTS_DIR = Path("/workspace/blender-api/scripts")
WORK_DIR = Path("/tmp/blender-work")
INPUT_DIR = WORK_DIR / "input"
OUTPUT_DIR = WORK_DIR / "output"
FRAMES_DIR = WORK_DIR / "frames"

for d in [INPUT_DIR, OUTPUT_DIR, FRAMES_DIR]:
    d.mkdir(parents=True, exist_ok=True)


def run_blender_script(script_name: str, args: dict, input_file: Path = None) -> Path:
    """Run a Blender Python script in background mode and return the output file path."""
    job_id = str(uuid.uuid4())[:8]
    output_path = OUTPUT_DIR / f"{job_id}_output.glb"

    # Build Blender command
    cmd = [
        BLENDER_BIN, "--background",
        "--addons", "io_scene_gltf2",
        "--python", str(SCRIPTS_DIR / script_name),
        "--",  # Separator for script args
        "--output", str(output_path),
    ]

    if input_file:
        cmd.extend(["--input", str(input_file)])

    # Pass all args as --key value
    for key, value in args.items():
        cmd.extend([f"--{key}", str(value)])

    print(f"[blender] Running: {' '.join(cmd[:8])}... (job {job_id})")

    # Longer timeout for multi-frame renders (turntable)
    timeout = 600 if "turntable" in script_name else 300

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
    )

    # Always log stdout/stderr for debugging
    if result.stdout:
        print(f"[blender] STDOUT (last 1000 chars):\n{result.stdout[-1000:]}")
    if result.stderr:
        print(f"[blender] STDERR (last 1000 chars):\n{result.stderr[-1000:]}")

    if result.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Blender script '{script_name}' failed (exit code {result.returncode}). "
                f"stderr hint: {result.stderr[-300:] if result.stderr else 'no stderr'}"
            ),
        )

    if not output_path.exists():
        # Try common alternative extensions
        for ext in [".glb", ".gltf", ".fbx", ".obj", ".png"]:
            alt = OUTPUT_DIR / f"{job_id}_output{ext}"
            if alt.exists():
                return alt
        raise HTTPException(status_code=500, detail="Blender produced no output file")

    return output_path


async def save_upload(upload: UploadFile) -> Path:
    """Save an uploaded file to the input directory."""
    ext = Path(upload.filename).suffix or ".glb"
    file_id = str(uuid.uuid4())[:8]
    dest = INPUT_DIR / f"{file_id}{ext}"
    with open(dest, "wb") as f:
        content = await upload.read()
        f.write(content)
    return dest


@app.get("/health")
async def health():
    return {"status": "ok", "blender": BLENDER_BIN}


# ── POST /api/auto-fix — One-click repair → remesh → smooth pipeline ──
@app.post("/api/auto-fix")
async def auto_fix(
    file: UploadFile = File(...),
    quality: str = Form("standard"),
):
    input_path = await save_upload(file)
    output_path = run_blender_script("auto_fix.py", {
        "quality": quality,
    }, input_path)
    return FileResponse(output_path, media_type="model/gltf-binary", filename="fixed.glb")


# ── POST /api/repair-mesh — Fill holes + fix non-manifold + merge doubles ──
@app.post("/api/repair-mesh")
async def repair_mesh(
    file: UploadFile = File(...),
    merge_threshold: float = Form(0.001),
    max_hole_edges: int = Form(64),
):
    input_path = await save_upload(file)
    output_path = run_blender_script("repair_mesh.py", {
        "merge_threshold": merge_threshold,
        "max_hole_edges": max_hole_edges,
    }, input_path)
    return FileResponse(output_path, media_type="model/gltf-binary", filename="repaired.glb")


# ── POST /api/clean-mesh — Retopology + voxel remesh + smoothing ──
@app.post("/api/clean-mesh")
async def clean_mesh(
    file: UploadFile = File(...),
    target_faces: int = Form(12000),
    smooth_iterations: int = Form(1),
    voxel_size: float = Form(0.005),
    use_voxel_remesh: str = Form("true"),
):
    input_path = await save_upload(file)
    output_path = run_blender_script("clean_mesh.py", {
        "target_faces": target_faces,
        "smooth_iterations": smooth_iterations,
        "voxel_size": voxel_size,
        "use_voxel_remesh": use_voxel_remesh,
    }, input_path)
    return FileResponse(output_path, media_type="model/gltf-binary", filename="cleaned.glb")


# ── POST /api/subdivide — Subdivision Surface ──
@app.post("/api/subdivide")
async def subdivide_mesh(
    file: UploadFile = File(...),
    levels: int = Form(1),
):
    input_path = await save_upload(file)
    output_path = run_blender_script("subdivide_mesh.py", {
        "levels": levels,
    }, input_path)
    return FileResponse(output_path, media_type="model/gltf-binary", filename="subdivided.glb")


# ── POST /api/smooth — Laplacian Smooth + Corrective Smooth ──
@app.post("/api/smooth")
async def smooth_mesh(
    file: UploadFile = File(...),
    iterations: int = Form(2),
    factor: float = Form(0.3),
    preserve_borders: float = Form(0.1),
):
    input_path = await save_upload(file)
    output_path = run_blender_script("smooth_mesh.py", {
        "iterations": iterations,
        "factor": factor,
        "preserve_borders": preserve_borders,
    }, input_path)
    return FileResponse(output_path, media_type="model/gltf-binary", filename="smoothed.glb")


# ── POST /api/apply-cloth-physics — Cloth simulation with fabric presets ──
@app.post("/api/apply-cloth-physics")
async def apply_cloth_physics(
    file: UploadFile = File(...),
    size: str = Form("M"),
    frames: int = Form(60),
    fabric_type: str = Form("cotton"),
):
    input_path = await save_upload(file)
    output_path = run_blender_script("cloth_physics.py", {
        "size": size,
        "frames": frames,
        "fabric_type": fabric_type,
    }, input_path)
    return FileResponse(output_path, media_type="model/gltf-binary", filename="cloth_sim.glb")


# ── POST /api/resize-garment — Parametric resize ──
@app.post("/api/resize-garment")
async def resize_garment(
    file: UploadFile = File(...),
    size: str = Form("M"),
):
    input_path = await save_upload(file)
    output_path = run_blender_script("resize_parametric.py", {
        "size": size,
    }, input_path)
    return FileResponse(output_path, media_type="model/gltf-binary", filename=f"resized_{size}.glb")


# ── POST /api/apply-logo — Logo UV mapping ──
@app.post("/api/apply-logo")
async def apply_logo(
    garment: UploadFile = File(...),
    logo: UploadFile = File(...),
    position: str = Form("chest_center"),
    scale: float = Form(0.15),
):
    garment_path = await save_upload(garment)
    logo_path = await save_upload(logo)
    output_path = run_blender_script("apply_logo.py", {
        "logo": str(logo_path),
        "position": position,
        "scale": scale,
    }, garment_path)
    return FileResponse(output_path, media_type="model/gltf-binary", filename="with_logo.glb")


# ── POST /api/swap-fabric — PBR material swap ──
@app.post("/api/swap-fabric")
async def swap_fabric(
    file: UploadFile = File(...),
    fabric_type: str = Form("cotton"),
):
    input_path = await save_upload(file)
    output_path = run_blender_script("swap_fabric.py", {
        "fabric_type": fabric_type,
    }, input_path)
    return FileResponse(output_path, media_type="model/gltf-binary", filename=f"fabric_{fabric_type}.glb")


# ── POST /api/render-scene — Cycles render to PNG ──
@app.post("/api/render-scene")
async def render_scene(
    file: UploadFile = File(...),
    resolution: int = Form(1024),
    samples: int = Form(128),
):
    input_path = await save_upload(file)
    output_path = run_blender_script("render_scene.py", {
        "resolution": resolution,
        "samples": samples,
    }, input_path)
    # Render produces a PNG
    png_path = output_path.with_suffix(".png")
    if png_path.exists():
        return FileResponse(png_path, media_type="image/png", filename="render.png")
    return FileResponse(output_path, filename="render.png")


# ── POST /api/bake-pbr — PBR texture baking (project AI render onto mesh UVs) ──
@app.post("/api/bake-pbr")
async def bake_pbr(
    file: UploadFile = File(...),        # GLB garment mesh
    texture: UploadFile = File(...),      # AI render PNG to project
    resolution: int = Form(2048),
):
    garment_path = await save_upload(file)
    texture_path = await save_upload(texture)
    output_path = run_blender_script("hunyuan_bake.py", {
        "texture": str(texture_path),
        "resolution": resolution,
    }, garment_path)
    return FileResponse(output_path, media_type="model/gltf-binary", filename="baked.glb")


# ── POST /api/turntable-render — 360° animated GIF turntable ──
@app.post("/api/turntable-render")
async def turntable_render(
    file: UploadFile = File(...),
    frames: int = Form(36),
    resolution: int = Form(512),
    samples: int = Form(32),
):
    input_path = await save_upload(file)
    output_path = run_blender_script("turntable_render.py", {
        "frames": frames,
        "resolution": resolution,
        "samples": samples,
    }, input_path)

    # turntable_render.py writes a marker JSON + GIF file
    output_base = str(output_path).rsplit(".", 1)[0]
    gif_path = Path(output_base + ".gif")
    marker_path = Path(output_base + "_turntable.json")

    # Check if GIF was assembled by Blender script (Pillow available)
    if gif_path.exists():
        return FileResponse(gif_path, media_type="image/gif", filename="turntable.gif")

    # If Blender couldn't assemble GIF, try with server-side Pillow
    if marker_path.exists():
        import json
        import glob as glob_mod
        with open(marker_path) as f:
            meta = json.load(f)

        frames_dir = meta.get("frames_dir", "")
        if frames_dir and Path(frames_dir).exists():
            try:
                from PIL import Image
                frame_files = sorted(glob_mod.glob(str(Path(frames_dir) / "frame_*.png")))
                if frame_files:
                    images = []
                    for fp in frame_files:
                        img = Image.open(fp).convert("RGBA")
                        bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
                        bg.paste(img, mask=img.split()[3])
                        images.append(bg.convert("RGB"))

                    gif_out = OUTPUT_DIR / f"{Path(output_base).name}.gif"
                    images[0].save(
                        str(gif_out),
                        save_all=True,
                        append_images=images[1:],
                        duration=80,
                        loop=0,
                        optimize=True,
                    )
                    return FileResponse(gif_out, media_type="image/gif", filename="turntable.gif")
            except ImportError:
                pass

    # Last resort: return first frame as PNG
    frames_dir_fallback = Path(output_base + "_frames")
    if frames_dir_fallback.exists():
        first_frame = sorted(frames_dir_fallback.glob("frame_*.png"))
        if first_frame:
            return FileResponse(first_frame[0], media_type="image/png", filename="turntable_frame.png")

    raise HTTPException(status_code=500, detail="Turntable render produced no output")


# ── POST /api/assemble-garment — Construct garment from JSON spec (no input GLB) ──
@app.post("/api/assemble-garment")
async def assemble_garment(request: Request):
    """
    Build a garment from a structured JSON spec using bmesh construction.
    Unlike other endpoints, this does NOT require a file upload — geometry
    is constructed from scratch based on the spec.
    """
    import json as json_mod

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    spec = body.get("spec")
    if not spec:
        raise HTTPException(status_code=400, detail="Missing 'spec' field in request body")

    # Write spec to a temp JSON file for the Blender script
    job_id = str(uuid.uuid4())[:8]
    spec_path = INPUT_DIR / f"{job_id}_spec.json"
    output_path = OUTPUT_DIR / f"{job_id}_assembled.glb"

    with open(spec_path, "w", encoding="utf-8") as f:
        json_mod.dump(spec, f, indent=2)

    # Build Blender command
    cmd = [
        BLENDER_BIN, "--background", "--python", str(SCRIPTS_DIR / "garment_builder.py"),
        "--",
        "--output", str(output_path),
        "--spec_json", str(spec_path),
    ]

    print(f"[assemble] Running garment_builder.py (job {job_id})")
    print(f"[assemble] Spec: {spec.get('garment_type', 'unknown')} with {len(spec.get('parts', []))} parts")

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Garment assembly timed out (300s)")

    if result.returncode != 0:
        print(f"[assemble] STDERR: {result.stderr[-500:]}")
        raise HTTPException(
            status_code=500,
            detail=f"Garment assembly failed: {result.stderr[-300:]}"
        )

    if not output_path.exists():
        raise HTTPException(status_code=500, detail="Garment assembly produced no output GLB")

    # Read config JSON written alongside the GLB
    config_path = Path(str(output_path).rsplit(".", 1)[0] + "_config.json")
    config = {}
    if config_path.exists():
        with open(config_path, "r") as f:
            config = json_mod.load(f)

    # Return GLB as base64 data URL + config
    with open(output_path, "rb") as f:
        glb_bytes = f.read()

    import base64
    glb_b64 = base64.b64encode(glb_bytes).decode("utf-8")
    glb_data_url = f"data:model/gltf-binary;base64,{glb_b64}"

    print(f"[assemble] Success: {config.get('total_vertices', '?')} verts, "
          f"{config.get('total_faces', '?')} faces, "
          f"{len(config.get('parts', []))} parts")

    # Cleanup temp files
    try:
        spec_path.unlink(missing_ok=True)
    except Exception:
        pass

    return JSONResponse({
        "glbDataUrl": glb_data_url,
        "config": config,
    })
'''

# ──────────────────────────────────────────
# scripts/naming_convention.py
# ──────────────────────────────────────────
FILES[f"{SCRIPTS_DIR}/naming_convention.py"] = r'''# File: blender-backend/scripts/naming_convention.py
# Canonical garment part naming convention shared across all Blender scripts.
# Mirrored in JavaScript at src/lib/garment-naming.js

PART_PREFIX = "garment"

# Enumerated part types with valid suffixes and variants
PART_TYPES = {
    "body": {
        "suffixes": ["front", "back", "full"],
        "variants": ["shirt", "tshirt", "hoodie", "blazer", "dress", "pants", "skirt", "jacket", "coat"],
    },
    "collar": {
        "suffixes": [],
        "variants": ["mandarin", "spread", "button_down", "peter_pan", "band", "shawl", "polo", "crew", "v_neck"],
    },
    "cuff": {
        "suffixes": ["left", "right"],
        "variants": ["french", "barrel", "ribbed", "elastic"],
    },
    "sleeve": {
        "suffixes": ["left", "right"],
        "variants": ["long", "short", "three_quarter", "cap", "raglan", "bell", "puff"],
    },
    "pocket": {
        "suffixes": ["chest", "hip_left", "hip_right", "back_left", "back_right"],
        "variants": ["patch", "welt", "flap", "kangaroo", "zippered"],
    },
    "placket": {
        "suffixes": ["front", "back"],
        "variants": [],
    },
    "button": {
        "suffixes": [str(i) for i in range(12)],
        "variants": [],
    },
    "hood": {
        "suffixes": ["outer", "lining"],
        "variants": ["standard", "oversized"],
    },
    "waistband": {
        "suffixes": ["front", "back", "full"],
        "variants": ["elastic", "structured", "drawstring"],
    },
    "hem": {
        "suffixes": ["front", "back", "full"],
        "variants": ["straight", "curved", "split", "ribbed"],
    },
    "yoke": {
        "suffixes": ["front", "back"],
        "variants": [],
    },
    "dart": {
        "suffixes": ["bust_left", "bust_right", "waist_left", "waist_right"],
        "variants": [],
    },
    "belt_loop": {
        "suffixes": [str(i) for i in range(8)],
        "variants": [],
    },
    "zipper": {
        "suffixes": ["front", "side", "back"],
        "variants": ["exposed", "hidden", "decorative"],
    },
    "lining": {
        "suffixes": ["full", "partial"],
        "variants": [],
    },
}


def make_name(part_type, suffix="", variant=""):
    """
    Build a canonical object name.

    Examples:
        make_name("collar", variant="mandarin")       -> "garment_collar_mandarin"
        make_name("cuff", "left", "french")            -> "garment_cuff_french_left"
        make_name("body", "full", "shirt")             -> "garment_body_shirt_full"
        make_name("pocket", "chest", "patch")          -> "garment_pocket_patch_chest"
    """
    parts = [PART_PREFIX, part_type]
    if variant:
        parts.append(variant)
    if suffix:
        parts.append(suffix)
    return "_".join(parts)


def parse_name(name):
    """
    Parse a canonical name back into structured data.

    Returns dict with {part_type, detail, full_name} or None if not a garment part.

    Examples:
        parse_name("garment_collar_mandarin")
          -> {"part_type": "collar", "detail": "mandarin", "full_name": "garment_collar_mandarin"}
        parse_name("Cube.001")
          -> None
    """
    if not name or not name.startswith(PART_PREFIX + "_"):
        return None
    tokens = name.split("_")
    if len(tokens) < 2:
        return None
    part_type = tokens[1]
    detail = "_".join(tokens[2:]) if len(tokens) > 2 else ""
    return {
        "part_type": part_type,
        "detail": detail,
        "full_name": name,
    }


def is_garment_part(name):
    """Check if an object name follows the garment naming convention."""
    return name is not None and name.startswith(PART_PREFIX + "_")


def tag_object(obj, part_type, suffix="", variant=""):
    """
    Name a Blender object and set custom properties for metadata.
    Use this when creating or importing garment components.
    """
    obj.name = make_name(part_type, suffix, variant)
    obj["garment_part_type"] = part_type
    if variant:
        obj["garment_variant"] = variant
    if suffix:
        obj["garment_suffix"] = suffix
    return obj
'''

# ──────────────────────────────────────
# scripts/blender_helpers.py
# ──────────────────────────────────────
FILES[f"{SCRIPTS_DIR}/blender_helpers.py"] = r'''"""
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
'''

# ──────────────────────────────────────────
# scripts/repair_mesh.py
# ──────────────────────────────────────────
FILES[f"{SCRIPTS_DIR}/repair_mesh.py"] = r'''"""
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


@wrap_main
def repair():
    args = parse_args()

    # Import GLB
    meshes, err = safe_import_glb(args.input)
    if err:
        print(f"[repair_mesh] FATAL: {err}")
        sys.exit(1)

    print(f"[repair_mesh] Found {len(meshes)} mesh object(s)")
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
'''

# ──────────────────────────────────────────
# scripts/clean_mesh.py
# ──────────────────────────────────────────
FILES[f"{SCRIPTS_DIR}/clean_mesh.py"] = r'''"""
clean_mesh.py — Import GLB -> optional voxel remesh -> decimate -> SubSurf -> smooth shade -> export
Tuned for HunYuan 3D garment meshes (50K-500K+ noisy triangles).

Error-hardened: modifier application wrapped with safe_modifier_apply,
mesh validity checked before each step.

Pipeline order:
  1. Pre-decimate only if >3x target (noise reduction)
  2. Voxel remesh (converts triangle soup to clean quads)
  3. Final decimate to exact target count
  4. Optional SubSurf (capped at 2)
  5. Smooth shading + auto smooth

Usage: blender --background --python clean_mesh.py -- --input mesh.glb --output cleaned.glb --target_faces 12000 --voxel_size 0.005
"""

import bpy
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
    parser.add_argument("--target_faces", type=int, default=12000)
    parser.add_argument("--smooth_iterations", type=int, default=1)
    parser.add_argument("--voxel_size", type=float, default=0.005,
                        help="Voxel remesh resolution (smaller = more detail, 0 = skip)")
    parser.add_argument("--use_voxel_remesh", type=str, default="true",
                        help="Enable voxel remesh (true/false)")
    return parser.parse_args(argv)


@wrap_main
def clean():
    args = parse_args()
    use_voxel = args.use_voxel_remesh.lower() in ("true", "1", "yes")

    # Import GLB
    meshes, err = safe_import_glb(args.input)
    if err:
        print(f"[clean_mesh] FATAL: {err}")
        sys.exit(1)

    print(f"[clean_mesh] Found {len(meshes)} mesh object(s)")

    for obj in meshes:
        # Pre-check mesh validity
        ok, reason = check_mesh(obj)
        if not ok:
            print(f"[clean_mesh] Skipping '{obj.name}': {reason}")
            continue

        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)

        original_name = obj.name
        current_faces = len(obj.data.polygons)
        initial_faces = current_faces
        print(f"[clean_mesh] Processing '{obj.name}': {current_faces} faces")

        # ── Step 1: Pre-decimate if way over target (>3x) ──
        if current_faces > args.target_faces * 3:
            pre_target = args.target_faces * 2
            ratio = pre_target / current_faces
            mod = obj.modifiers.new(name="PreDecimate", type="DECIMATE")
            mod.ratio = max(ratio, 0.01)
            if safe_modifier_apply(obj, "PreDecimate", "Pre-decimate"):
                after = len(obj.data.polygons)
                print(f"[clean_mesh]   Pre-decimate: {current_faces} -> {after} faces")
                current_faces = after
            else:
                print(f"[clean_mesh]   Pre-decimate failed, continuing without it")

        # ── Step 2: Voxel Remesh ──
        if use_voxel and args.voxel_size > 0:
            mod = obj.modifiers.new(name="VoxelRemesh", type="REMESH")
            mod.mode = "VOXEL"
            mod.voxel_size = args.voxel_size
            mod.use_smooth_shade = True
            if safe_modifier_apply(obj, "VoxelRemesh", "Voxel remesh"):
                after = len(obj.data.polygons)
                print(f"[clean_mesh]   Voxel remesh (size={args.voxel_size}): {current_faces} -> {after} faces")
                current_faces = after
            else:
                print(f"[clean_mesh]   Voxel remesh failed, continuing with current mesh")

        # ── Step 3: Final decimate to exact target ──
        current_faces = len(obj.data.polygons)
        if current_faces > args.target_faces:
            ratio = args.target_faces / current_faces
            mod = obj.modifiers.new(name="Decimate", type="DECIMATE")
            mod.ratio = max(ratio, 0.01)
            if safe_modifier_apply(obj, "Decimate", "Final decimate"):
                after = len(obj.data.polygons)
                print(f"[clean_mesh]   Final decimate: {current_faces} -> {after} faces")
                current_faces = after
            else:
                print(f"[clean_mesh]   Final decimate failed, mesh may be over target")

        # ── Step 4: Optional SubSurf (capped at 2 levels) ──
        if args.smooth_iterations > 0:
            levels = min(args.smooth_iterations, 2)
            mod = obj.modifiers.new(name="SubSurf", type="SUBSURF")
            mod.levels = levels
            mod.render_levels = levels
            mod.subdivision_type = "CATMULL_CLARK"
            if safe_modifier_apply(obj, "SubSurf", f"SubSurf level {levels}"):
                after = len(obj.data.polygons)
                print(f"[clean_mesh]   SubSurf (level={levels}): {current_faces} -> {after} faces")
            else:
                print(f"[clean_mesh]   SubSurf failed, skipping")

        # ── Step 5: Smooth shading ──
        ensure_mode("OBJECT")
        safe_op(bpy.ops.object.shade_smooth, description="Apply smooth shading")

        # Auto smooth angle
        try:
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
        except (RuntimeError, AttributeError):
            pass

        # Final stats
        final_faces = len(obj.data.polygons)
        final_verts = len(obj.data.vertices)
        print(f"[clean_mesh]   Final: {final_verts} verts, {final_faces} faces "
              f"(was {initial_faces} faces)")

        # Restore name
        obj.name = original_name
        obj.select_set(False)

    # Export
    success, err = safe_export_glb(args.output)
    if not success:
        print(f"[clean_mesh] FATAL: Export failed: {err}")
        sys.exit(1)

    print(f"[clean_mesh] Exported to {args.output}")


if __name__ == "__main__":
    clean()
'''

# ──────────────────────────────────────────
# scripts/smooth_mesh.py
# ──────────────────────────────────────────
FILES[f"{SCRIPTS_DIR}/smooth_mesh.py"] = r'''"""
smooth_mesh.py — Import GLB -> Laplacian Smooth -> Corrective Smooth -> auto smooth angle -> export
Tuned for garment meshes: preserves seam ridges and folds.

Error-hardened: modifier application uses safe_modifier_apply,
mesh validated before processing.

Usage: blender --background --python smooth_mesh.py -- --input mesh.glb --output smoothed.glb --iterations 2 --factor 0.3
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


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--iterations", type=int, default=2,
                        help="Smooth iterations (1-10)")
    parser.add_argument("--factor", type=float, default=0.3,
                        help="Smooth strength factor (0.0-2.0)")
    parser.add_argument("--preserve_borders", type=float, default=0.1,
                        help="Border smoothing factor (lower = more preserved, 0.0-1.0)")
    return parser.parse_args(argv)


@wrap_main
def smooth():
    args = parse_args()
    iterations = max(1, min(args.iterations, 10))
    factor = max(0.0, min(args.factor, 2.0))
    border_factor = max(0.0, min(args.preserve_borders, 1.0))

    # Import GLB
    meshes, err = safe_import_glb(args.input)
    if err:
        print(f"[smooth] FATAL: {err}")
        sys.exit(1)

    print(f"[smooth] Found {len(meshes)} mesh object(s)")

    for obj in meshes:
        # Pre-check
        ok, reason = check_mesh(obj)
        if not ok:
            print(f"[smooth] Skipping '{obj.name}': {reason}")
            continue

        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)

        original_name = obj.name
        vertex_count = len(obj.data.vertices)

        # ── Laplacian Smooth ──
        mod = obj.modifiers.new(name="LaplacianSmooth", type="LAPLACIANSMOOTH")
        mod.iterations = iterations
        mod.lambda_factor = factor
        mod.lambda_border = border_factor
        mod.use_volume_preserve = True
        mod.use_normalized = True
        if safe_modifier_apply(obj, "LaplacianSmooth", "Laplacian Smooth"):
            print(f"[smooth]   Laplacian smooth applied: iter={iterations}, factor={factor:.2f}")
        else:
            print(f"[smooth]   Laplacian smooth failed, trying corrective smooth only")

        # ── Corrective Smooth ──
        mod2 = obj.modifiers.new(name="CorrectiveSmooth", type="CORRECTIVE_SMOOTH")
        mod2.iterations = 5
        mod2.scale = 0.8
        mod2.smooth_type = "LENGTH_WEIGHTED"
        mod2.use_pin_boundary = True
        if safe_modifier_apply(obj, "CorrectiveSmooth", "Corrective Smooth"):
            print(f"[smooth]   Corrective smooth applied")
        else:
            print(f"[smooth]   Corrective smooth failed")

        # ── Smooth shading ──
        ensure_mode("OBJECT")
        safe_op(bpy.ops.object.shade_smooth, description="Apply smooth shading")

        # Auto smooth angle
        try:
            obj.data.use_auto_smooth = True
            obj.data.auto_smooth_angle = math.radians(60)
        except AttributeError:
            pass

        print(f"[smooth] {obj.name}: {vertex_count} vertices, "
              f"{iterations} iterations, factor={factor:.2f}, "
              f"border={border_factor:.2f}")

        obj.name = original_name
        obj.select_set(False)

    # Export
    success, err = safe_export_glb(args.output)
    if not success:
        print(f"[smooth] FATAL: Export failed: {err}")
        sys.exit(1)

    print(f"[smooth] Exported to {args.output}")


if __name__ == "__main__":
    smooth()
'''

# ──────────────────────────────────────────
# scripts/subdivide_mesh.py
# ──────────────────────────────────────────
FILES[f"{SCRIPTS_DIR}/subdivide_mesh.py"] = r'''"""
subdivide_mesh.py — Import GLB -> apply Subdivision Surface modifier -> export
Error-hardened: safe_modifier_apply + mesh validation.

Usage: blender --background --python subdivide_mesh.py -- --input mesh.glb --output subdivided.glb --levels 1
"""

import bpy
import sys
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from blender_helpers import (
    safe_op, ensure_mode, check_mesh, safe_modifier_apply,
    safe_import_glb, safe_export_glb, wrap_main,
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
    parser.add_argument("--levels", type=int, default=1,
                        help="Subdivision levels (1-3)")
    return parser.parse_args(argv)


@wrap_main
def subdivide():
    args = parse_args()
    levels = max(1, min(args.levels, 3))

    # Import GLB
    meshes, err = safe_import_glb(args.input)
    if err:
        print(f"[subdivide] FATAL: {err}")
        sys.exit(1)

    for obj in meshes:
        ok, reason = check_mesh(obj)
        if not ok:
            print(f"[subdivide] Skipping '{obj.name}': {reason}")
            continue

        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)

        original_name = obj.name
        original_faces = len(obj.data.polygons)

        mod = obj.modifiers.new(name="Subdivide", type="SUBSURF")
        mod.subdivision_type = "CATMULL_CLARK"
        mod.levels = levels
        mod.render_levels = levels

        if safe_modifier_apply(obj, "Subdivide", f"Subdivision Surface level {levels}"):
            new_faces = len(obj.data.polygons)
            print(f"[subdivide] {obj.name}: {original_faces} -> {new_faces} faces (level {levels})")
        else:
            print(f"[subdivide] WARNING: SubSurf failed for '{obj.name}'")

        ensure_mode("OBJECT")
        safe_op(bpy.ops.object.shade_smooth, description="Apply smooth shading")

        obj.name = original_name
        obj.select_set(False)

    # Export
    success, err = safe_export_glb(args.output)
    if not success:
        print(f"[subdivide] FATAL: Export failed: {err}")
        sys.exit(1)

    print(f"[subdivide] Exported to {args.output}")


if __name__ == "__main__":
    subdivide()
'''

# ──────────────────────────────────────────
# scripts/cloth_physics.py
# ──────────────────────────────────────────
FILES[f"{SCRIPTS_DIR}/cloth_physics.py"] = r'''"""
cloth_physics.py — Cloth modifier + fabric presets + mannequin collision body
Supports 8 fabric types with tuned physics: cotton, silk, denim, leather, wool, linen, spandex, velvet.

Error-hardened: cloth simulation bake and modifier apply wrapped in try/except,
mannequin cleanup guaranteed, mesh validated before processing.

Usage: blender --background --python cloth_physics.py -- --input garment.glb --output draped.glb --size M --frames 60 --fabric_type cotton
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
FABRIC_PHYSICS = {
    "cotton": {
        "mass": 0.3,
        "tension_stiffness": 15.0,
        "compression_stiffness": 15.0,
        "shear_stiffness": 5.0,
        "bending_stiffness": 0.5,
        "tension_damping": 5.0,
        "compression_damping": 5.0,
        "shear_damping": 5.0,
        "bending_damping": 0.5,
        "air_damping": 1.0,
    },
    "silk": {
        "mass": 0.15,
        "tension_stiffness": 8.0,
        "compression_stiffness": 8.0,
        "shear_stiffness": 2.0,
        "bending_stiffness": 0.05,
        "tension_damping": 2.0,
        "compression_damping": 2.0,
        "shear_damping": 2.0,
        "bending_damping": 0.1,
        "air_damping": 1.5,
    },
    "denim": {
        "mass": 0.5,
        "tension_stiffness": 40.0,
        "compression_stiffness": 40.0,
        "shear_stiffness": 20.0,
        "bending_stiffness": 5.0,
        "tension_damping": 10.0,
        "compression_damping": 10.0,
        "shear_damping": 10.0,
        "bending_damping": 2.0,
        "air_damping": 0.5,
    },
    "leather": {
        "mass": 0.8,
        "tension_stiffness": 80.0,
        "compression_stiffness": 80.0,
        "shear_stiffness": 40.0,
        "bending_stiffness": 10.0,
        "tension_damping": 15.0,
        "compression_damping": 15.0,
        "shear_damping": 15.0,
        "bending_damping": 5.0,
        "air_damping": 0.3,
    },
    "wool": {
        "mass": 0.4,
        "tension_stiffness": 20.0,
        "compression_stiffness": 20.0,
        "shear_stiffness": 8.0,
        "bending_stiffness": 1.0,
        "tension_damping": 8.0,
        "compression_damping": 8.0,
        "shear_damping": 8.0,
        "bending_damping": 1.0,
        "air_damping": 0.8,
    },
    "linen": {
        "mass": 0.25,
        "tension_stiffness": 12.0,
        "compression_stiffness": 12.0,
        "shear_stiffness": 4.0,
        "bending_stiffness": 0.8,
        "tension_damping": 4.0,
        "compression_damping": 4.0,
        "shear_damping": 4.0,
        "bending_damping": 0.4,
        "air_damping": 1.0,
    },
    "spandex": {
        "mass": 0.2,
        "tension_stiffness": 5.0,
        "compression_stiffness": 5.0,
        "shear_stiffness": 1.0,
        "bending_stiffness": 0.1,
        "tension_damping": 3.0,
        "compression_damping": 3.0,
        "shear_damping": 3.0,
        "bending_damping": 0.2,
        "air_damping": 1.0,
    },
    "velvet": {
        "mass": 0.35,
        "tension_stiffness": 18.0,
        "compression_stiffness": 18.0,
        "shear_stiffness": 6.0,
        "bending_stiffness": 0.6,
        "tension_damping": 6.0,
        "compression_damping": 6.0,
        "shear_damping": 6.0,
        "bending_damping": 0.6,
        "air_damping": 0.8,
    },
}


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
    parser.add_argument("--frames", type=int, default=60)
    parser.add_argument("--fabric_type", default="cotton",
                        help=f"Fabric type: {', '.join(FABRIC_PHYSICS.keys())}")
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

    print(f"[cloth_physics] Fabric: {fabric_type}")
    print(f"[cloth_physics] Size: {args.size}, Frames: {args.frames}")

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

    garment = mesh_objects[0][0]

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

    # Add Cloth modifier
    cloth_mod = garment.modifiers.new(name="Cloth", type="CLOTH")
    cloth = cloth_mod.settings

    # Apply fabric-specific physics
    cloth.quality = 8
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
    scene.frame_end = args.frames

    # Bake cloth simulation
    print(f"[cloth_physics] Baking {args.frames} frames of cloth sim...")
    try:
        override = bpy.context.copy()
        override["point_cache"] = cloth_mod.point_cache
        bpy.ops.ptcache.bake(override, bake=True)
        print(f"[cloth_physics] Bake complete")
    except RuntimeError as e:
        print(f"[cloth_physics] WARNING: Cloth bake failed: {e}")
        print(f"[cloth_physics] Continuing with unbaked cloth (will try to apply modifier)")

    # Go to last frame and apply modifier
    scene.frame_set(args.frames)
    if not safe_modifier_apply(garment, cloth_mod.name, "Cloth modifier"):
        print(f"[cloth_physics] WARNING: Could not apply cloth modifier, exporting raw mesh")

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


if __name__ == "__main__":
    setup_cloth()
'''

# ──────────────────────────────────────────
# scripts/resize_parametric.py
# ──────────────────────────────────────────
FILES[f"{SCRIPTS_DIR}/resize_parametric.py"] = r'''"""
resize_parametric.py — Shape-key driven S->XXL parametric scaling
Error-hardened: safe_import_glb + safe_export_glb + mesh validation.

Usage: blender --background --python resize_parametric.py -- --input garment.glb --output resized.glb --size L
"""

import bpy
import sys
import argparse
from pathlib import Path
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).parent))
from blender_helpers import (
    safe_op, ensure_mode, check_mesh,
    safe_import_glb, safe_export_glb, wrap_main,
)


# Non-uniform scale factors: (chest_width, height, shoulder_width)
SIZE_PARAMS = {
    "XS": {"chest": 0.90, "height": 0.97, "shoulder": 0.92},
    "S":  {"chest": 0.95, "height": 0.98, "shoulder": 0.96},
    "M":  {"chest": 1.00, "height": 1.00, "shoulder": 1.00},
    "L":  {"chest": 1.06, "height": 1.02, "shoulder": 1.04},
    "XL": {"chest": 1.12, "height": 1.03, "shoulder": 1.08},
    "XXL":{"chest": 1.20, "height": 1.05, "shoulder": 1.14},
}


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
    return parser.parse_args(argv)


@wrap_main
def resize():
    args = parse_args()
    size = args.size.upper()
    params = SIZE_PARAMS.get(size, SIZE_PARAMS["M"])

    if size not in SIZE_PARAMS:
        print(f"[resize] WARNING: Unknown size '{size}', using M")
        size = "M"

    # Import
    meshes, err = safe_import_glb(args.input)
    if err:
        print(f"[resize] FATAL: {err}")
        sys.exit(1)

    for obj in meshes:
        ok, reason = check_mesh(obj)
        if not ok:
            print(f"[resize] Skipping '{obj.name}': {reason}")
            continue

        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)

        # Apply non-uniform scale
        obj.scale.x *= params["shoulder"]
        obj.scale.y *= params["chest"]
        obj.scale.z *= params["height"]

        safe_op(bpy.ops.object.transform_apply, location=False, rotation=False, scale=True,
                description="Apply scale transform")
        obj.select_set(False)

        print(f"[resize] {obj.name}: chest={params['chest']}, "
              f"height={params['height']}, shoulder={params['shoulder']}")

    # Export
    success, err = safe_export_glb(args.output)
    if not success:
        print(f"[resize] FATAL: Export failed: {err}")
        sys.exit(1)

    print(f"[resize] Exported {size} to {args.output}")


if __name__ == "__main__":
    resize()
'''

# ──────────────────────────────────────────
# scripts/apply_logo.py
# ──────────────────────────────────────────
FILES[f"{SCRIPTS_DIR}/apply_logo.py"] = r'''"""
apply_logo.py — Image Texture on UV island via Shader Nodes for logo/print placement
Error-hardened: safe_import_glb + safe_export_glb + mesh/texture validation.

Usage: blender --background --python apply_logo.py -- --input garment.glb --output with_logo.glb --logo logo.png --position chest_center --scale 0.15
"""

import bpy
import sys
import argparse
from pathlib import Path
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).parent))
from blender_helpers import safe_import_glb, safe_export_glb, wrap_main


# Predefined UV positions for common garment placements
POSITION_PRESETS = {
    "chest_center":  (0.5, 0.7),
    "chest_left":    (0.3, 0.7),
    "chest_right":   (0.7, 0.7),
    "back_center":   (0.5, 0.5),
    "back_upper":    (0.5, 0.7),
    "sleeve_left":   (0.15, 0.6),
    "sleeve_right":  (0.85, 0.6),
    "hem_center":    (0.5, 0.15),
    "pocket":        (0.35, 0.55),
}


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--logo", required=True)
    parser.add_argument("--position", default="chest_center")
    parser.add_argument("--scale", type=float, default=0.15)
    parser.add_argument("--target_part", default=None, help="Apply logo to specific named garment part")
    return parser.parse_args(argv)


@wrap_main
def apply_logo():
    args = parse_args()

    # Import garment
    meshes, err = safe_import_glb(args.input)
    if err:
        print(f"[apply_logo] FATAL: {err}")
        sys.exit(1)

    if not meshes:
        print("[apply_logo] FATAL: No mesh found")
        sys.exit(1)

    # Find target mesh
    garment = None
    for obj in meshes:
        if args.target_part and obj.name == args.target_part:
            garment = obj
            break
        if garment is None:
            garment = obj

    if not garment:
        print("[apply_logo] FATAL: No target mesh found")
        sys.exit(1)

    print(f"[apply_logo] Target mesh: {garment.name}")
    bpy.context.view_layer.objects.active = garment

    # Get or create material
    if not garment.data.materials:
        mat = bpy.data.materials.new(name="GarmentMaterial")
        garment.data.materials.append(mat)
    else:
        mat = garment.data.materials[0]

    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links

    # Find the Principled BSDF
    principled = None
    for node in nodes:
        if node.type == "BSDF_PRINCIPLED":
            principled = node
            break

    if not principled:
        principled = nodes.new("ShaderNodeBsdfPrincipled")

    # Load logo texture
    logo_tex = nodes.new("ShaderNodeTexImage")
    try:
        logo_tex.image = bpy.data.images.load(args.logo)
    except Exception as e:
        print(f"[apply_logo] FATAL: Cannot load logo '{args.logo}': {e}")
        sys.exit(1)

    # UV mapping for logo placement
    uv_map = nodes.new("ShaderNodeUVMap")
    mapping = nodes.new("ShaderNodeMapping")

    uv_pos = POSITION_PRESETS.get(args.position, (0.5, 0.5))
    if args.position not in POSITION_PRESETS:
        print(f"[apply_logo] WARNING: Unknown position '{args.position}', using (0.5, 0.5)")

    logo_scale = args.scale

    mapping.inputs["Location"].default_value[0] = uv_pos[0] - logo_scale / 2
    mapping.inputs["Location"].default_value[1] = uv_pos[1] - logo_scale / 2
    mapping.inputs["Scale"].default_value[0] = 1.0 / logo_scale
    mapping.inputs["Scale"].default_value[1] = 1.0 / logo_scale

    # Mix logo with base color using alpha
    mix_node = nodes.new("ShaderNodeMixRGB")
    mix_node.blend_type = "MIX"

    base_color_link = None
    for link in links:
        if link.to_socket == principled.inputs["Base Color"]:
            base_color_link = link
            break

    links.new(uv_map.outputs["UV"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], logo_tex.inputs["Vector"])
    links.new(logo_tex.outputs["Alpha"], mix_node.inputs["Fac"])
    links.new(logo_tex.outputs["Color"], mix_node.inputs["Color2"])

    if base_color_link:
        links.new(base_color_link.from_socket, mix_node.inputs["Color1"])
        links.remove(base_color_link)
    else:
        mix_node.inputs["Color1"].default_value = principled.inputs["Base Color"].default_value

    links.new(mix_node.outputs["Color"], principled.inputs["Base Color"])

    # Export
    success, err = safe_export_glb(args.output)
    if not success:
        print(f"[apply_logo] FATAL: Export failed: {err}")
        sys.exit(1)

    print(f"[apply_logo] Logo applied at {args.position} (scale {args.scale}) -> {args.output}")


if __name__ == "__main__":
    apply_logo()
'''

# ──────────────────────────────────────────
# scripts/swap_fabric.py
# ──────────────────────────────────────────
FILES[f"{SCRIPTS_DIR}/swap_fabric.py"] = r'''"""
swap_fabric.py — Principled BSDF parameter sets for different fabric types
Error-hardened: safe_import_glb + safe_export_glb + graceful param application.

Usage: blender --background --python swap_fabric.py -- --input garment.glb --output fabric_denim.glb --fabric_type denim
"""

import bpy
import sys
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from blender_helpers import safe_import_glb, safe_export_glb, wrap_main


# PBR material presets for common fabric types
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
        "Clearcoat Weight": 0.3,
        "Clearcoat Roughness": 0.2,
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


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--fabric_type", default="cotton")
    return parser.parse_args(argv)


@wrap_main
def swap():
    args = parse_args()
    fabric = args.fabric_type.lower()
    preset = FABRIC_PRESETS.get(fabric)

    if not preset:
        print(f"[swap_fabric] WARNING: Unknown fabric '{fabric}'. "
              f"Available: {list(FABRIC_PRESETS.keys())}. Using cotton.")
        fabric = "cotton"
        preset = FABRIC_PRESETS["cotton"]

    # Import
    meshes, err = safe_import_glb(args.input)
    if err:
        print(f"[swap_fabric] FATAL: {err}")
        sys.exit(1)

    # Apply material preset to all mesh objects
    applied_count = 0
    for obj in meshes:
        # Get or create material
        if not obj.data.materials:
            mat = bpy.data.materials.new(name=f"Fabric_{fabric}")
            obj.data.materials.append(mat)
        else:
            mat = obj.data.materials[0]

        mat.use_nodes = True
        nodes = mat.node_tree.nodes

        # Find Principled BSDF
        principled = None
        for node in nodes:
            if node.type == "BSDF_PRINCIPLED":
                principled = node
                break

        if not principled:
            principled = nodes.new("ShaderNodeBsdfPrincipled")

        # Apply preset values (gracefully skip unknown params for Blender version compat)
        for param, value in preset.items():
            if param in principled.inputs:
                try:
                    principled.inputs[param].default_value = value
                except (TypeError, AttributeError) as e:
                    print(f"[swap_fabric] WARNING: Could not set {param} on '{obj.name}': {e}")

        applied_count += 1
        print(f"[swap_fabric] Applied '{fabric}' to '{obj.name}'")

    # Export
    success, err = safe_export_glb(args.output)
    if not success:
        print(f"[swap_fabric] FATAL: Export failed: {err}")
        sys.exit(1)

    print(f"[swap_fabric] Applied '{fabric}' to {applied_count} mesh(es) -> {args.output}")


if __name__ == "__main__":
    swap()
'''

# ──────────────────────────────────────────
# scripts/render_scene.py
# ──────────────────────────────────────────
FILES[f"{SCRIPTS_DIR}/render_scene.py"] = r'''"""
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
'''

# ──────────────────────────────────────────
# scripts/hunyuan_bake.py
# ──────────────────────────────────────────
FILES[f"{SCRIPTS_DIR}/hunyuan_bake.py"] = r'''"""
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
'''

# ──────────────────────────────────────────
# scripts/auto_fix.py
# ──────────────────────────────────────────
FILES[f"{SCRIPTS_DIR}/auto_fix.py"] = r'''"""
auto_fix.py — One-click pipeline: repair -> voxel remesh -> smooth (no intermediate I/O)
Chains the three most important operations in correct order for HunYuan 3D meshes.

Error-hardened: every phase wrapped in try/except, modifiers use safe_modifier_apply,
mesh validated before each phase.

Quality presets:
  fast     — merge=0.002, 8K faces,  voxel=0.008, smooth=0.2 x1
  standard — merge=0.001, 12K faces, voxel=0.005, smooth=0.3 x2
  high     — merge=0.0005, 20K faces, voxel=0.003, smooth=0.2 x2

Usage: blender --background --python auto_fix.py -- --input mesh.glb --output fixed.glb --quality standard
"""

import bpy
import bmesh
import sys
import math
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from blender_helpers import (
    safe_op, ensure_mode, check_mesh, safe_modifier_apply,
    safe_import_glb, safe_export_glb, wrap_main,
)


QUALITY_PRESETS = {
    "fast": {
        "merge_threshold": 0.002,
        "target_faces": 8000,
        "voxel_size": 0.008,
        "smooth_factor": 0.2,
        "smooth_iterations": 1,
    },
    "standard": {
        "merge_threshold": 0.001,
        "target_faces": 12000,
        "voxel_size": 0.005,
        "smooth_factor": 0.3,
        "smooth_iterations": 2,
    },
    "high": {
        "merge_threshold": 0.0005,
        "target_faces": 20000,
        "voxel_size": 0.003,
        "smooth_factor": 0.2,
        "smooth_iterations": 2,
    },
}


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--quality", default="standard",
                        choices=list(QUALITY_PRESETS.keys()),
                        help="Quality preset: fast, standard, high")
    return parser.parse_args(argv)


@wrap_main
def auto_fix():
    args = parse_args()
    preset = QUALITY_PRESETS[args.quality]

    print(f"[auto_fix] Quality: {args.quality}")
    print(f"[auto_fix] Params: {preset}")

    # Import GLB
    meshes, err = safe_import_glb(args.input)
    if err:
        print(f"[auto_fix] FATAL: {err}")
        sys.exit(1)

    print(f"[auto_fix] Found {len(meshes)} mesh object(s)")

    for obj in meshes:
        # Pre-check
        ok, reason = check_mesh(obj)
        if not ok:
            print(f"[auto_fix] Skipping '{obj.name}': {reason}")
            continue

        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)

        original_name = obj.name
        initial_faces = len(obj.data.polygons)
        initial_verts = len(obj.data.vertices)
        print(f"[auto_fix] Processing '{obj.name}': {initial_verts} verts, {initial_faces} faces")

        # ═══════════════════════════════════════════
        # PHASE 1: REPAIR
        # ═══════════════════════════════════════════
        ensure_mode("EDIT")

        # 1a. Merge duplicate vertices
        safe_op(bpy.ops.mesh.select_all, action="SELECT", description="Select all")
        safe_op(bpy.ops.mesh.remove_doubles, threshold=preset["merge_threshold"],
                description=f"Merge by distance ({preset['merge_threshold']})")

        # 1b. Delete loose geometry
        safe_op(bpy.ops.mesh.select_all, action="DESELECT", description="Deselect all")
        safe_op(bpy.ops.mesh.select_loose, description="Select loose geometry")
        safe_op(bpy.ops.mesh.delete, type="VERT", description="Delete loose verts")

        # 1c. Dissolve degenerate faces
        safe_op(bpy.ops.mesh.select_all, action="SELECT", description="Select all")
        safe_op(bpy.ops.mesh.dissolve_degenerate, threshold=0.001,
                description="Dissolve degenerate faces")

        # 1d. Fill holes
        safe_op(bpy.ops.mesh.select_all, action="DESELECT", description="Deselect all")
        safe_op(bpy.ops.mesh.select_non_manifold,
                extend=False, use_wire=True, use_boundary=True,
                use_multi_face=False, use_non_contiguous=False, use_verts=False,
                description="Select non-manifold boundary")

        if not safe_op(bpy.ops.mesh.fill_grid, description="Grid fill holes"):
            if not safe_op(bpy.ops.mesh.fill, description="Basic fill holes"):
                print(f"[auto_fix]   No holes to fill")

        # 1e. Post-fill smoothing
        safe_op(bpy.ops.mesh.select_all, action="SELECT", description="Select all")
        safe_op(bpy.ops.mesh.vertices_smooth, factor=0.5, repeat=2,
                description="Post-fill vertex smoothing")

        # 1f. Recalculate normals
        safe_op(bpy.ops.mesh.normals_make_consistent, inside=False,
                description="Recalculate normals")

        # 1g. Final cleanup merge
        safe_op(bpy.ops.mesh.remove_doubles, threshold=preset["merge_threshold"],
                description="Final cleanup merge")

        ensure_mode("OBJECT")

        repaired_faces = len(obj.data.polygons)
        print(f"[auto_fix]   After repair: {repaired_faces} faces")

        # ═══════════════════════════════════════════
        # PHASE 2: REMESH
        # ═══════════════════════════════════════════

        # 2a. Pre-decimate if way over target
        current_faces = len(obj.data.polygons)
        if current_faces > preset["target_faces"] * 3:
            pre_target = preset["target_faces"] * 2
            ratio = pre_target / current_faces
            mod = obj.modifiers.new(name="PreDecimate", type="DECIMATE")
            mod.ratio = max(ratio, 0.01)
            if safe_modifier_apply(obj, "PreDecimate", "Pre-decimate"):
                print(f"[auto_fix]   Pre-decimate: {current_faces} -> {len(obj.data.polygons)}")

        # 2b. Voxel remesh
        mod = obj.modifiers.new(name="VoxelRemesh", type="REMESH")
        mod.mode = "VOXEL"
        mod.voxel_size = preset["voxel_size"]
        mod.use_smooth_shade = True
        if safe_modifier_apply(obj, "VoxelRemesh", "Voxel remesh"):
            remeshed_faces = len(obj.data.polygons)
            print(f"[auto_fix]   Voxel remesh (size={preset['voxel_size']}): -> {remeshed_faces} faces")
        else:
            print(f"[auto_fix]   Voxel remesh failed, continuing with current mesh")

        # 2c. Final decimate to target
        current_faces = len(obj.data.polygons)
        if current_faces > preset["target_faces"]:
            ratio = preset["target_faces"] / current_faces
            mod = obj.modifiers.new(name="Decimate", type="DECIMATE")
            mod.ratio = max(ratio, 0.01)
            if safe_modifier_apply(obj, "Decimate", "Final decimate"):
                print(f"[auto_fix]   Decimate: {current_faces} -> {len(obj.data.polygons)} faces")

        # ═══════════════════════════════════════════
        # PHASE 3: SMOOTH
        # ═══════════════════════════════════════════

        # 3a. Laplacian smooth
        mod = obj.modifiers.new(name="LaplacianSmooth", type="LAPLACIANSMOOTH")
        mod.iterations = preset["smooth_iterations"]
        mod.lambda_factor = preset["smooth_factor"]
        mod.lambda_border = 0.1
        mod.use_volume_preserve = True
        mod.use_normalized = True
        if safe_modifier_apply(obj, "LaplacianSmooth", "Laplacian Smooth"):
            print(f"[auto_fix]   Laplacian smooth: factor={preset['smooth_factor']}, "
                  f"iter={preset['smooth_iterations']}")

        # 3b. Corrective smooth
        mod = obj.modifiers.new(name="CorrectiveSmooth", type="CORRECTIVE_SMOOTH")
        mod.iterations = 5
        mod.scale = 0.8
        mod.smooth_type = "LENGTH_WEIGHTED"
        mod.use_pin_boundary = True
        safe_modifier_apply(obj, "CorrectiveSmooth", "Corrective Smooth")

        # 3c. Smooth shading
        ensure_mode("OBJECT")
        safe_op(bpy.ops.object.shade_smooth, description="Apply smooth shading")

        final_faces = len(obj.data.polygons)
        final_verts = len(obj.data.vertices)
        print(f"[auto_fix]   Final: {final_verts} verts, {final_faces} faces")
        print(f"[auto_fix]   Reduction: {initial_faces} -> {final_faces} faces "
              f"({(1 - final_faces/max(initial_faces, 1))*100:.0f}% reduction)")

        obj.name = original_name
        obj.select_set(False)

    # Export
    success, err = safe_export_glb(args.output)
    if not success:
        print(f"[auto_fix] FATAL: Export failed: {err}")
        sys.exit(1)

    print(f"[auto_fix] Exported to {args.output}")


if __name__ == "__main__":
    auto_fix()
'''

# ──────────────────────────────────────────
# scripts/turntable_render.py
# ──────────────────────────────────────────
FILES[f"{SCRIPTS_DIR}/turntable_render.py"] = r'''"""
turntable_render.py — 360 turntable camera orbit render -> frame sequence -> GIF

Renders N frames of a garment rotating (camera orbits) with the same fashion
lighting + gradient background from render_scene.py, then stitches into an
animated GIF using Pillow (installed in the Python env, NOT Blender's Python).

Parameters:
  --frames       Number of frames in the turntable (default 36 = 10 deg steps)
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
                        help="Number of frames (36 = 10 deg per frame)")
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

    # Camera setup - 85mm fashion lens
    cam_data = bpy.data.cameras.new(name="TurntableCam")
    cam_data.lens = 85
    cam_obj = bpy.data.objects.new("TurntableCam", cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj

    # Shadow catcher ground plane
    bpy.ops.mesh.primitive_plane_add(
        size=size * 10,
        location=(center.x, center.y, min_co.z),
    )
    ground = bpy.context.active_object
    ground.name = "GroundPlane"
    ground.is_shadow_catcher = True

    # Three-point fashion lighting
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

    # World background - gradient (warm gray -> white)
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

    # Render settings
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
    num_frames = max(4, min(args.frames, 120))

    # Output directory for frames
    output_base = os.path.splitext(args.output)[0]
    frames_dir = output_base + "_frames"
    os.makedirs(frames_dir, exist_ok=True)

    print(f"[turntable] Rendering {num_frames} frames at {args.resolution}x{args.resolution}, "
          f"{args.samples} samples")

    center, size, cam_obj = setup_scene(args)

    # Camera orbit radius
    cam_distance = size * 2.5
    cam_height = center.z + size * 0.2

    # Render each frame
    for i in range(num_frames):
        angle = (2.0 * math.pi * i) / num_frames

        cam_x = center.x + cam_distance * math.sin(angle)
        cam_y = center.y - cam_distance * math.cos(angle)
        cam_obj.location = (cam_x, cam_y, cam_height)

        direction = center - cam_obj.location
        rot_quat = direction.to_track_quat("-Z", "Y")
        cam_obj.rotation_euler = rot_quat.to_euler()

        frame_path = os.path.join(frames_dir, f"frame_{i:04d}.png")
        bpy.context.scene.render.filepath = frame_path

        print(f"[turntable] Frame {i+1}/{num_frames} "
              f"(angle {math.degrees(angle):.0f} deg)")
        bpy.ops.render.render(write_still=True)

    print(f"[turntable] All {num_frames} frames rendered to {frames_dir}")

    # Try to assemble GIF using Pillow (if available)
    gif_path = output_base + ".gif"
    try:
        from PIL import Image

        frame_files = sorted(glob_module.glob(os.path.join(frames_dir, "frame_*.png")))
        if frame_files:
            images = []
            for fp in frame_files:
                img = Image.open(fp).convert("RGBA")
                bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
                bg.paste(img, mask=img.split()[3])
                images.append(bg.convert("RGB"))

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
        print("[turntable] Pillow not available in Blender Python - "
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
'''

# ──────────────────────────────────────────
# scripts/garment_builder.py
# ──────────────────────────────────────────
FILES[f"{SCRIPTS_DIR}/garment_builder.py"] = r'''"""
garment_builder.py — Construct garments from structured JSON specs using bmesh.

Produces clean quad-based topology with named parts compatible with
GarmentViewer3D.jsx interactive selection. Each garment part is a separate
Blender object named via naming_convention.tag_object().

This is the "agentic" construction approach: an LLM parses natural language
into a structured garment spec, and this script builds native Blender geometry
instead of relying on generative AI triangle soup.

Usage:
  blender --background --python garment_builder.py -- \
    --output garment.glb --spec_json spec.json

Spec JSON format:
  {
    "garment_type": "shirt",
    "parts": [
      {"type": "body", "variant": "shirt", "suffix": "full",
       "params": {"length": 0.7, "width": 0.45, "taper": 0.05}},
      {"type": "collar", "variant": "spread", "suffix": "",
       "params": {"height": 0.04}},
      ...
    ],
    "fabric": "cotton",
    "color": [0.85, 0.83, 0.80]
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
from blender_helpers import safe_export_glb, wrap_main, ensure_mode
from naming_convention import tag_object, PART_TYPES


# ═══════════════════════════════════════════════════════════════
# DEFAULT DIMENSIONS (meters, roughly human scale)
# ═══════════════════════════════════════════════════════════════

DEFAULTS = {
    "body": {
        "length": 0.65,       # torso length
        "width": 0.42,        # chest width (half circumference)
        "depth": 0.22,        # front-to-back depth
        "taper": 0.04,        # waist narrowing
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

# Fabric PBR presets (subset for material assignment)
FABRIC_COLORS = {
    "cotton":  (0.85, 0.83, 0.80, 1.0),
    "denim":   (0.15, 0.22, 0.45, 1.0),
    "silk":    (0.92, 0.88, 0.85, 1.0),
    "leather": (0.18, 0.10, 0.06, 1.0),
    "linen":   (0.88, 0.85, 0.78, 1.0),
    "wool":    (0.55, 0.50, 0.42, 1.0),
    "spandex": (0.05, 0.05, 0.05, 1.0),
    "velvet":  (0.25, 0.05, 0.10, 1.0),
}


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--spec_json", required=True,
                        help="Path to JSON spec file or JSON string")
    return parser.parse_args(argv)


def get_param(params, key, part_type, default_key=None):
    """Get parameter with fallback to defaults."""
    if params and key in params:
        return params[key]
    defaults = DEFAULTS.get(part_type, {})
    return defaults.get(default_key or key, 0)


def create_mesh_object(name, bm):
    """Convert bmesh to Blender mesh object and link to scene."""
    mesh = bpy.data.meshes.new(name + "_mesh")
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def apply_material(obj, fabric, color=None):
    """Apply Principled BSDF material with fabric color."""
    mat = bpy.data.materials.new(name=f"Fabric_{fabric}")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes

    principled = None
    for node in nodes:
        if node.type == "BSDF_PRINCIPLED":
            principled = node
            break

    if principled:
        if color and len(color) >= 3:
            c = list(color) + [1.0] if len(color) == 3 else list(color)
            principled.inputs["Base Color"].default_value = c
        elif fabric in FABRIC_COLORS:
            principled.inputs["Base Color"].default_value = FABRIC_COLORS[fabric]

        # Fabric-appropriate roughness
        roughness_map = {
            "cotton": 0.85, "denim": 0.9, "silk": 0.25,
            "leather": 0.55, "linen": 0.92, "wool": 0.95,
            "spandex": 0.3, "velvet": 0.95,
        }
        principled.inputs["Roughness"].default_value = roughness_map.get(fabric, 0.7)

    obj.data.materials.append(mat)


# ═══════════════════════════════════════════════════════════════
# PART BUILDERS — each returns (obj, bounding_box_info)
# ═══════════════════════════════════════════════════════════════

def build_body(params):
    """
    Construct a garment body (torso) as a tapered cylinder with open top (neckline)
    and open bottom (hem line). Uses bmesh for clean quad topology.
    """
    p = params or {}
    length = get_param(p, "length", "body")
    width = get_param(p, "width", "body")
    depth = get_param(p, "depth", "body")
    taper = get_param(p, "taper", "body")
    seg_around = get_param(p, "segments_around", "body")
    seg_height = get_param(p, "segments_height", "body")

    bm = bmesh.new()

    # Build as a series of cross-section rings from top to bottom
    rings = []
    for j in range(seg_height + 1):
        t = j / seg_height  # 0 = top (shoulders), 1 = bottom (hem)
        y_pos = -t * length  # Top at 0, bottom at -length

        # Width tapers at waist (t=0.4-0.6), then flares slightly at hem
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

    # Create quad faces between adjacent rings
    for j in range(len(rings) - 1):
        ring_a = rings[j]
        ring_b = rings[j + 1]
        for i in range(seg_around):
            i_next = (i + 1) % seg_around
            try:
                bm.faces.new([
                    ring_a[i], ring_a[i_next],
                    ring_b[i_next], ring_b[i],
                ])
            except ValueError:
                pass  # Duplicate face (shouldn't happen but safety)

    # Smooth normals
    for f in bm.faces:
        f.smooth = True

    obj = create_mesh_object("body_temp", bm)

    # Position: center at origin, top at y=0
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
    """Construct a collar as a curved strip around the neckline."""
    p = params or {}
    height = get_param(p, "height", "collar")
    col_width = get_param(p, "width", "collar")
    segments = get_param(p, "segments", "collar")

    body_width = body_info.get("width", 0.42)
    neck_radius = body_width * 0.3  # Neckline is ~30% of body width

    bm = bmesh.new()

    # Two rings: bottom (at neckline) and top (collar height above)
    for ring_idx in range(2):
        y_offset = ring_idx * height
        for i in range(segments):
            angle = 2.0 * math.pi * i / segments
            x = neck_radius * math.cos(angle)
            z = neck_radius * 0.6 * math.sin(angle)  # Slightly oval
            bm.verts.new((x, y_offset, z))

    bm.verts.ensure_lookup_table()

    # Connect the two rings with quads
    for i in range(segments):
        i_next = (i + 1) % segments
        bottom_a = i
        bottom_b = i_next
        top_a = segments + i
        top_b = segments + i_next
        try:
            bm.faces.new([
                bm.verts[bottom_a], bm.verts[bottom_b],
                bm.verts[top_b], bm.verts[top_a],
            ])
        except ValueError:
            pass

    for f in bm.faces:
        f.smooth = True

    obj = create_mesh_object("collar_temp", bm)

    # Position at top of body
    obj.location.y = body_info.get("top_y", 0)

    return obj


def build_sleeve(params, body_info, side="left"):
    """Construct a sleeve as a tapered cylinder extending from the shoulder."""
    p = params or {}
    length = get_param(p, "length", "sleeve")
    width_top = get_param(p, "width_top", "sleeve")
    width_bottom = get_param(p, "width_bottom", "sleeve")
    seg_around = get_param(p, "segments_around", "sleeve")
    seg_length = get_param(p, "segments_length", "sleeve")

    bm = bmesh.new()

    # Build rings from shoulder to wrist
    for j in range(seg_length + 1):
        t = j / seg_length
        radius = width_top + (width_bottom - width_top) * t

        # Sleeve extends along X axis (left = -X, right = +X)
        x_offset = -(body_info.get("width", 0.42) + t * length) if side == "left" \
            else (body_info.get("width", 0.42) + t * length)

        for i in range(seg_around):
            angle = 2.0 * math.pi * i / seg_around
            local_y = radius * math.cos(angle)
            local_z = radius * math.sin(angle)
            bm.verts.new((x_offset, local_y + body_info.get("top_y", 0) * 0.1, local_z))

    bm.verts.ensure_lookup_table()

    # Connect rings with quads
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

    obj = create_mesh_object(f"sleeve_{side}_temp", bm)

    # Position at shoulder height
    obj.location.y = body_info.get("top_y", 0) * 0.15

    return obj


def build_cuff(params, body_info, side="left"):
    """Construct a cuff band at the end of a sleeve."""
    p = params or {}
    height = get_param(p, "height", "cuff")
    width = get_param(p, "width", "cuff")
    segments = get_param(p, "segments", "cuff")
    is_french = p.get("fold", False) or p.get("variant") == "french"

    if is_french:
        height *= 2.0  # French cuffs are doubled

    bm = bmesh.new()

    sleeve_length = DEFAULTS["sleeve"]["length"]
    body_width = body_info.get("width", 0.42)
    x_base = -(body_width + sleeve_length) if side == "left" else (body_width + sleeve_length)

    # Two rings for cuff band
    for ring_idx in range(2):
        offset = ring_idx * height
        for i in range(segments):
            angle = 2.0 * math.pi * i / segments
            local_y = width * math.cos(angle)
            local_z = width * math.sin(angle)
            bm.verts.new((x_base + (offset if side == "right" else -offset), local_y, local_z))

    bm.verts.ensure_lookup_table()

    for i in range(segments):
        i_next = (i + 1) % segments
        try:
            bm.faces.new([
                bm.verts[i], bm.verts[i_next],
                bm.verts[segments + i_next], bm.verts[segments + i],
            ])
        except ValueError:
            pass

    for f in bm.faces:
        f.smooth = True

    obj = create_mesh_object(f"cuff_{side}_temp", bm)
    return obj


def build_pocket(params, body_info, suffix="chest"):
    """Construct a flat pocket patch on the garment body."""
    p = params or {}
    width = get_param(p, "width", "pocket")
    height = get_param(p, "height", "pocket")

    bm = bmesh.new()

    body_width = body_info.get("width", 0.42)
    body_depth = body_info.get("depth", 0.22)

    # Determine position based on suffix
    positions = {
        "chest": (-body_width * 0.4, body_info.get("top_y", 0) - 0.15, body_depth + 0.005),
        "hip_left": (-body_width * 0.5, body_info.get("hip_y", -0.42), body_depth * 0.5 + 0.005),
        "hip_right": (body_width * 0.5, body_info.get("hip_y", -0.42), body_depth * 0.5 + 0.005),
    }
    pos = positions.get(suffix, positions["chest"])

    # Simple quad rectangle
    hw = width / 2
    hh = height / 2
    v1 = bm.verts.new((pos[0] - hw, pos[1] - hh, pos[2]))
    v2 = bm.verts.new((pos[0] + hw, pos[1] - hh, pos[2]))
    v3 = bm.verts.new((pos[0] + hw, pos[1] + hh, pos[2]))
    v4 = bm.verts.new((pos[0] - hw, pos[1] + hh, pos[2]))
    bm.faces.new([v1, v2, v3, v4])

    # Subdivide for smoother appearance
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=2)

    for f in bm.faces:
        f.smooth = True

    obj = create_mesh_object(f"pocket_{suffix}_temp", bm)
    return obj


def build_hood(params, body_info):
    """Construct a hood shape above the collar area."""
    p = params or {}
    height = get_param(p, "height", "hood")
    depth = get_param(p, "depth", "hood")
    hood_width = get_param(p, "width", "hood")
    segments = get_param(p, "segments", "hood")

    bm = bmesh.new()

    # Hood is a half-cylinder curving from back of neck over the head
    for j in range(segments + 1):
        t = j / segments  # 0=back of neck, 1=front forehead
        arc_angle = math.pi * t  # 180 degree arc

        # Position along the arc
        arc_y = body_info.get("top_y", 0) + height * math.sin(arc_angle)
        arc_z = -depth * math.cos(arc_angle)

        for i in range(segments):
            side_angle = math.pi * i / (segments - 1) - math.pi / 2
            x = hood_width * math.sin(side_angle)
            bm.verts.new((x, arc_y, arc_z))

    bm.verts.ensure_lookup_table()

    # Connect into quads
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

    obj = create_mesh_object("hood_temp", bm)
    return obj


def build_placket(params, body_info):
    """Construct a narrow strip down the center front of the garment."""
    p = params or {}
    width = get_param(p, "width", "placket")
    length = body_info.get("bottom_y", -0.65) - body_info.get("top_y", 0)
    length = abs(length) * 0.9

    bm = bmesh.new()

    body_depth = body_info.get("depth", 0.22)
    hw = width / 2
    top_y = body_info.get("top_y", 0) - 0.04
    bot_y = top_y - length

    # 4 subdivision rows for smooth curvature
    rows = 5
    for j in range(rows):
        t = j / (rows - 1)
        y = top_y + (bot_y - top_y) * t
        v1 = bm.verts.new((-hw, y, body_depth + 0.003))
        v2 = bm.verts.new((hw, y, body_depth + 0.003))

    bm.verts.ensure_lookup_table()

    for j in range(rows - 1):
        a = j * 2
        b = j * 2 + 1
        c = (j + 1) * 2 + 1
        d = (j + 1) * 2
        try:
            bm.faces.new([bm.verts[a], bm.verts[b], bm.verts[c], bm.verts[d]])
        except ValueError:
            pass

    for f in bm.faces:
        f.smooth = True

    obj = create_mesh_object("placket_temp", bm)
    return obj


def build_button(params, body_info, index=0):
    """Construct a small button cylinder."""
    p = params or {}
    radius = get_param(p, "radius", "button")
    count = p.get("count", DEFAULTS["button"]["count"])
    spacing = p.get("spacing", DEFAULTS["button"]["spacing"])

    bm = bmesh.new()

    body_depth = body_info.get("depth", 0.22)
    top_y = body_info.get("top_y", 0) - 0.06

    # Position this specific button
    y_pos = top_y - (index * spacing)

    # Simple circle of vertices
    segments = 8
    for ring in range(2):
        z_off = body_depth + 0.005 + ring * 0.003
        for i in range(segments):
            angle = 2.0 * math.pi * i / segments
            x = radius * math.cos(angle)
            y_local = radius * math.sin(angle)
            bm.verts.new((x, y_pos + y_local, z_off))

    bm.verts.ensure_lookup_table()

    # Connect into quads
    for i in range(segments):
        i_next = (i + 1) % segments
        try:
            bm.faces.new([
                bm.verts[i], bm.verts[i_next],
                bm.verts[segments + i_next], bm.verts[segments + i],
            ])
        except ValueError:
            pass

    # Cap faces
    try:
        bm.faces.new([bm.verts[i] for i in range(segments)])
    except ValueError:
        pass
    try:
        bm.faces.new([bm.verts[segments + i] for i in range(segments)])
    except ValueError:
        pass

    obj = create_mesh_object(f"button_{index}_temp", bm)
    return obj


def build_waistband(params, body_info):
    """Construct a waistband strip."""
    p = params or {}
    height = get_param(p, "height", "waistband")
    wb_width = body_info.get("width", 0.42)

    bm = bmesh.new()

    segments = 16
    waist_y = body_info.get("waist_y", -0.29)

    for ring in range(2):
        y_off = waist_y + ring * height
        for i in range(segments):
            angle = 2.0 * math.pi * i / segments
            x = wb_width * math.cos(angle)
            z = body_info.get("depth", 0.22) * math.sin(angle)
            bm.verts.new((x, y_off, z))

    bm.verts.ensure_lookup_table()

    for i in range(segments):
        i_next = (i + 1) % segments
        try:
            bm.faces.new([
                bm.verts[i], bm.verts[i_next],
                bm.verts[segments + i_next], bm.verts[segments + i],
            ])
        except ValueError:
            pass

    for f in bm.faces:
        f.smooth = True

    obj = create_mesh_object("waistband_temp", bm)
    return obj


def build_hem(params, body_info):
    """Construct a hem strip at the bottom of the garment."""
    p = params or {}
    height = get_param(p, "height", "hem")
    body_width = body_info.get("width", 0.42)

    bm = bmesh.new()

    segments = 16
    bottom_y = body_info.get("bottom_y", -0.65)

    for ring in range(2):
        y_off = bottom_y + ring * height
        for i in range(segments):
            angle = 2.0 * math.pi * i / segments
            x = body_width * math.cos(angle)
            z = body_info.get("depth", 0.22) * math.sin(angle)
            bm.verts.new((x, y_off, z))

    bm.verts.ensure_lookup_table()

    for i in range(segments):
        i_next = (i + 1) % segments
        try:
            bm.faces.new([
                bm.verts[i], bm.verts[i_next],
                bm.verts[segments + i_next], bm.verts[segments + i],
            ])
        except ValueError:
            pass

    for f in bm.faces:
        f.smooth = True

    obj = create_mesh_object("hem_temp", bm)
    return obj


# ═══════════════════════════════════════════════════════════════
# PART DISPATCH TABLE
# ═══════════════════════════════════════════════════════════════

BUILDERS = {
    "body": lambda params, info: build_body(params),
    "collar": lambda params, info: (build_collar(params, info), None),
    "sleeve": lambda params, info, side="left": (build_sleeve(params, info, side), None),
    "cuff": lambda params, info, side="left": (build_cuff(params, info, side), None),
    "pocket": lambda params, info, suffix="chest": (build_pocket(params, info, suffix), None),
    "hood": lambda params, info: (build_hood(params, info), None),
    "placket": lambda params, info: (build_placket(params, info), None),
    "button": lambda params, info, index=0: (build_button(params, info, index), None),
    "waistband": lambda params, info: (build_waistband(params, info), None),
    "hem": lambda params, info: (build_hem(params, info), None),
}


# ═══════════════════════════════════════════════════════════════
# MAIN ASSEMBLY
# ═══════════════════════════════════════════════════════════════

@wrap_main
def assemble():
    args = parse_args()

    # Load spec
    if os.path.isfile(args.spec_json):
        with open(args.spec_json, "r", encoding="utf-8") as f:
            spec = json.load(f)
    else:
        # Try parsing as inline JSON string
        spec = json.loads(args.spec_json)

    garment_type = spec.get("garment_type", "shirt")
    parts_list = spec.get("parts", [])
    fabric = spec.get("fabric", "cotton")
    color = spec.get("color", None)

    print(f"[garment_builder] Garment type: {garment_type}")
    print(f"[garment_builder] Parts: {len(parts_list)}")
    print(f"[garment_builder] Fabric: {fabric}")

    # Clear scene
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # ── Phase 1: Build body first (it defines the reference frame) ──
    body_info = {}
    body_obj = None

    # Find and build body part first
    for part_spec in parts_list:
        if part_spec.get("type") == "body":
            body_obj, body_info = build_body(part_spec.get("params"))
            variant = part_spec.get("variant", garment_type)
            suffix = part_spec.get("suffix", "full")
            tag_object(body_obj, "body", suffix=suffix, variant=variant)
            apply_material(body_obj, fabric, color)
            print(f"[garment_builder]   Built body: {body_obj.name} "
                  f"({len(body_obj.data.vertices)} verts, {len(body_obj.data.polygons)} faces)")
            break

    # If no body part specified, create a default one
    if body_obj is None:
        body_obj, body_info = build_body(None)
        tag_object(body_obj, "body", suffix="full", variant=garment_type)
        apply_material(body_obj, fabric, color)
        print(f"[garment_builder]   Built default body: {body_obj.name}")

    # ── Phase 2: Build all other parts ──
    built_parts = [body_obj]

    for part_spec in parts_list:
        part_type = part_spec.get("type", "")
        variant = part_spec.get("variant", "")
        suffix = part_spec.get("suffix", "")
        params = part_spec.get("params", {})

        if part_type == "body":
            continue  # Already built

        obj = None

        try:
            if part_type == "collar":
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

            elif part_type == "button":
                # Build multiple buttons
                count = params.get("count", DEFAULTS["button"]["count"])
                for idx in range(count):
                    btn_obj = build_button(params, body_info, idx)
                    tag_object(btn_obj, "button", suffix=str(idx), variant=variant)
                    apply_material(btn_obj, fabric, color)
                    built_parts.append(btn_obj)
                    print(f"[garment_builder]   Built button {idx}: {btn_obj.name}")
                continue  # Skip the single-object processing below

            elif part_type == "waistband":
                obj = build_waistband(params, body_info)

            elif part_type == "hem":
                obj = build_hem(params, body_info)

            else:
                print(f"[garment_builder]   WARNING: Unknown part type '{part_type}', skipping")
                continue

        except Exception as e:
            print(f"[garment_builder]   ERROR building '{part_type}': {e}")
            continue

        if obj is not None:
            tag_object(obj, part_type, suffix=suffix, variant=variant)
            apply_material(obj, fabric, color)
            built_parts.append(obj)
            vert_count = len(obj.data.vertices)
            face_count = len(obj.data.polygons)
            print(f"[garment_builder]   Built {part_type}: {obj.name} "
                  f"({vert_count} verts, {face_count} faces)")

    # ── Phase 3: Apply smooth shading to all parts ──
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

    # Output the config JSON for the frontend
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

    # Write config alongside output
    config_path = os.path.splitext(args.output)[0] + "_config.json"
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)
    print(f"[garment_builder] Config written to {config_path}")


if __name__ == "__main__":
    assemble()
'''


# ══════════════════════════════════════════
# DEPLOYMENT LOGIC
# ══════════════════════════════════════════

BLENDER_VERSION = "4.0.2"
BLENDER_URL = f"https://download.blender.org/release/Blender4.0/blender-{BLENDER_VERSION}-linux-x64.tar.xz"
BLENDER_INSTALL_DIR = "/opt/blender"

PYTHON_DEPS = [
    "fastapi",
    "uvicorn",
    "python-multipart",
    "trimesh",
    "numpy",
    "aiofiles",
    "Pillow",
]

SYSTEM_DEPS = [
    "libsm6",
    "libxext6",
    "libxi6",
    "libxxf86vm1",
    "libxfixes3",
    "libxrender1",
    "libgl1",
]


def run(cmd, desc="", check=True):
    """Run a shell command with logging."""
    print(f"\n{'=' * 60}")
    print(f"  {desc or cmd}")
    print(f"{'=' * 60}")
    result = subprocess.run(cmd, shell=True, capture_output=False, text=True)
    if check and result.returncode != 0:
        print(f"  [ERROR] Command failed with exit code {result.returncode}")
        sys.exit(1)
    return result


def main():
    print(r"""
    ╔══════════════════════════════════════════════════════════╗
    ║  Blender Garment API — RunPod Deployment Script         ║
    ║  Blender 4.0.2 + FastAPI + 15 Processing Scripts        ║
    ╚══════════════════════════════════════════════════════════╝
    """)

    # ── 1. Create directories ──
    print("\n[1/5] Creating directories...")
    os.makedirs(WORKSPACE, exist_ok=True)
    os.makedirs(SCRIPTS_DIR, exist_ok=True)
    os.makedirs(WORK_DIR, exist_ok=True)
    os.makedirs(f"{WORK_DIR}/input", exist_ok=True)
    os.makedirs(f"{WORK_DIR}/output", exist_ok=True)
    print(f"  Created {WORKSPACE}")
    print(f"  Created {SCRIPTS_DIR}")
    print(f"  Created {WORK_DIR}")

    # ── 2. Write all files from FILES dict ──
    print("\n[2/5] Writing files...")
    for filepath, content in FILES.items():
        dirpath = os.path.dirname(filepath)
        os.makedirs(dirpath, exist_ok=True)
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        size_kb = len(content) / 1024
        print(f"  Wrote {filepath} ({size_kb:.1f} KB)")
    print(f"  Total: {len(FILES)} files written")

    # ── 3. Install Python dependencies ──
    print("\n[3/5] Installing Python dependencies...")
    deps_str = " ".join(PYTHON_DEPS)
    run(f"pip install {deps_str}", desc=f"pip install {deps_str}")

    # ── 4. Install system dependencies + Blender 4.0.2 ──
    print("\n[4/5] Installing system dependencies and Blender...")

    # System libraries needed by Blender
    system_deps_str = " ".join(SYSTEM_DEPS)
    run(
        f"apt-get update && apt-get install -y --no-install-recommends {system_deps_str} xz-utils wget",
        desc=f"Installing system deps: {system_deps_str}",
        check=False,  # May fail if not root, that's ok on some pods
    )

    # Download and install Blender 4.0.2
    if not os.path.exists(f"{BLENDER_INSTALL_DIR}/blender"):
        print(f"  Downloading Blender {BLENDER_VERSION}...")
        run(
            f"wget -q --show-progress -O /tmp/blender.tar.xz {BLENDER_URL}",
            desc=f"Downloading Blender {BLENDER_VERSION} from blender.org",
        )

        print(f"  Extracting to {BLENDER_INSTALL_DIR}...")
        os.makedirs(BLENDER_INSTALL_DIR, exist_ok=True)
        run(
            f"tar -xf /tmp/blender.tar.xz -C /opt/ && "
            f"mv /opt/blender-{BLENDER_VERSION}-linux-x64/* {BLENDER_INSTALL_DIR}/ && "
            f"rm -rf /opt/blender-{BLENDER_VERSION}-linux-x64 /tmp/blender.tar.xz",
            desc="Extracting and installing Blender",
        )
    else:
        print(f"  Blender already installed at {BLENDER_INSTALL_DIR}/blender")

    # ── 5. Verify installation ──
    print("\n[5/5] Verifying installation...")

    # Check Blender
    blender_check = subprocess.run(
        [f"{BLENDER_INSTALL_DIR}/blender", "--version"],
        capture_output=True, text=True,
    )
    if blender_check.returncode == 0:
        version_line = blender_check.stdout.strip().split("\n")[0]
        print(f"  Blender: {version_line}")
    else:
        print(f"  [WARNING] Blender verification failed: {blender_check.stderr[:200]}")

    # Check Python packages
    for pkg in ["fastapi", "uvicorn"]:
        try:
            __import__(pkg)
            print(f"  {pkg}: OK")
        except ImportError:
            print(f"  {pkg}: MISSING (run pip install {pkg})")

    # List deployed files
    print(f"\n  Files deployed:")
    for filepath in sorted(FILES.keys()):
        print(f"    {filepath}")

    # ── Done ──
    print(f"""
{'=' * 60}
  DEPLOYMENT COMPLETE
{'=' * 60}

  Blender:    {BLENDER_INSTALL_DIR}/blender
  Server:     {WORKSPACE}/server.py
  Scripts:    {SCRIPTS_DIR}/ (15 scripts)
  Work dir:   {WORK_DIR}/

  To start the server:

    cd {WORKSPACE} && BLENDER_BIN={BLENDER_INSTALL_DIR}/blender uvicorn server:app --host 0.0.0.0 --port 8000

  Health check:

    curl http://localhost:8000/health

{'=' * 60}
""")


if __name__ == "__main__":
    main()
