# File: blender-backend/scripts/naming_convention.py
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
        make_name("collar", variant="mandarin")       → "garment_collar_mandarin"
        make_name("cuff", "left", "french")            → "garment_cuff_french_left"
        make_name("body", "full", "shirt")             → "garment_body_shirt_full"
        make_name("pocket", "chest", "patch")          → "garment_pocket_patch_chest"
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
          → {"part_type": "collar", "detail": "mandarin", "full_name": "garment_collar_mandarin"}
        parse_name("Cube.001")
          → None
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
