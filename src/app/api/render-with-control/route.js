// File: app/api/render-with-control/route.js — FLUX Dev + ControlNet Scribble (Precise mode)
import { NextResponse } from "next/server";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;
const CONTROLNET_VERSION = "9a8db105db745f8b11ad3afe5c8bd892428b2a43ade0b67edc4e0ccd52ff2fda";

/**
 * Upload a data URL to Replicate's file hosting using FormData (proven pattern).
 */
async function uploadDataUrl(dataUrl, label = "control") {
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
  console.log(`[render-with-control] Uploaded ${label}:`, url.substring(0, 80));
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
    const {
      prompt,
      negativePrompt,
      controlImage,
      controlType,
      controlStrength,
      width,
      height,
    } = await request.json();

    if (!prompt || !controlImage) {
      return NextResponse.json({ error: "Prompt and control image required" }, { status: 400 });
    }

    // Upload control image if it's a data URL
    let controlImageUrl = controlImage;
    if (controlImage.startsWith("data:")) {
      controlImageUrl = await uploadDataUrl(controlImage, "sketch-control");
    }

    console.log("[render-with-control] Prompt:", prompt.substring(0, 200));

    // Use FLUX Dev + ControlNet via version-based API with Prefer: wait
    const res = await fetch(
      "https://api.replicate.com/v1/predictions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${REPLICATE_TOKEN}`,
          "Content-Type": "application/json",
          Prefer: "wait",
        },
        body: JSON.stringify({
          version: CONTROLNET_VERSION,
          input: {
            prompt,
            control_image: controlImageUrl,
            control_type: controlType === "scribble" ? "soft_edge" : (controlType || "soft_edge"),
            control_strength: controlStrength || 0.65,
            steps: 28,
            guidance_scale: 3.5,
            output_format: "jpg",
            output_quality: 80,
            ...(negativePrompt && { negative_prompt: negativePrompt }),
          },
        }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      console.error("[render-with-control] ControlNet error:", data);
      return NextResponse.json(
        { error: data.detail || data.error || `ControlNet error ${res.status}` },
        { status: res.status }
      );
    }

    // If Prefer: wait returned a completed result
    if (data.status === "succeeded" || data.output) {
      const imageUrl = parseOutput(data.output);
      if (imageUrl) {
        return NextResponse.json({
          success: true,
          imageUrl,
          predictionId: data.id,
        });
      }
    }

    // Fallback: poll
    if (data.id) {
      const imageUrl = await pollPrediction(data.id);
      return NextResponse.json({
        success: true,
        imageUrl,
        predictionId: data.id,
      });
    }

    return NextResponse.json({ error: "ControlNet returned no output" }, { status: 500 });
  } catch (err) {
    console.error("[render-with-control] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function parseOutput(output) {
  if (typeof output === "string") return output;
  if (Array.isArray(output) && output.length > 0) {
    const first = output[0];
    return typeof first === "string" ? first : first?.url || first?.uri;
  }
  if (output?.url) return output.url;
  return null;
}

async function pollPrediction(id) {
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 2000));

    const res = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: { Authorization: `Bearer ${REPLICATE_TOKEN}` },
    });

    if (!res.ok) throw new Error("Failed to poll prediction");
    const data = await res.json();

    if (data.status === "succeeded") {
      const url = parseOutput(data.output);
      if (url) return url;
      throw new Error("Unexpected output format");
    }

    if (data.status === "failed" || data.status === "canceled") {
      throw new Error(data.error || "Prediction failed");
    }
  }
  throw new Error("Prediction timed out");
}
