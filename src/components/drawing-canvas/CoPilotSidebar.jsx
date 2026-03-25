"use client";

import { useDrawingCanvas } from "@/hooks/useDrawingCanvas";
import { getFiber, getConstruction, getFabricSummary } from "@/lib/fabric-db";
import FitLengthSliders from "./FitLengthSliders";
import CanvasColorPicker from "./CanvasColorPicker";

export default function CoPilotSidebar() {
  const { state, dispatch } = useDrawingCanvas();

  const fiber = state.selectedFiber ? getFiber(state.selectedFiber) : null;
  const construction = state.selectedConstruction ? getConstruction(state.selectedConstruction) : null;
  const fabricSummary = state.selectedFiber
    ? getFabricSummary({
        fiberId: state.selectedFiber,
        constructionId: state.selectedConstruction,
        gsm: state.gsm,
      })
    : null;

  return (
    <div className="absolute right-0 top-0 bottom-0 w-[280px] bg-white border-l border-gray-200 shadow-lg z-30 overflow-y-auto flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </svg>
          <span className="text-[13px] font-semibold text-gray-900">AI Co-Pilot</span>
        </div>
        <button
          onClick={() => dispatch({ type: "TOGGLE_CO_PILOT" })}
          className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 px-4 py-3 space-y-4 overflow-y-auto">
        {/* Interpretation */}
        <section>
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-[11px] text-amber-500">&#128161;</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Interpretation</span>
          </div>
          {state.currentInterpretation ? (
            <p className="text-[11px] text-gray-600 leading-relaxed bg-gray-50 rounded-lg p-2.5 border border-gray-100">
              {state.currentInterpretation}
            </p>
          ) : (
            <p className="text-[11px] text-gray-400 italic">Draw something to see AI interpretation...</p>
          )}
        </section>

        {/* Constraints */}
        {state.constraintViolations.length > 0 && (
          <section>
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-[11px] text-amber-500">&#9888;&#65039;</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Constraints</span>
            </div>
            <div className="space-y-1.5">
              {state.constraintViolations.map((v, i) => (
                <div
                  key={i}
                  className={`text-[11px] p-2 rounded-lg border ${
                    v.severity === "error"
                      ? "bg-red-50 border-red-200 text-red-700"
                      : "bg-amber-50 border-amber-200 text-amber-700"
                  }`}
                >
                  {v.message}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Style Controls */}
        <section>
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-[11px] text-purple-500">&#127912;</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Style Controls</span>
          </div>

          {/* Detail Notes */}
          <div className="mb-3">
            <label className="text-[10px] text-gray-500 block mb-1">Detail Notes</label>
            <input
              type="text"
              value={state.detailNotes}
              onChange={(e) => dispatch({ type: "SET_DETAIL_NOTES", payload: e.target.value })}
              placeholder="add gold buttons, make collar wider..."
              className="w-full text-[11px] bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none placeholder:text-gray-300"
            />
          </div>

          {/* Style Notes */}
          <div className="mb-3">
            <label className="text-[10px] text-gray-500 block mb-1">Style Direction</label>
            <input
              type="text"
              value={state.styleNotes}
              onChange={(e) => dispatch({ type: "SET_STYLE_NOTES", payload: e.target.value })}
              placeholder="oversized streetwear, tailored formal..."
              className="w-full text-[11px] bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none placeholder:text-gray-300"
            />
          </div>

          {/* Color Picker */}
          <CanvasColorPicker />

          {/* Fit / Length Sliders */}
          <div className="mt-3">
            <FitLengthSliders />
          </div>
        </section>

        {/* Fabric Specs */}
        {fiber && (
          <section>
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-[11px] text-teal-500">&#128208;</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Fabric Specs (V3)</span>
            </div>
            <div className="bg-gray-50 rounded-lg p-2.5 border border-gray-100 space-y-1.5">
              <p className="text-[12px] font-medium text-gray-800">{fiber.name}</p>
              {fabricSummary && (
                <p className="text-[10px] text-gray-500">{fabricSummary}</p>
              )}
              {fiber.hand_descriptors?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {fiber.hand_descriptors.slice(0, 4).map((d) => (
                    <span
                      key={d}
                      className="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100"
                    >
                      {d}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Suggestions */}
        {state.suggestions.length > 0 && (
          <section>
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-[11px] text-indigo-500">&#128279;</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Suggestions</span>
            </div>
            <div className="space-y-1.5">
              {state.suggestions.map((s, i) => (
                <p key={i} className="text-[11px] text-gray-600 bg-indigo-50 rounded-lg p-2 border border-indigo-100">
                  {s}
                </p>
              ))}
            </div>
          </section>
        )}

        {/* Annotations */}
        {state.annotations.length > 0 && (
          <section>
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-[11px] text-gray-500">&#128221;</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Annotations</span>
            </div>
            <div className="space-y-1">
              {state.annotations.map((ann) => (
                <div
                  key={ann.id}
                  className="flex items-center justify-between text-[11px] text-gray-600 bg-gray-50 rounded-lg px-2.5 py-1.5 border border-gray-100"
                >
                  <span>&ldquo;{ann.text}&rdquo;</span>
                  <button
                    onClick={() => dispatch({ type: "REMOVE_ANNOTATION", payload: ann.id })}
                    className="text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
