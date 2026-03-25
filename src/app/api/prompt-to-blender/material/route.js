// File: app/api/prompt-to-blender/material/route.js
// User describes a material in natural language → GPT-4o → PBR JSON spec
// Frontend uses the result to call /api/blender action:swap-fabric with PBR overrides.
import { NextResponse } from "next/server";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const MATERIAL_SYSTEM_PROMPT = `You are a material science AI for a 3D fashion platform.
Convert a fabric/material description into a precise PBR (Physically Based Rendering) JSON spec
for Blender's Principled BSDF shader.

## FABRIC BASE TYPES
cotton, denim, silk, leather, linen, wool, spandex, velvet

## PBR OUTPUT FIELDS
- fabric_base: one of the base types above (closest match)
- base_color: [r, g, b] each 0.0-1.0 (interpret color description precisely)
- roughness: 0.0 (mirror) to 1.0 (fully matte)
- sheen_weight: fabric surface fuzz/sheen (0-1); velvet=1.0, silk=0.8, cotton=0.3, leather=0.1
- sheen_roughness: sharpness of sheen (0=sharp, 1=diffuse); silk=0.3, wool=0.8
- subsurface_weight: light transmission through fabric (0-1); thin silk/cotton=0.05-0.1, leather=0.0
- coat_weight: clearcoat/lacquer layer (0-1); patent leather=0.8, standard leather=0.3, fabric=0.0
- anisotropic: directional sheen for woven fabrics (0-1); silk/satin=0.5-0.7, others=0.0
- specular_ior_level: specularity intensity (0-1); silk=0.8, leather=0.6, cotton=0.3, raw linen=0.2
- normal_map_id: texture ID for surface microdetail:
    twill_weave (denim, linen diagonal weave)
    jersey_knit (t-shirt, spandex, knitted wool)
    leather_grain (smooth or pebbled leather)
    satin_weave (silk, velvet, smooth synthetics)
    plain_weave (basic cotton, muslin, simple weaves)

## INTERPRETATION GUIDE
- "aged", "worn", "faded", "washed" → increase roughness by 0.1-0.15
- "patent", "glossy", "lacquered" → coat_weight 0.6-0.9, low roughness
- "raw", "natural", "unbleached" → slightly higher roughness and subsurface
- "brushed", "napped", "peach" → increase sheen_weight 0.1-0.2
- "heavyweight", "thick" → reduce subsurface_weight
- "sheer", "lightweight", "gauze" → increase subsurface_weight 0.1-0.2
- Color modifiers: "dark", "deep", "rich" → darken by 30%; "light", "pale", "pastel" → lighten

## RULES
1. Output ONLY valid JSON (no markdown, no explanation).
2. All float values must be in valid range for their field.
3. Interpret compound descriptions like "aged indigo denim" fully.

## OUTPUT FORMAT
{
  "fabric_base": "denim",
  "base_color": [0.08, 0.12, 0.28],
  "roughness": 0.95,
  "sheen_weight": 0.5,
  "sheen_roughness": 0.65,
  "subsurface_weight": 0.02,
  "coat_weight": 0.0,
  "anisotropic": 0.0,
  "specular_ior_level": 0.22,
  "normal_map_id": "twill_weave"
}`;

export async function POST(request) {
  if (!OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    const { description } = await request.json();

    if (!description) {
      return NextResponse.json(
        { error: "No material description provided" },
        { status: 400 }
      );
    }

    console.log("[material] Description:", description);

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: MATERIAL_SYSTEM_PROMPT },
          { role: "user", content: `Material description: "${description}"` },
        ],
        max_tokens: 500,
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });

    if (!openaiRes.ok) {
      const err = await openaiRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: err.error?.message || `OpenAI error ${openaiRes.status}` },
        { status: openaiRes.status }
      );
    }

    const openaiData = await openaiRes.json();
    const content = openaiData.choices?.[0]?.message?.content || "";

    let pbrSpec;
    try {
      pbrSpec = JSON.parse(content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
    } catch {
      console.error("[material] Failed to parse response:", content.substring(0, 200));
      return NextResponse.json(
        { error: "Failed to parse PBR spec from AI response" },
        { status: 500 }
      );
    }

    console.log("[material] PBR spec:", pbrSpec.fabric_base,
      "roughness:", pbrSpec.roughness, "sheen:", pbrSpec.sheen_weight);

    return NextResponse.json({
      pbrSpec,
      description,
      // Convenience: base_color as separate r/g/b for /api/blender form params
      swapFabricParams: {
        fabric_type: pbrSpec.fabric_base || "cotton",
        roughness: pbrSpec.roughness,
        sheen_weight: pbrSpec.sheen_weight,
        sheen_roughness: pbrSpec.sheen_roughness,
        subsurface_weight: pbrSpec.subsurface_weight,
        coat_weight: pbrSpec.coat_weight,
        anisotropic: pbrSpec.anisotropic,
        specular_ior_level: pbrSpec.specular_ior_level,
        base_color_r: pbrSpec.base_color?.[0],
        base_color_g: pbrSpec.base_color?.[1],
        base_color_b: pbrSpec.base_color?.[2],
        normal_map_id: pbrSpec.normal_map_id,
      },
    });
  } catch (err) {
    console.error("[material] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
