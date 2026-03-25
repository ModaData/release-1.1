"use client";

import { useRef, useEffect } from "react";
import { useDrawingCanvas } from "@/hooks/useDrawingCanvas";

export default function RenderHistoryScrubber() {
  const { state, dispatch } = useDrawingCanvas();
  const scrollRef = useRef(null);

  // Auto-scroll to latest
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [state.renderHistory.length]);

  if (state.renderHistory.length === 0) return null;

  return (
    <div className="h-16 flex-shrink-0 border-t border-gray-200 bg-white px-3 flex items-center gap-2">
      <span className="text-[10px] text-gray-400 font-medium flex-shrink-0">History</span>
      <div
        ref={scrollRef}
        className="flex-1 flex items-center gap-1.5 overflow-x-auto scrollbar-thin"
        style={{ scrollbarWidth: "thin" }}
      >
        {state.renderHistory.map((render, i) => {
          const isCurrent = render.renderUrl === state.currentRenderUrl;
          return (
            <button
              key={render.id}
              onClick={() => dispatch({ type: "REVERT_TO_RENDER", payload: render.id })}
              className={`flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden border-2 transition-all hover:scale-105 ${
                isCurrent
                  ? "border-indigo-500 ring-1 ring-indigo-200"
                  : "border-gray-200 hover:border-gray-300"
              }`}
              title={`Version ${i + 1}`}
            >
              <img
                src={render.renderUrl}
                alt={`v${i + 1}`}
                className="w-full h-full object-cover"
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
