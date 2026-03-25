import { NextResponse } from "next/server";

export async function POST(request) {
  try {
    const { sketchDescription, fabricContext, garmentCategory, styleNotes } = await request.json();

    if (!sketchDescription) {
      return NextResponse.json({ error: "No sketch description provided" }, { status: 400 });
    }

    const systemPrompt = `You are a fashion design consultant inside MODA DATA's AI Drawing Canvas. Given a sketch interpretation and fabric context, provide 1-2 concise, actionable design suggestions. Each suggestion should be specific and implementable (e.g., "Try adding a waist seam to break the silhouette" or "This fabric drapes best with bias-cut panels"). No fluff, no greetings. Respond as a JSON array of strings.`;

    const userMessage = [
      `Sketch interpretation: ${sketchDescription}`,
      fabricContext ? `Fabric: ${fabricContext}` : "",
      garmentCategory ? `Category: ${garmentCategory}` : "",
      styleNotes ? `Style direction: ${styleNotes}` : "",
    ].filter(Boolean).join("\n");

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        max_tokens: 200,
        temperature: 0.7,
        response_format: { type: "json_object" },
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error("OpenAI suggest error:", errText);
      return NextResponse.json({ error: "Suggestion generation failed" }, { status: 502 });
    }

    const data = await openaiRes.json();
    const content = data.choices?.[0]?.message?.content?.trim() || "[]";

    let suggestions = [];
    try {
      const parsed = JSON.parse(content);
      suggestions = parsed.suggestions || parsed || [];
      if (!Array.isArray(suggestions)) suggestions = [suggestions];
    } catch {
      suggestions = [content];
    }

    return NextResponse.json({
      success: true,
      suggestions: suggestions.slice(0, 2),
    });
  } catch (err) {
    console.error("suggest-design error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
