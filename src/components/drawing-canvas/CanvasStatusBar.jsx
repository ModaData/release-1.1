"use client";

import { useDrawingCanvas } from "@/hooks/useDrawingCanvas";
import SendToV3Button from "./SendToV3Button";

export default function CanvasStatusBar({ onExport }) {
  const { state, dispatch } = useDrawingCanvas();

  return (
    <div className="h-12 flex items-center justify-between px-4 bg-white border-t border-gray-200 flex-shrink-0 z-20">
      {/* Left: Status */}
      <div className="flex items-center gap-3">
        {state.isGenerating && (
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
            <span className="text-[11px] font-medium text-indigo-600">Rendering...</span>
          </div>
        )}
        {!state.isGenerating && (
          <span className="text-[11px] text-gray-500">{state.status}</span>
        )}
        {state.renderCount > 0 && (
          <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
            Generation {state.renderCount}
          </span>
        )}
        {state.error && (
          <span className="text-[11px] text-red-500 flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            {state.error}
          </span>
        )}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        {/* Style Notes Input */}
        <input
          type="text"
          placeholder="Add detail note..."
          value={state.detailNotes}
          onChange={(e) => dispatch({ type: "SET_DETAIL_NOTES", payload: e.target.value })}
          className="text-[12px] bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 w-48 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none placeholder:text-gray-400"
        />

        {/* Export Button */}
        <button
          onClick={onExport}
          disabled={!state.currentRenderUrl && !state.lockedRenderUrl}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Export
        </button>

        {/* Send to V3 Design Studio */}
        <SendToV3Button />
      </div>
    </div>
  );
}
