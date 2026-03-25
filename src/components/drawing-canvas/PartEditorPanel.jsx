// File: components/drawing-canvas/PartEditorPanel.jsx
// Editing panel for a selected garment part — appears overlaid on the RenderPanel
"use client";

import { useDrawingCanvas } from "@/hooks/useDrawingCanvas";
import { parsePartName, VARIANT_DISPLAY_NAMES } from "@/lib/garment-naming";

// Replacement variants available per part type
const PART_VARIANTS = {
  collar: ["mandarin", "spread", "button_down", "peter_pan", "band", "shawl", "polo"],
  cuff: ["french", "barrel", "ribbed", "elastic"],
  sleeve: ["long", "short", "three_quarter", "cap", "raglan", "puff"],
  pocket: ["patch", "welt", "flap", "kangaroo"],
  hood: ["standard", "oversized"],
  hem: ["straight", "curved", "split", "ribbed"],
  waistband: ["elastic", "structured", "drawstring"],
};

export default function PartEditorPanel() {
  const { state, dispatch } = useDrawingCanvas();
  const { selectedPart, garmentConfig } = state;

  if (!selectedPart) return null;
  const parsed = parsePartName(selectedPart);
  if (!parsed) return null;

  const variants = PART_VARIANTS[parsed.partType] || [];

  const handleDeselect = () => {
    dispatch({ type: "SET_SELECTED_PART", payload: null });
  };

  const handleDelete = () => {
    dispatch({ type: "REMOVE_GARMENT_PART", payload: selectedPart });
    dispatch({ type: "SET_STATUS", payload: `Removed ${parsed.displayName}` });
  };

  const handleReplace = (newVariant) => {
    dispatch({
      type: "REPLACE_GARMENT_PART",
      payload: { partName: selectedPart, newVariant },
    });
    dispatch({
      type: "SET_STATUS",
      payload: `Replacing ${parsed.displayName} with ${VARIANT_DISPLAY_NAMES[newVariant] || newVariant}...`,
    });
  };

  return (
    <div className="absolute top-14 right-4 z-30 w-56 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 bg-gray-50 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-indigo-500" />
          <h3 className="text-[12px] font-semibold text-gray-800">{parsed.displayName}</h3>
        </div>
        <button
          onClick={handleDeselect}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Actions */}
      <div className="p-2 space-y-1">
        {/* Replace variant — only if variants exist for this part type */}
        {variants.length > 0 && (
          <div className="px-2 py-1.5">
            <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5 block">
              Replace with
            </label>
            <div className="flex flex-wrap gap-1">
              {variants.map((variant) => (
                <button
                  key={variant}
                  onClick={() => handleReplace(variant)}
                  className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
                    parsed.detail === variant
                      ? "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {VARIANT_DISPLAY_NAMES[variant] || variant}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-gray-100 my-1" />

        {/* Delete */}
        <button
          onClick={handleDelete}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11px] text-red-500 hover:bg-red-50 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
          Remove this part
        </button>
      </div>
    </div>
  );
}
