// File: app/api/openai/route.js — OpenAI GPT-4 Proxy for Smart Edit Suggestions
import { NextResponse } from "next/server";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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

    const { garmentType, hoveredPart, brandAesthetic, fabric, season, colorPalette } = body;

    if (!hoveredPart) {
      return NextResponse.json(
        { error: "Missing 'hoveredPart' in request" },
        { status: 400 }
      );
    }

    const systemPrompt = `You are an expert fashion designer AI assistant for the MODA DATA platform. 
You suggest specific, actionable design edits for garment parts. 
Return ONLY a JSON array of 4-6 short suggestion strings (max 6 words each).
Each suggestion should be a concrete design action the user can take on the hovered garment part.
Consider the brand aesthetic, fabric, season, and color palette when making suggestions.
Be creative but practical. Mix structural changes, texture changes, detail additions, and style variations.`;

    const userPrompt = `Garment: ${garmentType || "fashion garment"}
Hovered part: ${hoveredPart}
Brand aesthetic: ${brandAesthetic || "modern minimalism"}
Fabric: ${fabric || "not specified"}
Season: ${season || "not specified"}
Color palette: ${colorPalette || "not specified"}

Return a JSON array of 4-6 specific edit suggestions for the "${hoveredPart}" area.`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.8,
        max_tokens: 200,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("OpenAI error:", err);
      return NextResponse.json(
        { error: err.error?.message || `OpenAI error ${res.status}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "[]";

    // Parse JSON array from response
    let suggestions;
    try {
      // Handle cases where GPT wraps in markdown code blocks
      const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      suggestions = JSON.parse(cleaned);
    } catch {
      // Fallback: split by newlines if JSON parse fails
      suggestions = content
        .split("\n")
        .map((s) => s.replace(/^[\d\-\*\.]+\s*/, "").trim())
        .filter((s) => s.length > 0 && s.length < 50);
    }

    return NextResponse.json({ suggestions: suggestions.slice(0, 6) });
  } catch (err) {
    console.error("POST /api/openai error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
