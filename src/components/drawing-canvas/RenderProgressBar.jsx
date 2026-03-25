"use client";

import { useDrawingCanvas } from "@/hooks/useDrawingCanvas";

export default function RenderProgressBar() {
  const { state } = useDrawingCanvas();

  if (!state.isGenerating) return null;

  return (
    <div className="absolute top-0 left-0 right-0 h-1 z-10 overflow-hidden">
      <div className="h-full w-1/3 bg-gradient-to-r from-indigo-500 to-purple-500 animate-progress-bar" />
    </div>
  );
}
