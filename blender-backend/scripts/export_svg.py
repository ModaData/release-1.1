"""
Export 2D pattern panels to SVG format.

Each panel is rendered as a coloured polygon with:
  - Panel name text labels
  - Seam allowance as dashed lines
  - Grid lines for measurement reference
  - Grain line arrows
  - Dimension annotations

Usage as Blender script:
    blender --background --python export_svg.py -- --spec_json '...' --output /path/to/out.svg

Usage as importable module:
    from scripts.export_svg import write_svg
    write_svg("output.svg", panels_list)
"""

import json
import math
import sys
import os
from typing import List, Dict, Tuple
from xml.sax.saxutils import escape as xml_escape


# ══════════════════════════════════════════════════════════════════════════════
# SVG builder
# ══════════════════════════════════════════════════════════════════════════════

# Default panel colours (cycle through these)
PANEL_COLORS = [
    "#4A90D9", "#E74C3C", "#2ECC71", "#F39C12", "#9B59B6",
    "#1ABC9C", "#E67E22", "#3498DB", "#E91E63", "#00BCD4",
]


def _points_to_path(points: List[Tuple[float, float]]) -> str:
    """Convert a list of (x, y) points to an SVG path 'd' attribute."""
    if not points:
        return ""
    parts = [f"M {points[0][0]:.4f},{points[0][1]:.4f}"]
    for x, y in points[1:]:
        parts.append(f"L {x:.4f},{y:.4f}")
    parts.append("Z")
    return " ".join(parts)


def _offset_polygon(points: List[Tuple[float, float]], distance: float) -> List[Tuple[float, float]]:
    """Compute outward offset of polygon by 'distance' (same algo as export_dxf)."""
    n = len(points)
    if n < 3:
        return points

    normals = []
    for i in range(n):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % n]
        dx, dy = x2 - x1, y2 - y1
        length = math.sqrt(dx * dx + dy * dy)
        if length < 1e-10:
            normals.append((0.0, 0.0))
        else:
            normals.append((dy / length, -dx / length))

    area = 0.0
    for i in range(n):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % n]
        area += (x2 - x1) * (y2 + y1)
    if area > 0:
        normals = [(-nx, -ny) for nx, ny in normals]

    offset_points = []
    for i in range(n):
        prev = (i - 1) % n
        nx1, ny1 = normals[prev]
        nx2, ny2 = normals[i]

        p1x = points[i][0] + nx1 * distance
        p1y = points[i][1] + ny1 * distance
        d1x = points[i][0] - points[prev][0]
        d1y = points[i][1] - points[prev][1]

        p2x = points[i][0] + nx2 * distance
        p2y = points[i][1] + ny2 * distance
        nxt = (i + 1) % n
        d2x = points[nxt][0] - points[i][0]
        d2y = points[nxt][1] - points[i][1]

        cross = d1x * d2y - d1y * d2x
        if abs(cross) < 1e-10:
            offset_points.append((p1x, p1y))
        else:
            t = ((p2x - p1x) * d2y - (p2y - p1y) * d2x) / cross
            ix = p1x + t * d1x
            iy = p1y + t * d1y
            offset_points.append((round(ix, 4), round(iy, 4)))

    return offset_points


def _centroid(points: List[Tuple[float, float]]) -> Tuple[float, float]:
    n = len(points)
    if n == 0:
        return (0.0, 0.0)
    return (sum(p[0] for p in points) / n, sum(p[1] for p in points) / n)


def _bbox(points: List[Tuple[float, float]]) -> Tuple[float, float, float, float]:
    """Return (min_x, min_y, max_x, max_y)."""
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return (min(xs), min(ys), max(xs), max(ys))


# ══════════════════════════════════════════════════════════════════════════════
# Main SVG export function
# ══════════════════════════════════════════════════════════════════════════════

def write_svg(output_path: str, panels: List[Dict], margin: float = 5.0, grid_spacing: float = 10.0):
    """Write 2D pattern panels to an SVG file.

    Args:
        output_path: Destination file path.
        panels: List of panel dicts with keys:
            - 'name' (str): Panel name
            - 'vertices' (list of [x, y]): Outline points in cm
            - 'seam_allowance' (float, optional): cm, default 1.0
            - 'grain_angle' (float, optional): degrees, default 0
            - 'color' (str, optional): Hex fill colour
        margin: SVG margin in cm.
        grid_spacing: Grid line spacing in cm.
    """
    if not panels:
        print("[svg] No panels to export")
        return

    # Collect all points to compute global bounding box
    all_points = []
    panel_data = []

    for panel_idx, panel in enumerate(panels):
        raw_verts = panel.get("vertices", [])
        if len(raw_verts) < 3:
            continue
        points = [(float(v[0]), float(v[1])) for v in raw_verts]
        sa = panel.get("seam_allowance", 1.0)
        seam_points = _offset_polygon(points, sa) if sa > 0 else []

        all_points.extend(points)
        if seam_points:
            all_points.extend(seam_points)

        panel_data.append({
            "name": panel.get("name", f"Panel_{panel_idx}"),
            "points": points,
            "seam_points": seam_points,
            "grain_angle": panel.get("grain_angle", 0.0),
            "color": panel.get("color", PANEL_COLORS[panel_idx % len(PANEL_COLORS)]),
            "seam_allowance": sa,
        })

    if not all_points:
        print("[svg] No valid panels")
        return

    gmin_x, gmin_y, gmax_x, gmax_y = _bbox(all_points)

    # SVG coordinate system: flip Y (SVG y goes down, pattern y goes up)
    # We'll transform: svg_y = (gmax_y + margin) - pattern_y + margin
    total_w = (gmax_x - gmin_x) + 2 * margin
    total_h = (gmax_y - gmin_y) + 2 * margin

    def tx(x: float) -> float:
        return x - gmin_x + margin

    def ty(y: float) -> float:
        return (gmax_y - y) + margin  # flip Y

    def transform_points(pts):
        return [(tx(x), ty(y)) for x, y in pts]

    svg_parts = []

    # SVG header
    svg_parts.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{total_w:.2f}cm" height="{total_h:.2f}cm" '
        f'viewBox="0 0 {total_w:.4f} {total_h:.4f}" '
        f'style="background: #FAFAFA;">'
    )

    # Defs: dashed line style, arrowhead marker
    svg_parts.append("""  <defs>
    <marker id="arrowhead" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
      <polygon points="0 0, 6 2, 0 4" fill="#333"/>
    </marker>
    <pattern id="grid" width="{gs}" height="{gs}" patternUnits="userSpaceOnUse">
      <path d="M {gs} 0 L 0 0 0 {gs}" fill="none" stroke="#E0E0E0" stroke-width="0.1"/>
    </pattern>
  </defs>""".format(gs=grid_spacing))

    # Grid background
    svg_parts.append(
        f'  <rect width="{total_w:.4f}" height="{total_h:.4f}" fill="url(#grid)"/>'
    )

    # Grid axis labels (every grid_spacing cm)
    for gx in range(int(gmin_x), int(gmax_x) + 1, int(grid_spacing)):
        sx = tx(gx)
        svg_parts.append(
            f'  <text x="{sx:.2f}" y="{total_h - 0.5:.2f}" '
            f'font-size="1.5" fill="#999" text-anchor="middle">{gx}</text>'
        )
    for gy in range(int(gmin_y), int(gmax_y) + 1, int(grid_spacing)):
        sy = ty(gy)
        svg_parts.append(
            f'  <text x="1" y="{sy:.2f}" '
            f'font-size="1.5" fill="#999" text-anchor="start">{gy}</text>'
        )

    # ── Render each panel ──
    for pd in panel_data:
        pts_svg = transform_points(pd["points"])
        name = pd["name"]
        color = pd["color"]

        # Panel group
        svg_parts.append(f'  <g id="{xml_escape(name)}">')

        # Seam allowance (dashed)
        if pd["seam_points"]:
            seam_svg = transform_points(pd["seam_points"])
            svg_parts.append(
                f'    <path d="{_points_to_path(seam_svg)}" '
                f'fill="none" stroke="#999" stroke-width="0.2" '
                f'stroke-dasharray="1,0.5" opacity="0.6"/>'
            )

        # Main panel polygon
        svg_parts.append(
            f'    <path d="{_points_to_path(pts_svg)}" '
            f'fill="{color}" fill-opacity="0.15" '
            f'stroke="{color}" stroke-width="0.4"/>'
        )

        # ── Grain line arrow ──
        cx, cy = _centroid(pd["points"])
        ys = [p[1] for p in pd["points"]]
        grain_len = (max(ys) - min(ys)) * 0.4
        rad = math.radians(pd["grain_angle"])
        gx1 = cx - (grain_len / 2) * math.sin(rad)
        gy1 = cy - (grain_len / 2) * math.cos(rad)
        gx2 = cx + (grain_len / 2) * math.sin(rad)
        gy2 = cy + (grain_len / 2) * math.cos(rad)

        sg1x, sg1y = tx(gx1), ty(gy1)
        sg2x, sg2y = tx(gx2), ty(gy2)
        svg_parts.append(
            f'    <line x1="{sg1x:.4f}" y1="{sg1y:.4f}" '
            f'x2="{sg2x:.4f}" y2="{sg2y:.4f}" '
            f'stroke="#333" stroke-width="0.3" marker-end="url(#arrowhead)"/>'
        )

        # ── Panel name label ──
        lcx, lcy = tx(cx), ty(cy)
        font_size = max(1.5, grain_len * 0.08)
        svg_parts.append(
            f'    <text x="{lcx:.2f}" y="{lcy - 1:.2f}" '
            f'font-size="{font_size:.1f}" fill="#333" '
            f'text-anchor="middle" font-family="Arial, sans-serif" '
            f'font-weight="bold">{xml_escape(name)}</text>'
        )

        # ── Dimension annotations ──
        bbox_pts = _bbox(pd["points"])
        bmin_x, bmin_y, bmax_x, bmax_y = bbox_pts
        width_cm = bmax_x - bmin_x
        height_cm = bmax_y - bmin_y

        # Width dimension (bottom)
        dim_y = ty(bmin_y) + 2.5
        dim_x1 = tx(bmin_x)
        dim_x2 = tx(bmax_x)
        dim_mid_x = (dim_x1 + dim_x2) / 2
        svg_parts.append(
            f'    <line x1="{dim_x1:.4f}" y1="{dim_y:.4f}" '
            f'x2="{dim_x2:.4f}" y2="{dim_y:.4f}" '
            f'stroke="#666" stroke-width="0.15"/>'
        )
        svg_parts.append(
            f'    <text x="{dim_mid_x:.2f}" y="{dim_y + 1.5:.2f}" '
            f'font-size="1.2" fill="#666" text-anchor="middle" '
            f'font-family="Arial, sans-serif">{width_cm:.1f} cm</text>'
        )

        # Height dimension (right)
        dim_x = tx(bmax_x) + 2.5
        dim_y1 = ty(bmax_y)
        dim_y2 = ty(bmin_y)
        dim_mid_y = (dim_y1 + dim_y2) / 2
        svg_parts.append(
            f'    <line x1="{dim_x:.4f}" y1="{dim_y1:.4f}" '
            f'x2="{dim_x:.4f}" y2="{dim_y2:.4f}" '
            f'stroke="#666" stroke-width="0.15"/>'
        )
        svg_parts.append(
            f'    <text x="{dim_x + 1.5:.2f}" y="{dim_mid_y:.2f}" '
            f'font-size="1.2" fill="#666" text-anchor="start" '
            f'font-family="Arial, sans-serif" '
            f'transform="rotate(-90, {dim_x + 1.5:.2f}, {dim_mid_y:.2f})">'
            f'{height_cm:.1f} cm</text>'
        )

        svg_parts.append("  </g>")

    # Close SVG
    svg_parts.append("</svg>")

    svg_content = "\n".join(svg_parts)
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(svg_content)

    print(f"[svg] Written {len(panel_data)} panels to {output_path} ({len(svg_content)} bytes)")


# ══════════════════════════════════════════════════════════════════════════════
# Blender script entry point
# ══════════════════════════════════════════════════════════════════════════════

def main():
    """Parse CLI args when run as a Blender script."""
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []

    import argparse
    parser = argparse.ArgumentParser(description="Export 2D patterns to SVG")
    parser.add_argument("--spec_json", required=True, help="GarmentSpec JSON string or file path")
    parser.add_argument("--output", required=True, help="Output SVG file path")
    args = parser.parse_args(argv)

    spec_str = args.spec_json
    if os.path.isfile(spec_str):
        with open(spec_str, "r") as f:
            spec_str = f.read()

    spec = json.loads(spec_str)
    panels = spec.get("panels", [])

    if not panels:
        print("[svg] ERROR: No panels found in spec")
        sys.exit(1)

    write_svg(args.output, panels)


if __name__ == "__main__":
    main()
