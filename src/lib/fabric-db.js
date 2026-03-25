// File: lib/fabric-db.js — Fabric Knowledge Database Utilities
// Lookup, prompt generation, and constraint validation for physically-accurate FLUX inpainting
import DB from "@/data/fabric-knowledge-db.json";

// ─── Fiber Gradients (define before catalog) ─────────────
const FIBER_GRADIENTS = {
  cotton: "from-amber-700/40 to-orange-900/30",
  wool: "from-stone-600/40 to-stone-800/30",
  silk: "from-blue-300/30 to-slate-400/20",
  linen: "from-yellow-700/30 to-amber-800/20",
  polyester: "from-gray-500/30 to-zinc-700/20",
  nylon: "from-sky-500/30 to-blue-700/20",
  viscose_rayon: "from-rose-400/30 to-pink-600/20",
  lyocell_tencel: "from-emerald-400/30 to-teal-600/20",
  spandex_elastane: "from-violet-400/30 to-purple-600/20",
};

// ─── Fiber Catalog ────────────────────────────────────────
// Compact cards for the UI picker, pulled from the full database
export const FIBER_CATALOG = Object.entries(DB.fibers).map(([id, fiber]) => ({
  id,
  name: fiber.name,
  category: fiber.category,
  handDescriptors: fiber.hand_descriptors || [],
  visual: fiber.visual || {},
  priceRange: fiber.production?.priceRange || null,
  gradient: FIBER_GRADIENTS[id] || "from-gray-500/30 to-gray-700/20",
}));

// ─── Construction Catalog ─────────────────────────────────
export const CONSTRUCTION_CATALOG = Object.entries(DB.constructions).map(([id, c]) => ({
  id,
  name: c.name,
  category: c.category,
  method: c.method,
  stretch: c.stretch,
  gsmRange: c.gsm_range,
  drapeRange: c.drape_coefficient_range,
  surface: c.surface,
  light: c.light,
  costTier: c.cost_tier,
  typicalGarments: c.typical_garments || [],
}));

// ─── Silhouette Effects ───────────────────────────────────
export const SILHOUETTE_CATALOG = Object.entries(DB.silhouetteEffects).filter(
  ([k]) => !k.startsWith("_")
).map(([id, s]) => ({
  id,
  compatibleFabrics: s.compatible_fabrics,
  physicsRequirements: s.fabric_physics_requirements,
  visualBehavior: s.visual_behavior,
}));

// ─── Lookups ──────────────────────────────────────────────

/** Get full fiber data by ID */
export function getFiber(id) {
  return DB.fibers[id] || null;
}

/** Get full construction data by ID */
export function getConstruction(id) {
  return DB.constructions[id] || null;
}

/** Get silhouette effect data */
export function getSilhouetteEffect(id) {
  return DB.silhouetteEffects[id] || null;
}

// ─── Weight Descriptor ────────────────────────────────────
/** Map GSM to a natural-language weight descriptor for FLUX prompts */
export function getWeightDescriptor(gsm) {
  const t = DB.promptFragmentTemplates.weight_descriptors;
  if (gsm <= (t.ultralight.gsm_max || 100)) return t.ultralight.descriptor;
  if (gsm <= (t.light.gsm_max || 170)) return t.light.descriptor;
  if (gsm <= (t.medium.gsm_max || 250)) return t.medium.descriptor;
  if (gsm <= (t.heavy.gsm_max || 350)) return t.heavy.descriptor;
  return t.very_heavy.descriptor;
}

// ─── Drape Descriptor ─────────────────────────────────────
/** Map drape coefficient to a descriptor for FLUX prompts */
export function getDrapeDescriptor(coeff) {
  // V3 uses "drape_descriptors", V2 used "drape_descriptors_by_coefficient"
  const d = DB.promptFragmentTemplates.drape_descriptors || DB.promptFragmentTemplates.drape_descriptors_by_coefficient;
  if (coeff <= (d.very_high_drape.coeff_max || 0.20))
    return { descriptor: d.very_high_drape.descriptor, behavior: d.very_high_drape.behavior };
  if (coeff <= (d.high_drape.coeff_max || 0.35))
    return { descriptor: d.high_drape.descriptor, behavior: d.high_drape.behavior };
  if (coeff <= (d.moderate_drape.coeff_max || 0.55))
    return { descriptor: d.moderate_drape.descriptor, behavior: d.moderate_drape.behavior };
  if (coeff <= (d.low_drape.coeff_max || 0.70))
    return { descriptor: d.low_drape.descriptor, behavior: d.low_drape.behavior };
  return { descriptor: d.minimal_drape.descriptor, behavior: d.minimal_drape.behavior };
}

// ─── Prompt Fragment Generation ───────────────────────────

/**
 * Generate a rich, physically-accurate FLUX prompt fragment from
 * the user's fabric selection.
 *
 * @param {object} fabricContext — { fiberId, constructionId, gsm }
 * @returns {string} — e.g. "midweight cotton plain weave, 200gsm,
 *   matte with subtle natural texture, soft rounded folds, diffuse matte lighting"
 */
export function generateFabricPromptFragment(fabricContext) {
  if (!fabricContext?.fiberId) return "";

  const fiber = getFiber(fabricContext.fiberId);
  if (!fiber) return "";

  const construction = fabricContext.constructionId
    ? getConstruction(fabricContext.constructionId)
    : null;

  const gsm = fabricContext.gsm || 200;
  const weightDesc = getWeightDescriptor(gsm);

  const parts = [];

  // Base: "midweight cotton plain weave, 200gsm"
  const constructionName = construction?.name || "";
  parts.push(
    `${weightDesc} ${fiber.name.toLowerCase()} ${constructionName.toLowerCase()}`.trim() +
    `, ${gsm}gsm`
  );

  // Surface texture: "matte with subtle natural texture"
  if (fiber.visual?.surface) {
    parts.push(fiber.visual.surface);
  }

  // Fold character: "soft rounded folds"
  if (fiber.visual?.foldCharacter) {
    parts.push(fiber.visual.foldCharacter);
  }

  // Light behavior: "diffuse matte lighting"
  if (fiber.visual?.lightBehavior) {
    parts.push(fiber.visual.lightBehavior);
  }

  // Wrinkle pattern
  if (fiber.visual?.wrinklePattern) {
    parts.push(fiber.visual.wrinklePattern);
  }

  // Movement / drape
  if (fiber.visual?.movement) {
    parts.push(fiber.visual.movement);
  }

  // Construction surface if available
  if (construction?.surface) {
    parts.push(construction.surface);
  }

  // Drape descriptor from construction
  if (construction?.drapeRange) {
    const midDrape =
      ((construction.drapeRange.min || 0.3) + (construction.drapeRange.max || 0.5)) / 2;
    const { descriptor, behavior } = getDrapeDescriptor(midDrape);
    parts.push(`${descriptor} fabric that ${behavior}`);
  }

  return parts.join(", ");
}

/**
 * Generate a compact fabric context string for brand brief summary.
 * e.g. "Silk charmeuse • 120gsm • fluid drape, lustrous"
 */
export function getFabricSummary(fabricContext) {
  if (!fabricContext?.fiberId) return null;

  const fiber = getFiber(fabricContext.fiberId);
  if (!fiber) return null;

  const construction = fabricContext.constructionId
    ? getConstruction(fabricContext.constructionId)
    : null;

  const gsm = fabricContext.gsm || 200;
  const constructionName = construction?.name ? ` ${construction.name}` : "";
  const handShort = (fiber.hand_descriptors || []).slice(0, 3).join(", ");

  return `${fiber.name}${constructionName} · ${gsm}gsm · ${handShort}`;
}

// ─── Constraint Validation ────────────────────────────────

/**
 * Validate a fabric selection against the constraint rules from the database.
 * Returns an array of { ruleId, severity, message, source } violations.
 *
 * @param {object} fabricContext — { fiberId, constructionId, gsm }
 * @param {object} garmentContext — { silhouette, priceRange, garmentType } (optional hints)
 * @returns {Array<{ruleId: string, severity: 'error'|'warning', message: string, source: string}>}
 */
export function validateFabricConstraints(fabricContext, garmentContext = {}) {
  const violations = [];
  if (!fabricContext?.fiberId) return violations;

  const fiber = getFiber(fabricContext.fiberId);
  const construction = fabricContext.constructionId
    ? getConstruction(fabricContext.constructionId)
    : null;
  const gsm = fabricContext.gsm || 200;

  const rules = DB.constraintRules;

  // Helper: V3 uses "id", V2 used "rule_id" — normalize
  const ruleId = (rule) => rule.id || rule.rule_id;

  // Helper: push a violation in normalized format
  const pushViolation = (rule) => {
    violations.push({
      ruleId: ruleId(rule),
      severity: rule.severity,
      message: rule.rule,
      source: rule.source || "Fabric Knowledge Database V3",
    });
  };

  // ── Fabric-Garment Compatibility ──
  if (rules.fabric_garment_compatibility) {
    for (const rule of rules.fabric_garment_compatibility) {
      const rid = ruleId(rule);

      // FGC-001: low-stretch fabrics can't be bodycon
      if (
        rid === "FGC-001" &&
        garmentContext.silhouette === "fitted" &&
        construction &&
        !construction.stretch?.width
      ) {
        const hasStretch =
          construction.stretch &&
          (construction.stretch.width || construction.stretch.weft || "").includes("%");
        if (!hasStretch && fabricContext.fiberId !== "spandex_elastane") {
          pushViolation(rule);
        }
      }

      // FGC-002: silk charmeuse/chiffon can't be structured blazers
      if (
        rid === "FGC-002" &&
        garmentContext.silhouette === "structured" &&
        fabricContext.fiberId === "silk"
      ) {
        pushViolation(rule);
      }

      // FGC-003: heavy denim/canvas not for draped/fluid silhouettes
      if (
        rid === "FGC-003" &&
        (garmentContext.silhouette === "draped_fluid" || garmentContext.silhouette === "fluid") &&
        gsm > 350
      ) {
        pushViolation(rule);
      }
    }
  }

  // ── Construction Method Constraints (V3 renamed from construction_modification_constraints) ──
  const cmcRules = rules.construction_method_constraints || rules.construction_modification_constraints;
  if (cmcRules) {
    for (const rule of cmcRules) {
      const rid = ruleId(rule);
      // Pleats require crease-retaining fabrics
      if (
        (rid === "CMC-004" || rid === "CON-004") &&
        garmentContext.garmentType?.toLowerCase().includes("pleat") &&
        (fabricContext.fiberId === "cotton" || fabricContext.fiberId === "linen")
      ) {
        pushViolation(rule);
      }
    }
  }

  // ── Costing constraints ──
  if (rules.costing_constraints && garmentContext.priceRange) {
    for (const rule of rules.costing_constraints) {
      const rid = ruleId(rule);
      if (
        (rid === "CC-001" || rid === "COST-001") &&
        fabricContext.fiberId === "silk" &&
        garmentContext.priceRange === "budget"
      ) {
        pushViolation(rule);
      }
    }
  }

  return violations;
}

// ─── Convenience: Get visual descriptors for UI display ───
/**
 * Returns a flat array of visual descriptor strings for a fiber,
 * suitable for displaying as chips/tags in the UI.
 */
export function getVisualDescriptors(fiberId) {
  const fiber = getFiber(fiberId);
  if (!fiber?.visual) return [];

  return Object.entries(fiber.visual)
    .filter(([, v]) => typeof v === "string")
    .map(([key, value]) => ({
      key,
      label: key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()),
      value,
    }));
}

/**
 * Returns hand descriptor strings for a fiber.
 */
export function getHandDescriptors(fiberId) {
  const fiber = getFiber(fiberId);
  return fiber?.hand_descriptors || [];
}

/**
 * Returns production info (finishes, price, mills) for a fiber.
 */
export function getProductionInfo(fiberId) {
  const fiber = getFiber(fiberId);
  return fiber?.production || null;
}

/**
 * Returns skin interaction info for a fiber.
 */
export function getSkinInteraction(fiberId) {
  const fiber = getFiber(fiberId);
  return fiber?.skin_interaction || null;
}

// ─── Export raw DB for advanced usage ─────────────────────
export { DB as FABRIC_DB };
