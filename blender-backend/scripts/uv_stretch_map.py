"""
uv_stretch_map.py — Compute per-face UV distortion and export as vertex color heatmap.

Manufacturers reject patterns with >5% UV stretch. This script provides instant
visual QA: green = clean pattern, red = bad stretch. Also writes a _uv_quality.json
sidecar with avg/max stretch, problem face indices, and a letter grade.

Usage:
  blender --background --python uv_stretch_map.py -- \
    --input pattern.glb --output stretch.glb \
    [--threshold 0.05]
"""

import bpy
import bmesh
import json
import math
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
    parser.add_argument("--input",     required=True)
    parser.add_argument("--output",    required=True)
    parser.add_argument("--threshold", type=float, default=0.05,
                        help="Stretch ratio above which a face is flagged (0.05 = 5%%)")
    return parser.parse_args(argv)


def triangle_area_3d(v0, v1, v2):
    """Compute area of a 3D triangle from three vertex positions."""
    e1 = [v1[i] - v0[i] for i in range(3)]
    e2 = [v2[i] - v0[i] for i in range(3)]
    cross = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
    ]
    return 0.5 * math.sqrt(cross[0]**2 + cross[1]**2 + cross[2]**2)


def triangle_area_2d(uv0, uv1, uv2):
    """Compute area of a 2D triangle from UV coordinates."""
    return abs(0.5 * ((uv1[0] - uv0[0]) * (uv2[1] - uv0[1]) -
                       (uv2[0] - uv0[0]) * (uv1[1] - uv0[1])))


def stretch_to_color(stretch, threshold):
    """Map stretch ratio to RGB: green (0) → yellow (threshold) → red (2*threshold+)."""
    t = min(stretch / max(threshold * 2, 0.001), 1.0)
    if t < 0.5:
        # Green → Yellow
        r = t * 2
        g = 1.0
    else:
        # Yellow → Red
        r = 1.0
        g = 1.0 - (t - 0.5) * 2
    return (r, g, 0.0, 1.0)


def compute_quality_grade(avg_stretch, max_stretch, problem_count, total_faces):
    """Assign a letter grade based on stretch metrics."""
    problem_ratio = problem_count / max(total_faces, 1)
    if avg_stretch < 0.02 and problem_ratio < 0.01:
        return "A"
    elif avg_stretch < 0.05 and problem_ratio < 0.05:
        return "B"
    elif avg_stretch < 0.10 and problem_ratio < 0.15:
        return "C"
    else:
        return "F"


@wrap_main
def uv_stretch_map():
    args = parse_args()

    # Import
    meshes, err = safe_import_glb(args.input)
    if err:
        print(f"[uv_stretch_map] FATAL: {err}")
        sys.exit(1)
    if not meshes:
        print("[uv_stretch_map] FATAL: No mesh objects in GLB")
        sys.exit(1)

    print(f"[uv_stretch_map] Loaded {len(meshes)} mesh object(s), threshold={args.threshold}")

    all_stretches = []
    problem_faces = []
    total_faces = 0

    for obj in meshes:
        mesh = obj.data
        uv_layer = mesh.uv_layers.active
        if not uv_layer:
            print(f"[uv_stretch_map] WARNING: '{obj.name}' has no UV map — skipping")
            continue

        # Create or get vertex color layer
        if "Col_Stretch" in mesh.vertex_colors:
            color_layer = mesh.vertex_colors["Col_Stretch"]
        else:
            color_layer = mesh.vertex_colors.new(name="Col_Stretch")

        # Compute per-face stretch
        face_stretches = []
        for poly in mesh.polygons:
            # Get 3D positions
            verts_3d = [obj.data.vertices[vi].co for vi in poly.vertices]
            # Get UV positions
            loop_uvs = [uv_layer.data[li].uv for li in poly.loop_indices]

            if len(verts_3d) < 3:
                face_stretches.append(0.0)
                continue

            # Compute areas (use first triangle for quads — good enough approximation)
            area_3d = triangle_area_3d(verts_3d[0], verts_3d[1], verts_3d[2])
            area_uv = triangle_area_2d(loop_uvs[0], loop_uvs[1], loop_uvs[2])

            # For quads, add second triangle
            if len(verts_3d) >= 4:
                area_3d += triangle_area_3d(verts_3d[0], verts_3d[2], verts_3d[3])
                area_uv += triangle_area_2d(loop_uvs[0], loop_uvs[2], loop_uvs[3])

            # Stretch = |1 - (uv_area / 3d_area)| normalized
            if area_3d > 1e-10:
                ratio = area_uv / area_3d
                stretch = abs(1.0 - ratio)
            else:
                stretch = 0.0

            face_stretches.append(stretch)
            all_stretches.append(stretch)
            total_faces += 1

            if stretch > args.threshold:
                problem_faces.append(poly.index)

        # Write vertex colors
        for poly_idx, poly in enumerate(mesh.polygons):
            stretch_val = face_stretches[poly_idx] if poly_idx < len(face_stretches) else 0.0
            color = stretch_to_color(stretch_val, args.threshold)
            for li in poly.loop_indices:
                color_layer.data[li].color = color

        print(f"[uv_stretch_map] '{obj.name}': {len(face_stretches)} faces analyzed")

    # Compute summary metrics
    avg_stretch = sum(all_stretches) / max(len(all_stretches), 1)
    max_stretch = max(all_stretches) if all_stretches else 0.0
    grade = compute_quality_grade(avg_stretch, max_stretch, len(problem_faces), total_faces)

    print(f"[uv_stretch_map] Summary: avg={avg_stretch:.4f}, max={max_stretch:.4f}, "
          f"problems={len(problem_faces)}/{total_faces}, grade={grade}")

    # Export GLB with vertex colors
    success, err = safe_export_glb(args.output)
    if not success:
        print(f"[uv_stretch_map] FATAL: Export failed: {err}")
        sys.exit(1)

    # Write sidecar JSON
    meta_path = str(args.output).rsplit(".", 1)[0] + "_uv_quality.json"
    meta = {
        "avg_stretch": round(avg_stretch, 6),
        "max_stretch": round(max_stretch, 6),
        "problem_faces": problem_faces[:100],  # Cap at 100 to keep JSON reasonable
        "problem_face_count": len(problem_faces),
        "total_faces": total_faces,
        "threshold": args.threshold,
        "quality_grade": grade,
    }
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    print(f"[uv_stretch_map] Done → {args.output} + {meta_path}")


if __name__ == "__main__":
    uv_stretch_map()
