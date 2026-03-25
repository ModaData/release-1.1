"use client";

import { useDrawingCanvas } from "@/hooks/useDrawingCanvas";
import { FIBER_CATALOG } from "@/lib/fabric-db";

const GARMENT_CATEGORIES = [
  { id: "top", label: "Top" },
  { id: "bottom", label: "Bottom" },
  { id: "dress", label: "Dress" },
  { id: "outerwear", label: "Outerwear" },
  { id: "one_piece", label: "One-Piece" },
  { id: "accessory", label: "Accessory" },
];

const GENDER_OPTIONS = [
  { id: "women", label: "Women's" },
  { id: "men", label: "Men's" },
  { id: "unisex", label: "Unisex" },
];

export default function CanvasTopBar({ onUndo, onRedo, onClear, canUndo, canRedo }) {
  const { state, dispatch } = useDrawingCanvas();

  return (
    <div className="h-[52px] flex items-center justify-between px-4 bg-white/80 backdrop-blur-md border-b border-gray-200 shadow-sm z-30 flex-shrink-0">
      {/* Left: Logo + Title */}
      <div className="flex items-center gap-3">
        <a href="/" className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-sm">
            <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          </div>
          <span className="text-[11px] font-bold text-gray-900 tracking-[0.15em] uppercase">AI Canvas</span>
        </a>

        <div className="w-px h-5 bg-gray-200 mx-1" />

        {/* Garment Category */}
        <select
          value={state.garmentCategory || ""}
          onChange={(e) => dispatch({ type: "SET_GARMENT_CATEGORY", payload: e.target.value || null })}
          className="text-[12px] font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
        >
          <option value="">Garment type...</option>
          {GARMENT_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>

        {/* Fabric */}
        <select
          value={state.selectedFiber || ""}
          onChange={(e) => dispatch({ type: "SET_FIBER", payload: e.target.value || null })}
          className="text-[12px] font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
        >
          <option value="">Fabric...</option>
          {FIBER_CATALOG.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>

        {/* Gender */}
        <select
          value={state.gender}
          onChange={(e) => dispatch({ type: "SET_GENDER", payload: e.target.value })}
          className="text-[12px] font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none hidden lg:block"
        >
          {GENDER_OPTIONS.map((g) => (
            <option key={g.id} value={g.id}>{g.label}</option>
          ))}
        </select>
      </div>

      {/* Center: Mode Toggle + Actions */}
      <div className="flex items-center gap-2">
        {/* Render Mode Toggle */}
        <div className="flex items-center bg-gray-100 rounded-lg p-0.5 border border-gray-200">
          <button
            onClick={() => dispatch({ type: "SET_RENDER_MODE", payload: "freestyle" })}
            className={`px-3 py-1 rounded-md text-[11px] font-medium transition-all ${
              state.renderMode === "freestyle"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Freestyle
          </button>
          <button
            onClick={() => dispatch({ type: "SET_RENDER_MODE", payload: "precise" })}
            className={`px-3 py-1 rounded-md text-[11px] font-medium transition-all ${
              state.renderMode === "precise"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Precise
          </button>
        </div>

        <div className="w-px h-5 bg-gray-200" />

        {/* Undo / Redo / Clear */}
        <button
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
          </svg>
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3" />
          </svg>
        </button>
        <button
          onClick={onClear}
          title="Clear Canvas (Ctrl+Shift+X)"
          className="p-1.5 rounded-lg text-gray-500 hover:text-red-500 hover:bg-red-50 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
        </button>
      </div>

      {/* Right: Lock + Export */}
      <div className="flex items-center gap-2">
        {/* Manual render toggle */}
        <label className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer hidden xl:flex">
          <input
            type="checkbox"
            checked={state.manualRenderMode}
            onChange={(e) => dispatch({ type: "SET_MANUAL_RENDER_MODE", payload: e.target.checked })}
            className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-500 focus:ring-indigo-500"
          />
          Manual
        </label>

        {state.isLocked ? (
          <button
            onClick={() => dispatch({ type: "UNLOCK_RENDER" })}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            Unlock
          </button>
        ) : (
          <button
            onClick={() => dispatch({ type: "LOCK_RENDER" })}
            disabled={!state.currentRenderUrl}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            Lock
          </button>
        )}

        <button
          onClick={() => dispatch({ type: "TOGGLE_CO_PILOT" })}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
            state.coPilotOpen
              ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
              : "bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200"
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </svg>
          Co-Pilot
        </button>
      </div>
    </div>
  );
}
