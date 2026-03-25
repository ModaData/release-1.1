// File: lib/perception.js — Combined Perception Pipeline
// Per approach doc: "Mouse position → SegFormer category lookup → highlight region → SAM decoder for pixel-perfect mask on click."

import {
  runSegFormer,
  getCategoryAtPoint,
  buildCategoryMask,
  buildSubRegionMask,
  CATEGORY_LABELS,
} from "./segformer";

/**
 * State container for a single image's perception data.
 */
export class PerceptionState {
  constructor() {
    this.segResult = null;
    this.isSegFormerReady = false;
    this.imageWidth = 0;
    this.imageHeight = 0;
    this.imageDataUrl = null; // Cached for SAM point-prompt calls
  }

  get isReady() {
    return this.isSegFormerReady;
  }
}

/**
 * Initialize perception for an uploaded image.
 * Runs SegFormer in-browser for instant garment part detection.
 * Caches image data URL for SAM point-prompt calls on click.
 *
 * @param {HTMLCanvasElement} canvas - Canvas with the image loaded
 * @param {string} imageUrl - URL of the image (may be blob:, not usable server-side)
 * @param {function} onStatus - Status callback
 * @returns {PerceptionState}
 */
export async function initPerception(canvas, imageUrl, onStatus) {
  const state = new PerceptionState();
  state.imageWidth = canvas.width;
  state.imageHeight = canvas.height;

  // Cache data URL for later SAM point-prompt calls on click
  state.imageDataUrl = canvas.toDataURL("image/jpeg", 0.85);

  // Run SegFormer in-browser (~1-2s) — primary perception engine for hover/click
  onStatus?.("Running garment segmentation...");
  try {
    const result = await runSegFormer(canvas);
    state.segResult = result;
    state.isSegFormerReady = true;
    onStatus?.(
      "Garment parts detected! Hover over the garment to see regions."
    );
  } catch (err) {
    console.error("[Perception] SegFormer failed:", err);
    throw new Error("Garment segmentation failed: " + err?.message);
  }

  return state;
}

/**
 * Get hover info at a point (instant, ~1ms).
 * Uses SegFormer pixel map for category lookup.
 */
export function getHoverInfo(perception, imgX, imgY) {
  if (!perception?.isSegFormerReady || !perception.segResult) return null;
  return getCategoryAtPoint(perception.segResult, imgX, imgY);
}

/**
 * Build a quick highlight mask from SegFormer for a category (instant).
 * If subRegion is specified, builds a tighter sub-region mask.
 * Used for hover glow effect.
 */
export function getHoverMask(perception, categoryId, subRegion) {
  if (!perception?.isSegFormerReady || !perception.segResult) return null;
  if (subRegion) {
    return buildSubRegionMask(perception.segResult, categoryId, subRegion);
  }
  return buildCategoryMask(perception.segResult, categoryId);
}

/**
 * Get a precise click mask.
 *
 * Strategy:
 *   1. Get semantic label + sub-region from SegFormer
 *   2. Get pixel-perfect mask via SAM decoder (or SegFormer category fallback)
 *   3. If a sub-region was detected, INTERSECT the mask with the
 *      SegFormer sub-region mask so only that part (e.g. pocket, sleeve)
 *      is selected — not the entire garment.
 */
export async function getClickMask(perception, imgX, imgY, onStatus) {
  if (!perception?.isSegFormerReady) {
    throw new Error("Perception not ready yet");
  }

  // Get semantic label from SegFormer
  const info = getCategoryAtPoint(perception.segResult, imgX, imgY);

  if (!info.isGarment) {
    throw new Error(
      `Clicked on "${info.label}" — click on a garment part instead`
    );
  }

  let mask;

  // Try SAM API with text prompt for pixel-perfect edges.
  // Pass the BASE garment label (e.g. "Upper-clothes") not the sub-region
  // ("Left Cuff") — Grounded SAM detects whole garments, not sub-parts.
  // Sub-region precision comes from the SegFormer intersection step below.
  if (perception.imageDataUrl) {
    try {
      onStatus?.("Generating precise mask with SAM...");
      mask = await getSamClickMask(
        perception.imageDataUrl,
        imgX,
        imgY,
        info.baseLabel || info.label
      );
      if (mask) {
        console.log("[Perception] SAM pixel-perfect mask generated");
      }
    } catch (err) {
      console.warn(
        "[Perception] SAM API failed, falling back to SegFormer:",
        err.message
      );
    }
  }

  // Fallback to SegFormer category mask
  if (!mask) {
    onStatus?.("Using category-based selection...");
    mask = buildCategoryMask(perception.segResult, info.categoryId);
  }

  // ── KEY: Intersect with sub-region mask for precise selection ──
  // Without this, clicking "Left Chest Pocket" selects the entire shirt
  // because SAM doesn't know about sub-regions.
  if (info.subRegion) {
    onStatus?.(`Isolating ${info.subRegion}...`);
    const subMask = buildSubRegionMask(
      perception.segResult,
      info.categoryId,
      info.subRegion
    );
    if (subMask) {
      mask = intersectMasks(mask, subMask);
      console.log("[Perception] Mask intersected with sub-region:", info.subRegion);
    }
  }

  return {
    mask,
    label: info.label,
    categoryId: info.categoryId,
    subRegion: info.subRegion || null,
  };
}

/**
 * Call SAM API with label (Grounded SAM) or point prompt (SAM3) to get a pixel-perfect mask.
 * Returns an HTMLCanvasElement with the mask, or null on failure.
 */
async function getSamClickMask(imageDataUrl, pointX, pointY, label) {
  const res = await fetch("/api/sam-encode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: imageDataUrl,
      label: label || undefined,
      point_x: pointX,
      point_y: pointY,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `SAM API failed: ${res.status}`);
  }

  const data = await res.json();

  if (!data.masks || data.masks.length === 0) {
    console.warn("[Perception] SAM returned no masks");
    return null;
  }

  // Use the first (best) mask — load it as a canvas
  const maskUrl = data.masks[0];
  console.log("[Perception] SAM mask URL:", maskUrl);

  const maskCanvas = document.createElement("canvas");
  await new Promise((resolve, reject) => {
    const img = new Image();
    // Only set crossOrigin for HTTP URLs, not data: URLs (data URLs are always same-origin)
    if (maskUrl.startsWith("http")) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => {
      maskCanvas.width = img.naturalWidth;
      maskCanvas.height = img.naturalHeight;
      const ctx = maskCanvas.getContext("2d");
      ctx.drawImage(img, 0, 0);

      // Convert to binary mask (white on transparent)
      const imgData = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
      for (let i = 0; i < imgData.data.length; i += 4) {
        // If pixel has any non-black content, make it white
        const r = imgData.data[i], g = imgData.data[i + 1], b = imgData.data[i + 2];
        if (r > 128 || g > 128 || b > 128) {
          imgData.data[i] = 255;
          imgData.data[i + 1] = 255;
          imgData.data[i + 2] = 255;
          imgData.data[i + 3] = 255;
        } else {
          imgData.data[i] = 0;
          imgData.data[i + 1] = 0;
          imgData.data[i + 2] = 0;
          imgData.data[i + 3] = 0;
        }
      }
      ctx.putImageData(imgData, 0, 0);
      resolve();
    };
    img.onerror = () => reject(new Error("Failed to load SAM mask image"));
    img.src = maskUrl;
  });

  return maskCanvas;
}

/**
 * Intersect two mask canvases — output pixel is white only where BOTH masks are white.
 * This lets us combine SAM's pixel-perfect edges with SegFormer's semantic sub-region.
 */
function intersectMasks(maskA, maskB) {
  const w = maskA.width;
  const h = maskA.height;

  const result = document.createElement("canvas");
  result.width = w;
  result.height = h;
  const ctx = result.getContext("2d");

  // Read both masks
  const ctxA = maskA.getContext("2d", { willReadFrequently: true });
  const ctxB = maskB.getContext("2d", { willReadFrequently: true });

  // maskB might be a different size — scale it to match maskA
  let dataB;
  if (maskB.width !== w || maskB.height !== h) {
    const scaledB = document.createElement("canvas");
    scaledB.width = w;
    scaledB.height = h;
    const sCtx = scaledB.getContext("2d");
    sCtx.drawImage(maskB, 0, 0, w, h);
    dataB = sCtx.getImageData(0, 0, w, h).data;
  } else {
    dataB = ctxB.getImageData(0, 0, w, h).data;
  }

  const dataA = ctxA.getImageData(0, 0, w, h).data;
  const imgData = ctx.createImageData(w, h);

  for (let i = 0; i < w * h; i++) {
    const alphaA = dataA[i * 4 + 3];
    const alphaB = dataB[i * 4 + 3];
    // Pixel is white only where both masks have opacity
    if (alphaA > 128 && alphaB > 128) {
      imgData.data[i * 4] = 255;
      imgData.data[i * 4 + 1] = 255;
      imgData.data[i * 4 + 2] = 255;
      imgData.data[i * 4 + 3] = Math.min(alphaA, alphaB);
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return result;
}
