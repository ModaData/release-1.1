// File: app/api/prompt-to-vector/route.js — GPT-4o generates SVG path data from text commands
import { NextResponse } from "next/server";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const SYSTEM_PROMPT = `You are a fashion design AI that generates SVG path data for garment construction lines.

Your job: Given a text command and canvas context, generate clean SVG path \`d\` attribute strings that draw the requested garment feature.

RULES:
1. Output ONLY valid JSON with this structure:
{
  "paths": [
    { "d": "M100 200 C120 180, 150 160, 200 200", "stroke": "#000000", "strokeWidth": 3, "label": "pocket-outline" }
  ],
  "explanation": "Brief description of what was drawn"
}

2. Use cubic Bezier curves (C command) for smooth garment lines. Use L for straight construction lines.
3. All coordinates are in pixels. The canvas dimensions are provided.
4. Draw professional, clean garment construction lines — not sketchy or rough.
5. For symmetric features (like pockets), draw both left and right sides.
6. Position elements logically on a garment body:
   - Collar/neckline: top center area (around y=100-200 for a 1000px tall canvas)
   - Shoulders: upper sides (y=150-250)
   - Chest/bust: y=200-400
   - Waist: y=400-500
   - Hips: y=500-600
   - Hem: y=700-900
   - Sleeves: extend from shoulder area outward
7. If an existing garment description is provided, place features in context.
8. Use closed paths (Z command) for enclosed shapes like pockets, collars.
9. Keep stroke colors dark (#000000 or #374151) and widths between 4-8px for main outlines and 2-4px for detail lines.

COMMON COMMANDS:
- "add pockets" → Draw patch or welt pocket outlines at hip level
- "add collar" → Draw collar shape at neckline
- "add hood" → Draw hood outline from neckline upward
- "add buttons" → Draw small circles/dots down center front
- "add belt" → Draw horizontal lines at waist level
- "make oversized" → Draw wider silhouette outline
- "draw hoodie" → Draw full hoodie silhouette with hood, kangaroo pocket
- "draw blazer" → Draw blazer silhouette with lapels, structured shoulders
- "draw dress" → Draw dress silhouette
- "add pleats" → Draw pleated lines at skirt area`;

export async function POST(request) {
  if (!OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    const { command, canvasWidth, canvasHeight, existingDescription } = await request.json();

    if (!command) {
      return NextResponse.json(
        { error: "No command provided" },
        { status: 400 }
      );
    }

    const w = canvasWidth || 800;
    const h = canvasHeight || 1000;

    const userParts = [
      `Canvas size: ${w}x${h} pixels.`,
      `Command: "${command}"`,
    ];

    if (existingDescription) {
      userParts.push(`Current garment on canvas: ${existingDescription}`);
    }

    console.log("[prompt-to-vector] Command:", command);

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
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
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("[prompt-to-vector] OpenAI error:", err);
      return NextResponse.json(
        { error: err.error?.message || `OpenAI error ${res.status}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Parse JSON from response
    let result;
    try {
      const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      result = JSON.parse(cleaned);
    } catch {
      console.error("[prompt-to-vector] Failed to parse response:", content.substring(0, 200));
      return NextResponse.json(
        { error: "Failed to parse AI response as SVG paths" },
        { status: 500 }
      );
    }

    if (!result.paths || !Array.isArray(result.paths) || result.paths.length === 0) {
      return NextResponse.json(
        { error: "AI returned no paths" },
        { status: 500 }
      );
    }

    console.log("[prompt-to-vector] Generated", result.paths.length, "paths");

    return NextResponse.json({
      success: true,
      paths: result.paths,
      explanation: result.explanation || "",
    });
  } catch (err) {
    console.error("[prompt-to-vector] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
