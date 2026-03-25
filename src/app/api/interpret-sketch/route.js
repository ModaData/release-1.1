// File: app/api/interpret-sketch/route.js — GPT-4o vision interpretation of canvas sketches
import { NextResponse } from "next/server";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const CANVAS_SYSTEM_PROMPT = `You are a fashion design AI assistant working inside MODA DATA's AI Drawing Canvas. Your job is to interpret fashion sketches and describe the garment in detail.

RULES:
1. Describe ONLY what you can see in the sketch. Do not invent details that aren't drawn.
2. If a region is ambiguous, describe the most likely fashion interpretation.
3. If annotations (circled text, arrows with labels) are visible, incorporate them.
4. Use precise fashion terminology: "princess seams", "drop shoulder", "empire waist", "welt pocket", "notch lapel", "raglan sleeve", etc.
5. Describe proportions relative to the body: "hits at mid-thigh", "nipped at natural waist".
6. Output a single dense paragraph. No bullets, no lists, no headers.
7. ONLY respond with "INSUFFICIENT_SKETCH: ..." if the canvas is completely blank or has fewer than 3 visible lines/strokes. Even rough or minimal outlines with a few construction lines should be interpreted as a garment. Vector construction lines (clean black curves on white background) are valid garment sketches — describe what they depict.
8. If a garment category is provided as context, use it to guide your interpretation of the lines.

CONTEXT PROVIDED:
- Garment category (user-selected)
- Fabric type (user-selected, if any)
- Previous interpretation (to maintain continuity — evolve, don't restart)`;

export async function POST(request) {
  if (!OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured in .env.local" },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();

    // Support BOTH the canvas format (sketchImage) and the old scratch-mode format (sketchDataUrl)
    const imageDataUrl = body.sketchImage || body.sketchDataUrl;

    if (!imageDataUrl) {
      return NextResponse.json(
        { error: "Missing sketch image (sketchImage or sketchDataUrl)" },
        { status: 400 }
      );
    }

    // ── Canvas mode: new AI Drawing Canvas ──
    if (body.sketchImage) {
      return handleCanvasInterpretation(body, imageDataUrl);
    }

    // ── Legacy mode: scratch-mode from garment editor ──
    return handleLegacyInterpretation(body, imageDataUrl);
  } catch (err) {
    console.error("POST /api/interpret-sketch error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── Canvas mode handler (AI Drawing Canvas — GPT-4o full) ──
async function handleCanvasInterpretation(body, imageDataUrl) {
  const {
    garmentCategory,
    fabricContext,
    previousInterpretation,
    annotations,
  } = body;

  // Build user message text parts
  const textParts = [];
  if (garmentCategory) textParts.push(`Garment category context: ${garmentCategory}`);
  if (fabricContext) textParts.push(`Fabric context: ${fabricContext}`);
  if (previousInterpretation) textParts.push(`Previous interpretation (maintain continuity): ${previousInterpretation}`);
  if (annotations?.length > 0) {
    const annotationText = annotations.map((a) => `Designer noted: '${a.text}' near ${a.region}`).join(". ");
    textParts.push(annotationText);
  }

  const userContent = [
    {
      type: "image_url",
      image_url: { url: imageDataUrl, detail: "high" },
    },
  ];
  if (textParts.length > 0) {
    userContent.unshift({ type: "text", text: textParts.join("\n") });
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: CANVAS_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      max_tokens: 500,
      temperature: 0.4,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error("OpenAI canvas interpret error:", err);
    return NextResponse.json(
      { error: err.error?.message || `OpenAI error ${res.status}` },
      { status: res.status }
    );
  }

  const data = await res.json();
  const description = data.choices?.[0]?.message?.content?.trim() || "";

  // Check for insufficient sketch
  const isInsufficient = description.startsWith("INSUFFICIENT_SKETCH");

  // Extract garment attributes for constraint engine
  let garmentAttributes = null;
  if (!isInsufficient) {
    garmentAttributes = extractAttributes(description, body.garmentCategory);
  }

  return NextResponse.json({
    success: true,
    description: isInsufficient ? "" : description,
    isInsufficient,
    garmentAttributes,
  });
}

// ── Legacy mode handler (scratch-mode from garment editor — GPT-4o-mini) ──
async function handleLegacyInterpretation(body, imageDataUrl) {
  const { silhouetteId, silhouetteLabel, brandBrief, drawingTime } = body;

  const contextParts = [];
  if (silhouetteLabel) contextParts.push(`Base silhouette: ${silhouetteLabel}`);
  if (brandBrief?.brief) contextParts.push(`Brand: ${brandBrief.brief}`);
  if (brandBrief?.season?.label) contextParts.push(`Season: ${brandBrief.season.label}`);
  if (brandBrief?.fabricContext?.fiberId) {
    contextParts.push(`Fabric: ${brandBrief.fabricContext.fiberId}`);
  }
  const contextStr = contextParts.length > 0
    ? `\nDesign context: ${contextParts.join(". ")}.`
    : "";

  const drawTimeNote = drawingTime > 30000
    ? "The designer has been working on this for a while — give a detailed interpretation."
    : "The designer just started — focus on what you can see so far.";

  const systemPrompt = `You are an expert fashion design AI for the MODA DATA platform.
You are analyzing a user's hand-drawn garment sketch in real-time to provide guidance.

Your task:
1. Describe what garment design the sketch shows (silhouette, proportions, style direction)
2. Identify any design details the user is drawing (collars, pockets, seams, closures)
3. Suggest a short FLUX image-generation prompt fragment that captures the design intent

Return ONLY valid JSON with this structure:
{
  "interpretation": "2-3 sentences describing what the sketch shows as a garment design",
  "suggestedPrompt": "comma-separated FLUX prompt fragment for generating this garment",
  "confidence": 0.0 to 1.0 confidence in your interpretation,
  "detectedElements": ["array", "of", "detected", "design", "elements"]
}`;

  const userPrompt = `Analyze this garment design sketch.${contextStr}
${drawTimeNote}
The sketch uses white lines on a dark background with a faint silhouette guide.`;

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
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            {
              type: "image_url",
              image_url: { url: imageDataUrl, detail: "low" },
            },
          ],
        },
      ],
      temperature: 0.4,
      max_tokens: 400,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error("OpenAI interpret error:", err);
    return NextResponse.json(
      { error: err.error?.message || `OpenAI error ${res.status}` },
      { status: res.status }
    );
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "";

  let result;
  try {
    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    result = JSON.parse(cleaned);
  } catch {
    result = {
      interpretation: content.substring(0, 300),
      suggestedPrompt: "fashion garment design, professional quality",
      confidence: 0.3,
      detectedElements: [],
    };
  }

  return NextResponse.json({
    interpretation: result.interpretation || "Unable to interpret sketch",
    suggestedPrompt: result.suggestedPrompt || "fashion garment",
    confidence: Math.max(0, Math.min(1, result.confidence || 0.5)),
    detectedElements: result.detectedElements || [],
  });
}

// Simple attribute extraction from description text
function extractAttributes(description, category) {
  const lower = description.toLowerCase();
  const attributes = {
    type: category || "garment",
    components: [],
    silhouette: "regular",
    length: "standard",
    fit: "regular",
  };

  const componentKeywords = {
    lapels: ["lapel", "notch lapel", "peak lapel", "shawl lapel"],
    pockets: ["pocket", "welt pocket", "patch pocket", "flap pocket", "cargo pocket"],
    collar: ["collar", "mandarin collar", "spread collar", "band collar"],
    hood: ["hood", "hooded"],
    buttons: ["button", "double-breasted", "single-breasted"],
    zipper: ["zip", "zipper"],
    belt: ["belt", "belted"],
    cuffs: ["cuff", "ribbed cuff"],
  };

  for (const [component, keywords] of Object.entries(componentKeywords)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      attributes.components.push(component);
    }
  }

  if (lower.includes("structured") || lower.includes("tailored")) attributes.silhouette = "structured";
  if (lower.includes("fluid") || lower.includes("flowing") || lower.includes("draped")) attributes.silhouette = "fluid";
  if (lower.includes("relaxed") || lower.includes("loose") || lower.includes("oversized")) attributes.silhouette = "relaxed";
  if (lower.includes("fitted") || lower.includes("slim") || lower.includes("bodycon")) attributes.silhouette = "fitted";
  if (lower.includes("cropped") || lower.includes("above waist")) attributes.length = "cropped";
  if (lower.includes("mid-thigh") || lower.includes("mini")) attributes.length = "short";
  if (lower.includes("knee") || lower.includes("midi")) attributes.length = "midi";
  if (lower.includes("maxi") || lower.includes("full length") || lower.includes("ankle")) attributes.length = "full";

  return attributes;
}
