"""
GarmentSchema v2 — Patterns-as-Code
Represents garments as structured collections of 2D panels, stitches (seam mappings),
and standardized measurements using Freesewing.org naming conventions.

This is the "source of truth" — every garment can be unrolled back to 2D sewing
panels for manufacturing, or folded into 3D via cloth simulation.
"""

from dataclasses import dataclass, field
from typing import List, Dict, Tuple
import json
import math
import copy


# ══════════════════════════════════════════════════════════════
# Standard body measurements in cm by size
# ══════════════════════════════════════════════════════════════

STANDARD_MEASUREMENTS = {
    "XS": {"chest": 82, "waist": 64, "hips": 88, "neck": 35, "shoulder_to_shoulder": 38,
            "shoulder_to_wrist": 58, "bicep": 26, "wrist": 15, "back_length": 40,
            "front_length": 42, "inseam": 76, "outseam": 102, "thigh": 52, "knee": 36,
            "ankle": 22, "waist_to_hip": 20, "armhole_depth": 20, "cross_front": 32, "cross_back": 34},
    "S":  {"chest": 88, "waist": 70, "hips": 94, "neck": 37, "shoulder_to_shoulder": 40,
            "shoulder_to_wrist": 60, "bicep": 28, "wrist": 16, "back_length": 41,
            "front_length": 43, "inseam": 78, "outseam": 104, "thigh": 54, "knee": 37,
            "ankle": 23, "waist_to_hip": 20, "armhole_depth": 21, "cross_front": 34, "cross_back": 36},
    "M":  {"chest": 96, "waist": 78, "hips": 100, "neck": 39, "shoulder_to_shoulder": 43,
            "shoulder_to_wrist": 62, "bicep": 30, "wrist": 17, "back_length": 43,
            "front_length": 45, "inseam": 80, "outseam": 106, "thigh": 56, "knee": 38,
            "ankle": 24, "waist_to_hip": 21, "armhole_depth": 22, "cross_front": 36, "cross_back": 38},
    "L":  {"chest": 104, "waist": 86, "hips": 108, "neck": 41, "shoulder_to_shoulder": 46,
            "shoulder_to_wrist": 64, "bicep": 33, "wrist": 18, "back_length": 45,
            "front_length": 47, "inseam": 82, "outseam": 108, "thigh": 60, "knee": 40,
            "ankle": 25, "waist_to_hip": 22, "armhole_depth": 23, "cross_front": 38, "cross_back": 40},
    "XL": {"chest": 112, "waist": 96, "hips": 116, "neck": 43, "shoulder_to_shoulder": 49,
            "shoulder_to_wrist": 66, "bicep": 36, "wrist": 19, "back_length": 47,
            "front_length": 49, "inseam": 82, "outseam": 108, "thigh": 64, "knee": 42,
            "ankle": 26, "waist_to_hip": 23, "armhole_depth": 24, "cross_front": 40, "cross_back": 42},
}

EASE_PROFILES = {
    "skin_tight":  {"chest": 0, "waist": 0, "hips": 0, "bicep": 0},
    "slim":        {"chest": 6, "waist": 4, "hips": 4, "bicep": 3},
    "regular":     {"chest": 10, "waist": 8, "hips": 8, "bicep": 5},
    "relaxed":     {"chest": 16, "waist": 14, "hips": 14, "bicep": 8},
    "oversized":   {"chest": 24, "waist": 22, "hips": 22, "bicep": 12},
}

FABRIC_PROPERTIES = {
    "cotton":   {"density": 0.15, "stiffness": 15, "bending": 5, "friction": 0.8, "thickness": 0.0018},
    "silk":     {"density": 0.08, "stiffness": 5,  "bending": 1, "friction": 0.3, "thickness": 0.0008},
    "denim":    {"density": 0.35, "stiffness": 40, "bending": 20, "friction": 0.9, "thickness": 0.0035},
    "wool":     {"density": 0.25, "stiffness": 20, "bending": 10, "friction": 0.7, "thickness": 0.003},
    "linen":    {"density": 0.18, "stiffness": 18, "bending": 8, "friction": 0.75, "thickness": 0.0022},
    "leather":  {"density": 0.6,  "stiffness": 60, "bending": 30, "friction": 0.95, "thickness": 0.005},
    "chiffon":  {"density": 0.05, "stiffness": 2,  "bending": 0.5, "friction": 0.2, "thickness": 0.0005},
    "velvet":   {"density": 0.3,  "stiffness": 12, "bending": 6, "friction": 0.85, "thickness": 0.004},
    "jersey":   {"density": 0.12, "stiffness": 8,  "bending": 2, "friction": 0.5, "thickness": 0.0012},
    "satin":    {"density": 0.1,  "stiffness": 6,  "bending": 1.5, "friction": 0.25, "thickness": 0.001},
    "tweed":    {"density": 0.35, "stiffness": 35, "bending": 18, "friction": 0.85, "thickness": 0.004},
    "polyester":{"density": 0.13, "stiffness": 10, "bending": 3, "friction": 0.4, "thickness": 0.0015},
}


# ══════════════════════════════════════════════════════════════
# Core Data Structures
# ══════════════════════════════════════════════════════════════

@dataclass
class Edge:
    """An edge of a panel, defined by indices into the panel's vertices."""
    id: str
    start_idx: int
    end_idx: int
    edge_type: str = "cut"  # "cut", "fold", "hem", "gather"
    seam_allowance: float = 1.0


@dataclass
class Stitch:
    """A mapping between two panel edges that get sewn together."""
    id: str
    edge_a: str
    edge_b: str
    stitch_type: str = "plain"  # "plain", "french", "overlock", "topstitch"
    order: int = 1


@dataclass
class Panel:
    """A 2D flat pattern piece. Vertices are in cm, counterclockwise."""
    name: str
    vertices: List[List[float]]
    edges: List[Edge] = field(default_factory=list)
    grain_line: str = "vertical"
    mirror: bool = False
    fabric_layer: int = 1
    notches: List[Dict] = field(default_factory=list)

    @property
    def width_cm(self) -> float:
        xs = [v[0] for v in self.vertices]
        return max(xs) - min(xs)

    @property
    def height_cm(self) -> float:
        ys = [v[1] for v in self.vertices]
        return max(ys) - min(ys)


@dataclass
class GarmentSpec:
    """Complete garment specification — the source of truth for 2D and 3D."""
    metadata: Dict = field(default_factory=dict)
    panels: List[Panel] = field(default_factory=list)
    stitches: List[Stitch] = field(default_factory=list)
    measurements: Dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict:
        d = {"metadata": self.metadata, "panels": [], "stitches": [], "measurements": self.measurements}
        for p in self.panels:
            d["panels"].append({
                "name": p.name, "vertices": p.vertices,
                "edges": [{"id": e.id, "start_idx": e.start_idx, "end_idx": e.end_idx,
                           "edge_type": e.edge_type, "seam_allowance": e.seam_allowance} for e in p.edges],
                "grain_line": p.grain_line, "mirror": p.mirror, "fabric_layer": p.fabric_layer,
                "width_cm": round(p.width_cm, 1), "height_cm": round(p.height_cm, 1),
            })
        for s in self.stitches:
            d["stitches"].append({"id": s.id, "edge_a": s.edge_a, "edge_b": s.edge_b,
                                  "stitch_type": s.stitch_type, "order": s.order})
        return d

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2)

    @staticmethod
    def from_dict(d: dict) -> "GarmentSpec":
        panels = []
        for pd in d.get("panels", []):
            edges = [Edge(**e) for e in pd.get("edges", [])]
            panels.append(Panel(name=pd["name"], vertices=pd["vertices"], edges=edges,
                                grain_line=pd.get("grain_line", "vertical"),
                                mirror=pd.get("mirror", False), fabric_layer=pd.get("fabric_layer", 1)))
        stitches = [Stitch(**s) for s in d.get("stitches", [])]
        return GarmentSpec(metadata=d.get("metadata", {}), panels=panels, stitches=stitches,
                           measurements=d.get("measurements", {}))


# ══════════════════════════════════════════════════════════════
# GarmentFactory — Parametric Template System
# ══════════════════════════════════════════════════════════════

class GarmentFactory:
    """Creates garments from parametric templates.
    Usage: factory.create("tshirt", size="M", fit="regular", sleeve_length=25)
    """

    @staticmethod
    def get_measurements(size: str = "M", custom: dict = None) -> dict:
        base = copy.deepcopy(STANDARD_MEASUREMENTS.get(size.upper(), STANDARD_MEASUREMENTS["M"]))
        if custom:
            base.update(custom)
        return base

    @staticmethod
    def apply_ease(measurements: dict, fit: str = "regular") -> dict:
        ease = EASE_PROFILES.get(fit, EASE_PROFILES["regular"])
        result = copy.deepcopy(measurements)
        for key, ease_val in ease.items():
            if key in result:
                result[key] += ease_val
        return result

    def create(self, garment_type: str, **params) -> GarmentSpec:
        factory_map = {
            "tshirt": self._make_tshirt, "shirt": self._make_shirt,
            "blazer": self._make_blazer, "pants": self._make_pants,
            "skirt": self._make_skirt, "dress": self._make_dress,
            "hoodie": self._make_hoodie, "tank_top": self._make_tank_top,
        }
        builder = factory_map.get(garment_type.lower().replace("-", "_").replace(" ", "_"), self._make_tshirt)
        return builder(**params)

    def _make_tshirt(self, size="M", fit="regular", sleeve_length=None,
                     body_length=None, neckline="crew", color="#FFFFFF",
                     fabric_type="cotton", **kw) -> GarmentSpec:
        m = self.apply_ease(self.get_measurements(size), fit)
        hc = m["chest"] / 2
        sw = m["shoulder_to_shoulder"] / 2
        nw = m["neck"] / (2 * math.pi) * 2
        sl = sleeve_length or m["shoulder_to_wrist"] * 0.35
        bl = body_length or m["back_length"] + 5
        ad = m["armhole_depth"]
        bw = m["bicep"] / 2 + 2

        front = Panel(name="front", vertices=[
            [0, 0], [hc, 0], [hc, bl - ad], [sw, bl],
            [sw - nw, bl], [hc/2, bl + 1], [nw, bl],
            [hc - sw, bl], [0, bl - ad],
        ], edges=[
            Edge(id="front:hem", start_idx=0, end_idx=1, edge_type="hem"),
            Edge(id="front:side_right", start_idx=1, end_idx=2, edge_type="cut"),
            Edge(id="front:armhole_right", start_idx=2, end_idx=3, edge_type="cut"),
            Edge(id="front:shoulder_right", start_idx=3, end_idx=4, edge_type="cut"),
            Edge(id="front:neckline", start_idx=4, end_idx=7, edge_type="hem"),
            Edge(id="front:shoulder_left", start_idx=7, end_idx=8, edge_type="cut"),
            Edge(id="front:side_left", start_idx=8, end_idx=0, edge_type="cut"),
        ])

        back_v = [[0, 0], [hc, 0], [hc, bl - ad], [sw, bl],
                  [sw - nw, bl], [hc/2, bl + 3], [nw, bl],
                  [hc - sw, bl], [0, bl - ad]]
        back = Panel(name="back", vertices=back_v, edges=[
            Edge(id="back:hem", start_idx=0, end_idx=1, edge_type="hem"),
            Edge(id="back:side_right", start_idx=1, end_idx=2, edge_type="cut"),
            Edge(id="back:armhole_right", start_idx=2, end_idx=3, edge_type="cut"),
            Edge(id="back:shoulder_right", start_idx=3, end_idx=4, edge_type="cut"),
            Edge(id="back:neckline", start_idx=4, end_idx=7, edge_type="hem"),
            Edge(id="back:shoulder_left", start_idx=7, end_idx=8, edge_type="cut"),
            Edge(id="back:side_left", start_idx=8, end_idx=0, edge_type="cut"),
        ])

        sv = [[0, 0], [bw*0.85, 0], [bw, sl*0.6], [bw+2, sl], [bw/2, sl+5], [-2, sl], [0, sl*0.6]]
        sleeve_l = Panel(name="sleeve_left", vertices=copy.deepcopy(sv), edges=[
            Edge(id="sleeve_left:cuff", start_idx=0, end_idx=1, edge_type="hem"),
            Edge(id="sleeve_left:cap", start_idx=2, end_idx=6, edge_type="cut"),
        ])
        sleeve_r = Panel(name="sleeve_right", vertices=copy.deepcopy(sv), edges=[
            Edge(id="sleeve_right:cuff", start_idx=0, end_idx=1, edge_type="hem"),
            Edge(id="sleeve_right:cap", start_idx=2, end_idx=6, edge_type="cut"),
        ])

        stitches = [
            Stitch(id="shoulder_left", edge_a="front:shoulder_left", edge_b="back:shoulder_left", stitch_type="overlock", order=1),
            Stitch(id="shoulder_right", edge_a="front:shoulder_right", edge_b="back:shoulder_right", stitch_type="overlock", order=1),
            Stitch(id="sleeve_left_cap", edge_a="front:armhole_right", edge_b="sleeve_left:cap", stitch_type="overlock", order=2),
            Stitch(id="sleeve_right_cap", edge_a="back:armhole_right", edge_b="sleeve_right:cap", stitch_type="overlock", order=2),
            Stitch(id="side_left", edge_a="front:side_left", edge_b="back:side_left", stitch_type="overlock", order=3),
            Stitch(id="side_right", edge_a="front:side_right", edge_b="back:side_right", stitch_type="overlock", order=3),
        ]

        return GarmentSpec(
            metadata={"name": f"{fit.title()} T-Shirt", "garment_type": "tshirt",
                      "fabric_type": fabric_type, "color": color, "size": size, "fit": fit, "neckline": neckline},
            panels=[front, back, sleeve_l, sleeve_r], stitches=stitches, measurements=self.get_measurements(size))

    def _make_shirt(self, size="M", fit="regular", sleeve_length=None, body_length=None,
                    collar_style="point", color="#FFFFFF", fabric_type="cotton", **kw) -> GarmentSpec:
        m = self.apply_ease(self.get_measurements(size), fit)
        hc, sw, nw = m["chest"] / 2, m["shoulder_to_shoulder"] / 2, m["neck"] / (2 * math.pi) * 2
        sl = sleeve_length or m["shoulder_to_wrist"]
        bl = body_length or m["back_length"] + 8
        ad, bw, ww = m["armhole_depth"], m["bicep"] / 2 + 2, m["wrist"] / 2 + 1.5

        front_left = Panel(name="front_left", vertices=[
            [0, 0], [hc/2+2, 0], [hc/2+2, bl-ad], [sw/2+2, bl], [hc/4+2, bl+1], [2, bl-2], [0, bl-ad],
        ], edges=[
            Edge(id="front_left:hem", start_idx=0, end_idx=1, edge_type="hem"),
            Edge(id="front_left:side", start_idx=1, end_idx=2, edge_type="cut"),
            Edge(id="front_left:armhole", start_idx=2, end_idx=3, edge_type="cut"),
            Edge(id="front_left:shoulder", start_idx=3, end_idx=4, edge_type="cut"),
            Edge(id="front_left:neckline", start_idx=4, end_idx=5, edge_type="cut"),
            Edge(id="front_left:placket", start_idx=5, end_idx=0, edge_type="fold"),
        ])

        fr_v = [[-v[0]+hc, v[1]] for v in front_left.vertices]
        front_right = Panel(name="front_right", vertices=fr_v, edges=[
            Edge(id="front_right:hem", start_idx=0, end_idx=1, edge_type="hem"),
            Edge(id="front_right:placket", start_idx=1, end_idx=2, edge_type="fold"),
            Edge(id="front_right:neckline", start_idx=2, end_idx=3, edge_type="cut"),
            Edge(id="front_right:shoulder", start_idx=3, end_idx=4, edge_type="cut"),
            Edge(id="front_right:armhole", start_idx=4, end_idx=5, edge_type="cut"),
            Edge(id="front_right:side", start_idx=5, end_idx=0, edge_type="cut"),
        ])

        back = Panel(name="back", vertices=[
            [0, 0], [hc, 0], [hc, bl-ad], [sw, bl], [hc-sw, bl], [0, bl-ad],
        ], edges=[
            Edge(id="back:hem", start_idx=0, end_idx=1, edge_type="hem"),
            Edge(id="back:side_right", start_idx=1, end_idx=2, edge_type="cut"),
            Edge(id="back:armhole_right", start_idx=2, end_idx=3, edge_type="cut"),
            Edge(id="back:shoulder_right", start_idx=3, end_idx=4, edge_type="cut"),
            Edge(id="back:shoulder_left", start_idx=4, end_idx=5, edge_type="cut"),
            Edge(id="back:side_left", start_idx=5, end_idx=0, edge_type="cut"),
        ])

        sv = [[0, 0], [ww, 0], [bw, sl*0.7], [bw+2, sl], [bw/2, sl+6], [-2, sl], [0, sl*0.7]]
        sleeve_l = Panel(name="sleeve_left", vertices=copy.deepcopy(sv), edges=[
            Edge(id="sleeve_left:cuff", start_idx=0, end_idx=1, edge_type="hem"),
            Edge(id="sleeve_left:cap", start_idx=2, end_idx=6, edge_type="cut"),
        ])
        sleeve_r = Panel(name="sleeve_right", vertices=copy.deepcopy(sv), edges=[
            Edge(id="sleeve_right:cuff", start_idx=0, end_idx=1, edge_type="hem"),
            Edge(id="sleeve_right:cap", start_idx=2, end_idx=6, edge_type="cut"),
        ])

        collar_len = m["neck"] + 2
        ch = 4 if collar_style == "point" else 3
        collar = Panel(name="collar", vertices=[[0, 0], [collar_len, 0], [collar_len-1, ch], [1, ch]], edges=[
            Edge(id="collar:neckband", start_idx=0, end_idx=1, edge_type="cut"),
            Edge(id="collar:fold", start_idx=2, end_idx=3, edge_type="fold"),
        ])

        stitches = [
            Stitch(id="shoulder_left", edge_a="front_left:shoulder", edge_b="back:shoulder_left", order=1),
            Stitch(id="shoulder_right", edge_a="front_right:shoulder", edge_b="back:shoulder_right", order=1),
            Stitch(id="collar_attach", edge_a="collar:neckband", edge_b="back:shoulder_right", stitch_type="topstitch", order=2),
            Stitch(id="sleeve_left_set", edge_a="sleeve_left:cap", edge_b="front_left:armhole", order=3),
            Stitch(id="sleeve_right_set", edge_a="sleeve_right:cap", edge_b="front_right:armhole", order=3),
            Stitch(id="side_left", edge_a="front_left:side", edge_b="back:side_left", order=4),
            Stitch(id="side_right", edge_a="front_right:side", edge_b="back:side_right", order=4),
        ]

        return GarmentSpec(
            metadata={"name": f"{fit.title()} {collar_style.title()} Collar Shirt", "garment_type": "shirt",
                      "fabric_type": fabric_type, "color": color, "size": size, "fit": fit, "collar_style": collar_style},
            panels=[front_left, front_right, back, sleeve_l, sleeve_r, collar], stitches=stitches,
            measurements=self.get_measurements(size))

    def _make_blazer(self, size="M", fit="regular", lapel_style="notch", body_length=None,
                     color="#1a1a2e", fabric_type="wool", double_breasted=False, **kw) -> GarmentSpec:
        m = self.apply_ease(self.get_measurements(size), fit)
        hc, sw = m["chest"] / 2, m["shoulder_to_shoulder"] / 2 + 1
        bl = body_length or m["back_length"] + 12
        ad = m["armhole_depth"] + 1
        overlap = 5 if double_breasted else 2.5
        lw = 8 if lapel_style == "peak" else 6

        front_left = Panel(name="front_left", vertices=[
            [0, 0], [hc/2+overlap, 0], [hc/2+overlap, bl*0.6], [hc/2+overlap, bl-ad],
            [sw/2+1, bl+1], [sw/2-4, bl+1],
            [overlap+lw, bl+4] if lapel_style == "peak" else [overlap+lw, bl+2],
            [overlap, bl-5], [0, bl-ad],
        ], edges=[
            Edge(id="front_left:hem", start_idx=0, end_idx=1, edge_type="hem"),
            Edge(id="front_left:side", start_idx=2, end_idx=3, edge_type="cut"),
            Edge(id="front_left:armhole", start_idx=3, end_idx=4, edge_type="cut"),
            Edge(id="front_left:shoulder", start_idx=4, end_idx=5, edge_type="cut"),
            Edge(id="front_left:lapel", start_idx=5, end_idx=7, edge_type="fold"),
        ], fabric_layer=2)

        fr_v = [[-v[0]+hc, v[1]] for v in front_left.vertices]
        front_right = Panel(name="front_right", vertices=fr_v, edges=[
            Edge(id="front_right:hem", start_idx=0, end_idx=1, edge_type="hem"),
            Edge(id="front_right:side", start_idx=2, end_idx=3, edge_type="cut"),
            Edge(id="front_right:armhole", start_idx=3, end_idx=4, edge_type="cut"),
            Edge(id="front_right:shoulder", start_idx=4, end_idx=5, edge_type="cut"),
            Edge(id="front_right:lapel", start_idx=5, end_idx=7, edge_type="fold"),
        ], fabric_layer=2)

        back = Panel(name="back", vertices=[
            [0, 0], [hc, 0], [hc, bl-ad], [sw, bl+1], [hc-sw, bl+1], [0, bl-ad],
        ], edges=[
            Edge(id="back:hem", start_idx=0, end_idx=1, edge_type="hem"),
            Edge(id="back:side_right", start_idx=1, end_idx=2, edge_type="cut"),
            Edge(id="back:armhole_right", start_idx=2, end_idx=3, edge_type="cut"),
            Edge(id="back:shoulder_right", start_idx=3, end_idx=4, edge_type="cut"),
            Edge(id="back:shoulder_left", start_idx=4, end_idx=5, edge_type="cut"),
            Edge(id="back:side_left", start_idx=5, end_idx=0, edge_type="cut"),
        ])

        sl, bw, ww = m["shoulder_to_wrist"], m["bicep"]/2+3, m["wrist"]/2+2
        sv = [[0, 0], [ww, 0], [bw, sl*0.7], [bw+3, sl], [bw/2, sl+7], [-3, sl], [0, sl*0.7]]
        sleeve_l = Panel(name="sleeve_left", vertices=copy.deepcopy(sv), edges=[
            Edge(id="sleeve_left:cuff", start_idx=0, end_idx=1, edge_type="hem"),
            Edge(id="sleeve_left:cap", start_idx=2, end_idx=6, edge_type="cut"),
        ])
        sleeve_r = Panel(name="sleeve_right", vertices=copy.deepcopy(sv), edges=[
            Edge(id="sleeve_right:cuff", start_idx=0, end_idx=1, edge_type="hem"),
            Edge(id="sleeve_right:cap", start_idx=2, end_idx=6, edge_type="cut"),
        ])

        stitches = [
            Stitch(id="shoulder_left", edge_a="front_left:shoulder", edge_b="back:shoulder_left", order=1),
            Stitch(id="shoulder_right", edge_a="front_right:shoulder", edge_b="back:shoulder_right", order=1),
            Stitch(id="sleeve_left_set", edge_a="sleeve_left:cap", edge_b="front_left:armhole", order=2),
            Stitch(id="sleeve_right_set", edge_a="sleeve_right:cap", edge_b="front_right:armhole", order=2),
            Stitch(id="side_left", edge_a="front_left:side", edge_b="back:side_left", order=3),
            Stitch(id="side_right", edge_a="front_right:side", edge_b="back:side_right", order=3),
        ]

        name = f"{'Double-Breasted ' if double_breasted else ''}{lapel_style.title()} Lapel Blazer"
        return GarmentSpec(
            metadata={"name": name, "garment_type": "blazer", "fabric_type": fabric_type, "color": color,
                      "size": size, "fit": fit, "lapel_style": lapel_style, "double_breasted": double_breasted},
            panels=[front_left, front_right, back, sleeve_l, sleeve_r], stitches=stitches,
            measurements=self.get_measurements(size))

    def _make_pants(self, size="M", fit="regular", length=None, color="#1a1a2e",
                    fabric_type="cotton", style="straight", **kw) -> GarmentSpec:
        m = self.apply_ease(self.get_measurements(size), fit)
        tw, kw_m = m["thigh"]/2, m["knee"]/2
        inseam = length or m["inseam"]
        rise = m["waist_to_hip"] + 5
        crotch_ext = tw * 0.3
        taper = {"skinny": 0.6, "slim": 0.75, "straight": 0.9, "wide": 1.2, "bootcut": 1.0}
        aw = kw_m * taper.get(style, 0.9)

        fv = [[0, 0], [aw, 0], [kw_m, inseam*0.45], [tw+crotch_ext, inseam],
              [tw, inseam+rise], [0, inseam+rise], [0, inseam*0.45]]
        front_left = Panel(name="front_left", vertices=fv, edges=[
            Edge(id="front_left:ankle", start_idx=0, end_idx=1, edge_type="hem"),
            Edge(id="front_left:inseam", start_idx=1, end_idx=3, edge_type="cut"),
            Edge(id="front_left:crotch", start_idx=3, end_idx=4, edge_type="cut"),
            Edge(id="front_left:waistband", start_idx=4, end_idx=5, edge_type="cut"),
            Edge(id="front_left:outseam", start_idx=5, end_idx=0, edge_type="cut"),
        ])

        bv = copy.deepcopy(fv)
        bv[3] = [tw + crotch_ext * 1.5, inseam]
        back_left = Panel(name="back_left", vertices=bv, edges=[
            Edge(id="back_left:ankle", start_idx=0, end_idx=1, edge_type="hem"),
            Edge(id="back_left:inseam", start_idx=1, end_idx=3, edge_type="cut"),
            Edge(id="back_left:crotch", start_idx=3, end_idx=4, edge_type="cut"),
            Edge(id="back_left:waistband", start_idx=4, end_idx=5, edge_type="cut"),
            Edge(id="back_left:outseam", start_idx=5, end_idx=0, edge_type="cut"),
        ])

        fr_v = [[-v[0]+tw+crotch_ext+5, v[1]] for v in fv]
        front_right = Panel(name="front_right", vertices=fr_v, edges=[
            Edge(id="front_right:ankle", start_idx=0, end_idx=1, edge_type="hem"),
            Edge(id="front_right:inseam", start_idx=1, end_idx=3, edge_type="cut"),
            Edge(id="front_right:waistband", start_idx=4, end_idx=5, edge_type="cut"),
            Edge(id="front_right:outseam", start_idx=5, end_idx=0, edge_type="cut"),
        ])

        br_v = [[-v[0]+tw+crotch_ext*1.5+5, v[1]] for v in bv]
        back_right = Panel(name="back_right", vertices=br_v, edges=[
            Edge(id="back_right:ankle", start_idx=0, end_idx=1, edge_type="hem"),
            Edge(id="back_right:inseam", start_idx=1, end_idx=3, edge_type="cut"),
            Edge(id="back_right:waistband", start_idx=4, end_idx=5, edge_type="cut"),
            Edge(id="back_right:outseam", start_idx=5, end_idx=0, edge_type="cut"),
        ])

        wb = Panel(name="waistband", vertices=[[0, 0], [m["waist"]+4, 0], [m["waist"]+4, 4], [0, 4]], edges=[
            Edge(id="waistband:top", start_idx=2, end_idx=3, edge_type="fold"),
            Edge(id="waistband:bottom", start_idx=0, end_idx=1, edge_type="cut"),
        ])

        stitches = [
            Stitch(id="outseam_left", edge_a="front_left:outseam", edge_b="back_left:outseam", order=1),
            Stitch(id="outseam_right", edge_a="front_right:outseam", edge_b="back_right:outseam", order=1),
            Stitch(id="inseam_left", edge_a="front_left:inseam", edge_b="back_left:inseam", order=2),
            Stitch(id="inseam_right", edge_a="front_right:inseam", edge_b="back_right:inseam", order=2),
            Stitch(id="crotch", edge_a="front_left:crotch", edge_b="front_right:crotch", order=3),
        ]

        return GarmentSpec(
            metadata={"name": f"{style.title()} {fabric_type.title()} Pants", "garment_type": "pants",
                      "fabric_type": fabric_type, "color": color, "size": size, "fit": fit, "style": style},
            panels=[front_left, front_right, back_left, back_right, wb], stitches=stitches,
            measurements=self.get_measurements(size))

    def _make_skirt(self, size="M", fit="regular", length=None, color="#800020",
                    fabric_type="cotton", style="a_line", **kw) -> GarmentSpec:
        m = self.apply_ease(self.get_measurements(size), fit)
        hw, hh = m["waist"]/2, m["hips"]/2
        sl = length or m.get("waist_to_knee", 55)
        flare = {"pencil": 0, "a_line": 15, "circle": 40, "straight": 5}.get(style, 10)

        fv = [[0, 0], [hh+flare, 0], [hh, m["waist_to_hip"]], [hw, sl], [0, sl]]
        front = Panel(name="front", vertices=fv, edges=[
            Edge(id="front:hem", start_idx=0, end_idx=1, edge_type="hem"),
            Edge(id="front:side_right", start_idx=1, end_idx=2, edge_type="cut"),
            Edge(id="front:waist", start_idx=3, end_idx=4, edge_type="cut"),
            Edge(id="front:side_left", start_idx=4, end_idx=0, edge_type="cut"),
        ])
        back = Panel(name="back", vertices=copy.deepcopy(fv), edges=[
            Edge(id="back:hem", start_idx=0, end_idx=1, edge_type="hem"),
            Edge(id="back:side_right", start_idx=1, end_idx=2, edge_type="cut"),
            Edge(id="back:waist", start_idx=3, end_idx=4, edge_type="cut"),
            Edge(id="back:side_left", start_idx=4, end_idx=0, edge_type="cut"),
        ])
        wb = Panel(name="waistband", vertices=[[0, 0], [m["waist"]+2, 0], [m["waist"]+2, 3.5], [0, 3.5]], edges=[
            Edge(id="waistband:top", start_idx=2, end_idx=3, edge_type="fold"),
            Edge(id="waistband:bottom", start_idx=0, end_idx=1, edge_type="cut"),
        ])
        stitches = [
            Stitch(id="side_left", edge_a="front:side_left", edge_b="back:side_left", order=1),
            Stitch(id="side_right", edge_a="front:side_right", edge_b="back:side_right", order=1),
        ]
        return GarmentSpec(
            metadata={"name": f"{style.replace('_',' ').title()} Skirt", "garment_type": "skirt",
                      "fabric_type": fabric_type, "color": color, "size": size, "fit": fit, "style": style},
            panels=[front, back, wb], stitches=stitches, measurements=self.get_measurements(size))

    def _make_dress(self, size="M", fit="regular", length=None, color="#800020",
                    fabric_type="cotton", sleeve_length=0, neckline="v_neck", **kw) -> GarmentSpec:
        m = self.apply_ease(self.get_measurements(size), fit)
        hc, hw, hh = m["chest"]/2, m["waist"]/2, m["hips"]/2
        sw, bl, ad = m["shoulder_to_shoulder"]/2, m["back_length"], m["armhole_depth"]
        dl = length or m.get("waist_to_knee", 55) + bl

        front = Panel(name="front", vertices=[
            [0, 0], [hh+10, 0], [hc, dl-bl], [hc, dl-ad], [sw, dl],
            [hc/2, dl-3], [hc-sw, dl], [0, dl-ad], [0, dl-bl],
        ], edges=[
            Edge(id="front:hem", start_idx=0, end_idx=1, edge_type="hem"),
            Edge(id="front:side_right", start_idx=1, end_idx=3, edge_type="cut"),
            Edge(id="front:armhole_right", start_idx=3, end_idx=4, edge_type="cut"),
            Edge(id="front:shoulder_right", start_idx=4, end_idx=5, edge_type="cut"),
            Edge(id="front:neckline", start_idx=5, end_idx=6, edge_type="hem"),
            Edge(id="front:shoulder_left", start_idx=6, end_idx=7, edge_type="cut"),
            Edge(id="front:side_left", start_idx=7, end_idx=0, edge_type="cut"),
        ])

        bv = [[0, 0], [hh+10, 0], [hc, dl-bl], [hc, dl-ad], [sw, dl],
              [hc/2, dl-1], [hc-sw, dl], [0, dl-ad], [0, dl-bl]]
        back = Panel(name="back", vertices=bv, edges=[
            Edge(id="back:hem", start_idx=0, end_idx=1, edge_type="hem"),
            Edge(id="back:side_right", start_idx=1, end_idx=3, edge_type="cut"),
            Edge(id="back:shoulder_right", start_idx=4, end_idx=5, edge_type="cut"),
            Edge(id="back:neckline", start_idx=5, end_idx=6, edge_type="hem"),
            Edge(id="back:shoulder_left", start_idx=6, end_idx=7, edge_type="cut"),
            Edge(id="back:side_left", start_idx=7, end_idx=0, edge_type="cut"),
        ])

        stitches = [
            Stitch(id="shoulder_left", edge_a="front:shoulder_left", edge_b="back:shoulder_left", order=1),
            Stitch(id="shoulder_right", edge_a="front:shoulder_right", edge_b="back:shoulder_right", order=1),
            Stitch(id="side_left", edge_a="front:side_left", edge_b="back:side_left", order=2),
            Stitch(id="side_right", edge_a="front:side_right", edge_b="back:side_right", order=2),
        ]
        return GarmentSpec(
            metadata={"name": f"{neckline.replace('_',' ').title()} Dress", "garment_type": "dress",
                      "fabric_type": fabric_type, "color": color, "size": size, "fit": fit, "neckline": neckline},
            panels=[front, back], stitches=stitches, measurements=self.get_measurements(size))

    def _make_hoodie(self, size="M", fit="relaxed", color="#333333", fabric_type="jersey", **kw) -> GarmentSpec:
        spec = self._make_tshirt(size=size, fit=fit, sleeve_length=kw.get("sleeve_length"),
                                 body_length=kw.get("body_length"), color=color, fabric_type=fabric_type)
        spec.metadata.update({"name": "Hoodie", "garment_type": "hoodie"})
        m = self.apply_ease(self.get_measurements(size), fit)
        hood_w = 30
        hood = Panel(name="hood", vertices=[[0, 0], [hood_w, 0], [hood_w+5, 24], [hood_w, 35], [0, 35]], edges=[
            Edge(id="hood:neckline", start_idx=0, end_idx=1, edge_type="cut"),
            Edge(id="hood:back", start_idx=1, end_idx=4, edge_type="cut"),
            Edge(id="hood:face", start_idx=4, end_idx=0, edge_type="hem"),
        ])
        spec.panels.append(hood)
        spec.stitches.append(Stitch(id="hood_attach", edge_a="hood:neckline", edge_b="front:neckline", order=5))
        pocket_w = m["chest"] * 0.4
        pocket = Panel(name="kangaroo_pocket", vertices=[[0, 0], [pocket_w, 0], [pocket_w, 18], [0, 18]], edges=[
            Edge(id="kangaroo_pocket:opening", start_idx=2, end_idx=3, edge_type="hem"),
        ])
        spec.panels.append(pocket)
        return spec

    def _make_tank_top(self, size="M", fit="slim", color="#FFFFFF", fabric_type="jersey", **kw) -> GarmentSpec:
        m = self.apply_ease(self.get_measurements(size), fit)
        hc, bl, sw = m["chest"]/2, m["back_length"]+3, 3

        front = Panel(name="front", vertices=[
            [0, 0], [hc, 0], [hc, bl*0.4], [hc-sw, bl], [hc/2, bl-5], [sw, bl], [0, bl*0.4],
        ], edges=[
            Edge(id="front:hem", start_idx=0, end_idx=1, edge_type="hem"),
            Edge(id="front:side_right", start_idx=1, end_idx=2, edge_type="cut"),
            Edge(id="front:strap_right", start_idx=2, end_idx=3, edge_type="cut"),
            Edge(id="front:neckline", start_idx=3, end_idx=5, edge_type="hem"),
            Edge(id="front:strap_left", start_idx=5, end_idx=6, edge_type="cut"),
            Edge(id="front:side_left", start_idx=6, end_idx=0, edge_type="cut"),
        ])

        bv = copy.deepcopy(front.vertices)
        bv[4] = [hc/2, bl-2]
        back = Panel(name="back", vertices=bv, edges=[
            Edge(id="back:hem", start_idx=0, end_idx=1, edge_type="hem"),
            Edge(id="back:side_right", start_idx=1, end_idx=2, edge_type="cut"),
            Edge(id="back:strap_right", start_idx=2, end_idx=3, edge_type="cut"),
            Edge(id="back:neckline", start_idx=3, end_idx=5, edge_type="hem"),
            Edge(id="back:strap_left", start_idx=5, end_idx=6, edge_type="cut"),
            Edge(id="back:side_left", start_idx=6, end_idx=0, edge_type="cut"),
        ])

        stitches = [
            Stitch(id="strap_left", edge_a="front:strap_left", edge_b="back:strap_left", order=1),
            Stitch(id="strap_right", edge_a="front:strap_right", edge_b="back:strap_right", order=1),
            Stitch(id="side_left", edge_a="front:side_left", edge_b="back:side_left", order=2),
            Stitch(id="side_right", edge_a="front:side_right", edge_b="back:side_right", order=2),
        ]
        return GarmentSpec(
            metadata={"name": "Tank Top", "garment_type": "tank_top", "fabric_type": fabric_type,
                      "color": color, "size": size, "fit": fit},
            panels=[front, back], stitches=stitches, measurements=self.get_measurements(size))


# ══════════════════════════════════════════════════════════════
# LLM System Prompt for parameter parsing
# ══════════════════════════════════════════════════════════════

LLM_SYSTEM_PROMPT = """You are a fashion pattern engineering AI. Parse the user's garment description into structured parameters for our GarmentFactory.

Return ONLY a JSON object with these fields:
{
  "garment_type": "tshirt|shirt|blazer|pants|skirt|dress|hoodie|tank_top",
  "size": "XS|S|M|L|XL",
  "fit": "skin_tight|slim|regular|relaxed|oversized",
  "fabric_type": "cotton|silk|denim|wool|linen|leather|chiffon|velvet|jersey|satin|tweed|polyester",
  "color": "#hex color code",
  "sleeve_length": null or number in cm,
  "body_length": null or number in cm,
  "neckline": "crew|v_neck|scoop|boat|turtleneck|point|mandarin",
  "collar_style": "point|spread|button_down|mandarin|band",
  "lapel_style": "notch|peak|shawl",
  "double_breasted": false,
  "style": "straight|slim|skinny|wide|bootcut|a_line|pencil|circle",
  "length": null or number in cm for pants/skirts
}

Only include fields relevant to the garment type. Infer reasonable defaults.
Examples:
- "Navy wool double-breasted blazer with peak lapels" -> {"garment_type":"blazer","fabric_type":"wool","color":"#1B2951","lapel_style":"peak","double_breasted":true,"fit":"regular"}
- "Slim-fit white cotton shirt" -> {"garment_type":"shirt","fabric_type":"cotton","color":"#FFFFFF","fit":"slim"}
- "Black leather skinny pants" -> {"garment_type":"pants","fabric_type":"leather","color":"#000000","style":"skinny","fit":"slim"}
"""


if __name__ == "__main__":
    factory = GarmentFactory()
    for gtype in ["tshirt", "shirt", "blazer", "pants", "skirt", "dress", "hoodie", "tank_top"]:
        spec = factory.create(gtype)
        d = spec.to_dict()
        print(f"\n{'='*60}")
        print(f"{d['metadata']['name']} ({gtype})")
        print(f"  Panels: {len(d['panels'])} | Stitches: {len(d['stitches'])}")
        for p in d['panels']:
            print(f"    {p['name']}: {p['width_cm']}x{p['height_cm']}cm, {len(p['vertices'])}v, {len(p['edges'])}e")
        for s in d['stitches']:
            print(f"    Stitch: {s['id']} ({s['edge_a']} <-> {s['edge_b']})")
