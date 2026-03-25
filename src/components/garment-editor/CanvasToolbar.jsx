// File: components/garment-editor/CanvasToolbar.jsx — KREA.ai-style floating toolbar
"use client";

import { useState, useRef, useEffect } from "react";
import {
  Pencil, Paintbrush, PenTool, Brush, Pipette, Eraser,
  Type, Upload, Undo2, Redo2, ZoomIn, ZoomOut, Move,
  Layers, Sparkles, Send, ChevronDown, Minus, Camera, Image as ImageIcon
} from "lucide-react";

const BRUSH_TYPES = [
  { id: "pencil", label: "Pencil", icon: Pencil, lineWidth: 3, lineCap: "round", lineJoin: "round", opacity: 1.0, cursor: "crosshair" },
  { id: "brush", label: "Brush", icon: Paintbrush, lineWidth: 8, lineCap: "round", lineJoin: "round", opacity: 0.85, cursor: "crosshair" },
  { id: "calligraphyBrush", label: "Calligraphy", icon: PenTool, lineWidth: 6, lineCap: "butt", lineJoin: "miter", opacity: 0.9, cursor: "crosshair", calligraphy: true },
  { id: "oilBrush", label: "Oil Brush", icon: Brush, lineWidth: 14, lineCap: "round", lineJoin: "round", opacity: 0.55, cursor: "crosshair" },
  { id: "airbrush", label: "Airbrush", icon: Sparkles, lineWidth: 24, lineCap: "round", lineJoin: "round", opacity: 0.15, cursor: "crosshair", airbrush: true },
  { id: "marker", label: "Marker", icon: PenTool, lineWidth: 10, lineCap: "square", lineJoin: "miter", opacity: 0.7, cursor: "crosshair" },
  { id: "crayon", label: "Crayon", icon: PenTool, lineWidth: 7, lineCap: "butt", lineJoin: "bevel", opacity: 0.8, cursor: "crosshair", noise: true },
  { id: "watercolor", label: "Watercolor", icon: Paintbrush, lineWidth: 18, lineCap: "round", lineJoin: "round", opacity: 0.2, cursor: "crosshair", watercolor: true },
  { id: "connectedLine", label: "Line", icon: Minus, lineWidth: 3, lineCap: "round", lineJoin: "round", opacity: 1.0, cursor: "crosshair", connectedLine: true },
  { id: "eraser", label: "Eraser", icon: Eraser, lineWidth: 16, lineCap: "round", lineJoin: "round", opacity: 1.0, cursor: "crosshair", eraser: true },
];

const QUICK_COLORS = [
  "#FF3B30", "#FF9500", "#FFCC00", "#34C759", "#007AFF",
  "#5856D6", "#AF52DE", "#FF2D55", "#FFFFFF", "#000000",
  "#8E8E93", "#C7C7CC"
];

export function CanvasToolbar({
  activeTool,
  activeColor,
  brushSize,
  editPrompt,
  isGenerating,
  hasScribble,
  hasMask,
  onToolChange,
  onColorChange,
  onBrushSizeChange,
  onPromptChange,
  onGenerate,
  onClear,
  onUndo,
  onAddText,
  onUploadGraphic,
  onCaptureCamera,
}) {
  const [showBrushPicker, setShowBrushPicker] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const brushPickerRef = useRef(null);
  const colorPickerRef = useRef(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e) => {
      if (brushPickerRef.current && !brushPickerRef.current.contains(e.target)) {
        setShowBrushPicker(false);
      }
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target)) {
        setShowColorPicker(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const activeBrush = BRUSH_TYPES.find((b) => b.id === activeTool) || BRUSH_TYPES[0];
  const ActiveIcon = activeBrush.icon;

  return (
    <div className="flex flex-col gap-2">
      {/* Main toolbar */}
      <div className="flex items-center gap-1 px-2.5 py-2 rounded-2xl toolbar-glass">

        {/* Brush type selector */}
        <div className="relative" ref={brushPickerRef}>
          <button
            onClick={() => setShowBrushPicker(!showBrushPicker)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl transition-all duration-200 ${
              showBrushPicker ? "bg-indigo-500/15 text-indigo-400" : "text-gray-400 hover:text-white hover:bg-white/[0.06]"
            }`}
            title={activeBrush.label}
          >
            <ActiveIcon className="w-4 h-4" />
            <span className="text-[11px] font-medium hidden sm:inline">{activeBrush.label}</span>
            <ChevronDown className={`w-3 h-3 opacity-50 transition-transform duration-200 ${showBrushPicker ? "rotate-180" : ""}`} />
          </button>

          {showBrushPicker && (
            <div className="absolute bottom-full left-0 mb-2 w-56 py-1.5 rounded-xl toolbar-glass z-50 animate-fade-in-scale">
              <div className="px-3 py-1.5 text-[10px] text-gray-500 uppercase tracking-[0.12em] font-semibold">Drawing Tools</div>
              {BRUSH_TYPES.map((brush) => {
                const Icon = brush.icon;
                return (
                  <button
                    key={brush.id}
                    onClick={() => {
                      onToolChange(brush.id);
                      setShowBrushPicker(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-all duration-150 ${
                      activeTool === brush.id
                        ? "bg-indigo-500/10 text-indigo-300"
                        : "text-gray-400 hover:bg-white/[0.04] hover:text-white"
                    }`}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <span className="text-[11px] font-medium">{brush.label}</span>
                    {/* Preview stroke */}
                    <div className="ml-auto w-16 h-3 flex items-center">
                      <svg viewBox="0 0 60 12" className="w-full h-full">
                        <path
                          d="M2,8 C10,2 20,10 30,6 C40,2 50,10 58,4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={Math.max(1, brush.lineWidth / 4)}
                          strokeLinecap={brush.lineCap}
                          opacity={brush.opacity}
                        />
                      </svg>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-white/[0.06] mx-0.5" />

        {/* Brush size slider */}
        <div className="flex items-center gap-2 px-2">
          <span className="text-[10px] text-gray-500 w-4 text-right font-mono font-medium">{brushSize || activeBrush.lineWidth}</span>
          <input
            type="range"
            min="1"
            max="40"
            value={brushSize || activeBrush.lineWidth}
            onChange={(e) => onBrushSizeChange(parseInt(e.target.value))}
            className="w-20 h-1 accent-indigo-500 cursor-pointer"
          />
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-white/[0.06] mx-0.5" />

        {/* Color selector */}
        <div className="relative" ref={colorPickerRef}>
          <button
            onClick={() => setShowColorPicker(!showColorPicker)}
            className="flex items-center gap-1.5 px-2 py-2 rounded-xl hover:bg-white/[0.04] transition-all duration-200"
          >
            <div
              className="w-5 h-5 rounded-lg border-2 border-white/20 shadow-inner transition-transform hover:scale-110"
              style={{ background: activeColor }}
            />
            <ChevronDown className={`w-3 h-3 text-gray-500 transition-transform duration-200 ${showColorPicker ? "rotate-180" : ""}`} />
          </button>

          {showColorPicker && (
            <div className="absolute bottom-full left-0 mb-2 p-3 rounded-xl toolbar-glass z-50 animate-fade-in-scale">
              <div className="grid grid-cols-6 gap-1.5 mb-2.5">
                {QUICK_COLORS.map((color) => (
                  <button
                    key={color}
                    onClick={() => {
                      onColorChange(color);
                      setShowColorPicker(false);
                    }}
                    className={`w-7 h-7 rounded-lg border-2 transition-all duration-150 hover:scale-110 ${
                      activeColor === color ? "border-white scale-110 shadow-lg" : "border-transparent hover:border-white/30"
                    }`}
                    style={{ background: color }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2 pt-2.5 border-t border-white/[0.06]">
                <input
                  type="color"
                  value={activeColor}
                  onChange={(e) => onColorChange(e.target.value)}
                  className="w-7 h-7 rounded-lg border border-white/[0.08] cursor-pointer bg-transparent"
                />
                <span className="text-[10px] text-gray-500 font-mono font-medium">{activeColor}</span>
              </div>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-white/[0.06] mx-0.5" />

        {/* Clear / Undo */}
        <button
          onClick={onUndo}
          disabled={!hasScribble}
          className="p-2 rounded-xl text-gray-500 hover:text-white hover:bg-white/[0.05] transition-all duration-200 disabled:opacity-20 disabled:pointer-events-none"
          title="Undo"
        >
          <Undo2 className="w-4 h-4" />
        </button>
        <button
          onClick={onClear}
          disabled={!hasScribble}
          className="p-2 rounded-xl text-gray-500 hover:text-white hover:bg-white/[0.05] transition-all duration-200 disabled:opacity-20 disabled:pointer-events-none"
          title="Clear drawing"
        >
          <Eraser className="w-4 h-4" />
        </button>

        {/* Divider */}
        <div className="w-px h-6 bg-white/[0.06] mx-0.5" />

        {/* Extra tools */}
        <button
          onClick={onAddText}
          className="p-2 rounded-xl text-gray-500 hover:text-white hover:bg-white/[0.05] transition-all duration-200"
          title="Add Text"
        >
          <Type className="w-4 h-4" />
        </button>
        <label
          className="p-2 rounded-xl text-gray-500 hover:text-white hover:bg-white/[0.05] transition-all duration-200 cursor-pointer"
          title="Upload Graphic"
        >
          <ImageIcon className="w-4 h-4" />
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUploadGraphic?.(file);
              e.target.value = "";
            }}
          />
        </label>
        <label
          className="p-2 rounded-xl text-gray-500 hover:text-white hover:bg-white/[0.05] transition-all duration-200 cursor-pointer"
          title="Camera Capture"
        >
          <Camera className="w-4 h-4" />
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onCaptureCamera?.(file);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {/* Prompt bar */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl toolbar-glass">
        <Sparkles className="w-4 h-4 text-gray-600 flex-shrink-0" />
        <input
          type="text"
          value={editPrompt || ""}
          onChange={(e) => onPromptChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && hasMask) {
              e.preventDefault();
              onGenerate();
            }
          }}
          placeholder="Describe your edit..."
          className="flex-1 bg-transparent text-sm text-gray-200 placeholder:text-gray-600 outline-none"
        />
        <div className="flex items-center gap-1.5">
          {editPrompt?.trim() && (
            <span className="text-[9px] text-gray-600 font-mono hidden sm:inline">⏎ Enter</span>
          )}
          <button
            onClick={onGenerate}
            disabled={!hasMask || (!hasScribble && !editPrompt?.trim()) || isGenerating}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-200 ${
              isGenerating
                ? "bg-indigo-500/15 text-indigo-400 border border-indigo-500/20"
                : "bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/20 hover:shadow-xl hover:shadow-indigo-500/30 hover:from-indigo-400 hover:to-purple-500 disabled:opacity-25 disabled:shadow-none disabled:from-gray-700 disabled:to-gray-700 disabled:text-gray-500"
            }`}
          >
            {isGenerating ? (
              <>
                <div className="w-3 h-3 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-gentle-spin" />
                <span>Processing</span>
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>Generate</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export { BRUSH_TYPES };
