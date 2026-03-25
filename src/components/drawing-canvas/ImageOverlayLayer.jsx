// File: components/drawing-canvas/ImageOverlayLayer.jsx — Renders uploaded reference image as semi-transparent overlay
"use client";

import { useDrawingCanvas } from "@/hooks/useDrawingCanvas";

export default function ImageOverlayLayer() {
  const { state } = useDrawingCanvas();

  if (!state.uploadedOverlayImage || !state.uploadedOverlayVisible) return null;

  const { dataUrl, opacity } = state.uploadedOverlayImage;

  return (
    <div
      className="absolute inset-0 pointer-events-none z-10 flex items-center justify-center"
      style={{ opacity }}
    >
      <img
        src={dataUrl}
        alt="Reference overlay"
        className="max-w-full max-h-full object-contain"
        draggable={false}
      />
    </div>
  );
}
