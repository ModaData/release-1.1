"""
Blender FastAPI Backend — Headless Blender 4.0 for garment processing.
Endpoints: auto-fix, repair-mesh, clean-mesh, subdivide, smooth, apply-cloth-physics,
           resize-garment, apply-logo, swap-fabric, render-scene, bake-pbr,
           assemble-garment, flatten-pattern, set-seams, edit-part, apply-gn,
           seams-and-flatten, add-thickness, extrude-edges,
           uv-stretch-map, auto-seam, uv-pack-nest
"""

import os
import uuid
import subprocess
import tempfile
import shutil
import json
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

BLENDER_BIN = os.environ.get("BLENDER_BIN", "blender")
SCRIPTS_DIR = Path("/app/scripts")
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
        BLENDER_BIN, "--background", "--python", str(SCRIPTS_DIR / script_name),
        "--",  # Separator for script args
        "--output", str(output_path),
    ]

    if input_file:
        cmd.extend(["--input", str(input_file)])

    # Pass all args as --key value
    for key, value in args.items():
        cmd.extend([f"--{key}", str(value)])

    print(f"[blender] Running: {' '.join(cmd[:6])}... (job {job_id})")

    # Longer timeout for multi-frame renders (turntable)
    timeout = 600 if "turntable" in script_name else 300

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
    )

    if result.returncode != 0:
        print(f"[blender] STDERR: {result.stderr[-500:]}")
        raise HTTPException(
            status_code=500,
            detail=f"Blender script failed: {result.stderr[-300:]}"
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


# ── POST /api/generate-from-spec — Text-to-3D parametric garment generation ──
@app.post("/api/generate-from-spec")
async def generate_from_spec(request: Request):
    """Generate a 3D garment from a GarmentSpec JSON (from GPT-4 orchestrator)."""
    body = await request.json()
    spec = body.get("spec", {})

    # The spec contains garment parameters; extract the geometry node inputs
    garment_spec = {
        "garment_type": spec.get("template", "tshirt_base").replace("_base", ""),
        "sleeve_length": spec.get("geometry_node_inputs", {}).get("sleeve_length", 1.0),
        "body_length": spec.get("geometry_node_inputs", {}).get("body_length", 0.7),
        "shoulder_width": spec.get("geometry_node_inputs", {}).get("shoulder_width", 0.5),
        "fit": {0.85: "slim", 1.0: "regular", 1.15: "relaxed", 1.35: "oversized"}.get(
            spec.get("geometry_node_inputs", {}).get("fit_scale", 1.0), "regular"
        ),
        "color_hex": spec.get("material", {}).get("color_hex", "#333333"),
        "fabric_type": spec.get("material", {}).get("fabric_type", "cotton"),
        "collar_style": spec.get("collar", "none"),
        "lapel_style": spec.get("lapel", "none"),
        "closure": spec.get("closure", "pullover"),
        "sleeve_style": spec.get("sleeve_style", "set_in"),
        "hem_style": spec.get("hem_style", "straight"),
        "button_count": spec.get("geometry_node_inputs", {}).get("button_count", 0),
        "construction_details": spec.get("construction", []),
        "name": spec.get("template", "garment").replace("_base", "").title(),
    }

    spec_json = json.dumps(garment_spec)
    job_id = str(uuid.uuid4())[:8]
    output_path = OUTPUT_DIR / f"{job_id}_garment.glb"

    cmd = [
        BLENDER_BIN, "--background", "--python",
        str(SCRIPTS_DIR / "generate_from_spec.py"),
        "--", "--spec_json", spec_json, "--output", str(output_path),
    ]

    print(f"[blender] Generating garment: {garment_spec.get('garment_type')} (job {job_id})")

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)

    if result.returncode != 0:
        print(f"[blender] STDERR: {result.stderr[-500:]}")
        raise HTTPException(
            status_code=500,
            detail=f"Garment generation failed: {result.stderr[-300:]}"
        )

    if not output_path.exists():
        raise HTTPException(status_code=500, detail="Blender produced no garment output")

    return FileResponse(output_path, media_type="model/gltf-binary", filename="garment.glb")


# ── POST /api/sew-panels — 2D pattern panels → cloth sim → 3D garment ──
@app.post("/api/sew-panels")
async def sew_panels(request: Request):
    """The Golden Path: 2D patterns → Blender cloth sim → 3D draped garment.
    Input: JSON with 'panels' (2D coordinates) + 'metadata' (fabric, color, etc.)
    Output: GLB file with shape keys (Flat + Draped)
    """
    body = await request.json()
    spec = body.get("spec", body)  # Accept spec directly or wrapped
    sim_frames = body.get("sim_frames", 60)

    panels = spec.get("panels", [])
    metadata = spec.get("metadata", {})

    if not panels:
        raise HTTPException(status_code=400, detail="No panels in spec")

    spec_json = json.dumps(spec)
    job_id = str(uuid.uuid4())[:8]
    output_path = OUTPUT_DIR / f"{job_id}_sewn.glb"

    cmd = [
        BLENDER_BIN, "--background", "--python",
        str(SCRIPTS_DIR / "sew_panels_to_3d.py"),
        "--", "--spec_json", spec_json,
        "--output", str(output_path),
        "--sim_frames", str(sim_frames),
    ]

    panel_names = [p.get("name", "?") for p in panels]
    fabric = metadata.get("fabric_type", "cotton")
    print(f"[blender] Sewing {len(panels)} panels ({', '.join(panel_names)}) in {fabric} (job {job_id}, {sim_frames} frames)")

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

    if result.returncode != 0:
        print(f"[blender] STDERR: {result.stderr[-500:]}")
        raise HTTPException(
            status_code=500,
            detail=f"Sewing simulation failed: {result.stderr[-300:]}"
        )

    if not output_path.exists():
        raise HTTPException(status_code=500, detail="Blender produced no output")

    return FileResponse(output_path, media_type="model/gltf-binary", filename="garment_sewn.glb")


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
    fabric_mode: str = Form("false"),
):
    input_path = await save_upload(file)
    output_path = run_blender_script("repair_mesh.py", {
        "merge_threshold": merge_threshold,
        "max_hole_edges": max_hole_edges,
        "fabric_mode": fabric_mode,
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
    levels: int = Form(2),
    method: str = Form("catmull_clark"),
    crease_seams: str = Form("true"),
):
    input_path = await save_upload(file)
    output_path = run_blender_script("subdivide_mesh.py", {
        "levels": levels,
        "method": method,
        "crease_seams": crease_seams,
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


# ── POST /api/apply-cloth-physics — Cloth simulation with fabric-adaptive profiles ──
@app.post("/api/apply-cloth-physics")
async def apply_cloth_physics(
    file: UploadFile = File(...),
    size: str = Form("M"),
    frames: int = Form(None),
    fabric_type: str = Form("cotton"),
    quality_preset: str = Form("standard"),
):
    input_path = await save_upload(file)
    script_args = {
        "size": size,
        "fabric_type": fabric_type,
        "quality_preset": quality_preset,
    }
    if frames is not None:
        script_args["frames"] = frames
    output_path = run_blender_script("cloth_physics.py", script_args, input_path)
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


# ── POST /api/swap-fabric — PBR material swap with optional overrides ──
@app.post("/api/swap-fabric")
async def swap_fabric(
    file: UploadFile = File(...),
    fabric_type: str = Form("cotton"),
    roughness: float = Form(None),
    sheen_weight: float = Form(None),
    sheen_roughness: float = Form(None),
    subsurface_weight: float = Form(None),
    coat_weight: float = Form(None),
    anisotropic: float = Form(None),
    specular_ior_level: float = Form(None),
    base_color_r: float = Form(None),
    base_color_g: float = Form(None),
    base_color_b: float = Form(None),
    normal_map_id: str = Form(None),
):
    input_path = await save_upload(file)
    script_args = {"fabric_type": fabric_type}
    # Only pass overrides that were explicitly set
    override_map = {
        "roughness": roughness, "sheen_weight": sheen_weight,
        "sheen_roughness": sheen_roughness, "subsurface_weight": subsurface_weight,
        "coat_weight": coat_weight, "anisotropic": anisotropic,
        "specular_ior_level": specular_ior_level,
        "base_color_r": base_color_r, "base_color_g": base_color_g,
        "base_color_b": base_color_b, "normal_map_id": normal_map_id,
    }
    for key, val in override_map.items():
        if val is not None:
            script_args[key] = val
    output_path = run_blender_script("swap_fabric.py", script_args, input_path)
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
    output_base = str(output_path).rsplit(".", 1)[0]  # strip extension
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


# ── POST /api/flatten-pattern — 3D garment → flat sewing pattern (shape-key morph) ──
@app.post("/api/flatten-pattern")
async def flatten_pattern(
    file: UploadFile = File(...),
    join: str = Form("false"),
    scale: float = Form(1.0),
):
    input_path = await save_upload(file)
    script_args = {"scale": scale}
    if join.lower() in ("true", "1", "yes"):
        script_args["join"] = ""  # flag-style arg
    output_path = run_blender_script("flatten_pattern.py", script_args, input_path)
    return FileResponse(output_path, media_type="model/gltf-binary", filename="pattern.glb")


# ── POST /api/set-seams — Apply user-defined seam edge overrides ──
@app.post("/api/set-seams")
async def set_seams(
    file: UploadFile = File(...),
    edge_indices: str = Form(..., description="JSON list of edge indices, e.g. '[12,45,78]'"),
    operation: str = Form("mark"),
    object_name: str = Form(None),
):
    input_path = await save_upload(file)
    script_args = {
        "edge_indices": edge_indices,
        "operation": operation,
    }
    if object_name:
        script_args["object_name"] = object_name
    output_path = run_blender_script("set_seams.py", script_args, input_path)
    return FileResponse(output_path, media_type="model/gltf-binary", filename="seamed.glb")


# ── POST /api/edit-part — Replace one named part in an assembled GLB ──
@app.post("/api/edit-part")
async def edit_part(
    file: UploadFile = File(...),
    edit_part: str = Form(..., description="Part type to replace, e.g. 'collar'"),
    part_spec: str = Form(..., description="JSON spec for replacement part"),
    pbr_json: str = Form(None),
):
    input_path = await save_upload(file)
    import json as json_mod
    import uuid
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
        cmd.extend(["--pbr_json", pbr_json])

    import subprocess
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if result.returncode != 0:
        raise HTTPException(status_code=500,
                            detail=f"Edit part failed: {result.stderr[-300:]}")
    if not output_path.exists():
        raise HTTPException(status_code=500, detail="Edit part produced no output GLB")

    return FileResponse(output_path, media_type="model/gltf-binary", filename="edited.glb")


# ── POST /api/apply-gn — Apply parametric Geometry Nodes modifier to a part ──
@app.post("/api/apply-gn")
async def apply_gn(
    file: UploadFile = File(...),
    part: str = Form(..., description="Part type: collar, sleeve, or cuff"),
    gn_params: str = Form("{}", description="JSON dict of GN param values"),
):
    input_path = await save_upload(file)
    output_path = run_blender_script("geometry_nodes_components.py", {
        "part": part,
        "gn_params": gn_params,
    }, input_path)
    return FileResponse(output_path, media_type="model/gltf-binary", filename=f"gn_{part}.glb")


# ── POST /api/seams-and-flatten — Atomic: mark seams + re-unwrap + flatten shape key ──
@app.post("/api/seams-and-flatten")
async def seams_and_flatten(
    file: UploadFile = File(...),
    edge_indices: str = Form(..., description="JSON list of edge indices, e.g. '[12,45,78]'"),
    operation: str = Form("mark"),
    object_name: str = Form(None),
    scale: float = Form(1.0),
    join: str = Form("false"),
):
    input_path = await save_upload(file)
    script_args = {
        "edge_indices": edge_indices,
        "operation": operation,
        "scale": scale,
    }
    if object_name:
        script_args["object_name"] = object_name
    if join.lower() in ("true", "1", "yes"):
        script_args["join"] = ""
    output_path = run_blender_script("seams_and_flatten.py", script_args, input_path)
    return FileResponse(output_path, media_type="model/gltf-binary", filename="seamed_flat.glb")


# ── POST /api/add-thickness — Solidify modifier with fabric-type-aware defaults ──
@app.post("/api/add-thickness")
async def add_thickness(
    file: UploadFile = File(...),
    fabric_type: str = Form("cotton"),
    thickness_multiplier: float = Form(1.0),
    use_rim: str = Form("true"),
):
    input_path = await save_upload(file)
    output_path = run_blender_script("add_thickness.py", {
        "fabric_type": fabric_type,
        "thickness_multiplier": thickness_multiplier,
        "use_rim": use_rim,
    }, input_path)
    return FileResponse(output_path, media_type="model/gltf-binary", filename="thick.glb")


# ── POST /api/extrude-edges — Extrude boundary edges for seam/hem allowance ──
@app.post("/api/extrude-edges")
async def extrude_edges(
    file: UploadFile = File(...),
    offset: float = Form(0.015),
    object_name: str = Form(None),
    crease_extrusion: str = Form("true"),
):
    input_path = await save_upload(file)
    script_args = {
        "offset": offset,
        "crease_extrusion": crease_extrusion,
    }
    if object_name:
        script_args["object_name"] = object_name
    output_path = run_blender_script("extrude_fabric_edges.py", script_args, input_path)
    return FileResponse(output_path, media_type="model/gltf-binary", filename="extruded.glb")


# ── POST /api/uv-stretch-map — Compute UV distortion heatmap ──
@app.post("/api/uv-stretch-map")
async def uv_stretch_map(
    file: UploadFile = File(...),
    threshold: float = Form(0.05),
):
    input_path = await save_upload(file)
    output_path = run_blender_script("uv_stretch_map.py", {"threshold": threshold}, input_path)
    return FileResponse(output_path, media_type="model/gltf-binary", filename="stretch_map.glb")


# ── POST /api/auto-seam — Garment-aware automatic seam placement ──
@app.post("/api/auto-seam")
async def auto_seam(
    file: UploadFile = File(...),
    garment_type: str = Form("shirt"),
    max_islands: int = Form(8),
):
    input_path = await save_upload(file)
    output_path = run_blender_script("auto_seam.py", {
        "garment_type": garment_type,
        "max_islands": max_islands,
    }, input_path)
    return FileResponse(output_path, media_type="model/gltf-binary", filename="auto_seamed.glb")


# ── POST /api/uv-pack-nest — Fabric yield nesting optimizer ──
@app.post("/api/uv-pack-nest")
async def uv_pack_nest(
    file: UploadFile = File(...),
    fabric_width: float = Form(1.5),
    grain_direction: str = Form("warp"),
    seam_allowance: float = Form(0.015),
    scale: float = Form(1.0),
):
    input_path = await save_upload(file)
    output_path = run_blender_script("uv_pack_nest.py", {
        "fabric_width": fabric_width,
        "grain_direction": grain_direction,
        "seam_allowance": seam_allowance,
        "scale": scale,
    }, input_path)
    return FileResponse(output_path, media_type="model/gltf-binary", filename="nested.glb")


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
        "--output",   str(output_path),
        "--spec_json", str(spec_path),
    ]
    # Forward pbr_values from spec as --pbr_json if present
    if spec.get("pbr_values"):
        import json as _json
        cmd.extend(["--pbr_json", _json.dumps(spec["pbr_values"])])

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
