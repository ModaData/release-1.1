// File: app/api/prompt-to-blender/assemble/route.js
// LLM parses natural language garment description into structured JSON spec,
// then forwards to Blender backend for bmesh construction.
import { NextResponse } from "next/server";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const BLENDER_API_URL = process.env.BLENDER_API_URL || "http://localhost:8000";

// ── RunPod Serverless mode ──
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;
const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
const USE_SERVERLESS = !!(RUNPOD_ENDPOINT_ID && RUNPOD_API_KEY);
const RUNPOD_BASE = `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}`;

// ── System prompt: parses garment description into parts + PBR + fabric physics ──
const SYSTEM_PROMPT = `You are a fashion construction AI that converts natural language garment descriptions into structured JSON specs for a Blender-based garment builder.

Your job: Output a JSON object with garment parts, fabric, color, physics properties, AND full PBR material values. One LLM call, three outputs.

## VALID PART TYPES AND THEIR OPTIONS

### body
- variants: shirt, tshirt, hoodie, blazer, dress, pants, skirt, jacket, coat
- suffixes: front, back, full
- params: length (0.4-1.2m), width (0.3-0.55m), depth (0.15-0.30m), taper (0-0.1)

### collar
- variants: mandarin, spread, button_down, peter_pan, band, shawl, polo, crew, v_neck
- params: height (0.02-0.08m), width (0.08-0.20m), spread_angle (30-90)

### sleeve
- variants: long, short, three_quarter, cap, raglan, bell, puff
- suffixes: left, right (ALWAYS include both)
- params: length (0.15-0.65m), width_top (0.08-0.16m), width_bottom (0.05-0.12m)

### cuff
- variants: french, barrel, ribbed, elastic
- suffixes: left, right (ALWAYS include both)
- params: height (0.03-0.08m), width (0.05-0.10m), fold (true for french cuffs)

### pocket
- variants: patch, welt, flap, kangaroo, zippered
- suffixes: chest, hip_left, hip_right, back_left, back_right
- params: width (0.06-0.15m), height (0.08-0.18m)

### hood
- variants: standard, oversized
- suffixes: outer, lining
- params: height (0.20-0.40m), depth (0.15-0.35m), width (0.15-0.25m)

### placket
- suffixes: front, back
- params: width (0.02-0.04m)

### button
- params: radius (0.004-0.01m), count (1-12), spacing (0.05-0.12m)

### waistband
- variants: elastic, structured, drawstring
- suffixes: front, back, full
- params: height (0.02-0.06m)

### hem
- variants: straight, curved, split, ribbed
- suffixes: front, back, full
- params: height (0.01-0.04m)

## FABRIC TYPES
cotton, denim, silk, leather, linen, wool, spandex, velvet

## COLOR
RGB array [r, g, b] each 0.0-1.0. Common colors:
- white: [1.0, 1.0, 1.0], black: [0.02, 0.02, 0.02], navy: [0.05, 0.08, 0.22]
- red: [0.7, 0.1, 0.08], cream: [0.95, 0.92, 0.85], grey: [0.45, 0.45, 0.45]
- olive: [0.25, 0.30, 0.12], beige: [0.85, 0.78, 0.65], burgundy: [0.35, 0.05, 0.08]
- indigo: [0.08, 0.12, 0.28], tan: [0.76, 0.60, 0.42], ecru: [0.91, 0.90, 0.82]
- If no color mentioned, choose a natural color that matches the fabric.

## FABRIC PHYSICS (fabric_physics field)
Set mass and tension_stiffness based on fabric drape and weight:
- silk:    mass 0.15, tension_stiffness 5   (very light, fluid)
- spandex: mass 0.20, tension_stiffness 5   (stretchy)
- linen:   mass 0.25, tension_stiffness 12  (medium weight, crisp)
- cotton:  mass 0.30, tension_stiffness 15  (standard)
- velvet:  mass 0.35, tension_stiffness 18  (medium-heavy, plush)
- wool:    mass 0.40, tension_stiffness 20  (heavy, warm)
- denim:   mass 0.50, tension_stiffness 40  (stiff, structured)
- leather: mass 0.80, tension_stiffness 80  (very stiff, minimal drape)

## PBR VALUES (pbr_values field)
Set based on fabric's visual surface characteristics:
- roughness: 0.0 (mirror) to 1.0 (matte). Silk=0.25, cotton=0.85, leather=0.55, denim=0.90
- sheen_weight: fabric fuzz/sheen. Velvet=1.0, silk=0.8, cotton=0.3, leather=0.1
- sheen_roughness: 0.0 (sharp sheen) to 1.0 (soft sheen). Silk=0.3, wool=0.8
- subsurface_weight: light transmission. Thin cotton/silk=0.05-0.1, leather=0.0
- coat_weight: clearcoat (patent leather=0.8, standard leather=0.3, fabric=0.0)
- anisotropic: directional sheen (silk=0.5, satin=0.7, others=0.0)
- specular_ior_level: specularity. Silk=0.8, leather=0.6, cotton=0.3, linen=0.2
- normal_map_id: one of [twill_weave, jersey_knit, leather_grain, satin_weave, plain_weave]
  Default mapping: denim/linen→twill_weave, cotton→plain_weave, silk/velvet→satin_weave,
                   wool/spandex→jersey_knit, leather→leather_grain

## ASSEMBLY RULES
1. Output ONLY valid JSON (no markdown, no explanation).
2. ALWAYS include a "body" part.
3. Tops: include body, collar, sleeves at minimum.
4. Bottoms: include body and waistband at minimum.
5. Both sleeves = two separate parts with suffix "left" and "right".
6. Both cuffs = two separate parts with suffix "left" and "right".
7. Use realistic dimensions — shirt body ~0.65m, dress ~0.90m, jacket ~0.70m.
8. Interpret descriptors: "aged", "worn", "washed" → increase roughness; "patent", "glossy" → coat_weight > 0.

## OUTPUT FORMAT
{
  "garment_type": "shirt",
  "parts": [
    { "type": "body", "variant": "shirt", "suffix": "full", "params": { "length": 0.65, "width": 0.42, "taper": 0.04 } },
    { "type": "collar", "variant": "spread", "suffix": "", "params": { "height": 0.04 } },
    { "type": "sleeve", "variant": "long", "suffix": "left", "params": { "length": 0.55, "width_top": 0.11, "width_bottom": 0.08 } },
    { "type": "sleeve", "variant": "long", "suffix": "right", "params": { "length": 0.55, "width_top": 0.11, "width_bottom": 0.08 } }
  ],
  "fabric": "cotton",
  "color": [0.85, 0.83, 0.80],
  "fabric_physics": { "mass": 0.30, "tension_stiffness": 15 },
  "pbr_values": {
    "roughness": 0.85,
    "sheen_weight": 0.3,
    "sheen_roughness": 0.5,
    "subsurface_weight": 0.05,
    "coat_weight": 0.0,
    "anisotropic": 0.0,
    "specular_ior_level": 0.3,
    "normal_map_id": "plain_weave"
  }
}`;

export async function POST(request) {
  if (!OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    const { prompt, garmentContext } = await request.json();

    if (!prompt) {
      return NextResponse.json(
        { error: "No garment description provided" },
        { status: 400 }
      );
    }

    console.log("[prompt-to-blender] Prompt:", prompt);

    // ── Step 1: Call OpenAI to parse the prompt into a garment spec ──
    const userParts = [`Garment description: "${prompt}"`];

    if (garmentContext) {
      if (garmentContext.category) {
        userParts.push(`Category context: ${garmentContext.category}`);
      }
      if (garmentContext.fiber) {
        userParts.push(`Fiber/fabric context: ${garmentContext.fiber}`);
      }
      if (garmentContext.construction) {
        userParts.push(`Construction context: ${garmentContext.construction}`);
      }
    }

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userParts.join("\n") },
        ],
        max_tokens: 2000,
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
    });

    if (!openaiRes.ok) {
      const err = await openaiRes.json().catch(() => ({}));
      console.error("[prompt-to-blender] OpenAI error:", err);
      return NextResponse.json(
        { error: err.error?.message || `OpenAI error ${openaiRes.status}` },
        { status: openaiRes.status }
      );
    }

    const openaiData = await openaiRes.json();
    const content = openaiData.choices?.[0]?.message?.content || "";

    // Parse the garment spec JSON
    let spec;
    try {
      const cleaned = content
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
      spec = JSON.parse(cleaned);
    } catch {
      console.error("[prompt-to-blender] Failed to parse LLM response:", content.substring(0, 300));
      return NextResponse.json(
        { error: "Failed to parse garment specification from AI response" },
        { status: 500 }
      );
    }

    // Validate spec has required fields
    if (!spec.parts || !Array.isArray(spec.parts) || spec.parts.length === 0) {
      return NextResponse.json(
        { error: "AI returned an invalid garment spec (no parts)" },
        { status: 500 }
      );
    }

    const hasBody = spec.parts.some((p) => p.type === "body");
    if (!hasBody) {
      // Auto-add a default body if LLM forgot
      spec.parts.unshift({
        type: "body",
        variant: spec.garment_type || "shirt",
        suffix: "full",
        params: { length: 0.65, width: 0.42, taper: 0.04 },
      });
    }

    console.log(
      "[prompt-to-blender] Spec:",
      spec.garment_type,
      "with",
      spec.parts.length,
      "parts, fabric:",
      spec.fabric,
      spec.pbr_values ? `| PBR: roughness=${spec.pbr_values.roughness} sheen=${spec.pbr_values.sheen_weight}` : ""
    );

    // ── Step 2: Forward spec to Blender backend ──
    let blenderData;

    if (USE_SERVERLESS) {
      // RunPod Serverless mode
      console.log("[prompt-to-blender] Using RunPod Serverless");

      const runRes = await fetch(`${RUNPOD_BASE}/run`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RUNPOD_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: { operation: "assemble-garment", spec },
        }),
      });

      if (!runRes.ok) {
        const errText = await runRes.text().catch(() => "");
        return NextResponse.json(
          { error: `RunPod submit failed: ${runRes.status} ${errText}` },
          { status: runRes.status }
        );
      }

      const { id: jobId } = await runRes.json();
      console.log("[prompt-to-blender] RunPod job:", jobId);

      // Poll for completion (max 5 minutes)
      let output;
      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const statusRes = await fetch(`${RUNPOD_BASE}/status/${jobId}`, {
          headers: { Authorization: `Bearer ${RUNPOD_API_KEY}` },
        });
        if (!statusRes.ok) continue;
        const status = await statusRes.json();
        if (status.status === "COMPLETED") { output = status.output; break; }
        if (status.status === "FAILED") {
          throw new Error(status.error || "RunPod job failed");
        }
      }

      if (!output) {
        return NextResponse.json({ error: "Garment assembly timed out" }, { status: 504 });
      }
      if (output.error) {
        return NextResponse.json({ error: output.error }, { status: 500 });
      }

      blenderData = {
        glbDataUrl: output.glb_b64
          ? `data:model/gltf-binary;base64,${output.glb_b64}`
          : null,
        config: output.config || {},
      };
    } else {
      // Direct HTTP mode (local Docker / persistent pod)
      const blenderRes = await fetch(`${BLENDER_API_URL}/api/assemble-garment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec }),
      });

      if (!blenderRes.ok) {
        const errText = await blenderRes.text().catch(() => "");
        console.error("[prompt-to-blender] Blender backend error:", errText);
        return NextResponse.json(
          { error: `Garment construction failed: ${blenderRes.status} ${errText.substring(0, 200)}` },
          { status: blenderRes.status }
        );
      }

      blenderData = await blenderRes.json();
    }

    if (!blenderData.glbDataUrl) {
      return NextResponse.json(
        { error: "Blender backend returned no GLB data" },
        { status: 500 }
      );
    }

    console.log(
      "[prompt-to-blender] Success:",
      blenderData.config?.total_vertices || "?",
      "verts,",
      blenderData.config?.parts?.length || "?",
      "parts"
    );

    // ── Step 3: Return GLB data URL + config to frontend ──
    return NextResponse.json({
      glbDataUrl: blenderData.glbDataUrl,
      config: blenderData.config || {},
      spec, // Full parsed spec (includes pbr_values, fabric_physics for frontend display)
      fabric: spec.fabric,
      fabricPhysics: spec.fabric_physics || null,
      pbrValues: spec.pbr_values || null,
    });
  } catch (err) {
    console.error("[prompt-to-blender] error:", err);
    const isConnRefused =
      err.cause?.code === "ECONNREFUSED" || err.message?.includes("fetch failed");
    const msg = isConnRefused
      ? USE_SERVERLESS
        ? "RunPod Serverless endpoint unreachable. Check RUNPOD_ENDPOINT_ID and RUNPOD_API_KEY."
        : "Blender backend is not running. Start with: docker compose up"
      : err.message;
    return NextResponse.json({ error: msg }, { status: isConnRefused ? 503 : 500 });
  }
}
