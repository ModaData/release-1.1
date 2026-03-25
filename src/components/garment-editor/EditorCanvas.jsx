// File: components/garment-editor/EditorCanvas.jsx — Enterprise Canvas with staged loading
"use client";

import { useRef, useState, useCallback, useEffect } from "react";

export function EditorCanvas({
  currentImageUrl,
  canvasRef,
  maskCanvasRef,
  drawCanvasRef,
  selectedMask,
  isGenerating,
  drawingTool,
  drawingColor,
  brushSize,
  hoverLabel,
  isPerceptionReady,
  isPerceptionLoading,
  onCanvasClick,
  onCanvasHover,
  onCanvasHoverLeave,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}) {
  const [tooltipPos, setTooltipPos] = useState(null);
  const [genStage, setGenStage] = useState(0);
  const containerRef = useRef(null);
  const genTimerRef = useRef(null);

  // Staged generation progress
  useEffect(() => {
    if (isGenerating) {
      setGenStage(0);
      const stages = [
        { delay: 0 },       // Preparing mask...
        { delay: 2000 },    // Sending to AI...
        { delay: 5000 },    // Generating...
        { delay: 15000 },   // Refining output...
      ];
      const timers = stages.map((s, i) => {
        if (i === 0) return null;
        return setTimeout(() => setGenStage(i), s.delay);
      });
      genTimerRef.current = timers;
      return () => timers.forEach((t) => t && clearTimeout(t));
    } else {
      setGenStage(0);
    }
  }, [isGenerating]);

  const GENERATION_STAGES = [
    { label: "Preparing mask", color: "text-gray-400" },
    { label: "Sending to AI", color: "text-blue-400" },
    { label: "Generating with FLUX.1", color: "text-indigo-400" },
    { label: "Refining output", color: "text-purple-400" },
  ];

  const handleMouseMoveForTooltip = useCallback(
    (e) => {
      if (!isPerceptionReady || selectedMask || isGenerating) {
        setTooltipPos(null);
        return;
      }
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      onCanvasHover?.(e);
    },
    [isPerceptionReady, selectedMask, isGenerating, onCanvasHover]
  );

  const handleMouseLeave = useCallback(() => {
    setTooltipPos(null);
    onCanvasHoverLeave?.();
  }, [onCanvasHoverLeave]);

  const handleContainerClick = useCallback(
    (e) => {
      if (selectedMask || isGenerating) return;
      onCanvasClick?.(e);
    },
    [selectedMask, isGenerating, onCanvasClick]
  );

  const getCursorStyle = () => {
    if (isGenerating) return "wait";
    if (selectedMask) return "crosshair";
    if (isPerceptionReady) return "pointer";
    return "default";
  };

  const drawCanvasPointerEvents = selectedMask && !isGenerating ? "auto" : "none";

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      style={{ cursor: currentImageUrl ? getCursorStyle() : "default" }}
      onMouseMove={currentImageUrl ? handleMouseMoveForTooltip : undefined}
      onMouseLeave={currentImageUrl ? handleMouseLeave : undefined}
      onClick={currentImageUrl ? handleContainerClick : undefined}
    >
      {/* Placeholder */}
      {!currentImageUrl && (
        <div className="flex flex-col items-center justify-center h-[420px] border border-dashed border-white/[0.06] rounded-2xl bg-[#08080d]/50">
          <div className="w-16 h-16 rounded-2xl bg-white/[0.02] border border-white/[0.05] flex items-center justify-center mb-5">
            <svg className="w-7 h-7 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
            </svg>
          </div>
          <p className="text-sm text-gray-500 font-medium">Upload a garment image to begin</p>
          <p className="text-[11px] text-gray-700 mt-1.5">AI will automatically detect and segment garment parts</p>
          <div className="mt-6 flex items-center gap-3 text-[10px] text-gray-700">
            <span className="flex items-center gap-1"><span className="w-1 h-1 rounded-full bg-emerald-500/50" /> SegFormer</span>
            <span className="flex items-center gap-1"><span className="w-1 h-1 rounded-full bg-blue-500/50" /> SAM 2</span>
            <span className="flex items-center gap-1"><span className="w-1 h-1 rounded-full bg-purple-500/50" /> CLIP</span>
          </div>
        </div>
      )}

      {/* Layer 1: Base image */}
      <canvas
        ref={canvasRef}
        className="w-full rounded-xl"
        style={{ display: currentImageUrl ? "block" : "none" }}
      />

      {/* Layer 2: Mask glow */}
      <canvas
        ref={maskCanvasRef}
        className="absolute top-0 left-0 w-full h-full rounded-xl pointer-events-none"
        style={{ zIndex: 1, display: currentImageUrl ? "block" : "none" }}
      />

      {/* Layer 3: Drawing */}
      <canvas
        ref={drawCanvasRef}
        className="absolute top-0 left-0 w-full h-full rounded-xl"
        style={{
          zIndex: 2,
          touchAction: "none",
          pointerEvents: drawCanvasPointerEvents,
          cursor: selectedMask ? "crosshair" : "inherit",
          display: currentImageUrl ? "block" : "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onPointerCancel={onPointerUp}
      />

      {/* Hover label tooltip — floating pill */}
      {hoverLabel && tooltipPos && !selectedMask && (
        <div
          className="absolute pointer-events-none z-20"
          style={{ left: tooltipPos.x + 14, top: tooltipPos.y - 10 }}
        >
          <div className="px-3 py-1.5 rounded-xl bg-[#0a0a12]/95 backdrop-blur-xl text-white text-[11px] font-semibold shadow-2xl shadow-black/50 whitespace-nowrap border border-indigo-500/20">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-400 mr-1.5 animate-pulse" />
            {hoverLabel}
          </div>
        </div>
      )}

      {/* Perception loading */}
      {isPerceptionLoading && !isGenerating && (
        <div className="absolute top-3 right-3 z-20">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#0a0a12]/90 backdrop-blur-xl border border-white/[0.06] shadow-lg">
            <div className="w-3 h-3 border-2 border-gray-700 border-t-blue-400 rounded-full animate-gentle-spin" />
            <span className="text-[10px] text-gray-300 font-medium">Analyzing garment...</span>
          </div>
        </div>
      )}

      {/* AI ready pill */}
      {isPerceptionReady && !selectedMask && !isPerceptionLoading && currentImageUrl && (
        <div className="absolute bottom-3 left-3 z-20 animate-fade-in">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-emerald-950/80 backdrop-blur-xl border border-emerald-500/20 text-emerald-300 shadow-lg">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-[10px] font-semibold">AI Active</span>
            <span className="text-[9px] text-emerald-400/50 font-medium">· Hover to detect</span>
          </div>
        </div>
      )}

      {/* ── Generation Overlay — Staged Progress ── */}
      {isGenerating && (
        <div className="absolute inset-0 bg-[#08080d]/85 backdrop-blur-md rounded-xl flex flex-col items-center justify-center z-30">
          {/* Spinner */}
          <div className="relative mb-5">
            <div className="w-14 h-14 border-2 border-white/[0.06] rounded-full" />
            <div className="absolute inset-0 w-14 h-14 border-2 border-transparent border-t-indigo-400 rounded-full animate-gentle-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
            </div>
          </div>

          {/* Stage indicators */}
          <div className="space-y-2 w-56">
            {GENERATION_STAGES.map((stage, i) => (
              <div
                key={i}
                className={`flex items-center gap-2.5 transition-all duration-500 ${
                  i <= genStage ? "opacity-100" : "opacity-20"
                }`}
              >
                <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold ${
                  i < genStage
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                    : i === genStage
                    ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30"
                    : "bg-white/[0.03] text-gray-600 border border-white/[0.06]"
                }`}>
                  {i < genStage ? (
                    <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : i === genStage ? (
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                  ) : (
                    <span>{i + 1}</span>
                  )}
                </div>
                <span className={`text-[11px] font-medium ${
                  i === genStage ? stage.color : i < genStage ? "text-emerald-400/60" : "text-gray-600"
                }`}>
                  {stage.label}{i === genStage ? "..." : ""}
                </span>
              </div>
            ))}
          </div>

          {/* Progress shimmer bar */}
          <div className="mt-5 w-48 h-1 rounded-full bg-white/[0.04] overflow-hidden">
            <div className="h-full bg-gradient-to-r from-indigo-500/50 via-purple-500/50 to-indigo-500/50 animate-shimmer rounded-full" style={{ backgroundSize: "200% 100%" }} />
          </div>

          <div className="mt-3 text-[9px] text-gray-600 font-mono">FLUX.1 Fill Dev · Inpainting</div>
        </div>
      )}
    </div>
  );
}
