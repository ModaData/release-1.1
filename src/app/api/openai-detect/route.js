// File: app/api/openai-detect/route.js — OpenAI GPT-4o-mini Vision Garment Component Detector
// Replaces Roboflow: uses GPT-4o-mini vision to detect small garment components
// (buttons, zippers, pockets, collars, cuffs, seams, rivets, etc.)

import { NextResponse } from "next/server";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const SYSTEM_PROMPT = `You are a fashion garment component detector. Given an image of clothing, identify ALL visible garment components and small details such as: buttons, zippers, pockets, collars, cuffs, seams, hems, plackets, belt loops, stitching, labels, tags, ribbing, distressing, rivets, snaps, drawstrings, embroidery, patches, linings, vents, darts, pleats, gathers, yokes, epaulettes, etc.

Return ONLY a valid JSON array (no markdown, no code fences) of objects with:
{
  "label": "component name",
  "confidence": 0.0 to 1.0,
  "position": {
    "relative_x": 0.0 to 1.0,
    "relative_y": 0.0 to 1.0,
    "relative_width": 0.0 to 1.0,
    "relative_height": 0.0 to 1.0
  }
}

Coordinates are relative to image dimensions (0=top-left, 1=bottom-right).
Be thorough — detect even small details. Return up to 12 components, ordered by confidence (highest first).`;

export async function POST(request) {
  if (!OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured in .env.local" },
      { status: 500 }
    );
  }

  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid or empty JSON body" },
        { status: 400 }
      );
    }

    const { image, confidence = 0.4 } = body;

    if (!image) {
      return NextResponse.json(
        { error: "No image provided" },
        { status: 400 }
      );
    }

    // Ensure proper data URL format
    let imageUrl = image;
    if (!imageUrl.startsWith("data:")) {
      imageUrl = `data:image/jpeg;base64,${imageUrl}`;
    }

    console.log("[OpenAI-Detect] Sending garment image for component detection...");

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "Detect all garment components and details in this clothing image." },
              { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
            ],
          },
        ],
        temperature: 0.2,
        max_tokens: 1000,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("[OpenAI-Detect] API error:", err);
      return NextResponse.json(
        { error: err.error?.message || `OpenAI error ${res.status}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "[]";

    // Parse JSON array from response (handle markdown code fences)
    let rawDetections;
    try {
      const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      rawDetections = JSON.parse(cleaned);
    } catch {
      console.warn("[OpenAI-Detect] Failed to parse response:", content);
      rawDetections = [];
    }

    // Normalize to match Roboflow-compatible detection format
    // (same shape used by useRoboflow hook / ControlsPanel)
    const detections = (Array.isArray(rawDetections) ? rawDetections : [])
      .filter((d) => d.confidence >= confidence)
      .map((d) => ({
        label: d.label,
        confidence: d.confidence,
        bbox: {
          x: Math.round((d.position?.relative_x || 0) * 1000),
          y: Math.round((d.position?.relative_y || 0) * 1000),
          width: Math.round((d.position?.relative_width || 0.1) * 1000),
          height: Math.round((d.position?.relative_height || 0.1) * 1000),
        },
        center: {
          x: Math.round(((d.position?.relative_x || 0) + (d.position?.relative_width || 0.1) / 2) * 1000),
          y: Math.round(((d.position?.relative_y || 0) + (d.position?.relative_height || 0.1) / 2) * 1000),
        },
      }));

    console.log(
      `[OpenAI-Detect] Detected ${detections.length} components:`,
      detections.map((d) => d.label).join(", ")
    );

    return NextResponse.json({
      detections,
      model: data.model,
      usage: data.usage,
    });
  } catch (err) {
    console.error("[OpenAI-Detect] Error:", err);
    return NextResponse.json(
      { error: err.message || "Component detection failed" },
      { status: 500 }
    );
  }
}
