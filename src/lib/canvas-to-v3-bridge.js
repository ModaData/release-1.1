// File: lib/canvas-to-v3-bridge.js — Maps Drawing Canvas state to V3 Design Studio initial state

/**
 * Maps the AI Drawing Canvas state to V3 Design Studio state.
 * This enables the "Send to Design Studio" bridge — the user's
 * canvas render becomes the base garment in V3 for further refinement.
 *
 * @param {object} canvasState — full canvas state from useDrawingCanvas
 * @returns {object} — V3-compatible state to hydrate useDesignStudio
 */
export function mapCanvasToV3State(canvasState) {
  const imageUrl = canvasState.lockedRenderUrl || canvasState.currentRenderUrl;

  return {
    // Source metadata
    source: "canvas",
    timestamp: Date.now(),

    // Base garment image from canvas render
    customBaseImage: imageUrl,
    customBaseLabel: "AI Canvas Sketch Render",

    // Fabric context (carry over from canvas)
    fabricContext: {
      fiberId: canvasState.selectedFiber || null,
      constructionId: canvasState.selectedConstruction || null,
      gsm: canvasState.gsm || null,
    },

    // Garment category
    garmentCategory: canvasState.garmentCategory || null,

    // Gender
    gender: canvasState.gender || "women",

    // Style notes for context
    styleNotes: canvasState.styleNotes || "",

    // AI interpretation for reference
    interpretation: canvasState.currentInterpretation || "",

    // Skip to step 3 (Component Customization) since we already have the base
    startAtStep: 3,
  };
}

/**
 * Reads bridge data from sessionStorage if the user arrived via "Send to Design Studio".
 * Call this in the V3 Design Studio page on mount.
 *
 * @returns {object|null} — V3 state hydration data, or null if no bridge data
 */
export function readCanvasBridgeData() {
  try {
    const raw = sessionStorage.getItem("canvas_to_v3_bridge");
    if (!raw) return null;

    const data = JSON.parse(raw);

    // Clear after reading (one-time transfer)
    sessionStorage.removeItem("canvas_to_v3_bridge");

    // Validate
    if (data.source !== "canvas" || !data.customBaseImage) return null;

    return data;
  } catch {
    return null;
  }
}
