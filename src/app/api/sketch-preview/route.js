// File: app/api/sketch-preview/route.js — Fast FLUX preview from sketch (low quality for speed)
import { NextResponse } from "next/server";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;

// Official FLUX.1 Fill Dev model (model-based API — always uses latest version)
const FLUX_FILL_DEV_MODEL = "black-forest-labs/flux-fill-dev";

/**
 * Upload a data URL to Replicate's file hosting.
 * Throws on failure instead of silently returning the data URL.
 */
async function uploadDataUrl(dataUrl, label = "file") {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error(`Invalid data URL for ${label}`);

  const mimeType = match[1];
  const base64Data = match[2];
  const buffer = Buffer.from(base64Data, "base64");
  const ext = mimeType.includes("png") ? "png" : "jpg";

  const blob = new Blob([buffer], { type: mimeType });
  const formData = new FormData();
  formData.append("content", blob, `${label}.${ext}`);

  const uploadRes = await fetch("https://api.replicate.com/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${REPLICATE_TOKEN}` },
    body: formData,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => "");
    throw new Error(`File upload failed for ${label}: ${uploadRes.status} ${errText}`);
  }

  const uploadData = await uploadRes.json();
  const url = uploadData.urls?.get;
  if (!url) throw new Error(`File upload for ${label} returned no URL`);
  console.log(`[sketch-preview] Uploaded ${label}:`, url.substring(0, 80));
  return url;
}

/**
 * Generate a full white PNG mask as a data URL at the given dimensions.
 * Uses zlib to produce a proper PNG with all-white pixels.
 */
function generateWhiteMask(width = 768, height = 1024) {
  const zlib = require("zlib");

  // PNG helper: write 4-byte big-endian uint
  function writeUint32BE(buf, val, offset) {
    buf[offset] = (val >>> 24) & 0xff;
    buf[offset + 1] = (val >>> 16) & 0xff;
    buf[offset + 2] = (val >>> 8) & 0xff;
    buf[offset + 3] = val & 0xff;
  }

  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk: width, height, bit depth 8, color type 2 (RGB), compression 0, filter 0, interlace 0
  const ihdrData = Buffer.alloc(13);
  writeUint32BE(ihdrData, width, 0);
  writeUint32BE(ihdrData, height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type RGB
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = makeChunk("IHDR", ihdrData);

  // IDAT chunk: raw image data (filter byte 0 + RGB white pixels per row)
  const rowSize = 1 + width * 3; // filter byte + RGB
  const rawData = Buffer.alloc(rowSize * height, 255); // all 0xFF
  // Set filter bytes to 0 (None) at start of each row
  for (let y = 0; y < height; y++) {
    rawData[y * rowSize] = 0;
  }
  const compressed = zlib.deflateSync(rawData);
  const idat = makeChunk("IDAT", compressed);

  // IEND chunk
  const iend = makeChunk("IEND", Buffer.alloc(0));

  const png = Buffer.concat([signature, ihdr, idat, iend]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

function makeChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const crcInput = Buffer.concat([typeBuffer, data]);
  const crc = crc32(crcInput);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc >>> 0, 0);

  return Buffer.concat([length, typeBuffer, data, crcBuf]);
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function POST(request) {
  if (!REPLICATE_TOKEN) {
    return NextResponse.json(
      { error: "REPLICATE_API_TOKEN not configured in .env.local" },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const {
      sketchDataUrl,
      silhouetteId,
      silhouetteLabel,
      interpretation,
      suggestedPrompt,
      brandBrief,
    } = body;

    if (!sketchDataUrl) {
      return NextResponse.json(
        { error: "Missing 'sketchDataUrl' in request" },
        { status: 400 }
      );
    }

    // ── Build prompt — white clay 3D maquette aesthetic ──
    const promptParts = [
      "White clay 3D render of",
      silhouetteLabel ? `${silhouetteLabel} garment` : "garment",
    ];

    if (suggestedPrompt) {
      promptParts.push(suggestedPrompt);
    }

    promptParts.push(
      "matte white plaster material, no color, no fabric texture, no pattern",
      "uniform neutral white/off-white surface",
      "all construction details fully visible and sharp: seams, stitching lines, collar shape, pocket placement, closure hardware, cuff construction, hem finish",
      "subtle soft shadows showing depth and dimension",
      "garment shown flat-lay or floating on invisible mannequin",
      "clean black background",
      "product photography lighting, soft directional studio light from upper left",
      "photorealistic clay maquette aesthetic, no model, no hanger, no tags",
      "centered composition, high detail, 8K quality"
    );

    const prompt = promptParts.filter(Boolean).join(", ");

    // ── Create full white mask ──
    // For sketch-to-image, white mask = regenerate entire image from sketch guidance
    const maskDataUrl = generateWhiteMask();

    // ── Upload sketch + mask to Replicate file hosting ──
    console.log("[sketch-preview] Uploading sketch + mask...");
    const [sketchUrl, maskUrl] = await Promise.all([
      uploadDataUrl(sketchDataUrl, "sketch"),
      uploadDataUrl(maskDataUrl, "mask"),
    ]);

    // ── Call FLUX.1 Fill Dev via model-based API (fast preview) ──
    console.log("[sketch-preview] Calling FLUX.1 Fill Dev (fast preview)...");
    console.log("[sketch-preview] Prompt:", prompt.substring(0, 200));

    const res = await fetch(
      `https://api.replicate.com/v1/models/${FLUX_FILL_DEV_MODEL}/predictions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${REPLICATE_TOKEN}`,
          "Content-Type": "application/json",
          Prefer: "wait", // Wait for result (sync)
        },
        body: JSON.stringify({
          input: {
            image: sketchUrl,
            mask: maskUrl,
            prompt,
            num_inference_steps: 15, // Reduced from 28 for speed
            guidance: 20, // Lower guidance for creative interpretation
            output_format: "jpg",
            output_quality: 75,
          },
        }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      console.error("FLUX preview error:", data);
      return NextResponse.json(
        { error: data.detail || data.error || `FLUX error ${res.status}` },
        { status: res.status }
      );
    }

    // Parse output URL
    let previewUrl;
    const output = data.output;
    if (typeof output === "string") {
      previewUrl = output;
    } else if (Array.isArray(output) && output.length > 0) {
      const first = output[0];
      previewUrl = typeof first === "string" ? first : first?.url || first?.uri;
    } else if (output?.url) {
      previewUrl = output.url;
    }

    if (!previewUrl) {
      return NextResponse.json(
        { error: "FLUX returned no output" },
        { status: 500 }
      );
    }

    console.log("[sketch-preview] Preview URL:", previewUrl);

    return NextResponse.json({
      previewUrl,
      predictionId: data.id,
      prompt: prompt.substring(0, 200),
    });
  } catch (err) {
    console.error("POST /api/sketch-preview error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
