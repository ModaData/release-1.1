// File: app/api/sam-encode/route.js — SAM Segmentation API
// Primary: Grounded SAM (schananas/grounded_sam) — text-prompted, always warm, ~3s, $0.003
// Fallback: SAM3 (yodagg/sam3-image-seg) — point-prompted, may cold boot
import { NextResponse } from "next/server";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;

// Grounded SAM — text-prompt masking (1M+ runs, always warm, ~3s)
const GROUNDED_SAM_VERSION =
  "ee871c19efb1941f55f66a3d7d960428c8a5afcb77449547fe8e5a3ab9ebc21c";

// SAM3 — point-prompt masking (fallback)
const SAM3_VERSION =
  "7eb9c942234dec84193a945331ff37fa142363aca9662170a52f2c66a2324e01";

/**
 * Upload a data URL to Replicate's file hosting (multipart/form-data).
 */
async function uploadDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return dataUrl;

  const mimeType = match[1];
  const base64Data = match[2];
  const buffer = Buffer.from(base64Data, "base64");
  const ext = mimeType.includes("png") ? "png" : "jpg";

  const blob = new Blob([buffer], { type: mimeType });
  const formData = new FormData();
  formData.append("content", blob, `sam-input.${ext}`);

  const uploadRes = await fetch("https://api.replicate.com/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${REPLICATE_TOKEN}` },
    body: formData,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    console.error("[SAM] File upload failed:", uploadRes.status, errText);
    throw new Error(`File upload failed: ${uploadRes.status}`);
  }
  const uploadData = await uploadRes.json();
  console.log("[SAM] Uploaded file:", uploadData.urls?.get);
  return uploadData.urls?.get;
}

/**
 * Run a Replicate prediction and poll until completion.
 * Includes retry logic for rate-limited accounts (<$5 credit).
 */
async function runPrediction(version, input, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const createRes = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REPLICATE_TOKEN}`,
        "Content-Type": "application/json",
        Prefer: "wait",
      },
      body: JSON.stringify({ version, input }),
    });

    let result = await createRes.json();

    if (!createRes.ok) {
      // Handle rate limiting — wait and retry
      if (createRes.status === 429 && attempt < maxRetries) {
        const waitTime = Math.min(10, (attempt + 1) * 5);
        console.log(`[SAM] Rate limited (attempt ${attempt + 1}/${maxRetries + 1}), waiting ${waitTime}s...`);
        await new Promise((r) => setTimeout(r, waitTime * 1000));
        continue;
      }
      throw new Error(result.detail || `Prediction create failed: ${createRes.status}`);
    }

    // Poll if not completed (cold boot or long inference)
    if (result.status !== "succeeded" && result.status !== "failed") {
      for (let i = 0; i < 45; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const pollRes = await fetch(
          `https://api.replicate.com/v1/predictions/${result.id}`,
          { headers: { Authorization: `Bearer ${REPLICATE_TOKEN}` } }
        );
        result = await pollRes.json();
        console.log(`[SAM] Poll ${i + 1}: ${result.status}`);
        if (result.status === "succeeded" || result.status === "failed") break;
      }
    }

    if (result.status === "failed") {
      throw new Error(result.error || "Prediction failed");
    }

    return result.output;
  }

  // All retries exhausted
  throw new Error("Rate limited — all retries exhausted. Please try again in a few seconds.");
}

export async function POST(request) {
  if (!REPLICATE_TOKEN) {
    return NextResponse.json(
      { error: "REPLICATE_API_TOKEN not configured" },
      { status: 500 }
    );
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { image, label, point_x, point_y } = body;

    if (!image) {
      return NextResponse.json({ error: "Missing 'image'" }, { status: 400 });
    }

    // Upload data URL to Replicate file hosting
    let imageUrl = image;
    if (image.startsWith("data:")) {
      console.log("[SAM] Uploading image to Replicate...");
      imageUrl = await uploadDataUrl(image);
      console.log("[SAM] Image URL:", imageUrl);
    }

    let masks = [];
    let maskType = "unknown";

    // Use provided label, or default to a broad garment prompt
    const effectiveLabel = label || "clothing";

    // ── Strategy 1: Grounded SAM with text prompt (preferred — always warm) ──
    try {
      const prompt = mapLabelToPrompt(effectiveLabel);
      console.log(`[SAM] Grounded SAM: label="${effectiveLabel}" → prompt="${prompt}"`);

      const output = await runPrediction(GROUNDED_SAM_VERSION, {
        image: imageUrl,
        mask_prompt: prompt,
        adjustment_factor: 0,
      });

      masks = extractMasksFromOutput(output);
      maskType = "grounded_sam";
      console.log(`[SAM] Grounded SAM returned ${masks.length} mask(s)`);
    } catch (err) {
      const msg = err.message || "";
      if (msg.includes("reshape tensor") || msg.includes("0 elements")) {
        console.warn(`[SAM] Grounded SAM: no "${effectiveLabel}" detected in image (falling back)`);
      } else {
        console.warn("[SAM] Grounded SAM failed:", msg);
      }
    }

    // ── Strategy 1b: Retry Grounded SAM with broader prompt if specific label failed ──
    if (masks.length === 0 && effectiveLabel !== "clothing") {
      try {
        console.log(`[SAM] Grounded SAM retry with broad prompt: "clothing,garment,fabric"`);
        const output = await runPrediction(GROUNDED_SAM_VERSION, {
          image: imageUrl,
          mask_prompt: "clothing,garment,fabric",
          adjustment_factor: 0,
        });

        masks = extractMasksFromOutput(output);
        maskType = "grounded_sam_broad";
        console.log(`[SAM] Grounded SAM (broad) returned ${masks.length} mask(s)`);
      } catch (err) {
        console.warn("[SAM] Grounded SAM (broad) failed:", err.message);
      }
    }

    // ── Strategy 2: SAM3 with point prompt (fallback — may cold boot) ──
    if (masks.length === 0 && point_x !== undefined && point_y !== undefined) {
      try {
        console.log(`[SAM] SAM3 point prompt: (${point_x}, ${point_y})`);

        const output = await runPrediction(SAM3_VERSION, {
          image: imageUrl,
          points: JSON.stringify([[Math.round(point_x), Math.round(point_y)]]),
          point_labels: JSON.stringify([1]),
          multimask_output: false,
          return_polygons: false,
          visualize_output: false,
        });

        // Handle various SAM3 output formats
        if (output?.pred_masks?.length > 0) {
          masks = output.pred_masks;
        } else if (Array.isArray(output)) {
          masks = extractMasksFromOutput(output);
        } else if (output && typeof output === "string") {
          masks = [output];
        } else if (output?.masks?.length > 0) {
          masks = output.masks;
        }

        if (masks.length > 0) {
          maskType = "sam3_point";
          console.log(`[SAM] SAM3 returned ${masks.length} mask(s)`);
        }
      } catch (err) {
        console.warn("[SAM] SAM3 point-prompt failed:", err.message);
      }
    }

    if (masks.length === 0) {
      return NextResponse.json(
        {
          error: "No masks generated. SAM could not detect any regions in the image. Try clicking directly on a garment area.",
          strategies_tried: [
            `grounded_sam (label: "${effectiveLabel}")`,
            effectiveLabel !== "clothing" ? "grounded_sam (broad: clothing,garment,fabric)" : null,
            point_x !== undefined ? `sam3_point (${point_x}, ${point_y})` : "sam3_point (no coordinates)",
          ].filter(Boolean),
        },
        { status: 500 }
      );
    }

    // Convert mask URLs to base64 data URLs to avoid browser CORS issues
    // (replicate.delivery doesn't set Access-Control-Allow-Origin headers)
    const masksAsDataUrls = await Promise.all(
      masks.map(async (maskUrl) => {
        try {
          if (maskUrl.startsWith("data:")) return maskUrl; // Already a data URL
          const res = await fetch(maskUrl);
          if (!res.ok) throw new Error(`Mask fetch failed: ${res.status}`);
          const buffer = await res.arrayBuffer();
          const contentType = res.headers.get("content-type") || "image/png";
          const base64 = Buffer.from(buffer).toString("base64");
          console.log(`[SAM] Proxied mask: ${maskUrl.substring(0, 60)}... → data URL (${buffer.byteLength} bytes)`);
          return `data:${contentType};base64,${base64}`;
        } catch (err) {
          console.warn(`[SAM] Failed to proxy mask URL, returning original:`, err.message);
          return maskUrl; // Fallback to original URL
        }
      })
    );

    return NextResponse.json({
      status: "ready",
      masks: masksAsDataUrls,
      maskType,
    });
  } catch (err) {
    console.error("[SAM] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * Extract mask URLs from Grounded SAM output (handles various output shapes).
 * Grounded SAM returns: [annotated_mask, neg_annotated, mask, inverted_mask]
 * We want the clean binary mask (index 2, filename contains "mask" but not "annotated"/"inverted").
 */
function extractMasksFromOutput(output) {
  if (!output) return [];

  if (typeof output === "string" && output.startsWith("http")) {
    return [output];
  }

  if (Array.isArray(output)) {
    const allUrls = output.filter((u) => typeof u === "string" && u.startsWith("http"));
    if (allUrls.length === 0) return [];

    // Find the clean binary mask (not annotated, not inverted)
    const binaryMask = allUrls.find(
      (u) => u.includes("/mask") && !u.includes("annotated") && !u.includes("inverted")
    );
    if (binaryMask) return [binaryMask];

    // Fallback: if 3+ URLs, index 2 is typically the binary mask; otherwise use first
    return [allUrls[allUrls.length > 2 ? 2 : 0]];
  }

  // Handle object outputs with masks/pred_masks keys
  if (output.masks && Array.isArray(output.masks)) return output.masks;
  if (output.pred_masks && Array.isArray(output.pred_masks)) return output.pred_masks;

  return [];
}

/**
 * Map a SegFormer base category label to a Grounded SAM text prompt.
 * These are garment-level labels like "Upper-clothes", "Pants", "Dress" etc.
 * Grounded SAM works best with simple, common object descriptions.
 */
function mapLabelToPrompt(label) {
  const lower = label.toLowerCase();

  // SegFormer category labels → Grounded SAM prompts
  const mappings = {
    "upper-clothes": "shirt,top,upper body garment",
    "upper clothes": "shirt,top,upper body garment",
    "dress": "dress",
    "coat": "coat,jacket,outerwear",
    "pants": "pants,trousers",
    "skirt": "skirt",
    "scarf": "scarf",
    "socks": "socks",
    "hat": "hat,cap",
    "sunglasses": "sunglasses,glasses",
    "jumpsuits": "jumpsuit,romper",
    "left-shoe": "shoes",
    "right-shoe": "shoes",
    "belt": "belt",
    "bag": "bag,handbag",
    "glove": "gloves",
    "clothing": "clothing,garment,fabric",
  };

  // Check direct matches
  for (const [key, prompt] of Object.entries(mappings)) {
    if (lower.includes(key)) return prompt;
  }

  // Common garment keywords fallback
  if (lower.includes("shirt") || lower.includes("top") || lower.includes("blouse")) return "shirt,top";
  if (lower.includes("jacket")) return "jacket,coat";
  if (lower.includes("jean") || lower.includes("trouser")) return "pants,trousers";
  if (lower.includes("shoe") || lower.includes("boot")) return "shoes";

  // Last resort: use cleaned label
  return lower.replace(/[-_]/g, " ");
}
