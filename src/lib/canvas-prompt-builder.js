// File: lib/canvas-prompt-builder.js — Merges sketch description + V3 data + user controls into generation prompt
import { generateFabricPromptFragment } from "@/lib/fabric-db";

/**
 * Build the full render prompt from sketch description + canvas state.
 * Used by the continuous render engine to produce FLUX prompts.
 */
export function buildCanvasRenderPrompt(sketchDescription, state) {
  const parts = [
    // From GPT-4o sketch interpretation
    `Fashion design photograph: ${sketchDescription}`,

    // From V3 fabric data
    state.fabricPromptFragment || "",

    // From user's style notes
    state.detailNotes || "",

    // From user's color selection
    state.selectedColor
      ? `Primary color: ${state.selectedColor.name || state.selectedColor.hex}`
      : "",

    // From fit/length sliders
    `Fit: ${fitToPrompt(state.fitValue)}`,
    `Length: ${lengthToPrompt(state.lengthValue)}`,

    // Gender/style context
    `${state.gender}'s fashion`,
    state.styleNotes || "",

    // Quality anchors
    "professional fashion photography, studio lighting, clean background, haute couture presentation",
  ];

  return parts.filter(Boolean).join(", ");
}

/**
 * Build a fabric prompt fragment from the canvas state's fiber selection.
 * Wraps the V3 utility for convenience.
 */
export function buildFabricFragment(fiberId, constructionId, gsm) {
  if (!fiberId) return "";
  return generateFabricPromptFragment({
    fiberId,
    constructionId: constructionId || null,
    gsm: gsm || 200,
  });
}

function fitToPrompt(val) {
  if (val == null) val = 0.5;
  if (val < 0.2) return "slim, fitted, tailored";
  if (val < 0.4) return "slightly fitted, semi-tailored";
  if (val < 0.6) return "regular fit";
  if (val < 0.8) return "relaxed, comfortable";
  return "oversized, relaxed, loose";
}

function lengthToPrompt(val) {
  if (val == null) val = 0.5;
  if (val < 0.2) return "cropped above waist";
  if (val < 0.4) return "cropped at waist";
  if (val < 0.6) return "hip length";
  if (val < 0.8) return "knee length";
  return "full length to ankles";
}
