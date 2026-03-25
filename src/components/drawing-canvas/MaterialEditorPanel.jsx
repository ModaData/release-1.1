// File: components/drawing-canvas/MaterialEditorPanel.jsx
// PBR material properties + fabric presets editor panel
"use client";

import { useState } from "react";
import { useDrawingCanvas } from "@/hooks/useDrawingCanvas";
import { useMeshOperations } from "@/hooks/useMeshOperations";
import { FABRIC_PRESETS_3D } from "@/lib/fabric-presets-3d";

const SWATCH_COLORS = [
  "#ffffff", "#f5f5f4", "#d4d4d4", "#737373", "#262626", "#000000",
  "#dc2626", "#ea580c", "#d97706", "#65a30d", "#0d9488", "#2563eb",
  "#7c3aed", "#db2777", "#f472b6", "#92400e",
];

function Slider({ label, value, min, max, step, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-[10px] text-gray-500 w-16 flex-shrink-0">{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 h-1 accent-indigo-500"
      />
      <span className="text-[9px] text-gray-400 w-8 text-right font-mono">
        {value.toFixed(2)}
      </span>
    </div>
  );
}

export default function MaterialEditorPanel() {
  const { state, dispatch } = useDrawingCanvas();
  const meshOps = useMeshOperations();
  const [useBlender, setUseBlender] = useState(false);
  const { materialEditor } = state;

  const updateMaterial = (updates) => {
    dispatch({ type: "SET_MATERIAL_EDITOR", payload: updates });
  };

  const handleFabricPreset = (presetId) => {
    const preset = FABRIC_PRESETS_3D[presetId];
    if (!preset) return;

    if (useBlender) {
      // Server-side full PBR via Blender backend
      meshOps.swapFabric(presetId);
    } else {
      // Client-side instant preview
      updateMaterial({
        color: preset.color,
        metalness: preset.metalness,
        roughness: preset.roughness,
        opacity: preset.opacity,
        fabricPreset: presetId,
      });
    }
  };

  return (
    <div className="absolute top-14 right-4 z-30 w-60 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-[calc(100vh-120px)] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 bg-gray-50 border-b border-gray-100 sticky top-0">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.098 19.902a3.75 3.75 0 005.304 0l6.401-6.402M6.75 21A3.75 3.75 0 013 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 003.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008z" />
          </svg>
          <h3 className="text-[12px] font-semibold text-gray-800">Material</h3>
        </div>
        <button
          onClick={() => dispatch({ type: "SET_EDITOR_PANEL", payload: "none" })}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="p-3 space-y-4">
        {/* ── Color ── */}
        <div>
          <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-2 block">
            Color
          </label>
          <div className="flex flex-wrap gap-1">
            {SWATCH_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => updateMaterial({ color })}
                className={`w-5 h-5 rounded-md border transition-all ${
                  materialEditor.color === color
                    ? "ring-2 ring-indigo-400 ring-offset-1 border-indigo-300"
                    : "border-gray-200 hover:border-gray-400"
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <div
              className="w-6 h-6 rounded-md border border-gray-200"
              style={{ backgroundColor: materialEditor.color }}
            />
            <input
              type="text"
              value={materialEditor.color}
              onChange={(e) => updateMaterial({ color: e.target.value })}
              className="flex-1 text-[10px] font-mono text-gray-600 border border-gray-200 rounded-md px-2 py-1 outline-none focus:border-indigo-300"
              placeholder="#000000"
            />
          </div>
        </div>

        {/* ── PBR Properties ── */}
        <div>
          <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-2 block">
            Properties
          </label>
          <div className="space-y-2">
            <Slider
              label="Metalness"
              value={materialEditor.metalness}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => updateMaterial({ metalness: v })}
            />
            <Slider
              label="Roughness"
              value={materialEditor.roughness}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => updateMaterial({ roughness: v })}
            />
            <Slider
              label="Opacity"
              value={materialEditor.opacity}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => updateMaterial({ opacity: v })}
            />
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={materialEditor.wireframe}
                onChange={(e) => updateMaterial({ wireframe: e.target.checked })}
                className="accent-indigo-500 w-3 h-3"
              />
              <span className="text-[10px] text-gray-600">Wireframe overlay</span>
            </label>
          </div>
        </div>

        {/* ── Fabric Presets ── */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">
              Fabric Presets
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={useBlender}
                onChange={(e) => setUseBlender(e.target.checked)}
                className="accent-indigo-500 w-3 h-3"
              />
              <span className="text-[8px] text-gray-400">Blender PBR</span>
            </label>
          </div>
          <div className="flex flex-wrap gap-1">
            {Object.entries(FABRIC_PRESETS_3D).map(([id, preset]) => (
              <button
                key={id}
                onClick={() => handleFabricPreset(id)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
                  materialEditor.fabricPreset === id
                    ? "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-sm border border-black/10"
                  style={{ backgroundColor: preset.color }}
                />
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Apply buttons ── */}
        <div className="flex gap-2 pt-1 border-t border-gray-100">
          <button
            onClick={() => dispatch({ type: "SET_STATUS", payload: "Material applied to selected" })}
            className="flex-1 px-3 py-1.5 rounded-lg text-[10px] font-medium bg-indigo-50 text-indigo-600 border border-indigo-100 hover:bg-indigo-100 transition-colors"
          >
            Apply to Selected
          </button>
          <button
            onClick={() => dispatch({ type: "SET_STATUS", payload: "Material applied to all" })}
            className="flex-1 px-3 py-1.5 rounded-lg text-[10px] font-medium bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100 transition-colors"
          >
            Apply to All
          </button>
        </div>
      </div>
    </div>
  );
}
