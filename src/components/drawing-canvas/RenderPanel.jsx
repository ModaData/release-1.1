// File: components/drawing-canvas/RenderPanel.jsx — AI render output + 3D viewer with view mode toggle
"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useDrawingCanvas } from "@/hooks/useDrawingCanvas";
import RenderHistoryScrubber from "./RenderHistoryScrubber";
import RenderProgressBar from "./RenderProgressBar";
import MeshStatsOverlay from "./MeshStatsOverlay";
import PartEditorPanel from "./PartEditorPanel";
import Editor3DToolbar from "./Editor3DToolbar";
import MaterialEditorPanel from "./MaterialEditorPanel";
import MeshOpsPanel from "./MeshOpsPanel";
import AIEffectTools from "./AIEffectTools";
import SAMSegmentOverlay from "./SAMSegmentOverlay";

// Dynamically import Three.js viewer (no SSR)
const GarmentViewer3D = dynamic(() => import("./GarmentViewer3D"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center bg-[#f9fafb]">
      <div className="w-10 h-10 border-2 border-indigo-200 border-t-indigo-500 rounded-full animate-gentle-spin" />
    </div>
  ),
});

const VIEW_MODES = [
  { id: "2d", label: "2D", icon: "M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a2.25 2.25 0 002.25-2.25V5.25a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 003.75 21z" },
  { id: "3d", label: "3D", icon: "M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" },
  { id: "normalmap", label: "Normal", icon: "M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" },
  { id: "retopo", label: "Retopo", icon: "M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" },
  { id: "pattern", label: "Pattern", icon: "M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" },
];

export default function RenderPanel({ onRetry }) {
  const { state, dispatch } = useDrawingCanvas();
  const displayUrl = state.isLocked ? state.lockedRenderUrl : state.currentRenderUrl;
  const is3DView = ["3d", "normalmap", "retopo", "pattern"].includes(state.viewMode);

  // Mesh stats from 3D viewer (for retopo overlay + mesh ops panel)
  const [meshStats, setMeshStats] = useState(null);
  // Canvas element ref for SAM screenshot capture
  const [canvasElement, setCanvasElement] = useState(null);
  // 3D generation model selector
  const [gen3dModel, setGen3dModel] = useState("hunyuan");

  // Proxy remote GLB URLs through our server to avoid CORS issues
  const proxiedGlbUrl = useMemo(() => {
    if (!state.glbUrl) return null;
    if (state.glbUrl.startsWith("data:") || state.glbUrl.startsWith("/") || state.glbUrl.startsWith("blob:")) {
      return state.glbUrl;
    }
    return `/api/proxy-model?url=${encodeURIComponent(state.glbUrl)}`;
  }, [state.glbUrl]);

  // Generate 3D from current render
  const handleGenerate3D = useCallback(async () => {
    const imageUrl = displayUrl;
    if (!imageUrl) return;

    dispatch({ type: "SET_GENERATING_3D", payload: true });
    dispatch({ type: "SET_STATUS", payload: `Generating 3D mesh with ${gen3dModel === "trellis" ? "Trellis (clean quads)" : "HunYuan"}...` });

    try {
      let imageDataUrl = imageUrl;
      if (!imageUrl.startsWith("data:")) {
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        imageDataUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
      }

      const res = await fetch("/api/generate-3d", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl, model: gen3dModel }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed with status ${res.status}`);

      dispatch({ type: "SET_GLB_URL", payload: data.glbUrl });
      dispatch({ type: "SET_VIEW_MODE", payload: "3d" });
      dispatch({ type: "SET_STATUS", payload: "3D mesh generated successfully!" });
    } catch (err) {
      console.error("Generate 3D error:", err);
      dispatch({ type: "SET_ERROR", payload: `3D generation failed: ${err.message}` });
    } finally {
      dispatch({ type: "SET_GENERATING_3D", payload: false });
    }
  }, [displayUrl, dispatch, gen3dModel]);

  return (
    <div className="relative w-full h-full bg-[#f9fafb] overflow-hidden flex flex-col">
      {/* Progress bar */}
      <RenderProgressBar />

      {/* View mode toggle — shown when GLB exists */}
      {state.glbUrl && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 p-1 rounded-xl bg-white/90 backdrop-blur-sm border border-gray-200 shadow-sm">
          {VIEW_MODES.map((mode) => (
            <button
              key={mode.id}
              onClick={() => {
                dispatch({ type: "SET_VIEW_MODE", payload: mode.id });
                dispatch({ type: "SET_SELECTED_PART", payload: null });
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-all ${
                state.viewMode === mode.id
                  ? "bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={mode.icon} />
              </svg>
              {mode.label}
            </button>
          ))}
        </div>
      )}

      {/* Render display area */}
      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        {/* ── 3D Viewer ── */}
        {is3DView && proxiedGlbUrl && (
          <GarmentViewer3D
            glbUrl={proxiedGlbUrl}
            viewMode={state.viewMode}
            selectedPart={state.selectedPart}
            hoveredPart={state.hoveredPart}
            onHover={(name) => dispatch({ type: "SET_HOVERED_PART", payload: name })}
            onSelect={(name) => dispatch({ type: "SET_SELECTED_PART", payload: state.selectedPart === name ? null : name })}
            onMeshStats={setMeshStats}
            // 3D editor props
            editorTool3D={state.editorTool3D}
            transformSpace={state.transformSpace}
            materialEditor={state.materialEditor}
            paintMode={state.paintMode}
            paintColor={state.paintColor}
            paintBrushRadius={state.paintBrushRadius}
            onCanvasReady={setCanvasElement}
          />
        )}

        {/* ── 3D Editor Toolbar (left side) ── */}
        {is3DView && proxiedGlbUrl && (
          <Editor3DToolbar meshStats={meshStats} />
        )}

        {/* ── Material Editor Panel (right side) ── */}
        {is3DView && state.editorPanelOpen === "material" && (
          <MaterialEditorPanel />
        )}

        {/* ── Mesh Operations Panel (right side) ── */}
        {is3DView && state.editorPanelOpen === "mesh_ops" && (
          <MeshOpsPanel meshStats={meshStats} />
        )}

        {/* ── AI Effect Tools Panel (right side) ── */}
        {is3DView && state.editorPanelOpen === "ai_effects" && (
          <div className="absolute top-12 right-0 bottom-0 w-56 bg-white border-l border-gray-200 shadow-lg z-20 overflow-hidden">
            <AIEffectTools
              currentGlbUrl={proxiedGlbUrl}
              isProcessing={state.meshOpInProgress !== null}
              onApplyEffect={async (effect) => {
                dispatch({ type: "SET_MESH_OP", payload: effect.toolId });
                try {
                  // Extract base64 from GLB data URL
                  const glbBase64 = proxiedGlbUrl?.startsWith("data:")
                    ? proxiedGlbUrl.split(",")[1]
                    : null;
                  if (!glbBase64) {
                    console.error("[ai-effect] No GLB data available");
                    return;
                  }
                  const res = await fetch("/api/apply-effect", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      glbBase64,
                      bpyInstruction: effect.bpyInstruction,
                      toolId: effect.toolId,
                      toolName: effect.toolName,
                      position: effect.position,
                    }),
                  });
                  if (res.ok) {
                    const data = await res.json();
                    if (data.glbUrl) {
                      dispatch({ type: "SET_GLB_URL", payload: data.glbUrl });
                    }
                  }
                } catch (err) {
                  console.error("[ai-effect] Apply failed:", err);
                } finally {
                  dispatch({ type: "SET_MESH_OP", payload: null });
                }
              }}
            />
          </div>
        )}

        {/* ── SAM Segment Overlay ── */}
        {is3DView && state.partSelectionMode === "sam_auto" && (
          <SAMSegmentOverlay canvasElement={canvasElement} />
        )}

        {/* ── Mesh stats overlay (retopo mode only) ── */}
        {state.viewMode === "retopo" && proxiedGlbUrl && (
          <MeshStatsOverlay meshStats={meshStats} />
        )}

        {/* ── Part editor panel (when a part is selected in 3D view) ── */}
        {is3DView && state.selectedPart && <PartEditorPanel />}

        {/* ── 2D Render Display ── */}
        {!is3DView && (
          <>
            {state.previousRenderUrl && state.previousRenderUrl !== displayUrl && (
              <img
                src={state.previousRenderUrl}
                className="absolute inset-0 w-full h-full object-contain transition-opacity duration-300 opacity-0 pointer-events-none"
                alt=""
              />
            )}

            {state.previewUrl && state.isGenerating && (
              <>
                <img
                  src={state.previewUrl}
                  className="absolute inset-0 w-full h-full object-contain opacity-60 transition-opacity duration-500"
                  alt="Quick preview"
                />
                <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/80 backdrop-blur-sm border border-gray-200 text-[10px] text-gray-500 font-medium z-10">
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                  Quick Preview — HD rendering...
                </div>
              </>
            )}

            {displayUrl && (
              <img
                key={displayUrl}
                src={displayUrl}
                className="absolute inset-0 w-full h-full object-contain transition-opacity duration-300 animate-in"
                alt="AI interpretation of your sketch"
                style={{ animationDuration: "0.3s" }}
              />
            )}

            {state.error && !displayUrl && !state.isGenerating && (
              <div className="flex flex-col items-center gap-3 text-center px-8">
                <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center">
                  <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                </div>
                <p className="text-[12px] text-red-500 max-w-[260px] leading-relaxed">
                  {state.error}
                </p>
                {onRetry && (
                  <button
                    onClick={onRetry}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-medium bg-indigo-50 text-indigo-600 border border-indigo-100 hover:bg-indigo-100 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                    </svg>
                    Retry Render
                  </button>
                )}
              </div>
            )}

            {!displayUrl && !state.isGenerating && !state.error && (
              <div className="flex flex-col items-center gap-3 text-center px-8">
                <div className="w-16 h-16 rounded-2xl bg-gray-100 border border-gray-200 flex items-center justify-center">
                  <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a2.25 2.25 0 002.25-2.25V5.25a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 003.75 21z" />
                  </svg>
                </div>
                <p className="text-[13px] text-gray-400 max-w-[240px] leading-relaxed">
                  Start drawing on the left — AI will render your sketch here in real-time
                </p>
              </div>
            )}

            {!displayUrl && state.isGenerating && !state.previewUrl && (
              <div className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 border-2 border-indigo-200 border-t-indigo-500 rounded-full animate-gentle-spin" />
                <p className="text-[12px] text-gray-400">Generating first render...</p>
              </div>
            )}
          </>
        )}

        {/* Lock badge */}
        {state.isLocked && (
          <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-medium z-10">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            Locked
          </div>
        )}

        {/* Generate 3D: model selector + button */}
        {displayUrl && !state.glbUrl && !state.isGenerating3D && !is3DView && (
          <div className="absolute bottom-4 right-4 z-20 flex items-center gap-2">
            {/* Model toggle */}
            <div className="flex gap-0.5 p-0.5 bg-white/90 backdrop-blur-sm rounded-lg border border-gray-200 shadow-sm">
              {[
                { id: "hunyuan", label: "HunYuan", desc: "Fast, artistic" },
                { id: "trellis", label: "Trellis", desc: "Clean quads" },
              ].map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setGen3dModel(id)}
                  className={`px-2.5 py-1.5 rounded-md text-[9px] font-semibold transition-colors ${
                    gen3dModel === id
                      ? "bg-indigo-500 text-white shadow-sm"
                      : "text-gray-500 hover:bg-indigo-50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={handleGenerate3D}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl
                bg-gradient-to-r from-indigo-500 to-purple-600 text-white
                hover:from-indigo-600 hover:to-purple-700
                shadow-lg shadow-indigo-500/25
                transition-all text-[11px] font-semibold"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
              </svg>
              Generate 3D
            </button>
          </div>
        )}

        {/* 3D generation spinner */}
        {state.isGenerating3D && (
          <div className="absolute bottom-4 right-4 z-20 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/90 backdrop-blur-sm border border-indigo-200 text-indigo-600 text-[11px] font-semibold">
            <div className="w-4 h-4 border-2 border-indigo-200 border-t-indigo-500 rounded-full animate-spin" />
            Generating 3D mesh...
          </div>
        )}
      </div>

      {/* Render history scrubber */}
      {state.renderHistory.length > 0 && !is3DView && (
        <RenderHistoryScrubber />
      )}
    </div>
  );
}
