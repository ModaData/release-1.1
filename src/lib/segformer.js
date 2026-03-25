// File: lib/segformer.js — SegFormer B2 In-Browser (ONNX) + Sub-Region Detection
// Per approach doc: "18-category pixel map on image upload, runs entirely in-browser."
// ENHANCED: Spatial sub-region detection for sleeve, collar, cuff, button, pocket etc.

import { getOrt } from "./ort-helper";

let sessionPromise = null;

const CATEGORY_LABELS = [
  "Background", "Hat", "Hair", "Sunglasses", "Upper-clothes",
  "Scarf", "Dress", "Coat", "Socks", "Pants",
  "Jumpsuits", "Scarf", "Skirt", "Face", "Left-arm",
  "Right-arm", "Left-leg", "Right-leg",
];

const CATEGORY_COLORS = [
  [0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255],
  [255, 255, 0], [255, 0, 255], [0, 255, 255], [128, 0, 0],
  [0, 128, 0], [0, 0, 128], [128, 128, 0], [128, 0, 128],
  [0, 128, 128], [255, 128, 0], [255, 0, 128], [128, 255, 0],
  [0, 255, 128], [128, 0, 255],
];

// Garment-relevant category IDs (skip background, body parts, hair, face)
const GARMENT_CATEGORIES = new Set([1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

// ═══════════════════════════════════════════════════════
// SUB-REGION DETECTION — spatial position logic within each SegFormer category
// The SegFormer model gives coarse categories (e.g., "Upper-clothes" for whole shirt).
// We subdivide using bounding-box relative position to detect:
// collar, sleeve, cuff, button placket, pocket, hem, neckline, waistband, etc.
// ═══════════════════════════════════════════════════════

/**
 * Sub-regions for each garment category.
 * Each sub-region has a `test(rx, ry)` function where rx,ry are 0–1 relative
 * positions within that category's bounding box.
 * Order matters — first match wins.
 */
const SUB_REGIONS = {
  // 4 = Upper-clothes (shirt, blouse, t-shirt)
  4: [
    {
      name: "Collar",
      test: (rx, ry, aspect) => ry < 0.12 && rx > 0.25 && rx < 0.75,
      color: [255, 100, 100],
    },
    {
      name: "Neckline",
      test: (rx, ry) => ry < 0.18 && rx > 0.3 && rx < 0.7,
      color: [255, 150, 100],
    },
    {
      name: "Left Shoulder",
      test: (rx, ry) => ry < 0.15 && rx <= 0.3,
      color: [200, 100, 255],
    },
    {
      name: "Right Shoulder",
      test: (rx, ry) => ry < 0.15 && rx >= 0.7,
      color: [200, 100, 255],
    },
    {
      name: "Left Sleeve",
      test: (rx, ry) => rx < 0.18 && ry > 0.1 && ry < 0.65,
      color: [100, 200, 255],
    },
    {
      name: "Right Sleeve",
      test: (rx, ry) => rx > 0.82 && ry > 0.1 && ry < 0.65,
      color: [100, 200, 255],
    },
    {
      name: "Left Cuff",
      test: (rx, ry) => rx < 0.15 && ry >= 0.55,
      color: [100, 255, 200],
    },
    {
      name: "Right Cuff",
      test: (rx, ry) => rx > 0.85 && ry >= 0.55,
      color: [100, 255, 200],
    },
    {
      name: "Button Placket",
      test: (rx, ry) => rx > 0.42 && rx < 0.58 && ry > 0.12 && ry < 0.85,
      color: [255, 255, 100],
    },
    {
      name: "Left Chest Pocket",
      test: (rx, ry) => rx > 0.2 && rx < 0.42 && ry > 0.2 && ry < 0.45,
      color: [255, 200, 100],
    },
    {
      name: "Right Chest Pocket",
      test: (rx, ry) => rx > 0.58 && rx < 0.8 && ry > 0.2 && ry < 0.45,
      color: [255, 200, 100],
    },
    {
      name: "Chest Area",
      test: (rx, ry) => ry > 0.15 && ry < 0.5,
      color: [100, 150, 255],
    },
    {
      name: "Hem",
      test: (rx, ry) => ry > 0.85,
      color: [150, 255, 150],
    },
    {
      name: "Body",
      test: () => true,
      color: [180, 180, 255],
    },
  ],

  // 7 = Coat / Jacket
  7: [
    {
      name: "Collar",
      test: (rx, ry) => ry < 0.1 && rx > 0.25 && rx < 0.75,
      color: [255, 100, 100],
    },
    {
      name: "Lapel",
      test: (rx, ry) => ry < 0.3 && ry > 0.08 && (rx < 0.35 || rx > 0.65),
      color: [255, 130, 130],
    },
    {
      name: "Left Shoulder",
      test: (rx, ry) => ry < 0.12 && rx <= 0.3,
      color: [200, 100, 255],
    },
    {
      name: "Right Shoulder",
      test: (rx, ry) => ry < 0.12 && rx >= 0.7,
      color: [200, 100, 255],
    },
    {
      name: "Left Sleeve",
      test: (rx, ry) => rx < 0.15 && ry > 0.08 && ry < 0.6,
      color: [100, 200, 255],
    },
    {
      name: "Right Sleeve",
      test: (rx, ry) => rx > 0.85 && ry > 0.08 && ry < 0.6,
      color: [100, 200, 255],
    },
    {
      name: "Left Cuff",
      test: (rx, ry) => rx < 0.12 && ry >= 0.55,
      color: [100, 255, 200],
    },
    {
      name: "Right Cuff",
      test: (rx, ry) => rx > 0.88 && ry >= 0.55,
      color: [100, 255, 200],
    },
    {
      name: "Button Placket",
      test: (rx, ry) => rx > 0.4 && rx < 0.6 && ry > 0.1 && ry < 0.9,
      color: [255, 255, 100],
    },
    {
      name: "Breast Pocket",
      test: (rx, ry) => rx > 0.2 && rx < 0.4 && ry > 0.2 && ry < 0.4,
      color: [255, 200, 100],
    },
    {
      name: "Side Pocket",
      test: (rx, ry) => (rx < 0.3 || rx > 0.7) && ry > 0.55 && ry < 0.8,
      color: [255, 180, 80],
    },
    {
      name: "Hem",
      test: (rx, ry) => ry > 0.88,
      color: [150, 255, 150],
    },
    {
      name: "Body",
      test: () => true,
      color: [180, 180, 255],
    },
  ],

  // 6 = Dress
  6: [
    {
      name: "Neckline",
      test: (rx, ry) => ry < 0.1 && rx > 0.3 && rx < 0.7,
      color: [255, 100, 100],
    },
    {
      name: "Left Strap / Sleeve",
      test: (rx, ry) => rx < 0.2 && ry < 0.25,
      color: [100, 200, 255],
    },
    {
      name: "Right Strap / Sleeve",
      test: (rx, ry) => rx > 0.8 && ry < 0.25,
      color: [100, 200, 255],
    },
    {
      name: "Bodice",
      test: (rx, ry) => ry > 0.08 && ry < 0.4,
      color: [200, 150, 255],
    },
    {
      name: "Waist",
      test: (rx, ry) => ry >= 0.35 && ry < 0.5,
      color: [255, 200, 150],
    },
    {
      name: "Skirt",
      test: (rx, ry) => ry >= 0.5 && ry < 0.9,
      color: [150, 200, 255],
    },
    {
      name: "Hem",
      test: (rx, ry) => ry >= 0.9,
      color: [150, 255, 150],
    },
    {
      name: "Body",
      test: () => true,
      color: [180, 180, 255],
    },
  ],

  // 9 = Pants / Trousers
  9: [
    {
      name: "Waistband",
      test: (rx, ry) => ry < 0.1,
      color: [255, 100, 100],
    },
    {
      name: "Fly / Zipper",
      test: (rx, ry) => rx > 0.35 && rx < 0.65 && ry > 0.05 && ry < 0.25,
      color: [255, 255, 100],
    },
    {
      name: "Left Pocket",
      test: (rx, ry) => rx < 0.35 && ry > 0.05 && ry < 0.25,
      color: [255, 200, 100],
    },
    {
      name: "Right Pocket",
      test: (rx, ry) => rx > 0.65 && ry > 0.05 && ry < 0.25,
      color: [255, 200, 100],
    },
    {
      name: "Left Thigh",
      test: (rx, ry) => rx < 0.5 && ry > 0.1 && ry < 0.5,
      color: [150, 150, 255],
    },
    {
      name: "Right Thigh",
      test: (rx, ry) => rx >= 0.5 && ry > 0.1 && ry < 0.5,
      color: [150, 150, 255],
    },
    {
      name: "Left Knee",
      test: (rx, ry) => rx < 0.5 && ry >= 0.4 && ry < 0.6,
      color: [200, 200, 255],
    },
    {
      name: "Right Knee",
      test: (rx, ry) => rx >= 0.5 && ry >= 0.4 && ry < 0.6,
      color: [200, 200, 255],
    },
    {
      name: "Left Cuff",
      test: (rx, ry) => rx < 0.5 && ry >= 0.88,
      color: [100, 255, 200],
    },
    {
      name: "Right Cuff",
      test: (rx, ry) => rx >= 0.5 && ry >= 0.88,
      color: [100, 255, 200],
    },
    {
      name: "Leg",
      test: () => true,
      color: [180, 180, 255],
    },
  ],

  // 12 = Skirt
  12: [
    {
      name: "Waistband",
      test: (rx, ry) => ry < 0.12,
      color: [255, 100, 100],
    },
    {
      name: "Hip Area",
      test: (rx, ry) => ry >= 0.12 && ry < 0.4,
      color: [200, 150, 255],
    },
    {
      name: "Hem",
      test: (rx, ry) => ry >= 0.88,
      color: [150, 255, 150],
    },
    {
      name: "Body",
      test: () => true,
      color: [180, 180, 255],
    },
  ],

  // 10 = Jumpsuits
  10: [
    {
      name: "Neckline",
      test: (rx, ry) => ry < 0.08 && rx > 0.3 && rx < 0.7,
      color: [255, 100, 100],
    },
    {
      name: "Left Sleeve",
      test: (rx, ry) => rx < 0.15 && ry < 0.3,
      color: [100, 200, 255],
    },
    {
      name: "Right Sleeve",
      test: (rx, ry) => rx > 0.85 && ry < 0.3,
      color: [100, 200, 255],
    },
    {
      name: "Bodice",
      test: (rx, ry) => ry > 0.05 && ry < 0.35,
      color: [200, 150, 255],
    },
    {
      name: "Waist",
      test: (rx, ry) => ry >= 0.3 && ry < 0.45,
      color: [255, 200, 150],
    },
    {
      name: "Leg",
      test: (rx, ry) => ry >= 0.45,
      color: [150, 200, 255],
    },
  ],

  // 1 = Hat
  1: [
    {
      name: "Crown",
      test: (rx, ry) => ry < 0.6,
      color: [255, 100, 100],
    },
    {
      name: "Brim",
      test: (rx, ry) => ry >= 0.6,
      color: [100, 200, 255],
    },
  ],

  // 5 = Scarf
  5: [
    { name: "Scarf", test: () => true, color: [255, 150, 200] },
  ],

  // 3 = Sunglasses
  3: [
    { name: "Sunglasses", test: () => true, color: [100, 100, 255] },
  ],

  // 8 = Socks
  8: [
    {
      name: "Cuff",
      test: (rx, ry) => ry < 0.2,
      color: [255, 100, 100],
    },
    {
      name: "Ankle",
      test: (rx, ry) => ry >= 0.2 && ry < 0.5,
      color: [200, 200, 255],
    },
    {
      name: "Foot",
      test: (rx, ry) => ry >= 0.5,
      color: [150, 255, 200],
    },
  ],

  // 11 = Scarf (duplicate ID in dataset)
  11: [
    { name: "Scarf", test: () => true, color: [255, 150, 200] },
  ],
};

/**
 * Lazily load the ONNX session (one time, ~105MB download).
 */
async function getSession() {
  if (sessionPromise) return sessionPromise;

  sessionPromise = (async () => {
    const ort = getOrt();

    ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4;
    ort.env.wasm.simd = true;

    const session = await ort.InferenceSession.create(
      "/models/segformer-b2-clothes.onnx",
      {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      }
    );

    console.log(
      "[SegFormer] Model loaded. Inputs:",
      session.inputNames,
      "Outputs:",
      session.outputNames
    );
    return session;
  })();

  return sessionPromise;
}

/**
 * Preprocess: resize image to 512x512, normalize to ImageNet mean/std,
 * return Float32 CHW tensor.
 */
function preprocessImage(imageData, width, height) {
  const targetW = 512;
  const targetH = 512;

  const offscreen = new OffscreenCanvas(targetW, targetH);
  const ctx = offscreen.getContext("2d");

  const srcCanvas = new OffscreenCanvas(width, height);
  const srcCtx = srcCanvas.getContext("2d");
  srcCtx.putImageData(imageData, 0, 0);
  ctx.drawImage(srcCanvas, 0, 0, targetW, targetH);

  const resized = ctx.getImageData(0, 0, targetW, targetH);
  const pixels = resized.data;

  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];

  const float32 = new Float32Array(3 * targetW * targetH);
  for (let i = 0; i < targetW * targetH; i++) {
    const r = pixels[i * 4] / 255.0;
    const g = pixels[i * 4 + 1] / 255.0;
    const b = pixels[i * 4 + 2] / 255.0;

    float32[0 * targetW * targetH + i] = (r - mean[0]) / std[0];
    float32[1 * targetW * targetH + i] = (g - mean[1]) / std[1];
    float32[2 * targetW * targetH + i] = (b - mean[2]) / std[2];
  }

  return { tensor: float32, targetW, targetH };
}

/**
 * Compute bounding box for each category in the pixel map.
 */
function computeCategoryBounds(pixelMap, width, height) {
  const bounds = {};

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cat = pixelMap[y * width + x];
      if (cat === 0) continue; // skip background

      if (!bounds[cat]) {
        bounds[cat] = { minX: x, maxX: x, minY: y, maxY: y, pixelCount: 0 };
      }
      const b = bounds[cat];
      if (x < b.minX) b.minX = x;
      if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y;
      if (y > b.maxY) b.maxY = y;
      b.pixelCount++;
    }
  }

  return bounds;
}

/**
 * Run SegFormer on a canvas and return the full pixel map + bounding boxes.
 */
export async function runSegFormer(canvas) {
  const session = await getSession();
  const ort = getOrt();

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const { tensor, targetW, targetH } = preprocessImage(
    imageData,
    canvas.width,
    canvas.height
  );

  const inputTensor = new ort.Tensor("float32", tensor, [
    1, 3, targetH, targetW,
  ]);

  const inputName = session.inputNames[0];
  const results = await session.run({ [inputName]: inputTensor });
  const outputName = session.outputNames[0];
  const output = results[outputName];

  const [, numClasses, outH, outW] = output.dims;
  const logits = output.data;
  const pixelMap = new Uint8Array(outH * outW);

  for (let i = 0; i < outH * outW; i++) {
    let maxVal = -Infinity;
    let maxIdx = 0;
    for (let c = 0; c < numClasses; c++) {
      const val = logits[c * outH * outW + i];
      if (val > maxVal) {
        maxVal = val;
        maxIdx = c;
      }
    }
    pixelMap[i] = maxIdx;
  }

  // Compute bounding boxes for sub-region detection
  const categoryBounds = computeCategoryBounds(pixelMap, outW, outH);

  return {
    pixelMap,
    width: outW,
    height: outH,
    originalWidth: canvas.width,
    originalHeight: canvas.height,
    categoryBounds,
  };
}

/**
 * Look up the category AND sub-region at a given point in original image coordinates.
 * Returns detailed label like "Left Sleeve" instead of just "Upper-clothes".
 */
export function getCategoryAtPoint(segResult, imgX, imgY) {
  const { pixelMap, width, height, originalWidth, originalHeight, categoryBounds } = segResult;

  const mapX = Math.floor((imgX / originalWidth) * width);
  const mapY = Math.floor((imgY / originalHeight) * height);

  const clampedX = Math.max(0, Math.min(width - 1, mapX));
  const clampedY = Math.max(0, Math.min(height - 1, mapY));

  const categoryId = pixelMap[clampedY * width + clampedX];

  if (!GARMENT_CATEGORIES.has(categoryId)) {
    return {
      categoryId,
      label: CATEGORY_LABELS[categoryId] || "Unknown",
      subRegion: null,
      isGarment: false,
    };
  }

  // Sub-region detection using bounding-box relative position
  const bounds = categoryBounds?.[categoryId];
  let subRegion = null;

  if (bounds) {
    const bw = bounds.maxX - bounds.minX || 1;
    const bh = bounds.maxY - bounds.minY || 1;
    const rx = (clampedX - bounds.minX) / bw; // 0–1 relative X within bounding box
    const ry = (clampedY - bounds.minY) / bh; // 0–1 relative Y within bounding box
    const aspect = bw / bh;

    const regions = SUB_REGIONS[categoryId];
    if (regions) {
      for (const region of regions) {
        if (region.test(rx, ry, aspect)) {
          subRegion = region.name;
          break;
        }
      }
    }
  }

  const baseLabel = CATEGORY_LABELS[categoryId] || "Garment";
  const label = subRegion ? `${subRegion}` : baseLabel;

  return {
    categoryId,
    label,
    baseLabel,
    subRegion,
    isGarment: true,
  };
}

/**
 * Build a binary mask canvas for all pixels of a given category.
 */
export function buildCategoryMask(segResult, categoryId) {
  const { pixelMap, width, height, originalWidth, originalHeight } = segResult;

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = width;
  maskCanvas.height = height;
  const ctx = maskCanvas.getContext("2d");
  const imgData = ctx.createImageData(width, height);

  for (let i = 0; i < width * height; i++) {
    if (pixelMap[i] === categoryId) {
      imgData.data[i * 4] = 255;
      imgData.data[i * 4 + 1] = 255;
      imgData.data[i * 4 + 2] = 255;
      imgData.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  const scaledCanvas = document.createElement("canvas");
  scaledCanvas.width = originalWidth;
  scaledCanvas.height = originalHeight;
  const scaledCtx = scaledCanvas.getContext("2d");
  scaledCtx.imageSmoothingEnabled = true;
  scaledCtx.imageSmoothingQuality = "high";
  scaledCtx.drawImage(maskCanvas, 0, 0, originalWidth, originalHeight);

  return scaledCanvas;
}

/**
 * Build a binary mask for a specific sub-region within a category.
 * Uses the bounding box + sub-region spatial test to produce a tighter mask.
 */
export function buildSubRegionMask(segResult, categoryId, subRegionName) {
  const { pixelMap, width, height, originalWidth, originalHeight, categoryBounds } = segResult;
  const bounds = categoryBounds?.[categoryId];
  if (!bounds) return buildCategoryMask(segResult, categoryId);

  const regions = SUB_REGIONS[categoryId];
  const region = regions?.find((r) => r.name === subRegionName);
  if (!region) return buildCategoryMask(segResult, categoryId);

  const bw = bounds.maxX - bounds.minX || 1;
  const bh = bounds.maxY - bounds.minY || 1;

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = width;
  maskCanvas.height = height;
  const ctx = maskCanvas.getContext("2d");
  const imgData = ctx.createImageData(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (pixelMap[i] !== categoryId) continue;

      const rx = (x - bounds.minX) / bw;
      const ry = (y - bounds.minY) / bh;

      if (region.test(rx, ry, bw / bh)) {
        imgData.data[i * 4] = 255;
        imgData.data[i * 4 + 1] = 255;
        imgData.data[i * 4 + 2] = 255;
        imgData.data[i * 4 + 3] = 255;
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);

  const scaledCanvas = document.createElement("canvas");
  scaledCanvas.width = originalWidth;
  scaledCanvas.height = originalHeight;
  const scaledCtx = scaledCanvas.getContext("2d");
  scaledCtx.imageSmoothingEnabled = true;
  scaledCtx.imageSmoothingQuality = "high";
  scaledCtx.drawImage(maskCanvas, 0, 0, originalWidth, originalHeight);

  return scaledCanvas;
}

/**
 * Render a full-image debug visualization of the segmentation map.
 */
export function renderSegmentationOverlay(segResult, alpha = 0.4) {
  const { pixelMap, width, height, originalWidth, originalHeight } = segResult;

  const overlayCanvas = document.createElement("canvas");
  overlayCanvas.width = width;
  overlayCanvas.height = height;
  const ctx = overlayCanvas.getContext("2d");
  const imgData = ctx.createImageData(width, height);

  for (let i = 0; i < width * height; i++) {
    const cat = pixelMap[i];
    const color = CATEGORY_COLORS[cat] || [0, 0, 0];
    imgData.data[i * 4] = color[0];
    imgData.data[i * 4 + 1] = color[1];
    imgData.data[i * 4 + 2] = color[2];
    imgData.data[i * 4 + 3] = cat === 0 ? 0 : Math.floor(alpha * 255);
  }
  ctx.putImageData(imgData, 0, 0);

  const scaled = document.createElement("canvas");
  scaled.width = originalWidth;
  scaled.height = originalHeight;
  scaled.getContext("2d").drawImage(overlayCanvas, 0, 0, originalWidth, originalHeight);

  return scaled;
}

export { CATEGORY_LABELS, GARMENT_CATEGORIES, SUB_REGIONS };
