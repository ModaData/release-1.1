"use client";

import { useRef, useCallback, useEffect } from "react";
import { useDrawingCanvas } from "@/hooks/useDrawingCanvas";

const THROTTLE_MS = 800;
const MIN_PATHS_FOR_RENDER = 1;

export function useContinuousRender(canvasRef) {
  const { state, dispatch } = useDrawingCanvas();
  const abortControllerRef = useRef(null);
  const renderGenerationRef = useRef(0);
  const throttleTimerRef = useRef(null);
  const retryTimerRef = useRef(null);
  const lastSnapshotHashRef = useRef(null);
  const isRenderingRef = useRef(false);
  const pendingRetryRef = useRef(false);
  const lastInterpretDataRef = useRef(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
      if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  // Simple canvas diff: compare a small hash of the canvas data
  const getCanvasHash = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas?.getSnapshot) return null;
    const snapshot = canvas.getSnapshot();
    if (!snapshot) return null;
    return snapshot.substring(22, 122);
  }, [canvasRef]);

  const captureAndRender = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Check if locked or manual mode
    if (state.isLocked) return;
    if (state.manualRenderMode) return;

    // Already rendering — mark pending retry so we auto-retry when done
    if (isRenderingRef.current) {
      pendingRetryRef.current = true;
      return;
    }

    // Minimum path count — need at least one completed stroke
    const pathCount = canvas.getPathCount?.() || 0;
    if (pathCount < MIN_PATHS_FOR_RENDER) return;

    // Canvas diff detection — skip if nothing changed
    const hash = getCanvasHash();
    if (hash && hash === lastSnapshotHashRef.current) return;
    lastSnapshotHashRef.current = hash;

    // Cancel any in-flight render
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const generation = ++renderGenerationRef.current;
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    const snapshot = canvas.getSnapshot();
    if (!snapshot) return;

    // Reset stroke count
    canvas.resetStrokeCount?.();

    isRenderingRef.current = true;
    dispatch({ type: "SET_GENERATING", payload: true });
    dispatch({ type: "SET_ERROR", payload: null });

    let interpretData = null;

    try {
      // ── Step 1: Vision interpretation ──
      console.log("[render] Step 1: Interpreting sketch...");
      const interpretRes = await fetch("/api/interpret-sketch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sketchImage: snapshot,
          garmentCategory: state.garmentCategory || "",
          fabricContext: state.selectedFiber
            ? `${state.selectedFiber} ${state.selectedConstruction || ""}`.trim()
            : "",
          previousInterpretation: state.currentInterpretation || "",
          annotations: state.annotations.map((a) => ({
            region: describeRegion(a.region),
            text: a.text,
          })),
        }),
        signal,
      });

      interpretData = await interpretRes.json();
      console.log("[render] Step 1 complete:", {
        ok: interpretRes.ok,
        isInsufficient: interpretData.isInsufficient,
        descriptionLength: interpretData.description?.length || 0,
      });

      if (!interpretRes.ok) throw new Error(interpretData.error || "Sketch interpretation failed");

      // Check if insufficient
      if (interpretData.isInsufficient) {
        dispatch({ type: "SET_STATUS", payload: "Keep drawing — AI needs a bit more to work with" });
        dispatch({ type: "SET_GENERATING", payload: false });
        isRenderingRef.current = false;
        return;
      }

      // Extract fashion terms and update interpretation
      const terms = extractFashionTerms(interpretData.description);
      console.log("[render] Fashion terms:", terms.length > 0 ? terms.join(", ") : "(none)");
      dispatch({ type: "SET_FASHION_TERMS", payload: terms });
      dispatch({ type: "SET_INTERPRETATION", payload: interpretData.description });
      lastInterpretDataRef.current = interpretData;

      // Check if this render is still the latest
      if (generation !== renderGenerationRef.current) { isRenderingRef.current = false; return; }

      // ── Fire fast sketch-preview in parallel (non-blocking) ──
      fetch("/api/sketch-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sketchDataUrl: snapshot,
          silhouetteLabel: state.garmentCategory || "garment",
          suggestedPrompt: interpretData.description,
        }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.previewUrl) {
            dispatch({ type: "SET_PREVIEW_URL", payload: data.previewUrl });
          }
        })
        .catch(() => {}); // Non-critical

      // ── Step 2: Build prompt and generate render ──
      const renderEndpoint = state.renderMode === "precise"
        ? "/api/render-with-control"
        : "/api/render-from-sketch";

      console.log("[render] Step 2: Generating image via", renderEndpoint);

      const prompt = buildRenderPrompt(interpretData.description, state);

      const renderBody = state.renderMode === "precise"
        ? {
            prompt,
            negativePrompt: "sketch, drawing, pencil lines, rough, unfinished, cartoon, anime, illustration, color, fabric texture, pattern, real clothing, model, hanger, tags, text, watermark",
            controlImage: snapshot,
            controlType: "scribble",
            controlStrength: state.controlStrength,
            width: 768,
            height: 768,
          }
        : {
            prompt,
            negativePrompt: "sketch, drawing, pencil lines, rough, unfinished, cartoon, anime, illustration, color, fabric texture, pattern, real clothing, model, hanger, tags, text, watermark",
            width: 768,
            height: 768,
          };

      const renderRes = await fetch(renderEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(renderBody),
        signal,
      });

      const renderData = await renderRes.json();
      console.log("[render] Step 2 complete:", {
        ok: renderRes.ok,
        status: renderRes.status,
        hasImageUrl: !!renderData.imageUrl,
      });

      if (!renderRes.ok) throw new Error(renderData.error || "Image generation failed");

      // Check if still latest
      if (generation !== renderGenerationRef.current) { isRenderingRef.current = false; return; }

      // ── Step 3: Display ──
      dispatch({
        type: "PUSH_RENDER",
        payload: {
          url: renderData.imageUrl,
          description: interpretData.description,
          snapshot,
        },
      });
      // Clear preview now that HD render is ready
      dispatch({ type: "SET_PREVIEW_URL", payload: null });

    } catch (err) {
      if (err.name === "AbortError") {
        isRenderingRef.current = false;
        return; // Superseded — normal
      }

      console.error("[render] Error:", err.message);

      // ── Fallback: try sketch-preview when primary render fails ──
      if (snapshot) {
        try {
          console.log("[render] Attempting fallback via sketch-preview...");
          const fallbackRes = await fetch("/api/sketch-preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sketchDataUrl: snapshot,
              silhouetteLabel: state.garmentCategory || "garment",
              suggestedPrompt: interpretData?.description || "fashion garment design",
            }),
          });
          const fallbackData = await fallbackRes.json();
          if (fallbackRes.ok && fallbackData.previewUrl) {
            console.log("[render] Fallback succeeded:", fallbackData.previewUrl);

            // Extract fashion terms from interpretation if available
            const descForTerms = interpretData?.description || lastInterpretDataRef.current?.description;
            if (descForTerms) {
              const terms = extractFashionTerms(descForTerms);
              console.log("[render] Fallback — fashion terms extracted:", terms);
              dispatch({ type: "SET_FASHION_TERMS", payload: terms });
              dispatch({ type: "SET_INTERPRETATION", payload: descForTerms });
              if (interpretData?.description) lastInterpretDataRef.current = interpretData;
            }

            dispatch({
              type: "PUSH_RENDER",
              payload: {
                url: fallbackData.previewUrl,
                description: interpretData?.description || "Quick preview",
                snapshot,
              },
            });
            dispatch({ type: "SET_STATUS", payload: "Used quick preview (primary render failed)" });
            dispatch({ type: "SET_PREVIEW_URL", payload: null });
            return; // Don't show error — fallback succeeded
          }
        } catch (fallbackErr) {
          console.error("[render] Fallback also failed:", fallbackErr.message);
        }
      }

      dispatch({ type: "SET_ERROR", payload: err.message });
      dispatch({ type: "SET_GENERATING", payload: false });
    } finally {
      isRenderingRef.current = false;
      // If strokes happened while we were rendering, auto-retry with latest canvas
      if (pendingRetryRef.current) {
        pendingRetryRef.current = false;
        retryTimerRef.current = setTimeout(() => captureAndRender(), 300);
      }
    }
  }, [canvasRef, state, dispatch, getCanvasHash]);

  // Immediate trigger (on pen-lift) — always fires, no throttle
  const triggerRender = useCallback(() => {
    if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
    captureAndRender();
  }, [captureAndRender]);

  // Throttled trigger (during active drawing) — debounced
  const triggerThrottled = useCallback(() => {
    if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
    throttleTimerRef.current = setTimeout(captureAndRender, THROTTLE_MS);
  }, [captureAndRender]);

  // Manual render trigger (also used as retry)
  const triggerManualRender = useCallback(() => {
    lastSnapshotHashRef.current = null; // Reset diff
    captureAndRender();
  }, [captureAndRender]);

  return { triggerRender, triggerThrottled, triggerManualRender };
}

// ─── Fashion Term Extraction ─────────────────────────────
function extractFashionTerms(description) {
  if (!description) return [];
  const FASHION_TERMS = [
    "princess seams", "empire waist", "drop shoulder", "raglan sleeve", "set-in sleeve",
    "dolman sleeve", "puff sleeve", "bell sleeve", "cap sleeve", "kimono sleeve",
    "notch lapel", "peak lapel", "shawl lapel", "mandarin collar", "peter pan collar",
    "band collar", "spread collar", "stand collar", "v-neck", "crew neck", "scoop neck",
    "boat neck", "cowl neck", "halter neck", "off-shoulder", "one-shoulder",
    "welt pocket", "patch pocket", "flap pocket", "cargo pocket", "kangaroo pocket",
    "inseam pocket", "slash pocket",
    "a-line", "pencil skirt", "wrap skirt", "pleated skirt", "circle skirt",
    "box pleat", "knife pleat", "inverted pleat", "accordion pleat",
    "double-breasted", "single-breasted", "fly front", "button-through",
    "french dart", "bust dart", "waist dart",
    "yoke", "basque", "peplum", "godet", "gusset", "placket",
    "straight leg", "bootcut", "flare", "wide leg", "tapered", "skinny",
    "high-waisted", "low-rise", "mid-rise",
    "fitted", "oversized", "relaxed", "tailored", "structured", "flowing", "draped",
    "cropped", "midi", "maxi", "mini", "full length",
    "ribbed cuff", "elastic waist", "drawstring", "belted", "tie waist",
    "hood", "hooded", "zip-up", "pullover", "cardigan",
  ];
  const lower = description.toLowerCase();
  return FASHION_TERMS.filter((term) => lower.includes(term));
}

// ─── Helpers ─────────────────────────────────────────────

// Helper: describe annotation region as text for the vision model
function describeRegion(region) {
  if (!region?.points || region.points.length === 0) return "unknown region";
  const xs = region.points.map((p) => p.x);
  const ys = region.points.map((p) => p.y);
  const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const cy = ys.reduce((a, b) => a + b, 0) / ys.length;

  const h = cy < 300 ? "upper" : cy < 600 ? "middle" : "lower";
  const v = cx < 300 ? "left" : cx < 600 ? "center" : "right";
  return `${h}-${v} region`;
}

// Helper: build the full render prompt — white clay 3D maquette aesthetic
function buildRenderPrompt(sketchDescription, state) {
  const parts = [
    `White clay 3D render of ${sketchDescription}`,
    "matte white plaster material, no color, no fabric texture, no pattern",
    "uniform neutral white/off-white surface",
    "all construction details fully visible and sharp: seams, stitching lines, collar shape, pocket placement, closure hardware, cuff construction, hem finish",
    `Fit: ${fitToPrompt(state.fitValue)}`,
    `Length: ${lengthToPrompt(state.lengthValue)}`,
    "subtle soft shadows showing depth and dimension",
    "garment shown flat-lay or floating on invisible mannequin",
    "clean black background",
    "product photography lighting, soft directional studio light from upper left",
    "photorealistic clay maquette aesthetic, no model, no hanger, no tags",
    "centered composition, high detail, 8K quality",
  ];
  return parts.filter(Boolean).join(", ");
}

function fitToPrompt(val) {
  if (val < 0.2) return "slim, fitted, tailored";
  if (val < 0.4) return "slightly fitted, semi-tailored";
  if (val < 0.6) return "regular fit";
  if (val < 0.8) return "relaxed, comfortable";
  return "oversized, relaxed, loose";
}

function lengthToPrompt(val) {
  if (val < 0.2) return "cropped above waist";
  if (val < 0.4) return "cropped at waist";
  if (val < 0.6) return "hip length";
  if (val < 0.8) return "knee length";
  return "full length to ankles";
}
