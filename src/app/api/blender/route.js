// File: app/api/blender/route.js — Next.js proxy to Blender backend
// Supports two modes:
//   1. RunPod Serverless (RUNPOD_ENDPOINT_ID + RUNPOD_API_KEY set)
//   2. Direct HTTP to FastAPI (BLENDER_API_URL — local Docker or persistent pod)
import { NextResponse } from "next/server";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// ── Mode detection ──
const RUNPOD_ENDPOINT_ID = (process.env.RUNPOD_ENDPOINT_ID || "").trim();
const RUNPOD_API_KEY = (process.env.RUNPOD_API_KEY || "").trim();
const USE_SERVERLESS = RUNPOD_ENDPOINT_ID.length > 0 && RUNPOD_API_KEY.length > 0;
const BLENDER_API_URL = (process.env.BLENDER_API_URL || "http://localhost:8000").trim();
const RUNPOD_BASE = `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}`;
console.log(`[blender/route] Mode: ${USE_SERVERLESS ? "RunPod Serverless" : "Direct HTTP → " + BLENDER_API_URL}`);

// Map action names to Blender backend endpoints (used in direct HTTP mode)
const ACTION_ENDPOINTS = {
  "auto-fix":            "/api/auto-fix",
  "repair-mesh":         "/api/repair-mesh",
  "clean-mesh":          "/api/clean-mesh",
  "subdivide":           "/api/subdivide",
  "smooth":              "/api/smooth",
  "apply-cloth-physics": "/api/apply-cloth-physics",
  "resize-garment":      "/api/resize-garment",
  "apply-logo":          "/api/apply-logo",
  "swap-fabric":         "/api/swap-fabric",
  "render-scene":        "/api/render-scene",
  "bake-pbr":            "/api/bake-pbr",
  "turntable-render":    "/api/turntable-render",
  // New endpoints
  "flatten-pattern":     "/api/flatten-pattern",
  "set-seams":           "/api/set-seams",
  "edit-part":           "/api/edit-part",
  "apply-gn":            "/api/apply-gn",
  // Morph UV Phase 2 + Fabric Refinement
  "seams-and-flatten":   "/api/seams-and-flatten",
  "add-thickness":       "/api/add-thickness",
  "extrude-edges":       "/api/extrude-edges",
  // Smart UV Suite
  "uv-stretch-map":      "/api/uv-stretch-map",
  "auto-seam":           "/api/auto-seam",
  "uv-pack-nest":        "/api/uv-pack-nest",
};

// Valid actions (for both modes)
const VALID_ACTIONS = new Set(Object.keys(ACTION_ENDPOINTS));


// ═══════════════════════════════════════════════════════════════
// RUNPOD SERVERLESS HELPERS
// ═══════════════════════════════════════════════════════════════

function extractBase64(dataUrl) {
  if (!dataUrl) return null;
  const match = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
  return match ? match[1] : dataUrl; // If no data: prefix, assume raw b64
}

async function runpodSubmitJob(input) {
  const res = await fetch(`${RUNPOD_BASE}/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RUNPOD_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`RunPod submit failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.id;
}

async function runpodPollResult(jobId, maxWaitMs = 600000) {
  const pollInterval = 3000; // 3 seconds
  const maxPolls = Math.ceil(maxWaitMs / pollInterval);

  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, pollInterval));

    const res = await fetch(`${RUNPOD_BASE}/status/${jobId}`, {
      headers: { Authorization: `Bearer ${RUNPOD_API_KEY}` },
    });

    if (!res.ok) continue; // Retry on transient errors

    const status = await res.json();

    if (status.status === "COMPLETED") {
      console.log(`[blender] RunPod job ${jobId} completed`);
      return status.output;
    }
    if (status.status === "FAILED") {
      console.error(`[blender] RunPod job ${jobId} FAILED:`, status.error);
      throw new Error(status.error || "RunPod job failed");
    }
    if (i % 5 === 0) {
      console.log(`[blender] RunPod job ${jobId}: ${status.status} (poll ${i + 1}/${maxPolls})`);
    }
  }

  throw new Error("RunPod job timed out");
}

function runpodOutputToResponse(output) {
  if (output.error) {
    return NextResponse.json({ error: output.error }, { status: 500 });
  }

  const contentType = output.content_type || "model/gltf-binary";
  const fileB64 = output.file_b64;

  if (!fileB64) {
    return NextResponse.json({ error: "No output from Blender" }, { status: 500 });
  }

  if (contentType.includes("model/gltf") || contentType.includes("application/octet")) {
    return NextResponse.json({
      fileDataUrl: `data:model/gltf-binary;base64,${fileB64}`,
      contentType: "model/gltf-binary",
    });
  }

  if (contentType.includes("image/png")) {
    return NextResponse.json({
      imageDataUrl: `data:image/png;base64,${fileB64}`,
      contentType: "image/png",
    });
  }

  if (contentType.includes("image/gif")) {
    return NextResponse.json({
      imageDataUrl: `data:image/gif;base64,${fileB64}`,
      contentType: "image/gif",
    });
  }

  // Fallback: return as GLB
  return NextResponse.json({
    fileDataUrl: `data:model/gltf-binary;base64,${fileB64}`,
    contentType: "model/gltf-binary",
  });
}


// ═══════════════════════════════════════════════════════════════
// SERVERLESS MODE HANDLER
// ═══════════════════════════════════════════════════════════════

async function handleServerless(body, action) {
  // Build the RunPod job input
  const input = { operation: action };

  // Extract base64 file data (strip data: URL prefix)
  if (body.fileDataUrl) {
    input.file_b64 = extractBase64(body.fileDataUrl);
  }
  if (body.logoDataUrl) {
    input.logo_b64 = extractBase64(body.logoDataUrl);
  }
  if (body.textureDataUrl) {
    input.texture_b64 = extractBase64(body.textureDataUrl);
  }

  // Forward all other params (size, resolution, samples, etc.)
  for (const [key, value] of Object.entries(body)) {
    if (!["action", "fileDataUrl", "logoDataUrl", "textureDataUrl"].includes(key) && value !== undefined) {
      input[key] = value;
    }
  }

  console.log(`[blender] RunPod Serverless: ${action}`);

  // Submit job and poll for result
  const jobId = await runpodSubmitJob(input);
  console.log(`[blender] RunPod job submitted: ${jobId}`);

  const output = await runpodPollResult(jobId);
  return runpodOutputToResponse(output);
}


// ═══════════════════════════════════════════════════════════════
// DIRECT HTTP MODE HANDLER (local Docker / persistent pod)
// ═══════════════════════════════════════════════════════════════

async function handleDirectHTTP(body, action) {
  const endpoint = ACTION_ENDPOINTS[action];

  // Forward as form data to Blender backend
  const formData = new FormData();

  // Handle file data (base64)
  if (body.fileDataUrl) {
    const match = body.fileDataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      const buffer = Buffer.from(match[2], "base64");
      const blob = new Blob([buffer], { type: match[1] });
      formData.append("file", blob, "input.glb");
    }
  }

  // Handle logo file (base64)
  if (body.logoDataUrl) {
    const match = body.logoDataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      const buffer = Buffer.from(match[2], "base64");
      const blob = new Blob([buffer], { type: match[1] });
      formData.append("logo", blob, "logo.png");
    }
  }

  // Handle texture file for PBR baking (base64)
  if (body.textureDataUrl) {
    const match = body.textureDataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      const buffer = Buffer.from(match[2], "base64");
      const blob = new Blob([buffer], { type: match[1] });
      formData.append("texture", blob, "texture.png");
    }
  }

  // Forward other params
  for (const [key, value] of Object.entries(body)) {
    if (!["action", "fileDataUrl", "logoDataUrl", "textureDataUrl"].includes(key) && value !== undefined) {
      formData.append(key, String(value));
    }
  }

  const res = await fetch(`${BLENDER_API_URL}${endpoint}`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `Blender backend error: ${res.status} ${errText}` },
      { status: res.status }
    );
  }

  // Check response content type
  const resContentType = res.headers.get("content-type") || "";

  if (resContentType.includes("model/gltf") || resContentType.includes("application/octet")) {
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    return NextResponse.json({
      fileDataUrl: `data:model/gltf-binary;base64,${base64}`,
      contentType: "model/gltf-binary",
    });
  }

  if (resContentType.includes("image/png")) {
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    return NextResponse.json({
      imageDataUrl: `data:image/png;base64,${base64}`,
      contentType: "image/png",
    });
  }

  if (resContentType.includes("image/gif")) {
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    return NextResponse.json({
      imageDataUrl: `data:image/gif;base64,${base64}`,
      contentType: "image/gif",
    });
  }

  const data = await res.json();
  return NextResponse.json(data);
}


// ═══════════════════════════════════════════════════════════════
// MAIN POST HANDLER
// ═══════════════════════════════════════════════════════════════

export async function POST(request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    const url = new URL(request.url);
    let action = url.searchParams.get("action");

    // ── JSON requests ──
    if (contentType.includes("application/json")) {
      const body = await request.json();
      action = action || body.action;

      if (!action || !VALID_ACTIONS.has(action)) {
        return NextResponse.json(
          { error: `Unknown action '${action}'. Valid: ${[...VALID_ACTIONS].join(", ")}` },
          { status: 400 }
        );
      }

      console.log(`[blender] ${action} via ${USE_SERVERLESS ? "RunPod Serverless" : "Direct HTTP"}`);

      if (USE_SERVERLESS) {
        return await handleServerless(body, action);
      }
      return await handleDirectHTTP(body, action);
    }

    // ── Multipart form data (direct HTTP only) ──
    if (contentType.includes("multipart/form-data")) {
      if (USE_SERVERLESS) {
        return NextResponse.json(
          { error: "Multipart uploads not supported in serverless mode. Use JSON with base64." },
          { status: 400 }
        );
      }

      const formData = await request.formData();
      action = action || formData.get("action");

      const endpoint = ACTION_ENDPOINTS[action];
      if (!endpoint) {
        return NextResponse.json({ error: `Unknown action '${action}'` }, { status: 400 });
      }

      formData.delete("action");

      const res = await fetch(`${BLENDER_API_URL}${endpoint}`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return NextResponse.json(
          { error: `Blender backend error: ${res.status} ${errText}` },
          { status: res.status }
        );
      }

      const buffer = await res.arrayBuffer();
      return new NextResponse(buffer, {
        headers: {
          "Content-Type": res.headers.get("content-type") || "application/octet-stream",
        },
      });
    }

    return NextResponse.json({ error: "Unsupported content type" }, { status: 400 });
  } catch (err) {
    console.error("POST /api/blender error:", err);
    const isConnRefused = err.cause?.code === "ECONNREFUSED" || err.message?.includes("fetch failed");
    const msg = isConnRefused
      ? USE_SERVERLESS
        ? "RunPod Serverless endpoint unreachable. Check RUNPOD_ENDPOINT_ID and RUNPOD_API_KEY."
        : "Blender backend is not running. Start with: docker compose up"
      : err.message;
    return NextResponse.json({ error: msg }, { status: isConnRefused ? 503 : 500 });
  }
}

// Health check
export async function GET() {
  if (USE_SERVERLESS) {
    return NextResponse.json({
      blenderBackend: "serverless",
      endpoint: RUNPOD_ENDPOINT_ID,
      mode: "RunPod Serverless",
    });
  }

  try {
    const res = await fetch(`${BLENDER_API_URL}/health`);
    const data = await res.json();
    return NextResponse.json({ blenderBackend: data });
  } catch (err) {
    return NextResponse.json(
      { blenderBackend: "offline", error: err.message },
      { status: 503 }
    );
  }
}
