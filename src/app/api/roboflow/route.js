// File: app/api/roboflow/route.js — Roboflow Fashion Detection API Proxy
// Supplements SegFormer with Roboflow's object detection for garment parts.
// Uses Roboflow Hosted API for inference.

import { NextResponse } from "next/server";

const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY;
// Default model — can be overridden by client. Popular fashion models:
// - "fashion-detection" / "fashion-items-detection"
// - User can set their own model/version in env
const ROBOFLOW_MODEL = process.env.ROBOFLOW_MODEL || "fashion-items-detection";
const ROBOFLOW_VERSION = process.env.ROBOFLOW_VERSION || "1";
const ROBOFLOW_WORKSPACE = process.env.ROBOFLOW_WORKSPACE || "";

export async function POST(request) {
  try {
    if (!ROBOFLOW_API_KEY) {
      return NextResponse.json(
        { error: "ROBOFLOW_API_KEY not configured" },
        { status: 500 }
      );
    }

    const { image, confidence = 0.4, overlap = 0.3 } = await request.json();

    if (!image) {
      return NextResponse.json(
        { error: "No image provided" },
        { status: 400 }
      );
    }

    // Roboflow accepts base64 images directly
    // Strip the data URL prefix if present
    let base64Image = image;
    if (base64Image.startsWith("data:")) {
      base64Image = base64Image.split(",")[1];
    }

    // Build Roboflow Hosted Inference API URL
    const url = `https://detect.roboflow.com/${ROBOFLOW_MODEL}/${ROBOFLOW_VERSION}?api_key=${ROBOFLOW_API_KEY}&confidence=${confidence}&overlap=${overlap}`;

    console.log(`[Roboflow] Calling model: ${ROBOFLOW_MODEL}/${ROBOFLOW_VERSION}`);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: base64Image,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[Roboflow] API error:", response.status, errText);
      return NextResponse.json(
        { error: `Roboflow API error: ${response.status}`, details: errText },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Roboflow returns: { predictions: [{ class, confidence, x, y, width, height }], image: { width, height } }
    console.log(
      `[Roboflow] Detected ${data.predictions?.length || 0} objects`
    );

    // Normalize predictions into a consistent format
    const detections = (data.predictions || []).map((pred) => ({
      label: pred.class,
      confidence: pred.confidence,
      // Roboflow returns center x,y + width,height
      bbox: {
        x: Math.round(pred.x - pred.width / 2),
        y: Math.round(pred.y - pred.height / 2),
        width: Math.round(pred.width),
        height: Math.round(pred.height),
      },
      // Center point (useful for SAM point prompts)
      center: {
        x: Math.round(pred.x),
        y: Math.round(pred.y),
      },
    }));

    return NextResponse.json({
      detections,
      imageWidth: data.image?.width,
      imageHeight: data.image?.height,
      model: `${ROBOFLOW_MODEL}/${ROBOFLOW_VERSION}`,
    });
  } catch (err) {
    console.error("[Roboflow] Error:", err);
    return NextResponse.json(
      { error: err.message || "Roboflow detection failed" },
      { status: 500 }
    );
  }
}
