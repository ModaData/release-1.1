// File: app/api/garment-ai/route.js
// Orchestrator endpoint: translates natural language → GarmentSpec JSON → Blender parametric generation
// Supports: initial generation, conversational refinement, and macro-mode edits
import { NextResponse } from "next/server";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

// ── GarmentSpec defaults (mirrors garment_schema.py) ──
const GARMENT_TYPES = [
  "blazer","jacket","coat","vest","shirt","blouse","tshirt","hoodie",
  "sweater","dress","skirt","pants","shorts","jumpsuit"
];

const SYSTEM_PROMPT = `You are a fashion design AI assistant. When the user describes a garment, you MUST respond with a valid JSON object matching the GarmentSpec schema.

Available fields and their types:
- garment_type: one of [${GARMENT_TYPES.join(", ")}]
- name: descriptive name string
- sleeve_length: float 0.0-1.0 (0=sleeveless, 0.5=elbow, 1.0=full)
- body_length: float 0.0-1.0 (0=cropped, 0.5=waist, 0.7=hip, 1.0=maxi)
- shoulder_width: float 0.0-1.0 (0=narrow, 0.5=natural, 1.0=extended)
- fit: one of [slim, regular, relaxed, oversized]
- lapel_style: one of [notch, peak, shawl, none]
- collar_style: one of [pointed, spread, button_down, mandarin, band, peter_pan, turtleneck, crew, v_neck, scoop, none]
- closure: one of [single_breasted, double_breasted, zipper, wrap, pullover, snap, toggle, open_front]
- sleeve_style: one of [set_in, raglan, kimono, dolman, bell, puff, bishop, cap]
- hem_style: one of [straight, curved, high_low, asymmetric, raw_edge, rolled]
- button_count: integer 0-12
- construction_details: list of [darts, pleats, gathers, pintucks, seam_pockets, patch_pockets, welt_pockets, flap_pockets, vents, kick_pleat, yoke, princess_seams, side_slits, hem_band, cuffs, belt_loops, drawstring, elastic_waist]
- fabric_type: one of [cotton, silk, wool, linen, denim, leather, velvet, chiffon, satin, tweed, jersey, nylon, polyester, spandex]
- color_hex: hex color string (e.g. "#000080")
- color_name: human readable color name
- pattern: surface pattern (solid, striped, plaid, houndstooth, floral, etc.)
- size_label: XS/S/M/L/XL/XXL

RULES:
1. Always respond with ONLY valid JSON. No markdown, no explanation, no code fences.
2. Fill in reasonable defaults for any unspecified fields.
3. Map vague terms to specific values: "long sleeves" = sleeve_length: 1.0, "knee-length" = body_length: 0.6
4. For colors, always provide both color_hex and color_name.`;

function buildEditPrompt(currentSpec, instruction) {
  return `You are modifying an existing garment design. The current specification is:

${JSON.stringify(currentSpec, null, 2)}

The user wants to make this change: "${instruction}"

Return the COMPLETE updated GarmentSpec as JSON with the requested modifications applied.
Only change the fields that the user's instruction affects. Keep everything else the same.
Respond with ONLY valid JSON, no markdown, no code fences, no explanation.`;
}

// ── Call GPT-4 to parse prompt into GarmentSpec ──
async function promptToSpec(prompt, currentSpec = null) {
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not configured");

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  if (currentSpec) {
    // Refinement mode — include current state
    messages.push({
      role: "user",
      content: buildEditPrompt(currentSpec, prompt),
    });
  } else {
    // Initial generation
    messages.push({
      role: "user",
      content: `Design this garment: "${prompt}"`,
    });
  }

  console.log(`[garment-ai] Calling GPT-4 (${currentSpec ? "edit" : "new"} mode)...`);

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
      max_tokens: 1000,
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
    console.log(`[garment-ai] Parsed spec:`, spec.garment_type, spec.name || "");
    return spec;
  } catch (e) {
    console.error("[garment-ai] Failed to parse GPT-4 response:", content.substring(0, 300));
    throw new Error("GPT-4 returned invalid JSON");
  }
}

// ── Map GarmentSpec to Blender template + Geometry Node inputs ──
const TEMPLATE_MAP = {
  blazer: "blazer_base",
  jacket: "jacket_base",
  coat: "coat_base",
  vest: "vest_base",
  shirt: "shirt_base",
  blouse: "blouse_base",
  tshirt: "tshirt_base",
  hoodie: "hoodie_base",
  sweater: "sweater_base",
  dress: "dress_base",
  skirt: "skirt_base",
  pants: "pants_base",
  shorts: "shorts_base",
  jumpsuit: "jumpsuit_base",
};

function specToBlenderParams(spec) {
  return {
    template: TEMPLATE_MAP[spec.garment_type] || "tshirt_base",
    geometry_node_inputs: {
      sleeve_length: spec.sleeve_length ?? 1.0,
      body_length: spec.body_length ?? 0.7,
      shoulder_width: spec.shoulder_width ?? 0.5,
      fit_scale: { slim: 0.85, regular: 1.0, relaxed: 1.15, oversized: 1.35 }[spec.fit] || 1.0,
      button_count: spec.button_count ?? 0,
    },
    material: {
      color_hex: spec.color_hex || "#333333",
      fabric_type: spec.fabric_type || "cotton",
      pattern: spec.pattern || "solid",
    },
    construction: spec.construction_details || [],
    collar: spec.collar_style || "none",
    lapel: spec.lapel_style || "none",
    closure: spec.closure || "pullover",
    sleeve_style: spec.sleeve_style || "set_in",
    hem_style: spec.hem_style || "straight",
  };
}

// ── POST handler ──
export async function POST(request) {
  try {
    const body = await request.json();
    const { prompt, currentSpec = null, action = "generate" } = body;

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { error: "Missing 'prompt' field (string)" },
        { status: 400 }
      );
    }

    // Step 1: GPT-4 parses prompt → GarmentSpec
    const spec = await promptToSpec(prompt, currentSpec);

    // Step 2: Map spec to Blender parameters
    const blenderParams = specToBlenderParams(spec);

    // Step 3: Call Blender backend to generate the 3D model
    const BLENDER_API_URL = (process.env.BLENDER_API_URL || "http://localhost:8000").trim();

    console.log(`[garment-ai] Calling Blender: template=${blenderParams.template}`);

    let glbUrl = null;
    let blenderResult = null;

    try {
      const blenderRes = await fetch(`${BLENDER_API_URL}/api/generate-from-spec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spec: blenderParams,
          output_format: "glb",
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (blenderRes.ok) {
        const contentType = blenderRes.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          blenderResult = await blenderRes.json();
          glbUrl = blenderResult.glb_url || blenderResult.output_url;
        } else {
          // Binary GLB response — convert to data URL
          const buffer = await blenderRes.arrayBuffer();
          const base64 = Buffer.from(buffer).toString("base64");
          glbUrl = `data:model/gltf-binary;base64,${base64}`;
        }
      } else {
        const errText = await blenderRes.text().catch(() => "");
        console.warn(`[garment-ai] Blender generation failed (${blenderRes.status}): ${errText.substring(0, 200)}`);
        // Don't fail — return the spec anyway so the user can see it
      }
    } catch (blenderErr) {
      console.warn(`[garment-ai] Blender backend unreachable: ${blenderErr.message}`);
      // Still return the spec — the frontend can show the spec while backend is down
    }

    return NextResponse.json({
      spec,
      blenderParams,
      glbUrl,
      template: blenderParams.template,
      message: glbUrl
        ? `Generated ${spec.name || spec.garment_type} successfully`
        : `Parsed garment spec for ${spec.name || spec.garment_type} (3D generation pending — Blender template not yet available)`,
    });
  } catch (err) {
    console.error("[garment-ai] Error:", err);
    return NextResponse.json(
      { error: err.message || "Garment AI generation failed" },
      { status: 500 }
    );
  }
}
