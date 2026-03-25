"use client";

import { useRef } from "react";
import { useDrawingCanvas } from "@/hooks/useDrawingCanvas";

const TOOLS = [
  { id: "pencil", label: "Pencil", shortcut: "P", icon: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
    </svg>
  )},
  { id: "brush", label: "Brush", shortcut: "B", icon: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
    </svg>
  )},
  { id: "eraser", label: "Eraser", shortcut: "E", icon: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9.75L14.25 12m0 0l2.25 2.25M14.25 12l2.25-2.25M14.25 12L12 14.25m-2.58 4.92l-6.375-6.375a1.125 1.125 0 010-1.59L9.42 4.83a1.125 1.125 0 011.59 0l6.375 6.375a1.125 1.125 0 010 1.59L10.83 19.17a1.125 1.125 0 01-1.59 0z" />
    </svg>
  )},
  { id: "lasso", label: "Annotate", shortcut: "L", icon: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
    </svg>
  )},
];

const STROKE_WIDTHS = [1, 2, 4, 8, 16];

const COLORS = [
  "#000000", "#374151", "#6b7280", "#dc2626",
  "#ea580c", "#ca8a04", "#16a34a", "#2563eb",
  "#7c3aed", "#db2777",
];

const MODE_LABELS = {
  IDLE: "DRAW",
  DRAWING: "DRAW",
  EDITING: "EDIT",
  CURVING: "CURVE",
};

export default function DrawingToolbar() {
  const { state, dispatch } = useDrawingCanvas();
  const fileInputRef = useRef(null);

  const modeLabel = MODE_LABELS[state.vectorMode] || "DRAW";

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        dispatch({
          type: "SET_UPLOADED_OVERLAY",
          payload: {
            dataUrl: ev.target.result,
            width: img.width,
            height: img.height,
            x: 0,
            y: 0,
            scale: 1,
            opacity: 0.4,
          },
        });
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-xl shadow-md z-20">
      {/* Mode Indicator */}
      <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-wider text-gray-400 bg-gray-50 border border-gray-100 select-none">
        {modeLabel}
      </span>

      <div className="w-px h-6 bg-gray-200 mx-1" />

      {/* Tools */}
      {TOOLS.map((tool) => (
        <button
          key={tool.id}
          onClick={() => dispatch({ type: "SET_TOOL", payload: tool.id })}
          title={`${tool.label} (${tool.shortcut})`}
          className={`p-2 rounded-lg transition-all ${
            state.tool === tool.id
              ? "bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200"
              : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
          }`}
        >
          {tool.icon}
        </button>
      ))}

      <div className="w-px h-6 bg-gray-200 mx-1" />

      {/* Stroke Width */}
      <div className="flex items-center gap-1">
        {STROKE_WIDTHS.map((w) => (
          <button
            key={w}
            onClick={() => dispatch({ type: "SET_STROKE_WIDTH", payload: w })}
            title={`${w}px`}
            className={`w-7 h-7 flex items-center justify-center rounded-md transition-all ${
              state.strokeWidth === w
                ? "bg-gray-100 ring-1 ring-gray-300"
                : "hover:bg-gray-50"
            }`}
          >
            <div
              className="rounded-full bg-current"
              style={{
                width: Math.min(w + 2, 14),
                height: Math.min(w + 2, 14),
                color: state.strokeColor,
              }}
            />
          </button>
        ))}
      </div>

      <div className="w-px h-6 bg-gray-200 mx-1" />

      {/* Colors */}
      <div className="flex items-center gap-1">
        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => dispatch({ type: "SET_STROKE_COLOR", payload: c })}
            className={`w-5 h-5 rounded-full border-2 transition-all ${
              state.strokeColor === c
                ? "border-indigo-500 scale-110"
                : "border-gray-200 hover:border-gray-400"
            }`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>

      <div className="w-px h-6 bg-gray-200 mx-1" />

      {/* Symmetry Toggle */}
      <button
        onClick={() => dispatch({ type: "TOGGLE_SYMMETRY" })}
        title="Toggle symmetry mirror (S)"
        className={`p-2 rounded-lg transition-all ${
          state.symmetryEnabled
            ? "bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200"
            : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
        }`}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
        </svg>
      </button>

      <div className="w-px h-6 bg-gray-200 mx-1" />

      {/* Image Upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageUpload}
        className="hidden"
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        title="Upload reference image overlay (I)"
        className={`p-2 rounded-lg transition-all ${
          state.uploadedOverlayImage
            ? "bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200"
            : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
        }`}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
        </svg>
      </button>

      {state.uploadedOverlayImage && (
        <>
          <button
            onClick={() => dispatch({ type: "TOGGLE_UPLOADED_OVERLAY" })}
            title={state.uploadedOverlayVisible ? "Hide overlay" : "Show overlay"}
            className={`p-2 rounded-lg transition-all ${
              state.uploadedOverlayVisible
                ? "text-emerald-600 hover:bg-emerald-50"
                : "text-gray-400 hover:bg-gray-50"
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              {state.uploadedOverlayVisible ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178zM15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
              )}
            </svg>
          </button>
          <button
            onClick={() => dispatch({ type: "CLEAR_UPLOADED_OVERLAY" })}
            title="Remove overlay image"
            className="p-2 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-all"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </>
      )}

      <div className="w-px h-6 bg-gray-200 mx-1" />

      {/* AI Command (Prompt-to-Vector) */}
      <button
        onClick={() => dispatch({ type: "SET_COMMAND_INPUT_OPEN", payload: true })}
        title="AI Commands — type to generate garment features (/)"
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all ${
          state.commandInputOpen
            ? "bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200"
            : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
        }`}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
        </svg>
        <span className="text-[10px] font-semibold tracking-wide">AI</span>
      </button>
    </div>
  );
}
