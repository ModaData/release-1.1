"""
GarmentSchema — Pydantic models that define the strict contract between
GPT-4 natural language parsing and the Blender parametric engine.

GPT-4 receives a user prompt and MUST return JSON that validates against GarmentSpec.
The Blender bridge reads GarmentSpec and updates Geometry Node inputs accordingly.
"""

from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field


# ── Enums: constrained vocabulary for garment attributes ──

class GarmentType(str, Enum):
    blazer = "blazer"
    jacket = "jacket"
    coat = "coat"
    vest = "vest"
    shirt = "shirt"
    blouse = "blouse"
    tshirt = "tshirt"
    hoodie = "hoodie"
    sweater = "sweater"
    dress = "dress"
    skirt = "skirt"
    pants = "pants"
    shorts = "shorts"
    jumpsuit = "jumpsuit"


class FabricType(str, Enum):
    cotton = "cotton"
    silk = "silk"
    wool = "wool"
    linen = "linen"
    denim = "denim"
    leather = "leather"
    velvet = "velvet"
    chiffon = "chiffon"
    satin = "satin"
    tweed = "tweed"
    jersey = "jersey"
    nylon = "nylon"
    polyester = "polyester"
    spandex = "spandex"


class FitType(str, Enum):
    slim = "slim"
    regular = "regular"
    relaxed = "relaxed"
    oversized = "oversized"


class LapelStyle(str, Enum):
    notch = "notch"
    peak = "peak"
    shawl = "shawl"
    none = "none"


class CollarStyle(str, Enum):
    pointed = "pointed"
    spread = "spread"
    button_down = "button_down"
    mandarin = "mandarin"
    band = "band"
    peter_pan = "peter_pan"
    turtleneck = "turtleneck"
    crew = "crew"
    v_neck = "v_neck"
    scoop = "scoop"
    none = "none"


class ClosureType(str, Enum):
    single_breasted = "single_breasted"
    double_breasted = "double_breasted"
    zipper = "zipper"
    wrap = "wrap"
    pullover = "pullover"
    snap = "snap"
    toggle = "toggle"
    open_front = "open_front"


class SleeveStyle(str, Enum):
    set_in = "set_in"
    raglan = "raglan"
    kimono = "kimono"
    dolman = "dolman"
    bell = "bell"
    puff = "puff"
    bishop = "bishop"
    cap = "cap"


class ConstructionDetail(str, Enum):
    darts = "darts"
    pleats = "pleats"
    gathers = "gathers"
    pintucks = "pintucks"
    seam_pockets = "seam_pockets"
    patch_pockets = "patch_pockets"
    welt_pockets = "welt_pockets"
    flap_pockets = "flap_pockets"
    vents = "vents"
    kick_pleat = "kick_pleat"
    yoke = "yoke"
    princess_seams = "princess_seams"
    side_slits = "side_slits"
    hem_band = "hem_band"
    cuffs = "cuffs"
    belt_loops = "belt_loops"
    drawstring = "drawstring"
    elastic_waist = "elastic_waist"


class HemStyle(str, Enum):
    straight = "straight"
    curved = "curved"
    high_low = "high_low"
    asymmetric = "asymmetric"
    raw_edge = "raw_edge"
    rolled = "rolled"


# ── Main Schema ──

class GarmentSpec(BaseModel):
    """
    The complete specification for a parametric garment.
    GPT-4 fills this from natural language; Blender reads it to drive Geometry Nodes.
    """

    # Core identity
    garment_type: GarmentType = Field(description="The base garment category")
    name: str = Field(default="", description="Optional descriptive name, e.g. 'Navy Double-Breasted Blazer'")

    # Dimensions (normalized 0.0-1.0 where applicable)
    sleeve_length: float = Field(default=1.0, ge=0.0, le=1.0,
        description="0.0=sleeveless, 0.25=cap, 0.5=elbow, 0.75=3/4, 1.0=full wrist")
    body_length: float = Field(default=0.7, ge=0.0, le=1.0,
        description="0.0=cropped, 0.5=waist, 0.7=hip, 1.0=full length/maxi")
    shoulder_width: float = Field(default=0.5, ge=0.0, le=1.0,
        description="0.0=narrow/dropped, 0.5=natural, 1.0=extended/padded")

    # Style details
    fit: FitType = Field(default=FitType.regular)
    lapel_style: LapelStyle = Field(default=LapelStyle.none)
    collar_style: CollarStyle = Field(default=CollarStyle.none)
    closure: ClosureType = Field(default=ClosureType.pullover)
    sleeve_style: SleeveStyle = Field(default=SleeveStyle.set_in)
    hem_style: HemStyle = Field(default=HemStyle.straight)
    button_count: int = Field(default=0, ge=0, le=12)

    # Construction
    construction_details: list[ConstructionDetail] = Field(default_factory=list)

    # Material
    fabric_type: FabricType = Field(default=FabricType.cotton)
    color_hex: str = Field(default="#333333",
        description="Primary color as hex, e.g. '#000080' for navy")
    color_name: str = Field(default="charcoal",
        description="Human-readable color name for display")
    pattern: str = Field(default="solid",
        description="Surface pattern: solid, striped, plaid, houndstooth, floral, etc.")

    # Sizing reference (used to scale the parametric model)
    size_label: str = Field(default="M",
        description="Size label: XS, S, M, L, XL, XXL, or numeric")


class GarmentEdit(BaseModel):
    """
    Represents a single edit operation from conversational refinement.
    The Orchestrator diffs this against the current GarmentSpec.
    """
    instruction: str = Field(description="The user's natural language edit request")
    field_changes: dict = Field(default_factory=dict,
        description="Map of GarmentSpec field names to new values")


class GarmentState(BaseModel):
    """
    The full state of a garment design session.
    Maintained by the Orchestrator across conversational turns.
    """
    spec: GarmentSpec
    history: list[GarmentEdit] = Field(default_factory=list,
        description="Ordered list of edits applied to the spec")
    glb_url: Optional[str] = Field(default=None,
        description="URL/path of the latest generated GLB")
    template_used: Optional[str] = Field(default=None,
        description="Which .blend template was used for generation")


# ── GPT-4 System Prompt ──

GARMENT_SYSTEM_PROMPT = """You are a fashion design AI assistant. When the user describes a garment, you MUST respond with a valid JSON object matching the GarmentSpec schema.

Available fields and their types:
- garment_type: one of [blazer, jacket, coat, vest, shirt, blouse, tshirt, hoodie, sweater, dress, skirt, pants, shorts, jumpsuit]
- name: descriptive name string
- sleeve_length: float 0.0-1.0 (0=sleeveless, 0.5=elbow, 1.0=full)
- body_length: float 0.0-1.0 (0=cropped, 0.5=waist, 0.7=hip, 1.0=maxi)
- shoulder_width: float 0.0-1.0 (0=narrow, 0.5=natural, 1.0=extended)
- fit: one of [slim, regular, relaxed, oversized]
- lapel_style: one of [notch, peak, shawl, none]
- collar_style: one of [pointed, spread, button_down, mandarin, band, peter_pan, turtleneck, crew, v_neck, scoop, none]
- closure: one of [single_breasted, double_breasted, zipper, wrap, pullover, snap, toggle, open_front]
- sleeve_style: one of [set_in, raglan, kimono, dolman, bell, puff, bishop, cap]
- hem_style: one of [straight, curved, high_low, asymmetric, raw_edge, rolled]
- button_count: integer 0-12
- construction_details: list of [darts, pleats, gathers, pintucks, seam_pockets, patch_pockets, welt_pockets, flap_pockets, vents, kick_pleat, yoke, princess_seams, side_slits, hem_band, cuffs, belt_loops, drawstring, elastic_waist]
- fabric_type: one of [cotton, silk, wool, linen, denim, leather, velvet, chiffon, satin, tweed, jersey, nylon, polyester, spandex]
- color_hex: hex color string (e.g. "#000080")
- color_name: human readable color name
- pattern: surface pattern (solid, striped, plaid, houndstooth, floral, etc.)
- size_label: XS/S/M/L/XL/XXL

RULES:
1. Always respond with ONLY valid JSON. No markdown, no explanation.
2. Fill in reasonable defaults for any unspecified fields.
3. If the user describes a modification to an existing garment, return the COMPLETE updated spec (not just changed fields).
4. Map vague terms to specific values: "long sleeves" → sleeve_length: 1.0, "knee-length" → body_length: 0.6
5. For colors, always provide both color_hex and color_name.
"""

GARMENT_EDIT_PROMPT = """You are modifying an existing garment design. The current specification is:

{current_spec}

The user wants to make this change: "{user_instruction}"

Return the COMPLETE updated GarmentSpec as JSON, with the requested modifications applied.
Only change the fields that the user's instruction affects. Keep everything else the same.
Respond with ONLY valid JSON, no markdown or explanation."""
