// File 1: app/api/replicate/route.js — Server-side API Proxy
import { NextResponse } from "next/server";

// Allow large request bodies for image data URLs (App Router config)
export const maxDuration = 120; // 2 minutes for FLUX Fill Dev inpainting
export const dynamic = "force-dynamic";

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;

if (!REPLICATE_TOKEN) {
  console.warn("⚠️ REPLICATE_API_TOKEN not set in .env.local");
}

/**
 * Upload a data URL to Replicate's file upload endpoint.
 * Returns a serving URL that Replicate models can access.
 * Uses multipart/form-data as required by the current Replicate Files API.
 */
async function uploadDataUrl(dataUrl) {
  // Parse the data URL
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return dataUrl; // Not a data URL, return as-is

  const mimeType = match[1];
  const base64Data = match[2];
  const buffer = Buffer.from(base64Data, "base64");

  // Determine file extension
  const ext = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";

  // Build multipart form data
  const blob = new Blob([buffer], { type: mimeType });
  const formData = new FormData();
  formData.append("content", blob, `upload.${ext}`);

  // Upload to Replicate's file API using multipart/form-data
  const uploadRes = await fetch("https://api.replicate.com/v1/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REPLICATE_TOKEN}`,
    },
    body: formData,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    console.error("File upload failed:", uploadRes.status, errText);
    // Fallback: return data URL and hope for the best
    return dataUrl;
  }

  const uploadData = await uploadRes.json();
  console.log("[Replicate] Uploaded file:", uploadData.urls?.get);
  return uploadData.urls?.get || dataUrl;
}

// POST — create a new prediction
export async function POST(request) {
  if (!REPLICATE_TOKEN) {
    return NextResponse.json(
      { error: "REPLICATE_API_TOKEN not configured in .env.local" },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { version, input } = body;

    if (!version || !input) {
      return NextResponse.json(
        { error: "Missing 'version' or 'input' in request body" },
        { status: 400 }
      );
    }

    // Upload any data URL inputs to Replicate's file hosting
    // This avoids the payload size limit for large image uploads
    const processedInput = { ...input };
    for (const key of Object.keys(processedInput)) {
      const val = processedInput[key];
      if (typeof val === "string" && val.startsWith("data:")) {
        console.log(`[Replicate] Uploading ${key} data URL (${(val.length / 1024 / 1024).toFixed(1)}MB)...`);
        processedInput[key] = await uploadDataUrl(val);
      }
    }

    const res = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REPLICATE_TOKEN}`,
        "Content-Type": "application/json",
        Prefer: "wait",
      },
      body: JSON.stringify({ version, input: processedInput }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("Replicate API error:", data);
      return NextResponse.json(
        { error: data.detail || data.error || `Replicate error ${res.status}` },
        { status: res.status }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("POST /api/replicate error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET — poll prediction status
export async function GET(request) {
  if (!REPLICATE_TOKEN) {
    return NextResponse.json(
      { error: "REPLICATE_API_TOKEN not configured" },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json(
      { error: "Missing prediction 'id' query param" },
      { status: 400 }
    );
  }

  try {
    // BUG FIX: was missing template literal backticks
    const res = await fetch(
      `https://api.replicate.com/v1/predictions/${id}`,
      { headers: { Authorization: `Bearer ${REPLICATE_TOKEN}` } }
    );

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { error: data.detail || `Replicate error ${res.status}` },
        { status: res.status }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("GET /api/replicate error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
