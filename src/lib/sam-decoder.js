// File: lib/sam-decoder.js — SAM Decoder In-Browser (ONNX)
// Per approach doc: "Lightweight decoder to the browser via ONNX means hover interactions resolve in ~50ms."

import { getOrt } from "./ort-helper";

let decoderSessionPromise = null;

/**
 * Lazily load the SAM decoder ONNX session.
 */
async function getDecoderSession() {
  if (decoderSessionPromise) return decoderSessionPromise;

  decoderSessionPromise = (async () => {
    const ort = getOrt();

    ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4;
    ort.env.wasm.simd = true;

    const session = await ort.InferenceSession.create(
      "/models/sam-vit-b-decoder.onnx",
      {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      }
    );

    console.log(
      "[SAM Decoder] Loaded. Inputs:",
      session.inputNames,
      "Outputs:",
      session.outputNames
    );
    return session;
  })();

  return decoderSessionPromise;
}

/**
 * Decode a mask from SAM embeddings + a single point.
 *
 * @param {Float32Array} imageEmbedding - From the SAM encoder (256x64x64)
 * @param {number} pointX - Click X in original image space
 * @param {number} pointY - Click Y in original image space
 * @param {number} origWidth - Original image width
 * @param {number} origHeight - Original image height
 * @param {number} pointLabel - 1 = foreground, 0 = background
 * @returns {HTMLCanvasElement} - Binary mask canvas at original image dimensions
 */
export async function decodeMask(
  imageEmbedding,
  pointX,
  pointY,
  origWidth,
  origHeight,
  pointLabel = 1
) {
  const session = await getDecoderSession();
  const ort = getOrt();

  // SAM expects coordinates normalized to 1024x1024 input space
  const inputSize = 1024;
  const scaleX = inputSize / origWidth;
  const scaleY = inputSize / origHeight;

  const scaledX = pointX * scaleX;
  const scaledY = pointY * scaleY;

  // Build input tensors
  const embeddingTensor = new ort.Tensor("float32", imageEmbedding, [
    1, 256, 64, 64,
  ]);
  const pointCoords = new ort.Tensor(
    "float32",
    new Float32Array([scaledX, scaledY]),
    [1, 1, 2]
  );
  const pointLabels = new ort.Tensor(
    "float32",
    new Float32Array([pointLabel]),
    [1, 1]
  );
  const maskInput = new ort.Tensor(
    "float32",
    new Float32Array(256 * 256).fill(0),
    [1, 1, 256, 256]
  );
  const hasMaskInput = new ort.Tensor(
    "float32",
    new Float32Array([0]),
    [1]
  );
  const origImSize = new ort.Tensor(
    "float32",
    new Float32Array([origHeight, origWidth]),
    [2]
  );

  // Run decoder — map inputs by name
  const feeds = {};
  const inputNames = session.inputNames;

  for (const name of inputNames) {
    if (name.includes("image_embedding")) feeds[name] = embeddingTensor;
    else if (name.includes("point_coord")) feeds[name] = pointCoords;
    else if (name.includes("point_label")) feeds[name] = pointLabels;
    else if (name.includes("mask_input")) feeds[name] = maskInput;
    else if (name.includes("has_mask")) feeds[name] = hasMaskInput;
    else if (name.includes("orig_im_size")) feeds[name] = origImSize;
  }

  const results = await session.run(feeds);

  // Get the best mask (highest IoU score)
  const masks = results[session.outputNames[0]];
  const iouScores = results[session.outputNames[1]];

  let bestIdx = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < iouScores.data.length; i++) {
    if (iouScores.data[i] > bestScore) {
      bestScore = iouScores.data[i];
      bestIdx = i;
    }
  }

  // Extract the best mask
  const maskH = masks.dims[2];
  const maskW = masks.dims[3];
  const maskData = masks.data;
  const offset = bestIdx * maskH * maskW;

  // Convert logits to binary mask canvas
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = maskW;
  maskCanvas.height = maskH;
  const ctx = maskCanvas.getContext("2d");
  const imgData = ctx.createImageData(maskW, maskH);

  for (let i = 0; i < maskH * maskW; i++) {
    const logit = maskData[offset + i];
    if (logit > 0) {
      imgData.data[i * 4] = 255;
      imgData.data[i * 4 + 1] = 255;
      imgData.data[i * 4 + 2] = 255;
      imgData.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // Scale to original image dimensions if needed
  if (maskW !== origWidth || maskH !== origHeight) {
    const scaled = document.createElement("canvas");
    scaled.width = origWidth;
    scaled.height = origHeight;
    const sctx = scaled.getContext("2d");
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(maskCanvas, 0, 0, origWidth, origHeight);

    // Re-threshold after scaling
    const scaledData = sctx.getImageData(0, 0, origWidth, origHeight);
    for (let i = 3; i < scaledData.data.length; i += 4) {
      scaledData.data[i] = scaledData.data[i] > 128 ? 255 : 0;
      if (scaledData.data[i] === 255) {
        scaledData.data[i - 3] = 255;
        scaledData.data[i - 2] = 255;
        scaledData.data[i - 1] = 255;
      } else {
        scaledData.data[i - 3] = 0;
        scaledData.data[i - 2] = 0;
        scaledData.data[i - 1] = 0;
      }
    }
    sctx.putImageData(scaledData, 0, 0);
    return scaled;
  }

  return maskCanvas;
}

/**
 * Preload the decoder session (call early to hide load time).
 */
export async function preloadDecoder() {
  try {
    await getDecoderSession();
    console.log("[SAM Decoder] Preloaded successfully");
  } catch (err) {
    console.warn("[SAM Decoder] Preload failed:", err.message);
  }
}
