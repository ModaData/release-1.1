"use client";

import { useDrawingCanvas } from "@/hooks/useDrawingCanvas";

const PRESET_COLORS = [
  { hex: "#000000", name: "Black" },
  { hex: "#FFFFFF", name: "White" },
  { hex: "#1e3a5f", name: "Navy" },
  { hex: "#8B0000", name: "Burgundy" },
  { hex: "#2F4F4F", name: "Charcoal" },
  { hex: "#F5F5DC", name: "Cream" },
  { hex: "#C19A6B", name: "Camel" },
  { hex: "#808080", name: "Grey" },
  { hex: "#556B2F", name: "Olive" },
  { hex: "#B76E79", name: "Rose" },
  { hex: "#FFD700", name: "Gold" },
  { hex: "#4169E1", name: "Royal Blue" },
  { hex: "#FF6347", name: "Coral" },
  { hex: "#9370DB", name: "Lavender" },
  { hex: "#228B22", name: "Forest Green" },
  { hex: "#D2691E", name: "Rust" },
];

export default function CanvasColorPicker() {
  const { state, dispatch } = useDrawingCanvas();

  return (
    <div>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 block mb-2">
        Garment Color
      </span>
      <div className="flex flex-wrap gap-1.5">
        {PRESET_COLORS.map((color) => {
          const isSelected = state.selectedColor?.hex === color.hex;
          return (
            <button
              key={color.hex}
              onClick={() =>
                dispatch({
                  type: "SET_COLOR",
                  payload: isSelected ? null : color,
                })
              }
              title={color.name}
              className={`w-6 h-6 rounded-full border-2 transition-all hover:scale-110 ${
                isSelected
                  ? "border-indigo-500 ring-2 ring-indigo-200 scale-110"
                  : "border-gray-200 hover:border-gray-300"
              }`}
              style={{ backgroundColor: color.hex }}
            />
          );
        })}
      </div>
      {state.selectedColor && (
        <p className="text-[10px] text-gray-500 mt-1.5">
          Selected: {state.selectedColor.name}
        </p>
      )}
    </div>
  );
}
