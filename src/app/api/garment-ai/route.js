// File: app/api/garment-ai/route.js
// 2D-First Garment AI Orchestrator
// Pipeline: User prompt → GPT-4 (2D pattern panels) → Blender (cloth sim) → 3D GLB
// This is the "Text-to-CAD" approach: patterns that export to CLO3D/Gerber
import { NextResponse } from "next/server";

export const maxDuration = 300; // Cloth sim can take a few minutes
export const dynamic = "force-dynamic";

// ── System prompt for 2D pattern generation ──
const PATTERN_SYSTEM_PROMPT = `You are an expert fashion pattern maker AI. When the user describes a garment, you generate 2D sewing pattern data as JSON.

Each garment is composed of PANELS (flat pattern pieces). Each panel has:
- name: identifier (e.g. "front_left", "back", "sleeve_right")
- points: ordered 2D coordinates [[x,y], ...] defining the panel outline (in centimeters, origin at panel center)
- seam_edges: pairs of point indices that form sewing seams
- grain_line: direction vector [dx, dy] for fabric grain (usually [0,1] = vertical)
- seam_allowance: cm to add around the edge (default 1.5)

COORDINATE SYSTEM:
- Units are centimeters. X = width, Y = height. Origin (0,0) = panel center.
- Standard shirt front panel: ~50cm wide x 70cm tall

PANEL LIBRARY (modify these shapes based on the prompt):

SHIRT/BLOUSE FRONT: [[-22,-35],[22,-35],[22,20],[18,30],[10,35],[0,32],[-10,35],[-18,30],[-22,20]]
SHIRT/BLOUSE BACK: [[-22,-35],[22,-35],[22,20],[18,28],[10,32],[0,30],[-10,32],[-18,28],[-22,20]]
SLEEVE: [[-20,-30],[20,-30],[18,0],[15,15],[10,20],[0,22],[-10,20],[-15,15],[-18,0]]
COLLAR BAND: [[-20,-3],[20,-3],[20,3],[-20,3]]
PANTS FRONT: [[-15,-45],[15,-45],[15,-5],[12,10],[10,20],[5,30],[0,32],[-5,28],[-8,10],[-15,-5]]
PANTS BACK: [[-16,-45],[16,-45],[16,-5],[13,10],[10,22],[5,32],[0,34],[-5,30],[-10,15],[-16,-5]]
SKIRT FRONT: [[-25,-40],[25,-40],[22,-5],[20,10],[15,25],[0,30],[-15,25],[-20,10],[-22,-5]]
SKIRT BACK: [[-25,-40],[25,-40],[22,-5],[20,10],[15,25],[0,28],[-15,25],[-20,10],[-22,-5]]
BLAZER FRONT: [[-25,-35],[25,-35],[25,22],[22,30],[18,34],[10,36],[0,33],[-10,36],[-18,34],[-22,30],[-25,22]]
BLAZER BACK: [[-24,-35],[24,-35],[24,22],[20,30],[10,34],[0,32],[-10,34],[-20,30],[-24,22]]
DRESS FRONT: [[-22,-55],[22,-55],[22,20],[18,30],[10,35],[0,32],[-10,35],[-18,30],[-22,20]]
DRESS BACK: [[-22,-55],[22,-55],[22,20],[18,28],[10,32],[0,30],[-10,32],[-18,28],[-22,20]]

RULES:
1. Return ONLY valid JSON. No markdown, no explanation, no code fences.
2. Include ALL panels needed (a basic shirt needs: front, back, sleeve_left, sleeve_right, collar).
3. Scale for size: S=scale 0.9, M=1.0, L=1.1, XL=1.2.
4. Slim fit: narrow side seams 10-15%. Oversized: widen 20%.
5. Coordinates form a CLOSED polygon (last point connects to first).
6. Always include metadata with garment_type, fabric_type, color_hex, color_name, fit, size.

OUTPUT FORMAT:
{
  "metadata": {
    "garment_type": "shirt",
    "name": "Classic White Shirt",
    "fabric_type": "cotton",
    "color_hex": "#FFFFFF",
    "color_name": "white",
    "fit": "regular",
    "size": "M"
  },
  "panels": [
    {
      "name": "front",
      "points": [[x,y], ...],
      "seam_edges": [[0,1], [1,2]],
      "grain_line": [0, 1],
      "seam_allowance": 1.5
    }
  ]
}`;

function buildEditPrompt(currentSpec, instruction) {
  return `You are modifying existing 2D sewing pattern data. The current pattern is:

${JSON.stringify(currentSpec, null, 2)}

The user wants: "${instruction}"

Return the COMPLETE updated pattern JSON with the modification applied.
Only change the panels/coordinates that the instruction affects. Keep everything else the same.
Respond with ONLY valid JSON, no markdown or code fences.`;
}

// ── Call GPT-4 to generate 2D pattern panels ──
async function promptToPattern(prompt, currentSpec = null) {
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not configured");

  const messages = [
    { role: "system", content: PATTERN_SYSTEM_PROMPT },
  ];

  if (currentSpec) {
    messages.push({
      role: "user",
      content: buildEditPrompt(currentSpec, prompt),
    });
  } else {
    messages.push({
      role: "user",
      content: `Create sewing patterns for: "${prompt}"`,
    });
  }

  console.log(`[garment-ai] GPT-4 (${currentSpec ? "edit" : "new"} pattern)...`);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages,
      temperature: 0.3,
      max_tokens: 3000,
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

  try {
    const spec = JSON.parse(content);
    const panelCount = spec.panels?.length || 0;
    console.log(`[garment-ai] Generated ${panelCount} panels: ${spec.panels?.map(p => p.name).join(", ")}`);
    return spec;
  } catch (e) {
    console.error("[garment-ai] Invalid JSON from GPT-4:", content.substring(0, 300));
    throw new Error("GPT-4 returned invalid JSON");
  }
}

// ── POST handler ──
export async function POST(request) {
  try {
    const body = await request.json();
    const { prompt, currentSpec = null } = body;

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "Missing 'prompt' field" }, { status: 400 });
    }

    // Step 1: GPT-4 generates 2D pattern panels
    const patternSpec = await promptToPattern(prompt, currentSpec);
    const metadata = patternSpec.metadata || {};
    const panels = patternSpec.panels || [];

    if (panels.length === 0) {
      return NextResponse.json({
        spec: patternSpec,
        glbUrl: null,
        message: "GPT-4 generated no panels. Try a more specific prompt.",
      });
    }

    // Step 2: Send to Blender for cloth simulation → 3D
    const BLENDER_API_URL = (process.env.BLENDER_API_URL || "http://localhost:8000").trim();

    console.log(`[garment-ai] Sending ${panels.length} panels to Blender for sewing simulation...`);

    let glbUrl = null;

    try {
      const blenderRes = await fetch(`${BLENDER_API_URL}/api/sew-panels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spec: patternSpec,
          sim_frames: 60,
        }),
        signal: AbortSignal.timeout(180000), // 3 min timeout for cloth sim
      });

      if (blenderRes.ok) {
        const contentType = blenderRes.headers.get("content-type") || "";
        if (contentType.includes("model/gltf-binary") || contentType.includes("application/octet-stream")) {
          const buffer = await blenderRes.arrayBuffer();
          const base64 = Buffer.from(buffer).toString("base64");
          glbUrl = `data:model/gltf-binary;base64,${base64}`;
          console.log(`[garment-ai] 3D garment generated! GLB size: ${Math.round(buffer.byteLength / 1024)}KB`);
        } else {
          const jsonResult = await blenderRes.json().catch(() => null);
          glbUrl = jsonResult?.glb_url || jsonResult?.output_url || null;
        }
      } else {
        const errText = await blenderRes.text().catch(() => "");
        console.warn(`[garment-ai] Blender sewing failed (${blenderRes.status}): ${errText.substring(0, 200)}`);
      }
    } catch (blenderErr) {
      console.warn(`[garment-ai] Blender backend: ${blenderErr.message}`);
    }

    // Build panel summary for chat display
    const panelSummary = panels.map(p => {
      const w = Math.round(Math.max(...p.points.map(pt => pt[0])) - Math.min(...p.points.map(pt => pt[0])));
      const h = Math.round(Math.max(...p.points.map(pt => pt[1])) - Math.min(...p.points.map(pt => pt[1])));
      return `${p.name} (${w}x${h}cm)`;
    }).join(", ");

    return NextResponse.json({
      spec: patternSpec,
      glbUrl,
      panels: panels.map(p => ({
        name: p.name,
        pointCount: p.points?.length || 0,
        width: Math.round(Math.max(...p.points.map(pt => pt[0])) - Math.min(...p.points.map(pt => pt[0]))),
        height: Math.round(Math.max(...p.points.map(pt => pt[1])) - Math.min(...p.points.map(pt => pt[1]))),
      })),
      message: glbUrl
        ? `Created ${metadata.name || metadata.garment_type}: ${panels.length} panels sewn into 3D (${panelSummary})`
        : `Pattern created: ${panels.length} panels (${panelSummary}). Blender sewing endpoint not yet configured.`,
    });
  } catch (err) {
    console.error("[garment-ai] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
