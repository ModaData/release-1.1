"use client";

import { useDrawingCanvas } from "@/hooks/useDrawingCanvas";

export default function FitLengthSliders() {
  const { state, dispatch } = useDrawingCanvas();

  return (
    <div className="space-y-3">
      {/* Fit Slider */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Fit</span>
          <span className="text-[10px] text-gray-500">{getFitLabel(state.fitValue)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-gray-400 w-8">Slim</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={state.fitValue}
            onChange={(e) => dispatch({ type: "SET_FIT", payload: parseFloat(e.target.value) })}
            className="flex-1 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-500"
          />
          <span className="text-[9px] text-gray-400 w-12 text-right">Oversized</span>
        </div>
      </div>

      {/* Length Slider */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Length</span>
          <span className="text-[10px] text-gray-500">{getLengthLabel(state.lengthValue)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-gray-400 w-8">Crop</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={state.lengthValue}
            onChange={(e) => dispatch({ type: "SET_LENGTH", payload: parseFloat(e.target.value) })}
            className="flex-1 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-500"
          />
          <span className="text-[9px] text-gray-400 w-12 text-right">Full</span>
        </div>
      </div>

      {/* Control Strength (Precise mode only) */}
      {state.renderMode === "precise" && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Control Strength</span>
            <span className="text-[10px] text-gray-500">{Math.round(state.controlStrength * 100)}%</span>
          </div>
          <input
            type="range"
            min="0.1"
            max="1.0"
            step="0.05"
            value={state.controlStrength}
            onChange={(e) => dispatch({ type: "SET_CONTROL_STRENGTH", payload: parseFloat(e.target.value) })}
            className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-500"
          />
        </div>
      )}
    </div>
  );
}

function getFitLabel(val) {
  if (val < 0.2) return "Slim";
  if (val < 0.4) return "Semi-fitted";
  if (val < 0.6) return "Regular";
  if (val < 0.8) return "Relaxed";
  return "Oversized";
}

function getLengthLabel(val) {
  if (val < 0.2) return "Cropped";
  if (val < 0.4) return "Waist";
  if (val < 0.6) return "Hip";
  if (val < 0.8) return "Knee";
  return "Full-length";
}
