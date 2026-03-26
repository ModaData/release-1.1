// File: app/api/generate-3d/route.js — 3D mesh generation
// Supports two models:
//   1. HunYuan (default) — Tencent Cloud, fast, artistic
//   2. Trellis (Microsoft/NVIDIA NIM) — cleaner quads, UV-ready for pattern work
import { NextResponse } from "next/server";
import { signedFetch } from "@/lib/tencent-cloud-auth";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 60; // 5 minutes max


// ═══════════════════════════════════════════════════════════════
// TRELLIS (Microsoft, via NVIDIA NIM API)
// Uses NVCF asset upload pattern:
//   1. POST to /v2/nvcf/assets → get presigned S3 URL + assetId
//   2. PUT binary image to presigned URL
//   3. POST to inference endpoint with assetId reference
// ═══════════════════════════════════════════════════════════════

const NVIDIA_TRELLIS_URL = "https://ai.api.nvidia.com/v1/genai/microsoft/trellis";
const NVIDIA_ASSETS_URL = "https://api.nvcf.nvidia.com/v2/nvcf/assets";

async function uploadImageToNVCF(dataUrl, apiKey) {
  // Parse the data URL to get binary
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid image data URL");

  const mimeType = match[1];
  const buffer = Buffer.from(match[2], "base64");

  console.log(`[generate-3d/trellis] Uploading image (${Math.round(buffer.length / 1024)}KB, ${mimeType}) to NVCF assets...`);

  // Step 1: Request a presigned upload URL
  const assetRes = await fetch(NVIDIA_ASSETS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      contentType: mimeType,
      description: "Garment image for Trellis 3D generation",
    }),
  });

  if (!assetRes.ok) {
    const err = await assetRes.text().catch(() => "");
    throw new Error(`NVCF asset request failed (${assetRes.status}): ${err.substring(0, 200)}`);
  }

  const { uploadUrl, assetId } = await assetRes.json();
  console.log(`[generate-3d/trellis] Got asset ID: ${assetId}, uploading binary...`);

  // Step 2: PUT binary image to presigned S3 URL
  // IMPORTANT: Only send Content-Type — extra headers invalidate the presigned signature
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
    },
    body: buffer,
  });

  if (!putRes.ok) {
    const err = await putRes.text().catch(() => "");
    throw new Error(`NVCF asset upload failed (${putRes.status}): ${err.substring(0, 200)}`);
  }

  console.log(`[generate-3d/trellis] Asset uploaded successfully: ${assetId}`);
  return assetId;
}

async function handleTrellis(imageDataUrl, trellisParams = {}) {
  const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
  if (!NVIDIA_API_KEY) {
    return NextResponse.json(
      { error: "NVIDIA_API_KEY not configured for Trellis" },
      { status: 500 }
    );
  }

  // Step 1+2: Upload image to NVCF assets
  let assetId;
  try {
    assetId = await uploadImageToNVCF(imageDataUrl, NVIDIA_API_KEY);
  } catch (err) {
    console.error("[generate-3d/trellis] Asset upload error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  const seed = trellisParams.seed ?? 0;
  const slatSamplingSteps = trellisParams.slat_sampling_steps ?? 25;
  const ssSamplingSteps = trellisParams.ss_sampling_steps ?? 25;
  const slatCfgScale = trellisParams.slat_cfg_scale ?? 3;
  const ssCfgScale = trellisParams.ss_cfg_scale ?? 7.5;

  console.log(`[generate-3d/trellis] Calling inference (seed=${seed}, asset=${assetId})...`);

  // Step 3: Call inference with asset reference
  const res = await fetch(NVIDIA_TRELLIS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NVIDIA_API_KEY}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "NVCF-INPUT-ASSET-REFERENCES": assetId,
    },
    body: JSON.stringify({
      image: assetId,
      mode: "image",
      seed,
      output_format: "glb",
      samples: 1,
      slat_sampling_steps: slatSamplingSteps,
      ss_sampling_steps: ssSamplingSteps,
      slat_cfg_scale: slatCfgScale,
      ss_cfg_scale: ssCfgScale,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error("[generate-3d/trellis] NVIDIA API error:", res.status, errBody.substring(0, 500));
    return NextResponse.json(
      { error: `Trellis API error (${res.status}): ${errBody.substring(0, 200)}` },
      { status: res.status }
    );
  }

  const data = await res.json();

  // NVIDIA returns: { artifacts: [{ base64: "...", finishReason: "SUCCESS", seed: N }] }
  const artifact = data.artifacts?.[0];

  if (!artifact || artifact.finishReason !== "SUCCESS") {
    const reason = artifact?.finishReason || "NO_ARTIFACT";
    console.error("[generate-3d/trellis] Generation failed:", reason);
    return NextResponse.json(
      { error: `Trellis generation failed: ${reason}` },
      { status: 500 }
    );
  }

  // Convert base64 GLB to a data URL the frontend can load directly
  const glbDataUrl = `data:model/gltf-binary;base64,${artifact.base64}`;

  console.log(`[generate-3d/trellis] Success! GLB size: ${Math.round(artifact.base64.length * 0.75 / 1024)}KB, seed: ${artifact.seed}`);

  return NextResponse.json({
    glbUrl: glbDataUrl,
    jobId: `trellis-${artifact.seed}`,
    previewImageUrl: null,
    textures: [],
    model: "trellis",
  });
}


// ═══════════════════════════════════════════════════════════════
// HUNYUAN (Tencent Cloud)
// ═══════════════════════════════════════════════════════════════

async function handleHunYuan(imageDataUrl) {
  // Extract base64 from data URL
  const base64Match = imageDataUrl.match(/^data:[^;]+;base64,(.+)$/);
  if (!base64Match) {
    return NextResponse.json(
      { error: "Invalid image data URL format" },
      { status: 400 }
    );
  }
  const inputImageBase64 = base64Match[1];

  // Submit task
  console.log("[generate-3d/hunyuan] Submitting HunYuan 3D Rapid task...");
  const submitResponse = await signedFetch(
    "hunyuan",
    "SubmitHunyuanTo3DRapidJob",
    {
      ImageBase64: inputImageBase64,
      ResultFormat: "GLB",
      EnablePBR: true,
    },
  );

  const jobId = submitResponse.JobId;
  if (!jobId) {
    console.error("[generate-3d/hunyuan] No JobId in response:", submitResponse);
    return NextResponse.json(
      { error: "HunYuan 3D returned no job ID" },
      { status: 500 }
    );
  }

  console.log("[generate-3d/hunyuan] Job submitted:", jobId);

  // Poll until complete
  let attempt = 0;
  let result = null;

  while (attempt < MAX_POLL_ATTEMPTS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    attempt++;

    console.log(`[generate-3d/hunyuan] Polling attempt ${attempt}/${MAX_POLL_ATTEMPTS}...`);

    const queryResponse = await signedFetch(
      "hunyuan",
      "QueryHunyuanTo3DRapidJob",
      { JobId: jobId }
    );

    const status = queryResponse.Status;
    console.log(`[generate-3d/hunyuan] Job status: ${status}`);

    if (status === "DONE") {
      result = queryResponse;
      break;
    }

    if (status === "FAIL") {
      const errMsg = queryResponse.ErrorMessage || queryResponse.ErrorCode || "HunYuan 3D job failed";
      console.error("[generate-3d/hunyuan] Job failed:", errMsg);
      return NextResponse.json({ error: errMsg }, { status: 500 });
    }
  }

  if (!result) {
    return NextResponse.json(
      { error: "HunYuan 3D job timed out after 5 minutes" },
      { status: 504 }
    );
  }

  // Extract output
  const resultFiles = result.ResultFile3Ds || [];
  let glbUrl = null;
  let previewImageUrl = null;
  const textures = [];

  for (const file of resultFiles) {
    if (file.Type === "GLB" || file.Type === "glb") {
      glbUrl = file.Url;
      previewImageUrl = file.PreviewImageUrl;
    } else {
      textures.push({ type: file.Type, url: file.Url });
    }
  }

  if (!glbUrl && resultFiles.length > 0) {
    glbUrl = resultFiles[0].Url;
    previewImageUrl = resultFiles[0].PreviewImageUrl;
  }

  if (!glbUrl) {
    console.error("[generate-3d/hunyuan] No model URL in result:", JSON.stringify(result).substring(0, 500));
    return NextResponse.json(
      { error: "HunYuan 3D returned no model URL" },
      { status: 500 }
    );
  }

  console.log("[generate-3d/hunyuan] Success! GLB URL:", glbUrl.substring(0, 100));

  return NextResponse.json({
    glbUrl,
    jobId,
    previewImageUrl,
    textures,
    model: "hunyuan",
  });
}


// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════

export async function POST(request) {
  try {
    const body = await request.json();
    const { imageDataUrl, model = "hunyuan", trellisParams = {} } = body;

    if (!imageDataUrl) {
      return NextResponse.json(
        { error: "Missing 'imageDataUrl' in request body" },
        { status: 400 }
      );
    }

    console.log(`[generate-3d] Model: ${model}`);

    // Route to the correct backend
    if (model === "trellis") {
      return await handleTrellis(imageDataUrl, trellisParams);
    }

    return await handleHunYuan(imageDataUrl);

  } catch (err) {
    console.error("POST /api/generate-3d error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
