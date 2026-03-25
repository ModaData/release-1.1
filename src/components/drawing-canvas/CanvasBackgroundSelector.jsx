"use client";

import { useDrawingCanvas } from "@/hooks/useDrawingCanvas";

const BACKGROUNDS = [
  { id: "blank", label: "Blank", icon: "□" },
  { id: "grid", label: "Grid", icon: "▦" },
  { id: "croquis_women", label: "Women's", icon: "♀" },
  { id: "croquis_men", label: "Men's", icon: "♂" },
  { id: "croquis_neutral", label: "Neutral", icon: "⚪" },
];

export default function CanvasBackgroundSelector() {
  const { state, dispatch } = useDrawingCanvas();

  return (
    <div className="absolute top-3 left-3 flex items-center gap-1 px-2 py-1.5 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg shadow-sm z-20">
      <span className="text-[10px] text-gray-400 font-medium mr-1">BG</span>
      {BACKGROUNDS.map((bg) => (
        <button
          key={bg.id}
          onClick={() => dispatch({ type: "SET_CANVAS_BACKGROUND", payload: bg.id })}
          title={bg.label}
          className={`w-6 h-6 flex items-center justify-center rounded text-[11px] transition-all ${
            state.canvasBackground === bg.id
              ? "bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200"
              : "text-gray-400 hover:text-gray-600 hover:bg-gray-50"
          }`}
        >
          {bg.icon}
        </button>
      ))}
    </div>
  );
}
