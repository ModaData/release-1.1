"""
Export 2D pattern panels to DXF format (AutoCAD 2010 / AC1024).

Writes raw DXF entities — no external library required.
Each panel becomes a LWPOLYLINE on its own named layer.
Includes seam allowance lines, grain line indicators, and notch marks.

Usage as Blender script:
    blender --background --python export_dxf.py -- --spec_json '...' --output /path/to/out.dxf

Usage as importable module:
    from scripts.export_dxf import write_dxf
    write_dxf("output.dxf", panels_list)
"""

import json
import math
import sys
import os
from typing import List, Dict, Tuple, Optional


# ══════════════════════════════════════════════════════════════════════════════
# DXF writer primitives
# ══════════════════════════════════════════════════════════════════════════════

class DXFWriter:
    """Minimal raw DXF writer for AutoCAD 2010 (AC1024)."""

    def __init__(self):
        self.layers: List[Dict] = []
        self.entities: List[str] = []
        self._handle = 100  # DXF entity handles start above reserved range

    def _next_handle(self) -> str:
        self._handle += 1
        return format(self._handle, "X")

    def add_layer(self, name: str, color: int = 7):
        """Register a layer. Color is AutoCAD Color Index (ACI): 1=red,2=yellow,...7=white."""
        self.layers.append({"name": name, "color": color})

    def add_lwpolyline(self, points: List[Tuple[float, float]], layer: str = "0",
                        closed: bool = True, color: int = 256, linetype: str = "ByLayer"):
        """Add a Lightweight Polyline entity.

        Args:
            points: List of (x, y) tuples in drawing units (cm).
            layer: Layer name.
            closed: Whether to close the polyline.
            color: Entity colour (256 = ByLayer).
            linetype: Line type name.
        """
        h = self._next_handle()
        flag = 1 if closed else 0
        lines = [
            "  0", "LWPOLYLINE",
            "  5", h,
            "100", "AcDbEntity",
            "  8", layer,
            " 62", str(color),
            "  6", linetype,
            "100", "AcDbPolyline",
            " 90", str(len(points)),
            " 70", str(flag),
            " 43", "0.0",
        ]
        for x, y in points:
            lines.extend([" 10", f"{x:.6f}", " 20", f"{y:.6f}"])
        self.entities.append("\n".join(lines))

    def add_line(self, x1: float, y1: float, x2: float, y2: float,
                 layer: str = "0", color: int = 256, linetype: str = "ByLayer"):
        """Add a LINE entity."""
        h = self._next_handle()
        lines = [
            "  0", "LINE",
            "  5", h,
            "100", "AcDbEntity",
            "  8", layer,
            " 62", str(color),
            "  6", linetype,
            "100", "AcDbLine",
            " 10", f"{x1:.6f}", " 20", f"{y1:.6f}", " 30", "0.0",
            " 11", f"{x2:.6f}", " 21", f"{y2:.6f}", " 31", "0.0",
        ]
        self.entities.append("\n".join(lines))

    def add_circle(self, cx: float, cy: float, radius: float,
                   layer: str = "0", color: int = 256):
        """Add a CIRCLE entity (used for notch marks)."""
        h = self._next_handle()
        lines = [
            "  0", "CIRCLE",
            "  5", h,
            "100", "AcDbEntity",
            "  8", layer,
            " 62", str(color),
            "100", "AcDbCircle",
            " 10", f"{cx:.6f}", " 20", f"{cy:.6f}", " 30", "0.0",
            " 40", f"{radius:.6f}",
        ]
        self.entities.append("\n".join(lines))

    def add_text(self, text: str, x: float, y: float, height: float = 1.0,
                 layer: str = "0", color: int = 256):
        """Add a TEXT entity."""
        h = self._next_handle()
        lines = [
            "  0", "TEXT",
            "  5", h,
            "100", "AcDbEntity",
            "  8", layer,
            " 62", str(color),
            "100", "AcDbText",
            " 10", f"{x:.6f}", " 20", f"{y:.6f}", " 30", "0.0",
            " 40", f"{height:.6f}",
            "  1", text,
            "100", "AcDbText",
        ]
        self.entities.append("\n".join(lines))

    def build(self) -> str:
        """Generate the complete DXF file as a string."""
        sections = []

        # ── HEADER section ──
        sections.append(self._header_section())

        # ── TABLES section (layers + linetypes) ──
        sections.append(self._tables_section())

        # ── ENTITIES section ──
        sections.append(self._entities_section())

        # ── EOF ──
        sections.append("  0\nEOF")

        return "\n".join(sections) + "\n"

    def _header_section(self) -> str:
        return "\n".join([
            "  0", "SECTION",
            "  2", "HEADER",
            "  9", "$ACADVER",
            "  1", "AC1024",
            "  9", "$INSUNITS",
            " 70", "4",  # 4 = centimetres
            "  9", "$MEASUREMENT",
            " 70", "1",  # 1 = metric
            "  0", "ENDSEC",
        ])

    def _tables_section(self) -> str:
        parts = [
            "  0", "SECTION",
            "  2", "TABLES",
        ]

        # Linetype table
        parts.extend([
            "  0", "TABLE",
            "  2", "LTYPE",
            " 70", "3",
        ])
        # Continuous
        parts.extend([
            "  0", "LTYPE",
            "  5", self._next_handle(),
            "100", "AcDbSymbolTableRecord",
            "100", "AcDbLinetypeTableRecord",
            "  2", "Continuous",
            " 70", "0",
            "  3", "Solid line",
            " 72", "65",
            " 73", "0",
            " 40", "0.0",
        ])
        # Dashed (for seam allowance)
        parts.extend([
            "  0", "LTYPE",
            "  5", self._next_handle(),
            "100", "AcDbSymbolTableRecord",
            "100", "AcDbLinetypeTableRecord",
            "  2", "DASHED",
            " 70", "0",
            "  3", "Dashed line  __ __ __",
            " 72", "65",
            " 73", "2",
            " 40", "1.0",
            " 49", "0.6",
            " 74", "0",
            " 49", "-0.4",
            " 74", "0",
        ])
        # Dashdot (for grain line)
        parts.extend([
            "  0", "LTYPE",
            "  5", self._next_handle(),
            "100", "AcDbSymbolTableRecord",
            "100", "AcDbLinetypeTableRecord",
            "  2", "DASHDOT",
            " 70", "0",
            "  3", "Dash dot  __ . __ .",
            " 72", "65",
            " 73", "4",
            " 40", "1.4",
            " 49", "0.8",
            " 74", "0",
            " 49", "-0.2",
            " 74", "0",
            " 49", "0.0",
            " 74", "0",
            " 49", "-0.2",
            " 74", "0",
        ])
        parts.extend(["  0", "ENDTAB"])

        # Layer table
        parts.extend([
            "  0", "TABLE",
            "  2", "LAYER",
            " 70", str(len(self.layers) + 1),
        ])
        # Default layer 0
        parts.extend([
            "  0", "LAYER",
            "  5", self._next_handle(),
            "100", "AcDbSymbolTableRecord",
            "100", "AcDbLayerTableRecord",
            "  2", "0",
            " 70", "0",
            " 62", "7",
            "  6", "Continuous",
        ])
        for layer in self.layers:
            parts.extend([
                "  0", "LAYER",
                "  5", self._next_handle(),
                "100", "AcDbSymbolTableRecord",
                "100", "AcDbLayerTableRecord",
                "  2", layer["name"],
                " 70", "0",
                " 62", str(layer["color"]),
                "  6", "Continuous",
            ])
        parts.extend(["  0", "ENDTAB"])

        parts.extend(["  0", "ENDSEC"])
        return "\n".join(parts)

    def _entities_section(self) -> str:
        parts = ["  0", "SECTION", "  2", "ENTITIES"]
        for entity in self.entities:
            parts.append(entity)
        parts.extend(["  0", "ENDSEC"])
        return "\n".join(parts)


# ══════════════════════════════════════════════════════════════════════════════
# Geometry helpers
# ══════════════════════════════════════════════════════════════════════════════

def _offset_polygon(points: List[Tuple[float, float]], distance: float) -> List[Tuple[float, float]]:
    """Compute a simple outward offset of a polygon by 'distance' cm.

    Uses the method of offsetting each edge by its normal, then finding
    intersections of adjacent offset edges.
    """
    n = len(points)
    if n < 3:
        return points

    # Compute outward normals for each edge
    normals = []
    for i in range(n):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % n]
        dx, dy = x2 - x1, y2 - y1
        length = math.sqrt(dx * dx + dy * dy)
        if length < 1e-10:
            normals.append((0.0, 0.0))
        else:
            # Outward normal (assuming CCW winding)
            normals.append((dy / length, -dx / length))

    # Check winding: if CW, flip normals
    area = 0.0
    for i in range(n):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % n]
        area += (x2 - x1) * (y2 + y1)
    if area > 0:  # CW winding
        normals = [(-nx, -ny) for nx, ny in normals]

    # Offset each edge
    offset_points = []
    for i in range(n):
        # Current edge: points[i] -> points[(i+1)%n], with normal normals[i]
        # Previous edge: points[(i-1)%n] -> points[i], with normal normals[(i-1)%n]
        prev = (i - 1) % n

        # Offset the two edges
        nx1, ny1 = normals[prev]
        nx2, ny2 = normals[i]

        # Point on previous offset edge: points[i] + normal * distance
        p1x = points[i][0] + nx1 * distance
        p1y = points[i][1] + ny1 * distance
        # Direction of previous edge
        d1x = points[i][0] - points[prev][0]
        d1y = points[i][1] - points[prev][1]

        # Point on current offset edge: points[i] + normal * distance
        p2x = points[i][0] + nx2 * distance
        p2y = points[i][1] + ny2 * distance
        # Direction of current edge
        nxt = (i + 1) % n
        d2x = points[nxt][0] - points[i][0]
        d2y = points[nxt][1] - points[i][1]

        # Find intersection of the two offset lines
        cross = d1x * d2y - d1y * d2x
        if abs(cross) < 1e-10:
            # Parallel edges, just use the offset point
            offset_points.append((p1x, p1y))
        else:
            t = ((p2x - p1x) * d2y - (p2y - p1y) * d2x) / cross
            ix = p1x + t * d1x
            iy = p1y + t * d1y
            offset_points.append((round(ix, 4), round(iy, 4)))

    return offset_points


def _centroid(points: List[Tuple[float, float]]) -> Tuple[float, float]:
    """Compute centroid of a polygon."""
    n = len(points)
    if n == 0:
        return (0.0, 0.0)
    cx = sum(p[0] for p in points) / n
    cy = sum(p[1] for p in points) / n
    return (cx, cy)


# ══════════════════════════════════════════════════════════════════════════════
# Main DXF export function
# ══════════════════════════════════════════════════════════════════════════════

# AutoCAD colour index mapping for layers
ACI_COLORS = [7, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 30, 40, 50, 60]


def write_dxf(output_path: str, panels: List[Dict]):
    """Write 2D pattern panels to a DXF file.

    Args:
        output_path: Destination file path.
        panels: List of panel dicts, each containing:
            - 'name' (str): Panel name, used as DXF layer name
            - 'vertices' (list of [x, y]): Outline points in cm
            - 'seam_allowance' (float, optional): Seam allowance in cm (default 1.0)
            - 'grain_angle' (float, optional): Grain line angle in degrees (default 0)
    """
    dxf = DXFWriter()

    for panel_idx, panel in enumerate(panels):
        name = panel.get("name", f"PANEL_{panel_idx}")
        layer_name = name.upper().replace(" ", "_")
        color = ACI_COLORS[panel_idx % len(ACI_COLORS)]
        seam_allowance = panel.get("seam_allowance", 1.0)
        grain_angle = panel.get("grain_angle", 0.0)

        raw_verts = panel.get("vertices", [])
        if len(raw_verts) < 3:
            print(f"[dxf] Skipping panel '{name}': fewer than 3 vertices")
            continue

        # Normalise to list of tuples
        points = [(float(v[0]), float(v[1])) for v in raw_verts]

        # Register layer
        dxf.add_layer(layer_name, color)
        seam_layer = f"{layer_name}_SEAM"
        dxf.add_layer(seam_layer, 8)  # 8 = dark grey
        grain_layer = f"{layer_name}_GRAIN"
        dxf.add_layer(grain_layer, 3)  # 3 = green
        notch_layer = f"{layer_name}_NOTCH"
        dxf.add_layer(notch_layer, 1)  # 1 = red

        # ── Cut line (main outline) ──
        dxf.add_lwpolyline(points, layer=layer_name, closed=True)

        # ── Seam allowance (offset outline) ──
        if seam_allowance > 0:
            seam_points = _offset_polygon(points, seam_allowance)
            dxf.add_lwpolyline(seam_points, layer=seam_layer, closed=True,
                                linetype="DASHED")

        # ── Grain line indicator ──
        cx, cy = _centroid(points)
        # Grain line length = 40% of panel height
        ys = [p[1] for p in points]
        grain_len = (max(ys) - min(ys)) * 0.4
        rad = math.radians(grain_angle)
        gx1 = cx - (grain_len / 2) * math.sin(rad)
        gy1 = cy - (grain_len / 2) * math.cos(rad)
        gx2 = cx + (grain_len / 2) * math.sin(rad)
        gy2 = cy + (grain_len / 2) * math.cos(rad)
        dxf.add_line(gx1, gy1, gx2, gy2, layer=grain_layer, linetype="DASHDOT")
        # Arrowhead at top end
        arrow_len = grain_len * 0.08
        arr_angle1 = rad + math.radians(150)
        arr_angle2 = rad + math.radians(210)
        dxf.add_line(gx2, gy2,
                     gx2 + arrow_len * math.sin(arr_angle1),
                     gy2 + arrow_len * math.cos(arr_angle1),
                     layer=grain_layer, linetype="DASHDOT")
        dxf.add_line(gx2, gy2,
                     gx2 + arrow_len * math.sin(arr_angle2),
                     gy2 + arrow_len * math.cos(arr_angle2),
                     layer=grain_layer, linetype="DASHDOT")

        # ── Notch marks at seam endpoints (vertices) ──
        notch_radius = 0.3  # cm
        for px, py in points:
            dxf.add_circle(px, py, notch_radius, layer=notch_layer)

        # ── Panel name label ──
        text_height = max(1.0, grain_len * 0.1)
        dxf.add_text(layer_name, cx - len(layer_name) * text_height * 0.3, cy + grain_len * 0.3,
                     height=text_height, layer=layer_name)

    # Write to file
    dxf_content = dxf.build()
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(dxf_content)

    print(f"[dxf] Written {len(panels)} panels to {output_path} ({len(dxf_content)} bytes)")


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
    parser = argparse.ArgumentParser(description="Export 2D patterns to DXF")
    parser.add_argument("--spec_json", required=True, help="GarmentSpec JSON string or file path")
    parser.add_argument("--output", required=True, help="Output DXF file path")
    args = parser.parse_args(argv)

    # Load spec — could be inline JSON or a file path
    spec_str = args.spec_json
    if os.path.isfile(spec_str):
        with open(spec_str, "r") as f:
            spec_str = f.read()

    spec = json.loads(spec_str)
    panels = spec.get("panels", [])

    if not panels:
        print("[dxf] ERROR: No panels found in spec")
        sys.exit(1)

    write_dxf(args.output, panels)


if __name__ == "__main__":
    main()
