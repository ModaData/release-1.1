// File: app/api/clip-interrogator/route.js — CLIP Interrogator via Replicate
import { NextResponse } from "next/server";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;

// CLIP Interrogator model on Replicate (latest version)
const CLIP_INTERROGATOR_VERSION =
  "8151e1c9f47e696fa316146a2e35812ccf79cfc9eba05b11c7f450155102af70";

/**
 * Upload a data URL to Replicate's file upload endpoint (multipart/form-data).
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
  formData.append("content", blob, `clip-input.${ext}`);

  const uploadRes = await fetch("https://api.replicate.com/v1/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REPLICATE_TOKEN}`,
    },
    body: formData,
  });

  if (!uploadRes.ok) return dataUrl;
  const uploadData = await uploadRes.json();
  return uploadData.urls?.get || dataUrl;
}

export async function POST(request) {
  if (!REPLICATE_TOKEN) {
    return NextResponse.json(
      { error: "REPLICATE_API_TOKEN not configured" },
      { status: 500 }
    );
  }

  try {
    const { image } = await request.json();
    if (!image) {
      return NextResponse.json({ error: "Missing 'image'" }, { status: 400 });
    }

    // Upload image if it's a data URL
    let imageUrl = image;
    if (image.startsWith("data:")) {
      imageUrl = await uploadDataUrl(image);
    }

    // Create prediction
    const res = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REPLICATE_TOKEN}`,
        "Content-Type": "application/json",
        Prefer: "wait",
      },
      body: JSON.stringify({
        version: CLIP_INTERROGATOR_VERSION,
        input: {
          image: imageUrl,
          mode: "fast",
          clip_model_name: "ViT-L-14/openai",
        },
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { error: data.detail || `Replicate error ${res.status}` },
        { status: res.status }
      );
    }

    // If completed immediately
    if (data.status === "succeeded") {
      return NextResponse.json({ description: data.output });
    }

    // Poll for completion
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));

      const pollRes = await fetch(
        `https://api.replicate.com/v1/predictions/${data.id}`,
        { headers: { Authorization: `Bearer ${REPLICATE_TOKEN}` } }
      );
      const result = await pollRes.json();

      if (result.status === "succeeded") {
        return NextResponse.json({ description: result.output });
      }
      if (result.status === "failed" || result.status === "canceled") {
        return NextResponse.json(
          { error: result.error || "CLIP failed" },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ error: "Timed out" }, { status: 504 });
  } catch (err) {
    console.error("CLIP Interrogator error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
