// File: components/drawing-canvas/SAMSegmentOverlay.jsx
// SAM auto-segment overlay — captures viewport screenshot, sends to SAM API, displays mask
"use client";

import { useCallback } from "react";
import { useDrawingCanvas } from "@/hooks/useDrawingCanvas";

/**
 * SAMSegmentOverlay — renders over the 3D viewport.
 * When the user clicks in SAM mode, it:
 * 1. Captures a screenshot of the 3D viewport
 * 2. Sends the screenshot + click point to /api/sam-encode
 * 3. Displays the returned mask as a semi-transparent overlay
 *
 * Props:
 *   canvasElement - the R3F gl.domElement (HTMLCanvasElement) for screenshot capture
 */
export default function SAMSegmentOverlay({ canvasElement }) {
  const { state, dispatch } = useDrawingCanvas();

  const handleClick = useCallback(
    async (e) => {
      if (state.partSelectionMode !== "sam_auto") return;
      if (!canvasElement) return;

      // Get click coordinates relative to canvas
      const rect = canvasElement.getBoundingClientRect();
      const point_x = Math.round(((e.clientX - rect.left) / rect.width) * canvasElement.width);
      const point_y = Math.round(((e.clientY - rect.top) / rect.height) * canvasElement.height);

      dispatch({ type: "SET_SAM_PROCESSING", payload: true });
      dispatch({ type: "SET_STATUS", payload: "Segmenting with SAM..." });

      try {
        // Capture viewport screenshot
        const screenshot = canvasElement.toDataURL("image/png");

        // Send garment category as label so Grounded SAM (Strategy 1) can run
        const label = state.garmentCategory || state.selectedPart || "upper-clothes";

        const res = await fetch("/api/sam-encode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image: screenshot,
            label,
            point_x,
            point_y,
          }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "SAM segmentation failed");

        const masks = (data.masks || []).map((m, i) => ({
          maskDataUrl: typeof m === "string" ? m : m.dataUrl,
          label: m.label || `Region ${i + 1}`,
          confidence: m.confidence || 0.9,
        }));

        dispatch({ type: "SET_SAM_MASKS", payload: masks });
        dispatch({ type: "SET_STATUS", payload: `SAM found ${masks.length} region(s)` });
      } catch (err) {
        console.error("[SAM] Segmentation error:", err.message);
        dispatch({ type: "SET_SAM_PROCESSING", payload: false });
        dispatch({ type: "SET_ERROR", payload: `SAM failed: ${err.message}` });
      }
    },
    [state.partSelectionMode, state.garmentCategory, state.selectedPart, canvasElement, dispatch]
  );

  const clearMasks = useCallback(() => {
    dispatch({ type: "SET_SAM_MASKS", payload: [] });
  }, [dispatch]);

  if (state.partSelectionMode !== "sam_auto") return null;

  return (
    <>
      {/* Click capture layer */}
      <div
        className="absolute inset-0 z-10 cursor-crosshair"
        onClick={handleClick}
        style={{ pointerEvents: state.samIsProcessing ? "none" : "auto" }}
      />

      {/* SAM mask overlays */}
      {state.samSegmentMasks.map((mask, i) => (
        <img
          key={i}
          src={mask.maskDataUrl}
          className="absolute inset-0 w-full h-full object-contain pointer-events-none z-10"
          style={{ mixBlendMode: "multiply", opacity: 0.35 }}
          alt={mask.label}
        />
      ))}

      {/* Processing indicator */}
      {state.samIsProcessing && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/90 backdrop-blur-sm border border-indigo-200 shadow-sm">
          <div className="w-3 h-3 border-2 border-indigo-200 border-t-indigo-500 rounded-full animate-spin" />
          <span className="text-[10px] font-medium text-indigo-600">Segmenting...</span>
        </div>
      )}

      {/* Clear masks button */}
      {state.samSegmentMasks.length > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            clearMasks();
          }}
          className="absolute top-14 right-4 z-30 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/90 backdrop-blur-sm border border-gray-200 text-[10px] font-medium text-gray-600 hover:bg-gray-50 shadow-sm"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          Clear Mask
        </button>
      )}

      {/* Instruction hint */}
      {state.samSegmentMasks.length === 0 && !state.samIsProcessing && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm text-[10px] text-white/80 font-medium">
          Click on a garment region to auto-segment
        </div>
      )}
    </>
  );
}
