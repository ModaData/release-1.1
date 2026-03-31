/**
 * GarmentFactory v2 — Patterns-as-Code (JS port)
 *
 * Represents garments as structured collections of 2D panels, stitches (seam mappings),
 * and standardized measurements using Freesewing.org naming conventions.
 *
 * This is the "source of truth" — every garment can be unrolled back to 2D sewing
 * panels for manufacturing, or folded into 3D via cloth simulation.
 */

// ══════════════════════════════════════════════════════════════
// Standard body measurements in cm by size
// ══════════════════════════════════════════════════════════════

const STANDARD_MEASUREMENTS = {
  XS: {
    chest: 82, waist: 64, hips: 88, neck: 35, shoulder_to_shoulder: 38,
    shoulder_to_wrist: 58, bicep: 26, wrist: 15, back_length: 40,
    front_length: 42, inseam: 76, outseam: 102, thigh: 52, knee: 36,
    ankle: 22, waist_to_hip: 20, armhole_depth: 20, cross_front: 32, cross_back: 34,
  },
  S: {
    chest: 88, waist: 70, hips: 94, neck: 37, shoulder_to_shoulder: 40,
    shoulder_to_wrist: 60, bicep: 28, wrist: 16, back_length: 41,
    front_length: 43, inseam: 78, outseam: 104, thigh: 54, knee: 37,
    ankle: 23, waist_to_hip: 20, armhole_depth: 21, cross_front: 34, cross_back: 36,
  },
  M: {
    chest: 96, waist: 78, hips: 100, neck: 39, shoulder_to_shoulder: 43,
    shoulder_to_wrist: 62, bicep: 30, wrist: 17, back_length: 43,
    front_length: 45, inseam: 80, outseam: 106, thigh: 56, knee: 38,
    ankle: 24, waist_to_hip: 21, armhole_depth: 22, cross_front: 36, cross_back: 38,
  },
  L: {
    chest: 104, waist: 86, hips: 108, neck: 41, shoulder_to_shoulder: 46,
    shoulder_to_wrist: 64, bicep: 33, wrist: 18, back_length: 45,
    front_length: 47, inseam: 82, outseam: 108, thigh: 60, knee: 40,
    ankle: 25, waist_to_hip: 22, armhole_depth: 23, cross_front: 38, cross_back: 40,
  },
  XL: {
    chest: 112, waist: 96, hips: 116, neck: 43, shoulder_to_shoulder: 49,
    shoulder_to_wrist: 66, bicep: 36, wrist: 19, back_length: 47,
    front_length: 49, inseam: 82, outseam: 108, thigh: 64, knee: 42,
    ankle: 26, waist_to_hip: 23, armhole_depth: 24, cross_front: 40, cross_back: 42,
  },
};

const EASE_PROFILES = {
  skin_tight: { chest: 0, waist: 0, hips: 0, bicep: 0 },
  slim:       { chest: 6, waist: 4, hips: 4, bicep: 3 },
  regular:    { chest: 10, waist: 8, hips: 8, bicep: 5 },
  relaxed:    { chest: 16, waist: 14, hips: 14, bicep: 8 },
  oversized:  { chest: 24, waist: 22, hips: 22, bicep: 12 },
};

const FABRIC_PROPERTIES = {
  cotton:    { density: 0.15, stiffness: 15,  bending: 5,    friction: 0.8,  thickness: 0.0018 },
  silk:      { density: 0.08, stiffness: 5,   bending: 1,    friction: 0.3,  thickness: 0.0008 },
  denim:     { density: 0.35, stiffness: 40,  bending: 20,   friction: 0.9,  thickness: 0.0035 },
  wool:      { density: 0.25, stiffness: 20,  bending: 10,   friction: 0.7,  thickness: 0.003  },
  linen:     { density: 0.18, stiffness: 18,  bending: 8,    friction: 0.75, thickness: 0.0022 },
  leather:   { density: 0.6,  stiffness: 60,  bending: 30,   friction: 0.95, thickness: 0.005  },
  chiffon:   { density: 0.05, stiffness: 2,   bending: 0.5,  friction: 0.2,  thickness: 0.0005 },
  velvet:    { density: 0.3,  stiffness: 12,  bending: 6,    friction: 0.85, thickness: 0.004  },
  jersey:    { density: 0.12, stiffness: 8,   bending: 2,    friction: 0.5,  thickness: 0.0012 },
  satin:     { density: 0.1,  stiffness: 6,   bending: 1.5,  friction: 0.25, thickness: 0.001  },
  tweed:     { density: 0.35, stiffness: 35,  bending: 18,   friction: 0.85, thickness: 0.004  },
  polyester: { density: 0.13, stiffness: 10,  bending: 3,    friction: 0.4,  thickness: 0.0015 },
};

// ══════════════════════════════════════════════════════════════
// Helper: deep clone plain objects / arrays
// ══════════════════════════════════════════════════════════════

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ══════════════════════════════════════════════════════════════
// Helper: title-case a string
// ══════════════════════════════════════════════════════════════

function titleCase(s) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

// ══════════════════════════════════════════════════════════════
// Panel helpers — compute width/height from vertices
// ══════════════════════════════════════════════════════════════

function panelWidth(vertices) {
  const xs = vertices.map((v) => v[0]);
  return Math.round((Math.max(...xs) - Math.min(...xs)) * 10) / 10;
}

function panelHeight(vertices) {
  const ys = vertices.map((v) => v[1]);
  return Math.round((Math.max(...ys) - Math.min(...ys)) * 10) / 10;
}

// ══════════════════════════════════════════════════════════════
// Build a garment-spec plain object (mirrors GarmentSpec.to_dict)
// ══════════════════════════════════════════════════════════════

function buildSpec({ metadata, panels, stitches, measurements }) {
  return {
    metadata,
    panels: panels.map((p) => ({
      name: p.name,
      vertices: p.vertices,
      edges: p.edges.map((e) => ({
        id: e.id,
        start_idx: e.start_idx,
        end_idx: e.end_idx,
        edge_type: e.edge_type ?? "cut",
        seam_allowance: e.seam_allowance ?? 1.0,
      })),
      grain_line: p.grain_line ?? "vertical",
      mirror: p.mirror ?? false,
      fabric_layer: p.fabric_layer ?? 1,
      width_cm: panelWidth(p.vertices),
      height_cm: panelHeight(p.vertices),
    })),
    stitches: stitches.map((s) => ({
      id: s.id,
      edge_a: s.edge_a,
      edge_b: s.edge_b,
      stitch_type: s.stitch_type ?? "plain",
      order: s.order ?? 1,
    })),
    measurements,
  };
}

// ══════════════════════════════════════════════════════════════
// GarmentFactory — Parametric Template System
// ══════════════════════════════════════════════════════════════

class GarmentFactory {
  /**
   * Return base body measurements for a standard size, optionally merged
   * with custom overrides.
   */
  static getMeasurements(size = "M", custom = null) {
    const base = deepClone(
      STANDARD_MEASUREMENTS[size.toUpperCase()] ?? STANDARD_MEASUREMENTS.M
    );
    if (custom) Object.assign(base, custom);
    return base;
  }

  /**
   * Add ease values to body measurements for the chosen fit profile.
   */
  static applyEase(measurements, fit = "regular") {
    const ease = EASE_PROFILES[fit] ?? EASE_PROFILES.regular;
    const result = deepClone(measurements);
    for (const [key, easeVal] of Object.entries(ease)) {
      if (key in result) result[key] += easeVal;
    }
    return result;
  }

  /**
   * Create a garment spec from a type string and parameter object.
   *
   * @param {string} garmentType  One of: tshirt, shirt, blazer, pants, skirt,
   *                              dress, hoodie, tank_top
   * @param {object} params       Size/fit/fabric/style options
   * @returns {object}            Garment spec with metadata, panels, stitches,
   *                              measurements
   */
  create(garmentType, params = {}) {
    const key = garmentType.toLowerCase().replace(/-/g, "_").replace(/ /g, "_");
    const factoryMap = {
      tshirt:   (p) => this._makeTshirt(p),
      shirt:    (p) => this._makeShirt(p),
      blazer:   (p) => this._makeBlazer(p),
      pants:    (p) => this._makePants(p),
      skirt:    (p) => this._makeSkirt(p),
      dress:    (p) => this._makeDress(p),
      hoodie:   (p) => this._makeHoodie(p),
      tank_top: (p) => this._makeTankTop(p),
    };
    const builder = factoryMap[key] ?? factoryMap.tshirt;
    return builder(params);
  }

  // ────────────────────────────────────────────────────────────
  // T-Shirt
  // ────────────────────────────────────────────────────────────

  _makeTshirt({
    size = "M", fit = "regular", sleeve_length = null,
    body_length = null, neckline = "crew", color = "#FFFFFF",
    fabric_type = "cotton",
  } = {}) {
    const m  = GarmentFactory.applyEase(GarmentFactory.getMeasurements(size), fit);
    const hc = m.chest / 2;
    const sw = m.shoulder_to_shoulder / 2;
    const nw = (m.neck / (2 * Math.PI)) * 2;
    const sl = sleeve_length ?? m.shoulder_to_wrist * 0.35;
    const bl = body_length ?? m.back_length + 5;
    const ad = m.armhole_depth;
    const bw = m.bicep / 2 + 2;

    const front = {
      name: "front",
      vertices: [
        [0, 0], [hc, 0], [hc, bl - ad], [sw, bl],
        [sw - nw, bl], [hc / 2, bl + 1], [nw, bl],
        [hc - sw, bl], [0, bl - ad],
      ],
      edges: [
        { id: "front:hem",            start_idx: 0, end_idx: 1, edge_type: "hem" },
        { id: "front:side_right",     start_idx: 1, end_idx: 2, edge_type: "cut" },
        { id: "front:armhole_right",  start_idx: 2, end_idx: 3, edge_type: "cut" },
        { id: "front:shoulder_right", start_idx: 3, end_idx: 4, edge_type: "cut" },
        { id: "front:neckline",       start_idx: 4, end_idx: 7, edge_type: "hem" },
        { id: "front:shoulder_left",  start_idx: 7, end_idx: 8, edge_type: "cut" },
        { id: "front:side_left",      start_idx: 8, end_idx: 0, edge_type: "cut" },
      ],
    };

    const back = {
      name: "back",
      vertices: [
        [0, 0], [hc, 0], [hc, bl - ad], [sw, bl],
        [sw - nw, bl], [hc / 2, bl + 3], [nw, bl],
        [hc - sw, bl], [0, bl - ad],
      ],
      edges: [
        { id: "back:hem",            start_idx: 0, end_idx: 1, edge_type: "hem" },
        { id: "back:side_right",     start_idx: 1, end_idx: 2, edge_type: "cut" },
        { id: "back:armhole_right",  start_idx: 2, end_idx: 3, edge_type: "cut" },
        { id: "back:shoulder_right", start_idx: 3, end_idx: 4, edge_type: "cut" },
        { id: "back:neckline",       start_idx: 4, end_idx: 7, edge_type: "hem" },
        { id: "back:shoulder_left",  start_idx: 7, end_idx: 8, edge_type: "cut" },
        { id: "back:side_left",      start_idx: 8, end_idx: 0, edge_type: "cut" },
      ],
    };

    const sv = [
      [0, 0], [bw * 0.85, 0], [bw, sl * 0.6],
      [bw + 2, sl], [bw / 2, sl + 5], [-2, sl], [0, sl * 0.6],
    ];

    const sleeve_left = {
      name: "sleeve_left",
      vertices: deepClone(sv),
      edges: [
        { id: "sleeve_left:cuff", start_idx: 0, end_idx: 1, edge_type: "hem" },
        { id: "sleeve_left:cap",  start_idx: 2, end_idx: 6, edge_type: "cut" },
      ],
    };

    const sleeve_right = {
      name: "sleeve_right",
      vertices: deepClone(sv),
      edges: [
        { id: "sleeve_right:cuff", start_idx: 0, end_idx: 1, edge_type: "hem" },
        { id: "sleeve_right:cap",  start_idx: 2, end_idx: 6, edge_type: "cut" },
      ],
    };

    const stitches = [
      { id: "shoulder_left",    edge_a: "front:shoulder_left",  edge_b: "back:shoulder_left",  stitch_type: "overlock", order: 1 },
      { id: "shoulder_right",   edge_a: "front:shoulder_right", edge_b: "back:shoulder_right", stitch_type: "overlock", order: 1 },
      { id: "sleeve_left_cap",  edge_a: "front:armhole_right",  edge_b: "sleeve_left:cap",     stitch_type: "overlock", order: 2 },
      { id: "sleeve_right_cap", edge_a: "back:armhole_right",   edge_b: "sleeve_right:cap",    stitch_type: "overlock", order: 2 },
      { id: "side_left",        edge_a: "front:side_left",      edge_b: "back:side_left",      stitch_type: "overlock", order: 3 },
      { id: "side_right",       edge_a: "front:side_right",     edge_b: "back:side_right",     stitch_type: "overlock", order: 3 },
    ];

    return buildSpec({
      metadata: {
        name: `${titleCase(fit)} T-Shirt`, garment_type: "tshirt",
        fabric_type, color, size, fit, neckline,
      },
      panels: [front, back, sleeve_left, sleeve_right],
      stitches,
      measurements: GarmentFactory.getMeasurements(size),
    });
  }

  // ────────────────────────────────────────────────────────────
  // Dress Shirt
  // ────────────────────────────────────────────────────────────

  _makeShirt({
    size = "M", fit = "regular", sleeve_length = null, body_length = null,
    collar_style = "point", color = "#FFFFFF", fabric_type = "cotton",
  } = {}) {
    const m  = GarmentFactory.applyEase(GarmentFactory.getMeasurements(size), fit);
    const hc = m.chest / 2;
    const sw = m.shoulder_to_shoulder / 2;
    const nw = (m.neck / (2 * Math.PI)) * 2;
    const sl = sleeve_length ?? m.shoulder_to_wrist;
    const bl = body_length ?? m.back_length + 8;
    const ad = m.armhole_depth;
    const bw = m.bicep / 2 + 2;
    const ww = m.wrist / 2 + 1.5;

    const frontLeftVerts = [
      [0, 0], [hc / 2 + 2, 0], [hc / 2 + 2, bl - ad],
      [sw / 2 + 2, bl], [hc / 4 + 2, bl + 1], [2, bl - 2], [0, bl - ad],
    ];

    const front_left = {
      name: "front_left",
      vertices: frontLeftVerts,
      edges: [
        { id: "front_left:hem",      start_idx: 0, end_idx: 1, edge_type: "hem" },
        { id: "front_left:side",     start_idx: 1, end_idx: 2, edge_type: "cut" },
        { id: "front_left:armhole",  start_idx: 2, end_idx: 3, edge_type: "cut" },
        { id: "front_left:shoulder", start_idx: 3, end_idx: 4, edge_type: "cut" },
        { id: "front_left:neckline", start_idx: 4, end_idx: 5, edge_type: "cut" },
        { id: "front_left:placket",  start_idx: 5, end_idx: 0, edge_type: "fold" },
      ],
    };

    const front_right = {
      name: "front_right",
      vertices: frontLeftVerts.map((v) => [-v[0] + hc, v[1]]),
      edges: [
        { id: "front_right:hem",      start_idx: 0, end_idx: 1, edge_type: "hem" },
        { id: "front_right:placket",  start_idx: 1, end_idx: 2, edge_type: "fold" },
        { id: "front_right:neckline", start_idx: 2, end_idx: 3, edge_type: "cut" },
        { id: "front_right:shoulder", start_idx: 3, end_idx: 4, edge_type: "cut" },
        { id: "front_right:armhole",  start_idx: 4, end_idx: 5, edge_type: "cut" },
        { id: "front_right:side",     start_idx: 5, end_idx: 0, edge_type: "cut" },
      ],
    };

    const back = {
      name: "back",
      vertices: [
        [0, 0], [hc, 0], [hc, bl - ad], [sw, bl], [hc - sw, bl], [0, bl - ad],
      ],
      edges: [
        { id: "back:hem",            start_idx: 0, end_idx: 1, edge_type: "hem" },
        { id: "back:side_right",     start_idx: 1, end_idx: 2, edge_type: "cut" },
        { id: "back:armhole_right",  start_idx: 2, end_idx: 3, edge_type: "cut" },
        { id: "back:shoulder_right", start_idx: 3, end_idx: 4, edge_type: "cut" },
        { id: "back:shoulder_left",  start_idx: 4, end_idx: 5, edge_type: "cut" },
        { id: "back:side_left",      start_idx: 5, end_idx: 0, edge_type: "cut" },
      ],
    };

    const sv = [
      [0, 0], [ww, 0], [bw, sl * 0.7],
      [bw + 2, sl], [bw / 2, sl + 6], [-2, sl], [0, sl * 0.7],
    ];

    const sleeve_left = {
      name: "sleeve_left",
      vertices: deepClone(sv),
      edges: [
        { id: "sleeve_left:cuff", start_idx: 0, end_idx: 1, edge_type: "hem" },
        { id: "sleeve_left:cap",  start_idx: 2, end_idx: 6, edge_type: "cut" },
      ],
    };

    const sleeve_right = {
      name: "sleeve_right",
      vertices: deepClone(sv),
      edges: [
        { id: "sleeve_right:cuff", start_idx: 0, end_idx: 1, edge_type: "hem" },
        { id: "sleeve_right:cap",  start_idx: 2, end_idx: 6, edge_type: "cut" },
      ],
    };

    const collarLen = m.neck + 2;
    const ch = collar_style === "point" ? 4 : 3;
    const collar = {
      name: "collar",
      vertices: [[0, 0], [collarLen, 0], [collarLen - 1, ch], [1, ch]],
      edges: [
        { id: "collar:neckband", start_idx: 0, end_idx: 1, edge_type: "cut" },
        { id: "collar:fold",     start_idx: 2, end_idx: 3, edge_type: "fold" },
      ],
    };

    const stitches = [
      { id: "shoulder_left",    edge_a: "front_left:shoulder",  edge_b: "back:shoulder_left",  order: 1 },
      { id: "shoulder_right",   edge_a: "front_right:shoulder", edge_b: "back:shoulder_right", order: 1 },
      { id: "collar_attach",    edge_a: "collar:neckband",      edge_b: "back:shoulder_right", stitch_type: "topstitch", order: 2 },
      { id: "sleeve_left_set",  edge_a: "sleeve_left:cap",      edge_b: "front_left:armhole",  order: 3 },
      { id: "sleeve_right_set", edge_a: "sleeve_right:cap",     edge_b: "front_right:armhole", order: 3 },
      { id: "side_left",        edge_a: "front_left:side",      edge_b: "back:side_left",      order: 4 },
      { id: "side_right",       edge_a: "front_right:side",     edge_b: "back:side_right",     order: 4 },
    ];

    return buildSpec({
      metadata: {
        name: `${titleCase(fit)} ${titleCase(collar_style)} Collar Shirt`,
        garment_type: "shirt", fabric_type, color, size, fit, collar_style,
      },
      panels: [front_left, front_right, back, sleeve_left, sleeve_right, collar],
      stitches,
      measurements: GarmentFactory.getMeasurements(size),
    });
  }

  // ────────────────────────────────────────────────────────────
  // Blazer
  // ────────────────────────────────────────────────────────────

  _makeBlazer({
    size = "M", fit = "regular", lapel_style = "notch", body_length = null,
    color = "#1a1a2e", fabric_type = "wool", double_breasted = false,
  } = {}) {
    const m  = GarmentFactory.applyEase(GarmentFactory.getMeasurements(size), fit);
    const hc = m.chest / 2;
    const sw = m.shoulder_to_shoulder / 2 + 1;
    const bl = body_length ?? m.back_length + 12;
    const ad = m.armhole_depth + 1;
    const overlap = double_breasted ? 5 : 2.5;
    const lw = lapel_style === "peak" ? 8 : 6;

    const frontLeftVerts = [
      [0, 0], [hc / 2 + overlap, 0], [hc / 2 + overlap, bl * 0.6],
      [hc / 2 + overlap, bl - ad], [sw / 2 + 1, bl + 1], [sw / 2 - 4, bl + 1],
      lapel_style === "peak" ? [overlap + lw, bl + 4] : [overlap + lw, bl + 2],
      [overlap, bl - 5], [0, bl - ad],
    ];

    const front_left = {
      name: "front_left",
      vertices: frontLeftVerts,
      edges: [
        { id: "front_left:hem",      start_idx: 0, end_idx: 1, edge_type: "hem" },
        { id: "front_left:side",     start_idx: 2, end_idx: 3, edge_type: "cut" },
        { id: "front_left:armhole",  start_idx: 3, end_idx: 4, edge_type: "cut" },
        { id: "front_left:shoulder", start_idx: 4, end_idx: 5, edge_type: "cut" },
        { id: "front_left:lapel",    start_idx: 5, end_idx: 7, edge_type: "fold" },
      ],
      fabric_layer: 2,
    };

    const front_right = {
      name: "front_right",
      vertices: frontLeftVerts.map((v) => [-v[0] + hc, v[1]]),
      edges: [
        { id: "front_right:hem",      start_idx: 0, end_idx: 1, edge_type: "hem" },
        { id: "front_right:side",     start_idx: 2, end_idx: 3, edge_type: "cut" },
        { id: "front_right:armhole",  start_idx: 3, end_idx: 4, edge_type: "cut" },
        { id: "front_right:shoulder", start_idx: 4, end_idx: 5, edge_type: "cut" },
        { id: "front_right:lapel",    start_idx: 5, end_idx: 7, edge_type: "fold" },
      ],
      fabric_layer: 2,
    };

    const back = {
      name: "back",
      vertices: [
        [0, 0], [hc, 0], [hc, bl - ad], [sw, bl + 1], [hc - sw, bl + 1], [0, bl - ad],
      ],
      edges: [
        { id: "back:hem",            start_idx: 0, end_idx: 1, edge_type: "hem" },
        { id: "back:side_right",     start_idx: 1, end_idx: 2, edge_type: "cut" },
        { id: "back:armhole_right",  start_idx: 2, end_idx: 3, edge_type: "cut" },
        { id: "back:shoulder_right", start_idx: 3, end_idx: 4, edge_type: "cut" },
        { id: "back:shoulder_left",  start_idx: 4, end_idx: 5, edge_type: "cut" },
        { id: "back:side_left",      start_idx: 5, end_idx: 0, edge_type: "cut" },
      ],
    };

    const slLen = m.shoulder_to_wrist;
    const bwVal = m.bicep / 2 + 3;
    const wwVal = m.wrist / 2 + 2;
    const sv = [
      [0, 0], [wwVal, 0], [bwVal, slLen * 0.7],
      [bwVal + 3, slLen], [bwVal / 2, slLen + 7], [-3, slLen], [0, slLen * 0.7],
    ];

    const sleeve_left = {
      name: "sleeve_left",
      vertices: deepClone(sv),
      edges: [
        { id: "sleeve_left:cuff", start_idx: 0, end_idx: 1, edge_type: "hem" },
        { id: "sleeve_left:cap",  start_idx: 2, end_idx: 6, edge_type: "cut" },
      ],
    };

    const sleeve_right = {
      name: "sleeve_right",
      vertices: deepClone(sv),
      edges: [
        { id: "sleeve_right:cuff", start_idx: 0, end_idx: 1, edge_type: "hem" },
        { id: "sleeve_right:cap",  start_idx: 2, end_idx: 6, edge_type: "cut" },
      ],
    };

    const stitches = [
      { id: "shoulder_left",    edge_a: "front_left:shoulder",  edge_b: "back:shoulder_left",  order: 1 },
      { id: "shoulder_right",   edge_a: "front_right:shoulder", edge_b: "back:shoulder_right", order: 1 },
      { id: "sleeve_left_set",  edge_a: "sleeve_left:cap",      edge_b: "front_left:armhole",  order: 2 },
      { id: "sleeve_right_set", edge_a: "sleeve_right:cap",     edge_b: "front_right:armhole", order: 2 },
      { id: "side_left",        edge_a: "front_left:side",      edge_b: "back:side_left",      order: 3 },
      { id: "side_right",       edge_a: "front_right:side",     edge_b: "back:side_right",     order: 3 },
    ];

    const name = `${double_breasted ? "Double-Breasted " : ""}${titleCase(lapel_style)} Lapel Blazer`;
    return buildSpec({
      metadata: {
        name, garment_type: "blazer", fabric_type, color, size, fit,
        lapel_style, double_breasted,
      },
      panels: [front_left, front_right, back, sleeve_left, sleeve_right],
      stitches,
      measurements: GarmentFactory.getMeasurements(size),
    });
  }

  // ────────────────────────────────────────────────────────────
  // Pants
  // ────────────────────────────────────────────────────────────

  _makePants({
    size = "M", fit = "regular", length = null, color = "#1a1a2e",
    fabric_type = "cotton", style = "straight",
  } = {}) {
    const m  = GarmentFactory.applyEase(GarmentFactory.getMeasurements(size), fit);
    const tw = m.thigh / 2;
    const kwM = m.knee / 2;
    const inseam = length ?? m.inseam;
    const rise = m.waist_to_hip + 5;
    const crotchExt = tw * 0.3;

    const taperMap = { skinny: 0.6, slim: 0.75, straight: 0.9, wide: 1.2, bootcut: 1.0 };
    const aw = kwM * (taperMap[style] ?? 0.9);

    const fv = [
      [0, 0], [aw, 0], [kwM, inseam * 0.45],
      [tw + crotchExt, inseam], [tw, inseam + rise], [0, inseam + rise], [0, inseam * 0.45],
    ];

    const front_left = {
      name: "front_left",
      vertices: fv,
      edges: [
        { id: "front_left:ankle",    start_idx: 0, end_idx: 1, edge_type: "hem" },
        { id: "front_left:inseam",   start_idx: 1, end_idx: 3, edge_type: "cut" },
        { id: "front_left:crotch",   start_idx: 3, end_idx: 4, edge_type: "cut" },
        { id: "front_left:waistband", start_idx: 4, end_idx: 5, edge_type: "cut" },
        { id: "front_left:outseam",  start_idx: 5, end_idx: 0, edge_type: "cut" },
      ],
    };

    const bv = deepClone(fv);
    bv[3] = [tw + crotchExt * 1.5, inseam];
    const back_left = {
      name: "back_left",
      vertices: bv,
      edges: [
        { id: "back_left:ankle",    start_idx: 0, end_idx: 1, edge_type: "hem" },
        { id: "back_left:inseam",   start_idx: 1, end_idx: 3, edge_type: "cut" },
        { id: "back_left:crotch",   start_idx: 3, end_idx: 4, edge_type: "cut" },
        { id: "back_left:waistband", start_idx: 4, end_idx: 5, edge_type: "cut" },
        { id: "back_left:outseam",  start_idx: 5, end_idx: 0, edge_type: "cut" },
      ],
    };

    const frV = fv.map((v) => [-v[0] + tw + crotchExt + 5, v[1]]);
    const front_right = {
      name: "front_right",
      vertices: frV,
      edges: [
        { id: "front_right:ankle",    start_idx: 0, end_idx: 1, edge_type: "hem" },
        { id: "front_right:inseam",   start_idx: 1, end_idx: 3, edge_type: "cut" },
        { id: "front_right:waistband", start_idx: 4, end_idx: 5, edge_type: "cut" },
        { id: "front_right:outseam",  start_idx: 5, end_idx: 0, edge_type: "cut" },
      ],
    };

    const brV = bv.map((v) => [-v[0] + tw + crotchExt * 1.5 + 5, v[1]]);
    const back_right = {
      name: "back_right",
      vertices: brV,
      edges: [
        { id: "back_right:ankle",    start_idx: 0, end_idx: 1, edge_type: "hem" },
        { id: "back_right:inseam",   start_idx: 1, end_idx: 3, edge_type: "cut" },
        { id: "back_right:waistband", start_idx: 4, end_idx: 5, edge_type: "cut" },
        { id: "back_right:outseam",  start_idx: 5, end_idx: 0, edge_type: "cut" },
      ],
    };

    const waistband = {
      name: "waistband",
      vertices: [[0, 0], [m.waist + 4, 0], [m.waist + 4, 4], [0, 4]],
      edges: [
        { id: "waistband:top",    start_idx: 2, end_idx: 3, edge_type: "fold" },
        { id: "waistband:bottom", start_idx: 0, end_idx: 1, edge_type: "cut" },
      ],
    };

    const stitches = [
      { id: "outseam_left",  edge_a: "front_left:outseam",  edge_b: "back_left:outseam",  order: 1 },
      { id: "outseam_right", edge_a: "front_right:outseam", edge_b: "back_right:outseam", order: 1 },
      { id: "inseam_left",   edge_a: "front_left:inseam",   edge_b: "back_left:inseam",   order: 2 },
      { id: "inseam_right",  edge_a: "front_right:inseam",  edge_b: "back_right:inseam",  order: 2 },
      { id: "crotch",        edge_a: "front_left:crotch",   edge_b: "front_right:crotch", order: 3 },
    ];

    return buildSpec({
      metadata: {
        name: `${titleCase(style)} ${titleCase(fabric_type)} Pants`,
        garment_type: "pants", fabric_type, color, size, fit, style,
      },
      panels: [front_left, front_right, back_left, back_right, waistband],
      stitches,
      measurements: GarmentFactory.getMeasurements(size),
    });
  }

  // ────────────────────────────────────────────────────────────
  // Skirt
  // ────────────────────────────────────────────────────────────

  _makeSkirt({
    size = "M", fit = "regular", length = null, color = "#800020",
    fabric_type = "cotton", style = "a_line",
  } = {}) {
    const m  = GarmentFactory.applyEase(GarmentFactory.getMeasurements(size), fit);
    const hw = m.waist / 2;
    const hh = m.hips / 2;
    const sl = length ?? (m.waist_to_knee ?? 55);
    const flareMap = { pencil: 0, a_line: 15, circle: 40, straight: 5 };
    const flare = flareMap[style] ?? 10;

    const fv = [[0, 0], [hh + flare, 0], [hh, m.waist_to_hip], [hw, sl], [0, sl]];

    const front = {
      name: "front",
      vertices: fv,
      edges: [
        { id: "front:hem",        start_idx: 0, end_idx: 1, edge_type: "hem" },
        { id: "front:side_right", start_idx: 1, end_idx: 2, edge_type: "cut" },
        { id: "front:waist",      start_idx: 3, end_idx: 4, edge_type: "cut" },
        { id: "front:side_left",  start_idx: 4, end_idx: 0, edge_type: "cut" },
      ],
    };

    const back = {
      name: "back",
      vertices: deepClone(fv),
      edges: [
        { id: "back:hem",        start_idx: 0, end_idx: 1, edge_type: "hem" },
        { id: "back:side_right", start_idx: 1, end_idx: 2, edge_type: "cut" },
        { id: "back:waist",      start_idx: 3, end_idx: 4, edge_type: "cut" },
        { id: "back:side_left",  start_idx: 4, end_idx: 0, edge_type: "cut" },
      ],
    };

    const waistband = {
      name: "waistband",
      vertices: [[0, 0], [m.waist + 2, 0], [m.waist + 2, 3.5], [0, 3.5]],
      edges: [
        { id: "waistband:top",    start_idx: 2, end_idx: 3, edge_type: "fold" },
        { id: "waistband:bottom", start_idx: 0, end_idx: 1, edge_type: "cut" },
      ],
    };

    const stitches = [
      { id: "side_left",  edge_a: "front:side_left",  edge_b: "back:side_left",  order: 1 },
      { id: "side_right", edge_a: "front:side_right", edge_b: "back:side_right", order: 1 },
    ];

    return buildSpec({
      metadata: {
        name: `${titleCase(style.replace(/_/g, " "))} Skirt`,
        garment_type: "skirt", fabric_type, color, size, fit, style,
      },
      panels: [front, back, waistband],
      stitches,
      measurements: GarmentFactory.getMeasurements(size),
    });
  }

  // ────────────────────────────────────────────────────────────
  // Dress
  // ────────────────────────────────────────────────────────────

  _makeDress({
    size = "M", fit = "regular", length = null, color = "#800020",
    fabric_type = "cotton", sleeve_length = 0, neckline = "v_neck",
  } = {}) {
    const m  = GarmentFactory.applyEase(GarmentFactory.getMeasurements(size), fit);
    const hc = m.chest / 2;
    const hw = m.waist / 2;
    const hh = m.hips / 2;
    const sw = m.shoulder_to_shoulder / 2;
    const bl = m.back_length;
    const ad = m.armhole_depth;
    const dl = length ?? (m.waist_to_knee ?? 55) + bl;

    const front = {
      name: "front",
      vertices: [
        [0, 0], [hh + 10, 0], [hc, dl - bl], [hc, dl - ad], [sw, dl],
        [hc / 2, dl - 3], [hc - sw, dl], [0, dl - ad], [0, dl - bl],
      ],
      edges: [
        { id: "front:hem",            start_idx: 0, end_idx: 1, edge_type: "hem" },
        { id: "front:side_right",     start_idx: 1, end_idx: 3, edge_type: "cut" },
        { id: "front:armhole_right",  start_idx: 3, end_idx: 4, edge_type: "cut" },
        { id: "front:shoulder_right", start_idx: 4, end_idx: 5, edge_type: "cut" },
        { id: "front:neckline",       start_idx: 5, end_idx: 6, edge_type: "hem" },
        { id: "front:shoulder_left",  start_idx: 6, end_idx: 7, edge_type: "cut" },
        { id: "front:side_left",      start_idx: 7, end_idx: 0, edge_type: "cut" },
      ],
    };

    const back = {
      name: "back",
      vertices: [
        [0, 0], [hh + 10, 0], [hc, dl - bl], [hc, dl - ad], [sw, dl],
        [hc / 2, dl - 1], [hc - sw, dl], [0, dl - ad], [0, dl - bl],
      ],
      edges: [
        { id: "back:hem",            start_idx: 0, end_idx: 1, edge_type: "hem" },
        { id: "back:side_right",     start_idx: 1, end_idx: 3, edge_type: "cut" },
        { id: "back:shoulder_right", start_idx: 4, end_idx: 5, edge_type: "cut" },
        { id: "back:neckline",       start_idx: 5, end_idx: 6, edge_type: "hem" },
        { id: "back:shoulder_left",  start_idx: 6, end_idx: 7, edge_type: "cut" },
        { id: "back:side_left",      start_idx: 7, end_idx: 0, edge_type: "cut" },
      ],
    };

    const stitches = [
      { id: "shoulder_left",  edge_a: "front:shoulder_left",  edge_b: "back:shoulder_left",  order: 1 },
      { id: "shoulder_right", edge_a: "front:shoulder_right", edge_b: "back:shoulder_right", order: 1 },
      { id: "side_left",      edge_a: "front:side_left",      edge_b: "back:side_left",      order: 2 },
      { id: "side_right",     edge_a: "front:side_right",     edge_b: "back:side_right",     order: 2 },
    ];

    return buildSpec({
      metadata: {
        name: `${titleCase(neckline.replace(/_/g, " "))} Dress`,
        garment_type: "dress", fabric_type, color, size, fit, neckline,
      },
      panels: [front, back],
      stitches,
      measurements: GarmentFactory.getMeasurements(size),
    });
  }

  // ────────────────────────────────────────────────────────────
  // Hoodie (built on top of t-shirt + hood + kangaroo pocket)
  // ────────────────────────────────────────────────────────────

  _makeHoodie({
    size = "M", fit = "relaxed", color = "#333333", fabric_type = "jersey",
    sleeve_length = null, body_length = null,
  } = {}) {
    const spec = this._makeTshirt({ size, fit, sleeve_length, body_length, color, fabric_type });
    spec.metadata.name = "Hoodie";
    spec.metadata.garment_type = "hoodie";

    const m = GarmentFactory.applyEase(GarmentFactory.getMeasurements(size), fit);
    const hoodW = 30;

    const hood = {
      name: "hood",
      vertices: [[0, 0], [hoodW, 0], [hoodW + 5, 24], [hoodW, 35], [0, 35]],
      edges: [
        { id: "hood:neckline", start_idx: 0, end_idx: 1, edge_type: "cut" },
        { id: "hood:back",     start_idx: 1, end_idx: 4, edge_type: "cut" },
        { id: "hood:face",     start_idx: 4, end_idx: 0, edge_type: "hem" },
      ],
    };

    const pocketW = m.chest * 0.4;
    const pocket = {
      name: "kangaroo_pocket",
      vertices: [[0, 0], [pocketW, 0], [pocketW, 18], [0, 18]],
      edges: [
        { id: "kangaroo_pocket:opening", start_idx: 2, end_idx: 3, edge_type: "hem" },
      ],
    };

    // Append hood and pocket panels + hood stitch into the existing tshirt spec
    spec.panels.push(
      {
        name: hood.name, vertices: hood.vertices, edges: hood.edges,
        grain_line: "vertical", mirror: false, fabric_layer: 1,
        width_cm: panelWidth(hood.vertices), height_cm: panelHeight(hood.vertices),
      },
      {
        name: pocket.name, vertices: pocket.vertices, edges: pocket.edges,
        grain_line: "vertical", mirror: false, fabric_layer: 1,
        width_cm: panelWidth(pocket.vertices), height_cm: panelHeight(pocket.vertices),
      },
    );

    spec.stitches.push({
      id: "hood_attach", edge_a: "hood:neckline", edge_b: "front:neckline",
      stitch_type: "plain", order: 5,
    });

    return spec;
  }

  // ────────────────────────────────────────────────────────────
  // Tank Top
  // ────────────────────────────────────────────────────────────

  _makeTankTop({
    size = "M", fit = "slim", color = "#FFFFFF", fabric_type = "jersey",
  } = {}) {
    const m  = GarmentFactory.applyEase(GarmentFactory.getMeasurements(size), fit);
    const hc = m.chest / 2;
    const bl = m.back_length + 3;
    const sw = 3; // strap width

    const frontVerts = [
      [0, 0], [hc, 0], [hc, bl * 0.4],
      [hc - sw, bl], [hc / 2, bl - 5], [sw, bl], [0, bl * 0.4],
    ];

    const front = {
      name: "front",
      vertices: frontVerts,
      edges: [
        { id: "front:hem",         start_idx: 0, end_idx: 1, edge_type: "hem" },
        { id: "front:side_right",  start_idx: 1, end_idx: 2, edge_type: "cut" },
        { id: "front:strap_right", start_idx: 2, end_idx: 3, edge_type: "cut" },
        { id: "front:neckline",    start_idx: 3, end_idx: 5, edge_type: "hem" },
        { id: "front:strap_left",  start_idx: 5, end_idx: 6, edge_type: "cut" },
        { id: "front:side_left",   start_idx: 6, end_idx: 0, edge_type: "cut" },
      ],
    };

    const backVerts = deepClone(frontVerts);
    backVerts[4] = [hc / 2, bl - 2]; // higher back neckline

    const back = {
      name: "back",
      vertices: backVerts,
      edges: [
        { id: "back:hem",         start_idx: 0, end_idx: 1, edge_type: "hem" },
        { id: "back:side_right",  start_idx: 1, end_idx: 2, edge_type: "cut" },
        { id: "back:strap_right", start_idx: 2, end_idx: 3, edge_type: "cut" },
        { id: "back:neckline",    start_idx: 3, end_idx: 5, edge_type: "hem" },
        { id: "back:strap_left",  start_idx: 5, end_idx: 6, edge_type: "cut" },
        { id: "back:side_left",   start_idx: 6, end_idx: 0, edge_type: "cut" },
      ],
    };

    const stitches = [
      { id: "strap_left",  edge_a: "front:strap_left",  edge_b: "back:strap_left",  order: 1 },
      { id: "strap_right", edge_a: "front:strap_right", edge_b: "back:strap_right", order: 1 },
      { id: "side_left",   edge_a: "front:side_left",   edge_b: "back:side_left",   order: 2 },
      { id: "side_right",  edge_a: "front:side_right",  edge_b: "back:side_right",  order: 2 },
    ];

    return buildSpec({
      metadata: {
        name: "Tank Top", garment_type: "tank_top",
        fabric_type, color, size, fit,
      },
      panels: [front, back],
      stitches,
      measurements: GarmentFactory.getMeasurements(size),
    });
  }
}

export {
  STANDARD_MEASUREMENTS,
  EASE_PROFILES,
  FABRIC_PROPERTIES,
  GarmentFactory,
};
