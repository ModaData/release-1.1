// File: app/api/render-from-sketch/route.js — FLUX 1.1 Pro text-to-image (Freestyle mode)
import { NextResponse } from "next/server";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;
const FLUX_MODEL = "black-forest-labs/flux-1.1-pro";

export async function POST(request) {
  if (!REPLICATE_TOKEN) {
    return NextResponse.json(
      { error: "REPLICATE_API_TOKEN not configured in .env.local" },
      { status: 500 }
    );
  }

  try {
    const { prompt, negativePrompt, width, height, seed } = await request.json();

    if (!prompt) {
      return NextResponse.json({ error: "No prompt provided" }, { status: 400 });
    }

    console.log("[render-from-sketch] Prompt:", prompt.substring(0, 200));

    // Use FLUX 1.1 Pro via model-based API with Prefer: wait (sync)
    const res = await fetch(
      `https://api.replicate.com/v1/models/${FLUX_MODEL}/predictions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${REPLICATE_TOKEN}`,
          "Content-Type": "application/json",
          Prefer: "wait",
        },
        body: JSON.stringify({
          input: {
            prompt,
            width: width || 768,
            height: height || 768,
            prompt_upsampling: true,
            safety_tolerance: 5,
            output_format: "jpg",
            output_quality: 80,
            ...(seed != null && { seed }),
          },
        }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      console.error("[render-from-sketch] FLUX error:", data);
      return NextResponse.json(
        { error: data.detail || data.error || `FLUX error ${res.status}` },
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
          seed: data.input?.seed,
        });
      }
    }

    // Fallback: poll if Prefer: wait didn't complete synchronously
    if (data.id) {
      const imageUrl = await pollPrediction(data.id);
      return NextResponse.json({
        success: true,
        imageUrl,
        predictionId: data.id,
      });
    }

    return NextResponse.json({ error: "FLUX returned no output" }, { status: 500 });
  } catch (err) {
    console.error("[render-from-sketch] error:", err);
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
