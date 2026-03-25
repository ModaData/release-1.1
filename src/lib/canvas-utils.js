// File 3: lib/canvas-utils.js — Shared Canvas Helpers

/**
 * Load an image URL into a canvas element, sizing the canvas to match.
 * Returns the loaded Image object.
 */
export function loadImageToCanvas(canvas, src) {
  return new Promise((resolve, reject) => {
    if (!canvas) return reject(new Error("Canvas ref is null"));

    const img = new Image();
    // Only set crossOrigin for HTTP URLs — data: and blob: URLs are same-origin
    if (src.startsWith("http")) {
      img.crossOrigin = "anonymous";
    }

    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      resolve(img);
    };

    img.onerror = () => reject(new Error("Failed to load image: " + src));
    img.src = src;
  });
}

/**
 * Sync overlay canvas dimensions to match a reference canvas.
 */
export function syncCanvasSize(referenceCanvas, ...overlayCanvases) {
  if (!referenceCanvas) return;
  const { width, height } = referenceCanvas;

  overlayCanvases.forEach((canvas) => {
    if (canvas && (canvas.width !== width || canvas.height !== height)) {
      canvas.width = width;
      canvas.height = height;
    }
  });
}

/**
 * Clear a canvas completely.
 */
export function clearCanvas(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/**
 * Convert canvas content to a data URL.
 */
export function canvasToDataUrl(canvas, type = "image/png") {
  if (!canvas) return null;
  return canvas.toDataURL(type);
}

/**
 * Get pointer coordinates in canvas image-space.
 */
export function getCanvasCoords(e, canvas) {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: Math.floor((e.clientX - rect.left) * scaleX),
    y: Math.floor((e.clientY - rect.top) * scaleY),
  };
}

/**
 * Check if a pixel in a mask canvas is "on" (non-transparent).
 */
export function isPixelInMask(maskCanvas, x, y) {
  if (!maskCanvas) return false;
  try {
    const ctx = maskCanvas.getContext("2d", { willReadFrequently: true });
    const pixel = ctx.getImageData(x, y, 1, 1).data;
    return pixel[3] > 128;
  } catch {
    return false;
  }
}

/**
 * Check if a canvas has any non-transparent pixels (i.e., user has drawn something).
 */
export function canvasHasContent(canvas) {
  if (!canvas) return false;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  // Sample every 16th pixel for speed
  for (let i = 3; i < data.length; i += 64) {
    if (data[i] > 0) return true;
  }
  return false;
}

/**
 * Draw a beautiful glow overlay on the mask canvas.
 * Refabric-style: semi-transparent tinted overlay with soft glowing border.
 */
export function drawMaskGlow(overlayCanvas, maskCanvas) {
  if (!overlayCanvas || !maskCanvas) return;

  const ctx = overlayCanvas.getContext("2d");
  const w = overlayCanvas.width;
  const h = overlayCanvas.height;

  ctx.clearRect(0, 0, w, h);

  // Step 1: Draw the mask shape
  ctx.drawImage(maskCanvas, 0, 0, w, h);

  // Step 2: Tint the filled area with a semi-transparent indigo/blue
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = "rgba(99, 102, 241, 0.25)";
  ctx.fillRect(0, 0, w, h);

  // Step 3: Draw a glowing border around the mask
  ctx.globalCompositeOperation = "source-over";

  // Create a blurred version of the mask for the glow
  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = w;
  glowCanvas.height = h;
  const glowCtx = glowCanvas.getContext("2d");

  // Draw mask, apply blur for glow
  glowCtx.filter = "blur(6px)";
  glowCtx.drawImage(maskCanvas, 0, 0, w, h);
  glowCtx.filter = "none";

  // Tint the glow
  glowCtx.globalCompositeOperation = "source-in";
  glowCtx.fillStyle = "rgba(99, 102, 241, 0.5)";
  glowCtx.fillRect(0, 0, w, h);

  // Composite glow under the fill
  ctx.globalCompositeOperation = "destination-over";
  ctx.drawImage(glowCanvas, 0, 0);

  // Step 4: Draw crisp edge border
  ctx.globalCompositeOperation = "source-over";

  // Create edge detection via XOR of mask and slightly eroded mask
  const edgeCanvas = document.createElement("canvas");
  edgeCanvas.width = w;
  edgeCanvas.height = h;
  const edgeCtx = edgeCanvas.getContext("2d");

  // Draw blurred mask (shrunk)
  edgeCtx.filter = "blur(2px)";
  edgeCtx.drawImage(maskCanvas, 0, 0, w, h);
  edgeCtx.filter = "none";

  // Get the edge pixels
  const edgeData = edgeCtx.getImageData(0, 0, w, h);
  const maskTempCanvas = document.createElement("canvas");
  maskTempCanvas.width = w;
  maskTempCanvas.height = h;
  const maskTempCtx = maskTempCanvas.getContext("2d");
  maskTempCtx.drawImage(maskCanvas, 0, 0, w, h);
  const maskData = maskTempCtx.getImageData(0, 0, w, h);

  // Find border pixels (where original mask is on but blurred is partially transparent)
  const borderData = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const origAlpha = maskData.data[i * 4 + 3];
    const blurAlpha = edgeData.data[i * 4 + 3];
    if (origAlpha > 128 && blurAlpha < 240) {
      borderData.data[i * 4] = 129;     // indigo R
      borderData.data[i * 4 + 1] = 140; // indigo G
      borderData.data[i * 4 + 2] = 248; // indigo B
      borderData.data[i * 4 + 3] = 200;
    }
  }

  const borderCanvas = document.createElement("canvas");
  borderCanvas.width = w;
  borderCanvas.height = h;
  borderCanvas.getContext("2d").putImageData(borderData, 0, 0);

  ctx.drawImage(borderCanvas, 0, 0);

  ctx.globalCompositeOperation = "source-over";
}

/**
 * Create a feathered mask (2-4px gaussian blur on edges).
 * Per approach doc: prevents inpainting boundary artifacts.
 */
export function featherMask(maskCanvas, radius = 3) {
  if (!maskCanvas) return maskCanvas;

  const feathered = document.createElement("canvas");
  feathered.width = maskCanvas.width;
  feathered.height = maskCanvas.height;
  const ctx = feathered.getContext("2d");

  // BUG FIX: was missing template literal backticks around blur(...)
  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(maskCanvas, 0, 0);
  ctx.filter = "none";

  // Re-threshold to keep mask mostly binary but with soft edges
  const imgData = ctx.getImageData(0, 0, feathered.width, feathered.height);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    // Boost contrast: anything above 30% alpha becomes mostly opaque
    if (data[i + 3] > 76) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.min(255, data[i + 3] * 1.5);
    }
  }
  ctx.putImageData(imgData, 0, 0);

  return feathered;
}
