// File: app/api/inpaint-3d/route.js — FLUX Fill Dev inpainting for targeted 3D texture edits
import { NextResponse } from "next/server";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;
const FLUX_FILL_DEV_MODEL = "black-forest-labs/flux-fill-dev";

/**
 * Upload a data URL to Replicate's file hosting.
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
  console.log(`[inpaint-3d] Uploaded ${label}:`, url.substring(0, 80));
  return url;
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
    const { viewportScreenshot, maskDataUrl, prompt, region } = body;

    if (!viewportScreenshot) {
      return NextResponse.json(
        { error: "Missing 'viewportScreenshot' — capture of 3D viewport" },
        { status: 400 }
      );
    }

    if (!maskDataUrl) {
      return NextResponse.json(
        { error: "Missing 'maskDataUrl' — painted region mask" },
        { status: 400 }
      );
    }

    if (!prompt) {
      return NextResponse.json(
        { error: "Missing 'prompt' — describe what to paint in the masked region" },
        { status: 400 }
      );
    }

    // ── Build inpainting prompt ──
    const promptParts = [
      prompt,
      "seamless integration with surrounding garment surface",
      "photorealistic fabric detail",
      "consistent lighting and shadows",
      "high quality, 8K detail",
    ];

    if (region) {
      promptParts.unshift(`On the ${region} of the garment:`);
    }

    const fullPrompt = promptParts.filter(Boolean).join(", ");

    // ── Upload viewport screenshot + mask ──
    console.log("[inpaint-3d] Uploading viewport screenshot + mask...");
    const [imageUrl, maskUrl] = await Promise.all([
      uploadDataUrl(viewportScreenshot, "viewport"),
      uploadDataUrl(maskDataUrl, "mask"),
    ]);

    // ── Call FLUX.1 Fill Dev for targeted inpainting ──
    console.log("[inpaint-3d] Calling FLUX.1 Fill Dev...");
    console.log("[inpaint-3d] Prompt:", fullPrompt.substring(0, 200));

    const res = await fetch(
      `https://api.replicate.com/v1/models/${FLUX_FILL_DEV_MODEL}/predictions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${REPLICATE_TOKEN}`,
          "Content-Type": "application/json",
          Prefer: "wait",
        },
        body: JSON.stringify({
          input: {
            image: imageUrl,
            mask: maskUrl,
            prompt: fullPrompt,
            num_inference_steps: 25,
            guidance: 30,
            output_format: "png",
            output_quality: 90,
          },
        }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      console.error("[inpaint-3d] FLUX error:", data);
      return NextResponse.json(
        { error: data.detail || data.error || `FLUX error ${res.status}` },
        { status: res.status }
      );
    }

    // Parse output URL
    let resultUrl;
    const output = data.output;
    if (typeof output === "string") {
      resultUrl = output;
    } else if (Array.isArray(output) && output.length > 0) {
      const first = output[0];
      resultUrl = typeof first === "string" ? first : first?.url || first?.uri;
    } else if (output?.url) {
      resultUrl = output.url;
    }

    if (!resultUrl) {
      return NextResponse.json(
        { error: "FLUX returned no output" },
        { status: 500 }
      );
    }

    console.log("[inpaint-3d] Result URL:", resultUrl);

    return NextResponse.json({
      resultUrl,
      predictionId: data.id,
      prompt: fullPrompt.substring(0, 200),
    });
  } catch (err) {
    console.error("POST /api/inpaint-3d error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
