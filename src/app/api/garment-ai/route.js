// File: app/api/garment-ai/route.js
// 2D-First Garment AI Orchestrator (v2 — GarmentFactory)
//
// Pipeline:
//   1. GPT-4 parses user prompt → structured parameters (garment_type, size, fit, fabric...)
//   2. GarmentFactory (Python) generates precise 2D panels + stitches from parametric templates
//   3. Blender sews panels into 3D via cloth simulation
//   4. (Optional) HunYuan generates a visual concept mesh as guide
//
// This is "Patterns-as-Code": output can be unrolled back to 2D for CLO3D/Gerber
import { NextResponse } from "next/server";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const BLENDER_API_URL = () => (process.env.BLENDER_API_URL || "http://localhost:8000").trim();

// ── GPT-4 System Prompt: Parse text → GarmentFactory parameters ──
const PARAMETER_PARSER_PROMPT = `You are a fashion pattern engineering AI. Parse the user's garment description into structured parameters for our GarmentFactory.

Return ONLY a JSON object with these fields:
{
  "garment_type": "tshirt|shirt|blazer|pants|skirt|dress|hoodie|tank_top",
  "size": "XS|S|M|L|XL",
  "fit": "skin_tight|slim|regular|relaxed|oversized",
  "fabric_type": "cotton|silk|denim|wool|linen|leather|chiffon|velvet|jersey|satin|tweed|polyester",
  "color": "#hex color code",
  "sleeve_length": null or number in cm (null = use template default),
  "body_length": null or number in cm (null = use template default),
  "neckline": "crew|v_neck|scoop|boat|turtleneck",
  "collar_style": "point|spread|button_down|mandarin|band",
  "lapel_style": "notch|peak|shawl",
  "double_breasted": false,
  "style": "straight|slim|skinny|wide|bootcut|a_line|pencil|circle",
  "length": null or number in cm for pants/skirts
}

Only include fields relevant to the garment type. Infer reasonable defaults.
Examples:
- "Navy wool double-breasted blazer with peak lapels" → {"garment_type":"blazer","fabric_type":"wool","color":"#1B2951","lapel_style":"peak","double_breasted":true,"fit":"regular"}
- "Slim-fit white cotton shirt" → {"garment_type":"shirt","fabric_type":"cotton","color":"#FFFFFF","fit":"slim"}
- "Black leather skinny pants" → {"garment_type":"pants","fabric_type":"leather","color":"#000000","style":"skinny","fit":"slim"}
- "Red silk evening dress, floor length" → {"garment_type":"dress","fabric_type":"silk","color":"#8B0000","fit":"slim","length":140}
- "Oversized grey hoodie" → {"garment_type":"hoodie","fabric_type":"jersey","color":"#808080","fit":"oversized"}`;

// ── GPT-4 Edit Prompt: Modify parameters of existing spec ──
function buildEditPrompt(currentParams, instruction) {
  return `The current garment parameters are:
${JSON.stringify(currentParams, null, 2)}

The user wants: "${instruction}"

Return the COMPLETE updated parameter JSON with the modification applied.
Only change fields that the instruction affects. Keep everything else the same.
Respond with ONLY valid JSON, no markdown or code fences.`;
}

// ── Step 1: GPT-4 parses prompt → factory parameters ──
async function promptToParams(prompt, currentParams = null) {
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not configured");

  const messages = [{ role: "system", content: PARAMETER_PARSER_PROMPT }];

  if (currentParams) {
    messages.push({ role: "user", content: buildEditPrompt(currentParams, prompt) });
  } else {
    messages.push({ role: "user", content: `Parse this garment: "${prompt}"` });
  }

  console.log(`[garment-ai] GPT-4 parameter parsing (${currentParams ? "edit" : "new"})...`);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      messages,
      temperature: 0.2,
      max_tokens: 500,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`OpenAI API error (${res.status}): ${err.substring(0, 200)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("GPT-4 returned empty response");

  const params = JSON.parse(content);
  console.log(`[garment-ai] Parsed: ${params.garment_type} | ${params.fabric_type} | ${params.color} | ${params.fit} | ${params.size || "M"}`);
  return params;
}

// ── Step 2: Call GarmentFactory on the Blender backend ──
async function generatePattern(params) {
  const url = BLENDER_API_URL();
  console.log(`[garment-ai] Calling GarmentFactory at ${url}/api/generate-pattern...`);

  const res = await fetch(`${url}/api/generate-pattern`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    console.warn(`[garment-ai] GarmentFactory failed (${res.status}): ${err.substring(0, 300)}`);
    return null;
  }

  const spec = await res.json();
  console.log(`[garment-ai] GarmentFactory: ${spec.panels?.length || 0} panels, ${spec.stitches?.length || 0} stitches`);
  return spec;
}

// ── Step 3: Sew panels into 3D via Blender cloth sim ──
async function sewTo3D(spec, simFrames = 15) {
  const url = BLENDER_API_URL();
  console.log(`[garment-ai] Sewing ${spec.panels?.length} panels (${simFrames} sim frames)...`);

  const res = await fetch(`${url}/api/sew-panels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spec, sim_frames: simFrames }),
    signal: AbortSignal.timeout(90000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    console.warn(`[garment-ai] Sewing failed (${res.status}): ${err.substring(0, 200)}`);
    return null;
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("model/gltf-binary") || contentType.includes("application/octet-stream")) {
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    console.log(`[garment-ai] 3D garment sewn! GLB: ${Math.round(buffer.byteLength / 1024)}KB`);
    return `data:model/gltf-binary;base64,${base64}`;
  }

  const json = await res.json().catch(() => null);
  return json?.glb_url || null;
}

// ── Step 4 (optional): HunYuan visual concept mesh ──
async function generateVisualGuide(prompt) {
  // Use HunYuan to generate a concept mesh as visual reference
  // This is separate from the pattern-based construction
  try {
    const TENCENT_SECRET_ID = process.env.TENCENT_SECRET_ID;
    const TENCENT_SECRET_KEY = process.env.TENCENT_SECRET_KEY;
    if (!TENCENT_SECRET_ID || !TENCENT_SECRET_KEY) return null;

    console.log(`[garment-ai] Generating HunYuan visual guide for: "${prompt.substring(0, 50)}..."`);

    // Call the existing generate-3d endpoint internally
    const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL || "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/generate-3d`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: `3D garment model: ${prompt}`,
        model: "hunyuan",
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (res.ok) {
      const data = await res.json();
      console.log(`[garment-ai] HunYuan visual guide generated`);
      return data.glbUrl || null;
    }
  } catch (err) {
    console.warn(`[garment-ai] HunYuan guide skipped: ${err.message}`);
  }
  return null;
}

// ── POST handler ──
export async function POST(request) {
  try {
    const body = await request.json();
    const { prompt, currentSpec = null, currentParams = null, generateGuide = false } = body;

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "Missing 'prompt' field" }, { status: 400 });
    }

    // Step 1: GPT-4 parses prompt → structured parameters
    const params = await promptToParams(prompt, currentParams);

    // Step 2: GarmentFactory generates precise 2D panels + stitches
    let spec = await generatePattern(params);

    // Fallback: if GarmentFactory endpoint isn't available, generate panels client-side
    // (the frontend PatternEditor2D can render from params alone)
    if (!spec) {
      console.warn("[garment-ai] GarmentFactory unavailable, returning params only");
      spec = {
        metadata: {
          name: params.garment_type ? `${(params.fit || "regular")} ${params.garment_type}`.trim() : "Garment",
          garment_type: params.garment_type || "tshirt",
          fabric_type: params.fabric_type || "cotton",
          color: params.color || "#FFFFFF",
          size: params.size || "M",
          fit: params.fit || "regular",
        },
        panels: [],
        stitches: [],
        measurements: {},
      };
    }

    // Step 3: Sew panels into 3D
    let glbUrl = null;
    if (spec.panels && spec.panels.length > 0) {
      glbUrl = await sewTo3D(spec);
    }

    // Step 4 (optional): HunYuan visual guide
    let guideGlbUrl = null;
    if (generateGuide) {
      guideGlbUrl = await generateVisualGuide(prompt);
    }

    // Build panel summary for chat display
    const panels = spec.panels || [];
    const panelSummary = panels.map(p => {
      const w = p.width_cm || Math.round(Math.max(...(p.vertices || p.points || []).map(pt => pt[0])) - Math.min(...(p.vertices || p.points || []).map(pt => pt[0])));
      const h = p.height_cm || Math.round(Math.max(...(p.vertices || p.points || []).map(pt => pt[1])) - Math.min(...(p.vertices || p.points || []).map(pt => pt[1])));
      return `${p.name} (${w}x${h}cm)`;
    }).join(", ");

    const stitchCount = spec.stitches?.length || 0;
    const fabricType = spec.metadata?.fabric_type || params.fabric_type || "cotton";
    const garmentName = spec.metadata?.name || params.garment_type || "Garment";

    let message;
    if (glbUrl) {
      message = `${garmentName}: ${panels.length} panels, ${stitchCount} seams → sewn into 3D (${panelSummary})`;
    } else if (panels.length > 0) {
      message = `${garmentName}: ${panels.length} panels, ${stitchCount} seams (${panelSummary}). Sewing to 3D...`;
    } else {
      message = `Parsed: ${garmentName} (${fabricType}). Blender backend needed for pattern generation.`;
    }

    return NextResponse.json({
      spec,
      params,        // The parsed factory parameters (for future edits)
      glbUrl,        // 3D sewn garment (if sewing succeeded)
      guideGlbUrl,   // HunYuan concept mesh (if requested)
      panels: panels.map(p => ({
        name: p.name,
        vertexCount: (p.vertices || p.points || []).length,
        edgeCount: (p.edges || []).length,
        width: p.width_cm || 0,
        height: p.height_cm || 0,
      })),
      stitches: spec.stitches || [],
      message,
    });
  } catch (err) {
    console.error("[garment-ai] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
