"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useDrawingCanvas } from "@/hooks/useDrawingCanvas";
import { mapCanvasToV3State } from "@/lib/canvas-to-v3-bridge";

export default function SendToV3Button() {
  const { state } = useDrawingCanvas();
  const router = useRouter();

  const imageUrl = state.lockedRenderUrl || state.currentRenderUrl;

  const handleSendToV3 = useCallback(() => {
    if (!imageUrl) return;

    // Package canvas state for V3
    const v3State = mapCanvasToV3State(state);

    // Store in sessionStorage for V3 to pick up
    sessionStorage.setItem("canvas_to_v3_bridge", JSON.stringify(v3State));

    // Navigate to Garment Editor
    router.push("/garment-editor?from=canvas");
  }, [imageUrl, state, router]);

  return (
    <button
      onClick={handleSendToV3}
      disabled={!imageUrl}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white bg-gradient-to-r from-indigo-500 to-purple-500 shadow-sm hover:shadow-md disabled:opacity-30 disabled:cursor-not-allowed transition-all"
    >
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
      </svg>
      Send to Editor
    </button>
  );
}
