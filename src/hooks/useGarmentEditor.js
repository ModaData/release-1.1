// File: hooks/useGarmentEditor.js — MODA DATA Core Editor Hook
"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { runReplicate } from "@/lib/replicate-client";
import {
  loadImageToCanvas,
  syncCanvasSize,
  clearCanvas,
  canvasToDataUrl,
  getCanvasCoords,
  isPixelInMask,
  canvasHasContent,
  drawMaskGlow,
  featherMask,
} from "@/lib/canvas-utils";
import {
  initPerception,
  getHoverInfo,
  getHoverMask,
  getClickMask,
} from "@/lib/perception";
import { BRUSH_TYPES } from "@/components/garment-editor/CanvasToolbar";
import { generateFabricPromptFragment } from "@/lib/fabric-db";

// ─── Model versions ───
const FLUX_FILL_DEV_VERSION =
  "ca8350ff748d56b3ebbd5a12bd3436c2214262a4ff8619de9890ecc41751a008";

export function useGarmentEditor(brandBrief, clipDescription) {
  // ── State ──
  const [imageUrl, setImageUrl] = useState(null);
  const [currentImageUrl, setCurrentImageUrl] = useState(null);
  const [selectedMask, setSelectedMask] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState("Upload a garment image to start");
  const [history, setHistory] = useState([]);
  const [drawingTool, setDrawingTool] = useState("pencil");
  const [drawingColor, setDrawingColor] = useState("#FF3B30");
  const [editPrompt, setEditPrompt] = useState("");

  // Perception state (Phase 2)
  const [hoverLabel, setHoverLabel] = useState(null);
  const [hoverCategoryId, setHoverCategoryId] = useState(null);
  const [hoverSubRegion, setHoverSubRegion] = useState(null);
  const [isPerceptionReady, setIsPerceptionReady] = useState(false);
  const [isPerceptionLoading, setIsPerceptionLoading] = useState(false);
  const [debugInfo, setDebugInfo] = useState("waiting");

  // ── Refs ──
  const canvasRef = useRef(null);
  const maskCanvasRef = useRef(null);
  const drawCanvasRef = useRef(null);
  const drawStateRef = useRef({ lastX: null, lastY: null });
  // Connected line tool: stores anchor points
  const connectedLineRef = useRef({ points: [], active: false });
  const perceptionRef = useRef(null);
  const hoverThrottleRef = useRef(0);

  // ═══════════════════════════════════════════════════════
  // UPLOAD — now triggers perception pipeline
  // ═══════════════════════════════════════════════════════
  const handleImageUpload = useCallback(async (file) => {
    if (!file?.type?.startsWith("image/")) {
      setError("Please upload a PNG, JPG, or WebP image");
      return;
    }

    setError(null);
    setStatus("Loading image...");
    setIsPerceptionReady(false);
    setIsPerceptionLoading(true);
    perceptionRef.current = null;

    const url = URL.createObjectURL(file);

    try {
      await loadImageToCanvas(canvasRef.current, url);
      syncCanvasSize(
        canvasRef.current,
        maskCanvasRef.current,
        drawCanvasRef.current
      );
      clearCanvas(maskCanvasRef.current);
      clearCanvas(drawCanvasRef.current);

      setImageUrl(url);
      setCurrentImageUrl(url);
      setSelectedMask(null);
      setHoverLabel(null);
      setHistory([{ imageUrl: url, label: "Original" }]);
      setStatus("Analyzing garment...");

      // ── Run perception pipeline (SegFormer + SAM encoder in parallel) ──
      try {
        const perception = await initPerception(
          canvasRef.current,
          url,
          (msg) => setStatus(msg)
        );
        perceptionRef.current = perception;
        setIsPerceptionReady(true);
        setStatus(
          "Ready! Hover over the garment to see parts, click to select."
        );
      } catch (err) {
        console.error("Perception init failed:", err);
        setStatus(
          "Ready! Click on any part of the garment to start editing. (Hover detection unavailable)"
        );
        setIsPerceptionReady(false);
      }
    } catch (err) {
      console.error("Upload error:", err);
      setError("Failed to load image. Try a different file.");
    } finally {
      setIsPerceptionLoading(false);
    }
  }, []);

  // ═══════════════════════════════════════════════════════
  // HOVER — SegFormer category lookup + sub-region + glow
  // Uses canvasRef (base image) for coordinate mapping since
  // drawCanvas (z-index 2) is what receives the events but
  // canvasRef has the correct image dimensions.
  // ═══════════════════════════════════════════════════════
  const handleCanvasHover = useCallback(
    (e) => {
      if (!isPerceptionReady || selectedMask || isGenerating) return null;

      // Throttle to ~30fps
      const now = Date.now();
      if (now - hoverThrottleRef.current < 33) return null;
      hoverThrottleRef.current = now;

      // Map coordinates using base canvas (which has real image dimensions)
      const coords = getCanvasCoords(e, canvasRef.current);
      if (!coords) return null;

      const perception = perceptionRef.current;
      if (!perception) return null;

      const info = getHoverInfo(perception, coords.x, coords.y);

      if (!info || !info.isGarment) {
        if (hoverLabel !== null) {
          setHoverLabel(null);
          setHoverCategoryId(null);
          setHoverSubRegion(null);
          clearCanvas(maskCanvasRef.current);
        }
        return null;
      }

      // Same sub-region as before — skip redraw
      const currentKey = `${info.categoryId}-${info.subRegion || ""}`;
      const prevKey = `${hoverCategoryId}-${hoverSubRegion || ""}`;
      if (currentKey === prevKey) return null; // null = no change, don't re-fetch suggestions

      setHoverLabel(info.label);
      setHoverCategoryId(info.categoryId);
      setHoverSubRegion(info.subRegion || null);

      // Draw sub-region or category glow
      const hoverMaskCanvas = getHoverMask(perception, info.categoryId, info.subRegion);
      if (hoverMaskCanvas && maskCanvasRef.current) {
        syncCanvasSize(canvasRef.current, maskCanvasRef.current);
        drawMaskGlow(maskCanvasRef.current, hoverMaskCanvas);
      }

      return info;
    },
    [isPerceptionReady, selectedMask, isGenerating, hoverLabel, hoverCategoryId, hoverSubRegion]
  );

  const handleCanvasHoverLeave = useCallback(() => {
    if (!selectedMask) {
      setHoverLabel(null);
      setHoverCategoryId(null);
      setHoverSubRegion(null);
      clearCanvas(maskCanvasRef.current);
    }
  }, [selectedMask]);

  // ═══════════════════════════════════════════════════════
  // CLICK — Perception-powered mask OR Replicate SAM fallback
  // ═══════════════════════════════════════════════════════
  const handleCanvasClick = useCallback(
    async (e) => {
      const canvas = canvasRef.current;
      if (!currentImageUrl || isGenerating || !canvas) return;

      const coords = getCanvasCoords(e, canvas);
      if (!coords) return;

      console.log("[CLICK DEBUG] Click at", coords, "canvas size:", canvas.width, "x", canvas.height);
      console.log("[CLICK DEBUG] drawCanvas size:", drawCanvasRef.current?.width, "x", drawCanvasRef.current?.height);
      console.log("[CLICK DEBUG] perception ready:", perceptionRef.current?.isSegFormerReady);

      setError(null);
      setIsGenerating(true);
      clearCanvas(drawCanvasRef.current);
      clearCanvas(maskCanvasRef.current);

      const perception = perceptionRef.current;

      // ── Strategy A: Use perception pipeline (SegFormer + SAM decoder) ──
      if (perception?.isSegFormerReady) {
        try {
          const { mask, label, categoryId, subRegion } = await getClickMask(
            perception,
            coords.x,
            coords.y,
            (msg) => setStatus(msg)
          );

          console.log("[CLICK DEBUG] Mask received:", { label, categoryId, subRegion, maskW: mask?.width, maskH: mask?.height });
          
          // Verify mask has non-transparent pixels
          if (mask) {
            const mCtx = mask.getContext("2d", { willReadFrequently: true });
            const mData = mCtx.getImageData(0, 0, mask.width, mask.height).data;
            let opaquePixels = 0;
            for (let i = 3; i < mData.length; i += 4) {
              if (mData[i] > 128) opaquePixels++;
            }
            console.log("[CLICK DEBUG] Mask opaque pixels:", opaquePixels, "of", mask.width * mask.height, "total");
          }

          setSelectedMask({
            id: `perception-${Date.now()}`,
            label,
            categoryId,
            subRegion,
            canvas: mask,
            point: coords,
          });

          syncCanvasSize(canvas, maskCanvasRef.current, drawCanvasRef.current);
          drawMaskGlow(maskCanvasRef.current, mask);
          setHoverLabel(null);
          setHoverCategoryId(null);
          setHoverSubRegion(null);
          setStatus(
            `"${label}" selected! Draw your design changes, then click Generate Edit.`
          );
          setIsGenerating(false);
          return;
        } catch (err) {
          if (err.message.includes("click on a garment")) {
            setError(err.message);
            setIsGenerating(false);
            return;
          }
          console.warn(
            "Perception click failed, falling back to SAM:",
            err.message
          );
        }
      }

      // ── Strategy B: Replicate SAM via our API route (fallback) ──
      setStatus("Generating mask with SAM... (5–15 seconds)");
      try {
        // Get data URL from canvas for our SAM API
        const imageDataUrl = canvas.toDataURL("image/jpeg", 0.85);
        const samRes = await fetch("/api/sam-encode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image: imageDataUrl,
            label: "clothes,garment",
            point_x: coords.x,
            point_y: coords.y,
          }),
        });

        if (!samRes.ok) {
          const err = await samRes.json().catch(() => ({}));
          throw new Error(err.error || `SAM API failed: ${samRes.status}`);
        }

        const samData = await samRes.json();
        if (!samData.masks || samData.masks.length === 0) {
          throw new Error("SAM returned no masks");
        }

        const maskUrl = samData.masks[0];
        if (!maskUrl?.startsWith("http") && !maskUrl?.startsWith("data:")) throw new Error("Invalid mask URL");

        const rawMask = document.createElement("canvas");
        await loadImageToCanvas(rawMask, maskUrl);

        const resizedMask = document.createElement("canvas");
        resizedMask.width = canvas.width;
        resizedMask.height = canvas.height;
        const resizedCtx = resizedMask.getContext("2d");
        resizedCtx.drawImage(rawMask, 0, 0, canvas.width, canvas.height);

        // Convert RGB brightness → alpha channel
        // Grounded SAM returns JPEG masks (white=mask, black=bg, alpha always 255)
        // but isPixelInMask() and drawMaskGlow() check alpha channel
        const imgData = resizedCtx.getImageData(0, 0, resizedMask.width, resizedMask.height);
        const px = imgData.data;
        for (let i = 0; i < px.length; i += 4) {
          const brightness = (px[i] + px[i + 1] + px[i + 2]) / 3;
          px[i + 3] = brightness > 128 ? 255 : 0; // white → opaque, black → transparent
        }
        resizedCtx.putImageData(imgData, 0, 0);

        setSelectedMask({
          id: `sam-${Date.now()}`,
          label: "AI-Selected Region",
          canvas: resizedMask,
          point: coords,
        });

        syncCanvasSize(canvas, maskCanvasRef.current, drawCanvasRef.current);
        drawMaskGlow(maskCanvasRef.current, resizedMask);
        setStatus("Region selected! Draw your changes, then Generate Edit.");
      } catch (err) {
        console.error("SAM fallback failed:", err);

        // ── Strategy C: Circle fallback ──
        const fallback = document.createElement("canvas");
        fallback.width = canvas.width;
        fallback.height = canvas.height;
        const ctx = fallback.getContext("2d");
        const radius = Math.min(canvas.width, canvas.height) * 0.12;
        ctx.beginPath();
        ctx.arc(coords.x, coords.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = "white";
        ctx.fill();

        setSelectedMask({
          id: `fallback-${Date.now()}`,
          label: "Selected Region",
          canvas: fallback,
          point: coords,
        });

        syncCanvasSize(canvas, maskCanvasRef.current, drawCanvasRef.current);
        drawMaskGlow(maskCanvasRef.current, fallback);
        setError("SAM unavailable. Using circle selection.");
        setStatus(
          "Region selected (fallback). Draw changes, then Generate Edit."
        );
      } finally {
        setIsGenerating(false);
      }
    },
    [currentImageUrl, isGenerating]
  );

  // ═══════════════════════════════════════════════════════
  // DRAWING HANDLERS
  // ═══════════════════════════════════════════════════════
  const handlePointerDown = useCallback(
    (e) => {
      setDebugInfo(`pointerDown! mask=${!!selectedMask} gen=${isGenerating}`);
      if (!selectedMask || isGenerating) {
        setDebugInfo(`BLOCKED: mask=${!!selectedMask} gen=${isGenerating}`);
        return;
      }

      const pos = getCanvasCoords(e, drawCanvasRef.current);
      if (!pos) {
        setDebugInfo("BLOCKED: no pos from getCanvasCoords");
        return;
      }
      
      setDebugInfo(`pos=${pos.x},${pos.y} drawCanvas=${drawCanvasRef.current?.width}x${drawCanvasRef.current?.height} maskCanvas=${selectedMask.canvas?.width}x${selectedMask.canvas?.height}`);
      
      // TEMPORARILY BYPASS mask check for debugging — allow drawing anywhere
      // const inMask = isPixelInMask(selectedMask.canvas, pos.x, pos.y);
      // if (!inMask) return;

      const tool = BRUSH_TYPES.find((b) => b.id === drawingTool) || BRUSH_TYPES[0];

      // Connected Line tool: click-to-place-points mode
      if (tool.connectedLine) {
        const ctx = drawCanvasRef.current.getContext("2d");
        const cl = connectedLineRef.current;

        if (cl.points.length > 0) {
          // Draw line from last point to this point
          const last = cl.points[cl.points.length - 1];
          ctx.save();
          ctx.strokeStyle = drawingColor;
          ctx.lineWidth = tool.lineWidth;
          ctx.lineCap = tool.lineCap || "round";
          ctx.lineJoin = tool.lineJoin || "round";
          ctx.globalAlpha = tool.opacity;
          ctx.beginPath();
          ctx.moveTo(last.x, last.y);
          ctx.lineTo(pos.x, pos.y);
          ctx.stroke();
          ctx.restore();
        }

        // Place point indicator
        ctx.save();
        ctx.fillStyle = drawingColor;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, tool.lineWidth * 0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        cl.points.push({ x: pos.x, y: pos.y });
        cl.active = true;

        // Double-click to finish (detected by time between clicks)
        if (e.detail === 2 && cl.points.length >= 2) {
          connectedLineRef.current = { points: [], active: false };
        }
        return;
      }

      setIsDrawing(true);
      drawStateRef.current = { lastX: pos.x, lastY: pos.y };

      try {
        drawCanvasRef.current?.setPointerCapture(e.pointerId);
      } catch {}
    },
    [selectedMask, isGenerating, drawingTool, drawingColor]
  );

  const handlePointerMove = useCallback(
    (e) => {
      if (!isDrawing || !drawCanvasRef.current || !selectedMask) return;

      const pos = getCanvasCoords(e, drawCanvasRef.current);
      if (!pos) return;
      // TEMPORARILY BYPASS mask check for debugging
      // if (!isPixelInMask(selectedMask.canvas, pos.x, pos.y)) return;

      const { lastX, lastY } = drawStateRef.current;
      if (lastX === null) {
        drawStateRef.current = { lastX: pos.x, lastY: pos.y };
        return;
      }

      const ctx = drawCanvasRef.current.getContext("2d");
      const tool = BRUSH_TYPES.find((b) => b.id === drawingTool) || BRUSH_TYPES[0];

      // Eraser mode
      if (tool.eraser) {
        ctx.save();
        ctx.globalCompositeOperation = "destination-out";
        ctx.lineWidth = tool.lineWidth;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.globalAlpha = 1.0;
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        ctx.restore();
        drawStateRef.current = { lastX: pos.x, lastY: pos.y };
        return;
      }

      ctx.save();
      ctx.strokeStyle = drawingColor;
      ctx.lineWidth = tool.lineWidth;
      ctx.lineCap = tool.lineCap || "round";
      ctx.lineJoin = tool.lineJoin || "round";
      ctx.globalAlpha = tool.opacity;

      ctx.beginPath();
      ctx.moveTo(lastX, lastY);

      if (tool.noise) {
        // Crayon: jittered strokes
        const jx = (Math.random() - 0.5) * 5;
        const jy = (Math.random() - 0.5) * 5;
        ctx.lineTo(pos.x + jx, pos.y + jy);
      } else if (tool.airbrush) {
        // Airbrush: radial gradient dots
        ctx.restore();
        ctx.save();
        const gradient = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, tool.lineWidth);
        gradient.addColorStop(0, drawingColor + "40");
        gradient.addColorStop(0.5, drawingColor + "15");
        gradient.addColorStop(1, "transparent");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, tool.lineWidth, 0, Math.PI * 2);
        ctx.fill();
      } else if (tool.watercolor) {
        // Watercolor: layered transparent strokes
        for (let j = 0; j < 3; j++) {
          ctx.globalAlpha = tool.opacity * (0.3 + Math.random() * 0.3);
          ctx.lineWidth = tool.lineWidth * (0.7 + Math.random() * 0.6);
          ctx.beginPath();
          ctx.moveTo(lastX + (Math.random() - 0.5) * 4, lastY + (Math.random() - 0.5) * 4);
          ctx.lineTo(pos.x + (Math.random() - 0.5) * 4, pos.y + (Math.random() - 0.5) * 4);
          ctx.stroke();
        }
      } else if (tool.calligraphy) {
        // Calligraphy: pressure-sensitive width
        const dist = Math.sqrt((pos.x - lastX) ** 2 + (pos.y - lastY) ** 2);
        ctx.lineWidth = Math.max(1, tool.lineWidth * Math.min(1, 8 / (dist + 1)));
        const midX = (lastX + pos.x) / 2;
        const midY = (lastY + pos.y) / 2;
        ctx.quadraticCurveTo(lastX, lastY, midX, midY);
      } else {
        // Default: smooth quadratic
        const midX = (lastX + pos.x) / 2;
        const midY = (lastY + pos.y) / 2;
        ctx.quadraticCurveTo(lastX, lastY, midX, midY);
      }

      ctx.stroke();
      ctx.restore();

      drawStateRef.current = { lastX: pos.x, lastY: pos.y };
    },
    [isDrawing, selectedMask, drawingTool, drawingColor]
  );

  const handlePointerUp = useCallback(
    (e) => {
      if (!isDrawing) return;
      setIsDrawing(false);
      drawStateRef.current = { lastX: null, lastY: null };
      try {
        drawCanvasRef.current?.releasePointerCapture(e.pointerId);
      } catch {}
    },
    [isDrawing]
  );

  // ═══════════════════════════════════════════════════════
  // GENERATE → FLUX.1 Fill Dev Inpainting
  //
  // Pipeline (per client spec):
  //   1. Composite: bake the user's scribble drawing INTO
  //      the original image. The scribble acts as visual
  //      guidance for the AI — e.g. drawing a belt shape
  //      tells FLUX "put a belt here".
  //   2. Build mask: feather the SAM mask edges for smooth
  //      blending at boundaries.
  //   3. Send to FLUX Fill Dev:
  //        image = original + scribble composited
  //        mask  = SAM region (white = regenerate)
  //        prompt = optional text guidance
  //   4. FLUX regenerates ONLY the white-masked pixels,
  //      using the scribble lines as visual context.
  //   5. CLIENT-SIDE COMPOSITE: take FLUX's output and
  //      paste ONLY the masked pixels back onto the original
  //      image. This guarantees the rest is pixel-perfect
  //      identical to the original.
  //
  // Text prompt is OPTIONAL — user can just draw and generate.
  // ═══════════════════════════════════════════════════════
  const handleGenerateEdit = useCallback(async () => {
    if (!selectedMask) {
      setError("Click on the garment to select a region first");
      return;
    }

    const hasDrawing = canvasHasContent(drawCanvasRef.current);

    if (!hasDrawing && !editPrompt.trim()) {
      setError(
        "Draw on the selected region and/or enter a text prompt"
      );
      return;
    }
    if (isGenerating) return;

    setError(null);
    setIsGenerating(true);
    setStatus("Preparing inpainting request...");

    try {
      const baseCanvas = canvasRef.current;
      const w = baseCanvas.width;
      const h = baseCanvas.height;

      // ── Save a clean copy of the original image BEFORE compositing ──
      // We need this later for client-side compositing to guarantee
      // that non-masked pixels remain 100% identical to the original.
      const originalSnapshot = document.createElement("canvas");
      originalSnapshot.width = w;
      originalSnapshot.height = h;
      originalSnapshot.getContext("2d").drawImage(baseCanvas, 0, 0);

      // ── Step 1: Composite scribble INTO the image ──
      // FLUX Fill Dev sees the scribble as part of the image content,
      // so it uses the drawn lines as visual guidance when regenerating.
      const compCanvas = document.createElement("canvas");
      compCanvas.width = w;
      compCanvas.height = h;
      const compCtx = compCanvas.getContext("2d");

      // Start with original garment image
      compCtx.drawImage(baseCanvas, 0, 0);

      // Overlay the user's scribble drawing on top
      if (hasDrawing) {
        compCtx.drawImage(drawCanvasRef.current, 0, 0);
        console.log("[FLUX] Scribble composited into image");
      }

      // ── Step 2: Feather the SAM mask ──
      // Soft edges prevent hard boundary artifacts in the output
      const featheredMask = featherMask(selectedMask.canvas, 4);

      // ── Step 3: Build prompt ──
      // Context-aware prompt that incorporates brand brief, fabric, season,
      // and tells FLUX exactly what part is being edited.
      const partLabel = selectedMask.label || "selected region";
      const preservePrompt =
        "preserve the existing garment style, fabric texture, pattern and color of surrounding areas exactly, seamless blend with the rest of the garment";
      
      // Build brand context from brief
      let brandContext = "";
      if (brandBrief) {
        const parts = [];
        if (brandBrief.brief) parts.push(brandBrief.brief);
        // Rich fabric context from Fabric Knowledge Database
        if (brandBrief.fabricContext?.promptFragment) {
          parts.push(brandBrief.fabricContext.promptFragment);
        } else if (brandBrief.fabric) {
          parts.push(`${brandBrief.fabric.label} fabric (${brandBrief.fabric.weight})`);
        }
        if (brandBrief.season) parts.push(`${brandBrief.season.label} collection`);
        if (brandBrief.silhouette) parts.push(`${brandBrief.silhouette.label} silhouette`);
        if (brandBrief.colorPalette?.length > 0) parts.push("brand color palette");
        if (parts.length > 0) brandContext = `, brand aesthetic: ${parts.join(", ")}`;
      }

      // Build CLIP context from auto-description
      let clipContext = "";
      if (clipDescription) {
        // Extract the most useful parts of the CLIP description (garment type, fabric, style)
        // CLIP descriptions can be verbose, so we take the first 120 chars
        const cleanClip = clipDescription.replace(/\s+/g, " ").trim().substring(0, 120);
        clipContext = `, original garment: ${cleanClip}`;
      }

      let prompt;
      if (editPrompt.trim()) {
        prompt = `${editPrompt.trim()} on the ${partLabel} area only${brandContext}${clipContext}, ${preservePrompt}, high quality fashion garment, professional product photography`;
      } else if (hasDrawing) {
        prompt = `apply the drawn design changes to the ${partLabel} only${brandContext}${clipContext}, ${preservePrompt}, high quality fashion garment, professional product photography`;
      } else {
        prompt = `high quality fashion garment${brandContext}${clipContext}, ${preservePrompt}, professional product photography`;
      }

      // ── Step 4: Convert to data URLs ──
      setStatus("Uploading images to FLUX...");
      const imageDataUrl = canvasToDataUrl(compCanvas, "image/jpeg");
      const maskDataUrl = canvasToDataUrl(featheredMask, "image/png");

      if (!imageDataUrl || !maskDataUrl) {
        throw new Error("Failed to prepare image data for upload");
      }

      console.log("[FLUX] Image data URL length:", (imageDataUrl.length / 1024).toFixed(0), "KB");
      console.log("[FLUX] Mask data URL length:", (maskDataUrl.length / 1024).toFixed(0), "KB");
      console.log("[FLUX] Prompt:", prompt);

      // ── Step 5: Call FLUX Fill Dev ──
      setStatus("Generating with FLUX Fill Dev... (30–90 seconds)");

      const output = await runReplicate(
        FLUX_FILL_DEV_VERSION,
        {
          image: imageDataUrl,
          mask: maskDataUrl,
          prompt,
          num_inference_steps: 28,
          guidance: 30,
          megapixels: "match_input",
          output_format: "png",
          output_quality: 100,
        },
        (msg) => setStatus(`FLUX: ${msg}`)
      );

      // ── Step 6: Parse output ──
      let resultUrl;
      if (typeof output === "string") resultUrl = output;
      else if (Array.isArray(output)) {
        // Array elements can be strings or FileOutput objects {url: "..."}
        const first = output[0];
        resultUrl = typeof first === "string" ? first : first?.url || first?.uri;
      }
      else if (output?.url) resultUrl = output.url;
      else if (output?.uri) resultUrl = output.uri;
      else throw new Error("Unexpected FLUX output: " + JSON.stringify(output).substring(0, 200));

      console.log("[FLUX] Raw output type:", typeof output, Array.isArray(output) ? `array[${output.length}]` : "");
      
      if (!resultUrl?.startsWith("http")) {
        throw new Error("Invalid FLUX result URL: " + String(resultUrl).substring(0, 200));
      }

      console.log("[FLUX] Result URL:", resultUrl);

      // ── Step 6b: Proxy FLUX result to avoid CORS ──
      // Replicate delivery CDN may not send CORS headers, which would
      // taint the canvas and make getImageData() throw a security error.
      // Fetch through our API proxy to get a same-origin data URL.
      let safeResultUrl = resultUrl;
      if (resultUrl.startsWith("http")) {
        try {
          setStatus("Downloading FLUX result...");
          const proxyRes = await fetch("/api/replicate/proxy-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: resultUrl }),
          });
          if (proxyRes.ok) {
            const proxyData = await proxyRes.json();
            if (proxyData.dataUrl) {
              safeResultUrl = proxyData.dataUrl;
              console.log("[FLUX] Proxied result to data URL:", (safeResultUrl.length / 1024).toFixed(0), "KB");
            }
          } else {
            console.warn("[FLUX] Proxy failed, using direct URL (may fail CORS):", proxyRes.status);
          }
        } catch (proxyErr) {
          console.warn("[FLUX] Proxy error, using direct URL:", proxyErr.message);
        }
      }

      // ── Step 7: CLIENT-SIDE COMPOSITE ──
      setStatus("Compositing result...");

      const fluxResultCanvas = document.createElement("canvas");
      await loadImageToCanvas(fluxResultCanvas, safeResultUrl);
      console.log("[FLUX] Result loaded to canvas:", fluxResultCanvas.width, "x", fluxResultCanvas.height);

      // Build final image: original + FLUX result blended through mask
      const finalCanvas = document.createElement("canvas");
      finalCanvas.width = w;
      finalCanvas.height = h;
      const finalCtx = finalCanvas.getContext("2d");

      // Start with the ORIGINAL (pre-scribble) image
      finalCtx.drawImage(originalSnapshot, 0, 0);

      // Read all pixel data
      const finalData = finalCtx.getImageData(0, 0, w, h);
      const maskCtx = featheredMask.getContext("2d", { willReadFrequently: true });
      const maskData = maskCtx.getImageData(0, 0, featheredMask.width, featheredMask.height);

      // Scale FLUX result to match original dimensions if needed
      const fluxScaled = document.createElement("canvas");
      fluxScaled.width = w;
      fluxScaled.height = h;
      fluxScaled.getContext("2d").drawImage(fluxResultCanvas, 0, 0, w, h);
      const fluxData = fluxScaled.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h);

      // Scale mask to match if needed
      let scaledMaskData;
      if (featheredMask.width !== w || featheredMask.height !== h) {
        const scaledMask = document.createElement("canvas");
        scaledMask.width = w;
        scaledMask.height = h;
        scaledMask.getContext("2d").drawImage(featheredMask, 0, 0, w, h);
        scaledMaskData = scaledMask.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
      } else {
        scaledMaskData = maskData.data;
      }

      // Blend: where mask is white → use FLUX result, where black → keep original
      // Feathered edges get alpha-blended for smooth transitions
      for (let i = 0; i < w * h; i++) {
        const maskAlpha = scaledMaskData[i * 4 + 3] / 255; // 0.0 to 1.0

        if (maskAlpha > 0.01) {
          const pi = i * 4;
          // Alpha blend: result = flux * alpha + original * (1 - alpha)
          finalData.data[pi]     = Math.round(fluxData.data[pi]     * maskAlpha + finalData.data[pi]     * (1 - maskAlpha));
          finalData.data[pi + 1] = Math.round(fluxData.data[pi + 1] * maskAlpha + finalData.data[pi + 1] * (1 - maskAlpha));
          finalData.data[pi + 2] = Math.round(fluxData.data[pi + 2] * maskAlpha + finalData.data[pi + 2] * (1 - maskAlpha));
          finalData.data[pi + 3] = 255;
        }
      }

      finalCtx.putImageData(finalData, 0, 0);

      // Convert composited result to a blob URL for display
      const blob = await new Promise((resolve) => finalCanvas.toBlob(resolve, "image/png"));
      const finalUrl = URL.createObjectURL(blob);

      // ── Step 8: Load composited result onto canvas ──
      await loadImageToCanvas(canvasRef.current, finalUrl);
      syncCanvasSize(canvasRef.current, maskCanvasRef.current, drawCanvasRef.current);

      setCurrentImageUrl(finalUrl);
      setHistory((prev) => [
        ...prev,
        { imageUrl: finalUrl, label: `Edit: ${selectedMask.label}` },
      ]);

      // ── Clear state for next edit ──
      setSelectedMask(null);
      setHoverLabel(null);
      setHoverCategoryId(null);
      setHoverSubRegion(null);
      clearCanvas(maskCanvasRef.current);
      clearCanvas(drawCanvasRef.current);
      setEditPrompt("");

      // Re-init perception on the new result
      setIsPerceptionReady(false);
      try {
        const newPerception = await initPerception(
          canvasRef.current,
          finalUrl,
          (msg) => setStatus(msg)
        );
        perceptionRef.current = newPerception;
        setIsPerceptionReady(true);
      } catch {
        // Non-fatal — perception may fail on AI-generated images
      }

      setStatus("Edit complete! Hover over the garment to make another edit.");
    } catch (err) {
      console.error("FLUX inpainting error:", err);
      setError("Generation failed: " + err.message);
      setStatus("Generation failed. Try again or check your API token.");
    } finally {
      setIsGenerating(false);
    }
  }, [selectedMask, editPrompt, isGenerating]);

  // ═══════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════
  const handleClearDrawing = useCallback(() => {
    clearCanvas(drawCanvasRef.current);
    connectedLineRef.current = { points: [], active: false };
    setStatus("Drawing cleared");
  }, []);

  const handleStartOver = useCallback(() => {
    if (!confirm("Start over? All edits will be lost.")) return;

    [canvasRef, maskCanvasRef, drawCanvasRef].forEach((ref) =>
      clearCanvas(ref.current)
    );

    if (imageUrl?.startsWith("blob:")) URL.revokeObjectURL(imageUrl);
    history.forEach((h) => {
      if (h.imageUrl?.startsWith("blob:")) URL.revokeObjectURL(h.imageUrl);
    });

    setImageUrl(null);
    setCurrentImageUrl(null);
    setSelectedMask(null);
    setIsGenerating(false);
    setIsDrawing(false);
    setError(null);
    setHistory([]);
    setEditPrompt("");
    setHoverLabel(null);
    setHoverLabel(null);
    setHoverCategoryId(null);
    setHoverSubRegion(null);
    setIsPerceptionReady(false);
    perceptionRef.current = null;
    setStatus("Upload a garment image to start");
    drawStateRef.current = { lastX: null, lastY: null };
  }, [imageUrl, history]);

  const handleHistoryItemClick = useCallback(async (url) => {
    try {
      await loadImageToCanvas(canvasRef.current, url);
      syncCanvasSize(
        canvasRef.current,
        maskCanvasRef.current,
        drawCanvasRef.current
      );
      clearCanvas(maskCanvasRef.current);
      clearCanvas(drawCanvasRef.current);

      setCurrentImageUrl(url);
      setSelectedMask(null);
      setHoverLabel(null);
      setHoverCategoryId(null);
      setHoverSubRegion(null);

      // Re-init perception
      try {
        const perception = await initPerception(
          canvasRef.current,
          url,
          (msg) => setStatus(msg)
        );
        perceptionRef.current = perception;
        setIsPerceptionReady(true);
      } catch {
        setIsPerceptionReady(false);
      }

      setStatus("History loaded. Hover over garment to start editing.");
    } catch (err) {
      setError("Failed to load history item");
    }
  }, []);

  const hasScribble = useCallback(() => {
    return canvasHasContent(drawCanvasRef.current);
  }, []);

  // ── Canvas redraw on currentImageUrl change ──
  useEffect(() => {
    if (!currentImageUrl || !canvasRef.current) return;
    loadImageToCanvas(canvasRef.current, currentImageUrl)
      .then(() => {
        syncCanvasSize(
          canvasRef.current,
          maskCanvasRef.current,
          drawCanvasRef.current
        );
      })
      .catch((err) => {
        console.error("Canvas redraw error:", err);
        setError("Failed to render image");
      });
  }, [currentImageUrl]);

  // ═══════════════════════════════════════════════════════
  // ADD TEXT TO CANVAS
  // Prompts user for text, then draws it centered on the draw canvas
  // ═══════════════════════════════════════════════════════
  const addTextToCanvas = useCallback(() => {
    if (!selectedMask || !drawCanvasRef.current) return;
    const text = prompt("Enter text to add:");
    if (!text?.trim()) return;

    const ctx = drawCanvasRef.current.getContext("2d");
    const w = drawCanvasRef.current.width;
    const h = drawCanvasRef.current.height;

    ctx.save();
    ctx.fillStyle = drawingColor;
    ctx.font = "bold 32px 'Inter', 'Helvetica Neue', Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Find center of the mask region for placement
    const maskCtx = selectedMask.canvas.getContext("2d", { willReadFrequently: true });
    const maskData = maskCtx.getImageData(0, 0, selectedMask.canvas.width, selectedMask.canvas.height).data;
    let sumX = 0, sumY = 0, count = 0;
    for (let y = 0; y < selectedMask.canvas.height; y++) {
      for (let x = 0; x < selectedMask.canvas.width; x++) {
        if (maskData[(y * selectedMask.canvas.width + x) * 4 + 3] > 128) {
          sumX += x; sumY += y; count++;
        }
      }
    }
    const cx = count > 0 ? (sumX / count) * (w / selectedMask.canvas.width) : w / 2;
    const cy = count > 0 ? (sumY / count) * (h / selectedMask.canvas.height) : h / 2;

    ctx.fillText(text, cx, cy);
    ctx.restore();
    setStatus(`Text "${text}" added to canvas`);
  }, [selectedMask, drawingColor]);

  // ═══════════════════════════════════════════════════════
  // UPLOAD GRAPHIC OVERLAY
  // Draws an uploaded image onto the draw canvas within the mask region
  // ═══════════════════════════════════════════════════════
  const addGraphicToCanvas = useCallback((file) => {
    if (!selectedMask || !drawCanvasRef.current || !file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const ctx = drawCanvasRef.current.getContext("2d");
        const w = drawCanvasRef.current.width;
        const h = drawCanvasRef.current.height;

        // Find bounding box of the mask region
        const maskCtx = selectedMask.canvas.getContext("2d", { willReadFrequently: true });
        const mw = selectedMask.canvas.width;
        const mh = selectedMask.canvas.height;
        const maskData = maskCtx.getImageData(0, 0, mw, mh).data;
        let minX = mw, minY = mh, maxX = 0, maxY = 0;
        for (let y = 0; y < mh; y++) {
          for (let x = 0; x < mw; x++) {
            if (maskData[(y * mw + x) * 4 + 3] > 128) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }

        // Scale to canvas coordinates
        const scaleX = w / mw;
        const scaleY = h / mh;
        const regionX = minX * scaleX;
        const regionY = minY * scaleY;
        const regionW = (maxX - minX) * scaleX;
        const regionH = (maxY - minY) * scaleY;

        // Fit graphic inside the region while maintaining aspect ratio
        const aspect = img.width / img.height;
        let drawW, drawH;
        if (regionW / regionH > aspect) {
          drawH = regionH * 0.8;
          drawW = drawH * aspect;
        } else {
          drawW = regionW * 0.8;
          drawH = drawW / aspect;
        }
        const drawX = regionX + (regionW - drawW) / 2;
        const drawY = regionY + (regionH - drawH) / 2;

        ctx.save();
        ctx.drawImage(img, drawX, drawY, drawW, drawH);
        ctx.restore();
        setStatus("Graphic overlay added");
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }, [selectedMask]);

  // ── Cleanup ──
  useEffect(() => {
    return () => {
      if (imageUrl?.startsWith("blob:")) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  return {
    // State
    imageUrl,
    currentImageUrl,
    selectedMask,
    isGenerating,
    error,
    status,
    history,
    drawingTool,
    drawingColor,
    editPrompt,
    hoverLabel,
    isPerceptionReady,
    isPerceptionLoading,
    debugInfo,

    // Refs
    canvasRef,
    maskCanvasRef,
    drawCanvasRef,

    // Actions
    handleImageUpload,
    handleCanvasClick,
    handleCanvasHover,
    handleCanvasHoverLeave,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleClearDrawing,
    handleGenerateEdit,
    handleStartOver,
    handleHistoryItemClick,
    addTextToCanvas,
    addGraphicToCanvas,

    // Setters
    setDrawingTool,
    setDrawingColor,
    setEditPrompt,

    // Computed
    hasScribble,
  };
}
