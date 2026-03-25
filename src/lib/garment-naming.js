// File: lib/garment-naming.js
// JavaScript mirror of blender-backend/scripts/naming_convention.py
// Parses GLB node names into structured garment part metadata for Three.js interaction.

export const PART_PREFIX = "garment";

/**
 * Human-readable display names for each garment part type.
 */
export const PART_DISPLAY_NAMES = {
  body: "Body",
  collar: "Collar",
  cuff: "Cuff",
  sleeve: "Sleeve",
  pocket: "Pocket",
  placket: "Placket",
  button: "Button",
  hood: "Hood",
  waistband: "Waistband",
  hem: "Hem",
  yoke: "Yoke",
  dart: "Dart",
  belt_loop: "Belt Loop",
  zipper: "Zipper",
  lining: "Lining",
};

/**
 * Variant display names for detailed tooltips.
 */
export const VARIANT_DISPLAY_NAMES = {
  mandarin: "Mandarin",
  spread: "Spread",
  button_down: "Button Down",
  peter_pan: "Peter Pan",
  band: "Band",
  shawl: "Shawl",
  polo: "Polo",
  crew: "Crew Neck",
  v_neck: "V-Neck",
  french: "French",
  barrel: "Barrel",
  ribbed: "Ribbed",
  elastic: "Elastic",
  long: "Long",
  short: "Short",
  three_quarter: "Three Quarter",
  cap: "Cap",
  raglan: "Raglan",
  bell: "Bell",
  puff: "Puff",
  patch: "Patch",
  welt: "Welt",
  flap: "Flap",
  kangaroo: "Kangaroo",
};

/**
 * Parse a GLB node name into structured garment part metadata.
 *
 * @param {string} nodeName - e.g. "garment_collar_mandarin" or "garment_cuff_french_left"
 * @returns {{ partType: string, detail: string, displayName: string, fullName: string } | null}
 */
export function parsePartName(nodeName) {
  if (!nodeName || !nodeName.startsWith(PART_PREFIX + "_")) return null;

  const tokens = nodeName.split("_");
  if (tokens.length < 2) return null;

  const partType = tokens[1];
  const detail = tokens.slice(2).join("_");

  // Build human-readable display name
  const baseName = PART_DISPLAY_NAMES[partType] || partType;
  let displayName = baseName;

  if (detail) {
    // Try to make a nice display name from the detail tokens
    const detailParts = detail.split("_");
    const prettyDetail = detailParts
      .map((d) => VARIANT_DISPLAY_NAMES[d] || d.charAt(0).toUpperCase() + d.slice(1))
      .join(" ");
    displayName = `${baseName} — ${prettyDetail}`;
  }

  return {
    partType,
    detail,
    displayName,
    fullName: nodeName,
  };
}

/**
 * Check if a node name follows the garment naming convention.
 * @param {string} nodeName
 * @returns {boolean}
 */
export function isGarmentPart(nodeName) {
  return Boolean(nodeName && nodeName.startsWith(PART_PREFIX + "_"));
}

/**
 * Get all unique part types from a list of node names.
 * @param {string[]} nodeNames
 * @returns {string[]}
 */
export function getPartTypes(nodeNames) {
  const types = new Set();
  for (const name of nodeNames) {
    const parsed = parsePartName(name);
    if (parsed) types.add(parsed.partType);
  }
  return Array.from(types);
}
