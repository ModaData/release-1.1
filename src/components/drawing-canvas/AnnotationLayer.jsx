"use client";

import { useState, useRef, useCallback } from "react";
import { useDrawingCanvas } from "@/hooks/useDrawingCanvas";

export default function AnnotationLayer() {
  const { state, dispatch } = useDrawingCanvas();
  const [isDrawingLasso, setIsDrawingLasso] = useState(false);
  const [lassoPoints, setLassoPoints] = useState([]);
  const [showInput, setShowInput] = useState(false);
  const [inputPos, setInputPos] = useState({ x: 0, y: 0 });
  const [annotationText, setAnnotationText] = useState("");
  const layerRef = useRef(null);

  const getPos = useCallback((e) => {
    const rect = layerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const handlePointerDown = useCallback((e) => {
    if (state.tool !== "lasso") return;
    e.preventDefault();
    e.stopPropagation();
    setIsDrawingLasso(true);
    const pos = getPos(e);
    setLassoPoints([pos]);
  }, [state.tool, getPos]);

  const handlePointerMove = useCallback((e) => {
    if (!isDrawingLasso) return;
    e.preventDefault();
    const pos = getPos(e);
    setLassoPoints((prev) => [...prev, pos]);
  }, [isDrawingLasso, getPos]);

  const handlePointerUp = useCallback(() => {
    if (!isDrawingLasso) return;
    setIsDrawingLasso(false);

    if (lassoPoints.length < 3) {
      setLassoPoints([]);
      return;
    }

    // Find center of lasso for input placement
    const cx = lassoPoints.reduce((s, p) => s + p.x, 0) / lassoPoints.length;
    const cy = lassoPoints.reduce((s, p) => s + p.y, 0) / lassoPoints.length;
    setInputPos({ x: cx, y: cy });
    setShowInput(true);
  }, [isDrawingLasso, lassoPoints]);

  const handleSubmitAnnotation = useCallback(() => {
    if (!annotationText.trim()) {
      setShowInput(false);
      setLassoPoints([]);
      setAnnotationText("");
      return;
    }

    dispatch({
      type: "ADD_ANNOTATION",
      payload: {
        id: crypto.randomUUID(),
        region: { points: lassoPoints },
        text: annotationText.trim(),
        timestamp: Date.now(),
      },
    });

    setShowInput(false);
    setLassoPoints([]);
    setAnnotationText("");
  }, [annotationText, lassoPoints, dispatch]);

  // Only render overlay when lasso tool is active
  if (state.tool !== "lasso" && state.annotations.length === 0) return null;

  const svgPoints = lassoPoints.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div
      ref={layerRef}
      className="absolute inset-0 z-10"
      style={{ pointerEvents: state.tool === "lasso" ? "auto" : "none" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
        {/* Active lasso being drawn */}
        {isDrawingLasso && lassoPoints.length > 1 && (
          <polyline
            points={svgPoints}
            fill="none"
            stroke="#6366f1"
            strokeWidth="2"
            strokeDasharray="6 3"
            opacity="0.7"
          />
        )}

        {/* Completed lasso (before text input) */}
        {!isDrawingLasso && lassoPoints.length > 2 && (
          <polygon
            points={svgPoints}
            fill="rgba(99, 102, 241, 0.08)"
            stroke="#6366f1"
            strokeWidth="2"
            strokeDasharray="6 3"
            opacity="0.7"
          />
        )}

        {/* Existing annotations */}
        {state.annotations.map((ann) => {
          const pts = ann.region.points.map((p) => `${p.x},${p.y}`).join(" ");
          const cx = ann.region.points.reduce((s, p) => s + p.x, 0) / ann.region.points.length;
          const cy = ann.region.points.reduce((s, p) => s + p.y, 0) / ann.region.points.length;
          return (
            <g key={ann.id}>
              <polygon
                points={pts}
                fill="rgba(99, 102, 241, 0.06)"
                stroke="#6366f1"
                strokeWidth="1.5"
                strokeDasharray="4 2"
                opacity="0.5"
              />
              <text
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#6366f1"
                fontSize="11"
                fontWeight="500"
                fontFamily="Inter, sans-serif"
              >
                {ann.text}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Text input popup */}
      {showInput && (
        <div
          className="absolute z-20 flex items-center gap-1"
          style={{
            left: inputPos.x - 80,
            top: inputPos.y - 16,
          }}
        >
          <input
            autoFocus
            value={annotationText}
            onChange={(e) => setAnnotationText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmitAnnotation();
              if (e.key === "Escape") {
                setShowInput(false);
                setLassoPoints([]);
                setAnnotationText("");
              }
            }}
            placeholder="Describe this area..."
            className="text-[11px] bg-white border border-indigo-300 rounded-lg px-2.5 py-1.5 w-40 shadow-md focus:ring-2 focus:ring-indigo-500 outline-none"
          />
          <button
            onClick={handleSubmitAnnotation}
            className="p-1.5 rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 shadow-sm"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
