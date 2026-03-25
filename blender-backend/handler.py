"""
handler.py — RunPod Serverless handler for Blender garment processing.

Replaces the FastAPI server.py for serverless deployment. All 15 Blender scripts
are invoked identically via subprocess — only the I/O layer changes from HTTP to
RunPod's job-based model.

Input format:
  {
    "input": {
      "operation": "repair-mesh",
      "file_b64": "<base64 GLB>",
      "merge_threshold": 0.001,
      ...
    }
  }

Output format:
  {
    "file_b64": "<base64 GLB output>",
    "content_type": "model/gltf-binary",
    "config": { ... }    # only for assemble-garment
  }
"""

import runpod
import os
import uuid
import subprocess
import base64
import json
import glob as glob_mod
from pathlib import Path

BLENDER_BIN = os.environ.get("BLENDER_BIN", "/usr/bin/blender")
SCRIPTS_DIR = Path("/app/scripts")
WORK_DIR = Path("/tmp/blender-work")
INPUT_DIR = WORK_DIR / "input"
OUTPUT_DIR = WORK_DIR / "output"
FRAMES_DIR = WORK_DIR / "frames"

for d in [INPUT_DIR, OUTPUT_DIR, FRAMES_DIR]:
    d.mkdir(parents=True, exist_ok=True)


# ═══════════════════════════════════════════════════════════════
# OPERATION → SCRIPT MAPPING
# ═══════════════════════════════════════════════════════════════

OPERATIONS = {
    "auto-fix": {
        "script": "auto_fix.py",
        "params": ["quality"],
        "defaults": {"quality": "standard"},
    },
    "repair-mesh": {
        "script": "repair_mesh.py",
        "params": ["merge_threshold", "max_hole_edges", "fabric_mode"],
        "defaults": {"merge_threshold": "0.001", "max_hole_edges": "64", "fabric_mode": "false"},
    },
    "clean-mesh": {
        "script": "clean_mesh.py",
        "params": ["target_faces", "smooth_iterations", "voxel_size", "use_voxel_remesh"],
        "defaults": {"target_faces": "12000", "smooth_iterations": "1", "voxel_size": "0.005", "use_voxel_remesh": "true"},
    },
    "subdivide": {
        "script": "subdivide_mesh.py",
        "params": ["levels", "method", "crease_seams"],
        "defaults": {"levels": "2", "method": "catmull_clark", "crease_seams": "true"},
    },
    "smooth": {
        "script": "smooth_mesh.py",
        "params": ["iterations", "factor", "preserve_borders"],
        "defaults": {"iterations": "2", "factor": "0.3", "preserve_borders": "0.1"},
    },
    "apply-cloth-physics": {
        "script": "cloth_physics.py",
        # frames omitted from defaults — uses per-fabric profile when not provided
        "params": ["size", "frames", "fabric_type", "quality_preset"],
        "defaults": {"size": "M", "fabric_type": "cotton", "quality_preset": "standard"},
    },
    "resize-garment": {
        "script": "resize_parametric.py",
        "params": ["size"],
        "defaults": {"size": "M"},
    },
    "apply-logo": {
        "script": "apply_logo.py",
        "params": ["position", "scale"],
        "defaults": {"position": "chest_center", "scale": "0.15"},
        "extra_files": ["logo_b64"],
    },
    "swap-fabric": {
        "script": "swap_fabric.py",
        "params": ["fabric_type", "roughness", "sheen_weight", "sheen_roughness",
                   "subsurface_weight", "coat_weight", "anisotropic", "specular_ior_level",
                   "base_color_r", "base_color_g", "base_color_b", "normal_map_id"],
        "defaults": {"fabric_type": "cotton"},
    },
    "render-scene": {
        "script": "render_scene.py",
        "params": ["resolution", "samples"],
        "defaults": {"resolution": "1024", "samples": "128"},
        "output_type": "image/png",
    },
    "bake-pbr": {
        "script": "hunyuan_bake.py",
        "params": ["resolution"],
        "defaults": {"resolution": "2048"},
        "extra_files": ["texture_b64"],
    },
    "turntable-render": {
        "script": "turntable_render.py",
        "params": ["frames", "resolution", "samples"],
        "defaults": {"frames": "36", "resolution": "512", "samples": "32"},
        "output_type": "image/gif",
    },
    # ── New operations ──
    "flatten-pattern": {
        "script": "flatten_pattern.py",
        "params": ["join", "scale"],
        "defaults": {"scale": "1.0"},
    },
    "set-seams": {
        "script": "set_seams.py",
        "params": ["edge_indices", "operation", "object_name"],
        "defaults": {"operation": "mark"},
    },
    "apply-gn": {
        "script": "geometry_nodes_components.py",
        "params": ["part", "gn_params"],
        "defaults": {"gn_params": "{}"},
    },
    # ── Morph UV Phase 2 + Fabric Refinement ──
    "seams-and-flatten": {
        "script": "seams_and_flatten.py",
        "params": ["edge_indices", "operation", "object_name", "scale", "join"],
        "defaults": {"operation": "mark", "scale": "1.0"},
    },
    "add-thickness": {
        "script": "add_thickness.py",
        "params": ["fabric_type", "thickness_multiplier", "use_rim"],
        "defaults": {"fabric_type": "cotton", "thickness_multiplier": "1.0", "use_rim": "true"},
    },
    "extrude-edges": {
        "script": "extrude_fabric_edges.py",
        "params": ["offset", "object_name", "crease_extrusion"],
        "defaults": {"offset": "0.015", "crease_extrusion": "true"},
    },
    # ── Smart UV Suite ──
    "uv-stretch-map": {
        "script": "uv_stretch_map.py",
        "params": ["threshold"],
        "defaults": {"threshold": "0.05"},
    },
    "auto-seam": {
        "script": "auto_seam.py",
        "params": ["garment_type", "max_islands"],
        "defaults": {"garment_type": "shirt", "max_islands": "8"},
    },
    "uv-pack-nest": {
        "script": "uv_pack_nest.py",
        "params": ["fabric_width", "grain_direction", "seam_allowance", "scale"],
        "defaults": {"fabric_width": "1.5", "grain_direction": "warp", "seam_allowance": "0.015", "scale": "1.0"},
    },
}


# ═══════════════════════════════════════════════════════════════
# CORE HELPERS
# ═══════════════════════════════════════════════════════════════

def save_b64_file(b64_data, extension=".glb"):
    """Decode base64 data and save to a temp file. Returns the file path."""
    file_id = str(uuid.uuid4())[:8]
    dest = INPUT_DIR / f"{file_id}{extension}"
    raw = base64.b64decode(b64_data)
    with open(dest, "wb") as f:
        f.write(raw)
    return dest


def read_file_b64(file_path):
    """Read a file and return its base64-encoded contents."""
    with open(file_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def run_blender_script(script_name, args, input_file=None):
    """Run a Blender Python script in background mode. Returns the output file path."""
    job_id = str(uuid.uuid4())[:8]
    output_path = OUTPUT_DIR / f"{job_id}_output.glb"

    cmd = [
        BLENDER_BIN, "--background", "--python", str(SCRIPTS_DIR / script_name),
        "--",
        "--output", str(output_path),
    ]

    if input_file:
        cmd.extend(["--input", str(input_file)])

    for key, value in args.items():
        cmd.extend([f"--{key}", str(value)])

    print(f"[handler] Running: {script_name} (job {job_id})")

    timeout = 600 if "turntable" in script_name else 300

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return None, f"Script timed out after {timeout}s"

    if result.returncode != 0:
        stderr = result.stderr[-500:] if result.stderr else "No stderr"
        print(f"[handler] STDERR: {stderr}")
        return None, f"Blender script failed: {stderr[-300:]}"

    if not output_path.exists():
        for ext in [".glb", ".gltf", ".fbx", ".obj", ".png"]:
            alt = OUTPUT_DIR / f"{job_id}_output{ext}"
            if alt.exists():
                return alt, None
        return None, "Blender produced no output file"

    return output_path, None


def cleanup_files(*paths):
    """Silently remove temp files."""
    for p in paths:
        try:
            if p and Path(p).exists():
                Path(p).unlink(missing_ok=True)
        except Exception:
            pass


# ═══════════════════════════════════════════════════════════════
# SPECIAL HANDLERS
# ═══════════════════════════════════════════════════════════════

def handle_turntable(output_path):
    """Handle turntable GIF assembly (same logic as server.py)."""
    output_base = str(output_path).rsplit(".", 1)[0]
    gif_path = Path(output_base + ".gif")
    marker_path = Path(output_base + "_turntable.json")

    # Check if GIF was assembled by Blender script
    if gif_path.exists():
        return read_file_b64(gif_path), "image/gif"

    # Try server-side Pillow assembly
    if marker_path.exists():
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
                        str(gif_out), save_all=True, append_images=images[1:],
                        duration=80, loop=0, optimize=True,
                    )
                    return read_file_b64(gif_out), "image/gif"
            except ImportError:
                pass

    # Last resort: return first frame as PNG
    frames_dir_fallback = Path(output_base + "_frames")
    if frames_dir_fallback.exists():
        first_frame = sorted(frames_dir_fallback.glob("frame_*.png"))
        if first_frame:
            return read_file_b64(first_frame[0]), "image/png"

    return None, None


def handle_assemble(job_input):
    """Handle assemble-garment (JSON spec, no file input)."""
    spec = job_input.get("spec")
    if not spec:
        return {"error": "Missing 'spec' in input"}

    job_id = str(uuid.uuid4())[:8]
    spec_path = INPUT_DIR / f"{job_id}_spec.json"
    output_path = OUTPUT_DIR / f"{job_id}_assembled.glb"

    with open(spec_path, "w", encoding="utf-8") as f:
        json.dump(spec, f, indent=2)

    cmd = [
        BLENDER_BIN, "--background", "--python", str(SCRIPTS_DIR / "garment_builder.py"),
        "--",
        "--output",    str(output_path),
        "--spec_json", str(spec_path),
    ]
    # Forward pbr_values from spec as --pbr_json if present
    if spec.get("pbr_values"):
        cmd.extend(["--pbr_json", json.dumps(spec["pbr_values"])])

    print(f"[handler] Assembling: {spec.get('garment_type', 'unknown')} "
          f"with {len(spec.get('parts', []))} parts")

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    except subprocess.TimeoutExpired:
        cleanup_files(spec_path)
        return {"error": "Garment assembly timed out (300s)"}

    if result.returncode != 0:
        stderr = result.stderr[-500:] if result.stderr else "No stderr"
        print(f"[handler] STDERR: {stderr}")
        cleanup_files(spec_path)
        return {"error": f"Assembly failed: {stderr[-300:]}"}

    if not output_path.exists():
        cleanup_files(spec_path)
        return {"error": "Assembly produced no output GLB"}

    # Read config JSON
    config_path = Path(str(output_path).rsplit(".", 1)[0] + "_config.json")
    config = {}
    if config_path.exists():
        with open(config_path) as f:
            config = json.load(f)

    glb_b64 = read_file_b64(output_path)

    print(f"[handler] Assembly success: {config.get('total_vertices', '?')} verts, "
          f"{len(config.get('parts', []))} parts")

    cleanup_files(spec_path, output_path, config_path)

    return {
        "glb_b64": glb_b64,
        "content_type": "model/gltf-binary",
        "config": config,
    }


def handle_edit_part(job_input):
    """Handle edit-part: load GLB, remove old part, rebuild it, re-export."""
    file_b64 = job_input.get("file_b64")
    edit_part = job_input.get("edit_part")
    part_spec = job_input.get("part_spec")  # JSON string or dict
    pbr_json  = job_input.get("pbr_json")

    if not file_b64 or not edit_part or not part_spec:
        return {"error": "edit-part requires file_b64, edit_part, and part_spec"}

    if isinstance(part_spec, dict):
        part_spec = json.dumps(part_spec)

    input_path = save_b64_file(file_b64, ".glb")
    job_id = str(uuid.uuid4())[:8]
    output_path = OUTPUT_DIR / f"{job_id}_edited.glb"

    cmd = [
        BLENDER_BIN, "--background", "--python", str(SCRIPTS_DIR / "garment_builder.py"),
        "--",
        "--input",    str(input_path),
        "--output",   str(output_path),
        "--edit_part", edit_part,
        "--part_spec", part_spec,
    ]
    if pbr_json:
        if isinstance(pbr_json, dict):
            pbr_json = json.dumps(pbr_json)
        cmd.extend(["--pbr_json", pbr_json])

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    except subprocess.TimeoutExpired:
        cleanup_files(input_path)
        return {"error": "Edit-part timed out (180s)"}

    if result.returncode != 0:
        stderr = result.stderr[-500:] if result.stderr else "No stderr"
        cleanup_files(input_path)
        return {"error": f"Edit-part failed: {stderr[-300:]}"}

    if not output_path.exists():
        cleanup_files(input_path)
        return {"error": "Edit-part produced no output GLB"}

    glb_b64 = read_file_b64(output_path)
    cleanup_files(input_path, output_path)

    return {"file_b64": glb_b64, "content_type": "model/gltf-binary"}


# ═══════════════════════════════════════════════════════════════
# MAIN HANDLER
# ═══════════════════════════════════════════════════════════════

def handler(job):
    """RunPod serverless handler — dispatches all Blender operations."""
    job_input = job.get("input", {})
    operation = job_input.get("operation", "")

    print(f"[handler] Operation: {operation}")

    # ── Special case: assemble-garment (no file input) ──
    if operation == "assemble-garment":
        return handle_assemble(job_input)

    # ── Special case: edit-part (uses garment_builder.py in edit mode) ──
    if operation == "edit-part":
        return handle_edit_part(job_input)

    # ── Standard operations (require file input) ──
    op_config = OPERATIONS.get(operation)
    if not op_config:
        return {"error": f"Unknown operation '{operation}'. Valid: {', '.join(OPERATIONS.keys())}, assemble-garment"}

    # Decode input file
    file_b64 = job_input.get("file_b64")
    if not file_b64:
        return {"error": f"Operation '{operation}' requires 'file_b64' (base64-encoded GLB)"}

    input_path = save_b64_file(file_b64, ".glb")
    extra_paths = []

    # Build script args from input params
    script_args = {}
    for param in op_config.get("params", []):
        value = job_input.get(param, op_config["defaults"].get(param))
        if value is not None:
            script_args[param] = str(value)

    # Handle extra file inputs (logo, texture)
    for extra_key in op_config.get("extra_files", []):
        extra_b64 = job_input.get(extra_key)
        if extra_b64:
            ext = ".png"
            extra_path = save_b64_file(extra_b64, ext)
            extra_paths.append(extra_path)
            # Map the key name to the script arg name
            if extra_key == "logo_b64":
                script_args["logo"] = str(extra_path)
            elif extra_key == "texture_b64":
                script_args["texture"] = str(extra_path)

    # Run Blender script
    output_path, error = run_blender_script(
        op_config["script"], script_args, input_path
    )

    if error:
        cleanup_files(input_path, *extra_paths)
        return {"error": error}

    # ── Handle output based on type ──
    output_type = op_config.get("output_type", "model/gltf-binary")

    # Turntable: special GIF assembly logic
    if operation == "turntable-render":
        file_data, content_type = handle_turntable(output_path)
        cleanup_files(input_path, *extra_paths)
        if file_data:
            return {"file_b64": file_data, "content_type": content_type}
        return {"error": "Turntable render produced no output"}

    # Render: look for PNG output
    if operation == "render-scene":
        png_path = output_path.with_suffix(".png")
        if png_path.exists():
            file_data = read_file_b64(png_path)
            cleanup_files(input_path, png_path, *extra_paths)
            return {"file_b64": file_data, "content_type": "image/png"}

    # Standard: return GLB
    file_data = read_file_b64(output_path)
    cleanup_files(input_path, output_path, *extra_paths)

    return {
        "file_b64": file_data,
        "content_type": output_type,
    }


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
