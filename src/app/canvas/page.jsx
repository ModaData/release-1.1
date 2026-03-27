"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { DrawingCanvasProvider, useDrawingCanvas } from "@/hooks/useDrawingCanvas";
import { generateFabricPromptFragment, validateFabricConstraints } from "@/lib/fabric-db";
import CanvasTopBar from "@/components/drawing-canvas/CanvasTopBar";
import CanvasStatusBar from "@/components/drawing-canvas/CanvasStatusBar";
import DrawingPanel from "@/components/drawing-canvas/DrawingPanel";
import RenderPanel from "@/components/drawing-canvas/RenderPanel";
import CoPilotSidebar from "@/components/drawing-canvas/CoPilotSidebar";
import ExportPanel from "@/components/drawing-canvas/ExportPanel";
import GarmentAIChat from "@/components/drawing-canvas/GarmentAIChat";
import PatternEditor2D from "@/components/drawing-canvas/PatternEditor2D";

function CanvasLayout() {
  const { state, dispatch } = useDrawingCanvas();
  const drawingCanvasRef = useRef(null);
  const containerRef = useRef(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [patternSpec, setPatternSpec] = useState(null);
  // Workspace modes: "sketch" (Draw+Render), "pattern" (2D Pattern+3D), "pattern-only" (full 2D editor)
  const [workspace, setWorkspace] = useState("sketch");

  // Splitter drag state
  const [isDragging, setIsDragging] = useState(false);
  const splitRatio = state.splitRatio;

  // Generate fabric prompt fragment when fiber changes
  useEffect(() => {
    if (state.selectedFiber) {
      const fragment = generateFabricPromptFragment({
        fiberId: state.selectedFiber,
        constructionId: state.selectedConstruction || null,
        gsm: state.gsm || 200,
      });
      dispatch({ type: "SET_FABRIC_PROMPT_FRAGMENT", payload: fragment });
    } else {
      dispatch({ type: "SET_FABRIC_PROMPT_FRAGMENT", payload: null });
    }
  }, [state.selectedFiber, state.selectedConstruction, state.gsm, dispatch]);

  // Run constraint validation when interpretation or fabric changes
  useEffect(() => {
    if (!state.selectedFiber || !state.currentInterpretation) {
      dispatch({ type: "SET_VIOLATIONS", payload: [] });
      return;
    }
    const violations = validateFabricConstraints(
      { fiberId: state.selectedFiber, constructionId: state.selectedConstruction, gsm: state.gsm || 200 },
      { garmentType: state.garmentCategory }
    );
    dispatch({ type: "SET_VIOLATIONS", payload: violations });
  }, [state.selectedFiber, state.selectedConstruction, state.gsm, state.currentInterpretation, state.garmentCategory, dispatch]);

  // Fetch design suggestions every 3rd render
  useEffect(() => {
    if (state.renderCount > 0 && state.renderCount % 3 === 0 && state.currentInterpretation) {
      fetch("/api/suggest-design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sketchDescription: state.currentInterpretation,
          fabricContext: state.fabricPromptFragment || "",
          garmentCategory: state.garmentCategory || "",
          styleNotes: state.styleNotes || "",
        }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.suggestions) dispatch({ type: "SET_SUGGESTIONS", payload: data.suggestions });
        })
        .catch(() => {}); // Non-critical
    }
  }, [state.renderCount]);

  const handleUndo = useCallback(() => {
    drawingCanvasRef.current?.undo();
  }, []);

  const handleRedo = useCallback(() => {
    drawingCanvasRef.current?.redo();
  }, []);

  const handleClear = useCallback(() => {
    if (window.confirm("Clear the entire canvas? This cannot be undone.")) {
      drawingCanvasRef.current?.clear();
    }
  }, []);

  const handleHistoryChange = useCallback((undoCount, redoCount) => {
    setCanUndo(undoCount > 0);
    setCanRedo(redoCount > 0);
  }, []);

  const handleRetry = useCallback(() => {
    drawingCanvasRef.current?.triggerManualRender();
  }, []);

  // Splitter drag handlers
  const handleSplitterMouseDown = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const ratio = Math.max(0.3, Math.min(0.7, x / rect.width));
      dispatch({ type: "SET_SPLIT_RATIO", payload: ratio });
    };

    const handleMouseUp = () => setIsDragging(false);

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, dispatch]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      // Undo / Redo — route to 3D undo stack when in 3D view
      const in3D = state.viewMode === "3d" || state.viewMode === "normalmap" || state.viewMode === "retopo";
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        if (in3D && state.glbUrl) {
          dispatch({ type: "UNDO_3D" });
        } else {
          handleUndo();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        if (in3D && state.glbUrl) {
          dispatch({ type: "REDO_3D" });
        } else {
          handleRedo();
        }
      }
      // Clear
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "X") {
        e.preventDefault();
        handleClear();
      }
      // Tool shortcuts (only if not in an input)
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;

      // Check if we're in 3D view
      const is3DView = state.viewMode === "3d" || state.viewMode === "normalmap" || state.viewMode === "retopo";

      if (is3DView) {
        // ── 3D Editor shortcuts ──
        if (e.key === "q" || e.key === "Q") dispatch({ type: "SET_EDITOR_TOOL_3D", payload: "select" });
        if (e.key === "g" || e.key === "G") dispatch({ type: "SET_EDITOR_TOOL_3D", payload: "translate" });
        if (e.key === "r" || e.key === "R") dispatch({ type: "SET_EDITOR_TOOL_3D", payload: "rotate" });
        if (e.key === "s" || e.key === "S") dispatch({ type: "SET_EDITOR_TOOL_3D", payload: "scale" });
        // Material editor toggle
        if (e.key === "m" || e.key === "M") {
          dispatch({
            type: "SET_EDITOR_PANEL",
            payload: state.editorPanelOpen === "material" ? "none" : "material",
          });
        }
        // Vertex paint toggle
        if (e.key === "v" || e.key === "V") {
          const newPaintMode = state.paintMode === "off" ? "vertex_paint" : "off";
          dispatch({ type: "SET_PAINT_MODE", payload: newPaintMode });
          if (newPaintMode !== "off") {
            dispatch({ type: "SET_EDITOR_PANEL", payload: "paint" });
          }
        }
        // World/Local transform space toggle
        if (e.key === "x" || e.key === "X") {
          dispatch({
            type: "SET_TRANSFORM_SPACE",
            payload: state.transformSpace === "world" ? "local" : "world",
          });
        }
      } else {
        // ── 2D Drawing shortcuts ──
        if (e.key === "p" || e.key === "P") dispatch({ type: "SET_TOOL", payload: "pencil" });
        if (e.key === "b" || e.key === "B") dispatch({ type: "SET_TOOL", payload: "brush" });
        if (e.key === "e" || e.key === "E") dispatch({ type: "SET_TOOL", payload: "eraser" });
        if (e.key === "l" || e.key === "L") dispatch({ type: "SET_TOOL", payload: "lasso" });
      }

      // "/" opens command input (both modes)
      if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        dispatch({ type: "SET_COMMAND_INPUT_OPEN", payload: true });
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleUndo, handleRedo, handleClear, dispatch, state.viewMode, state.paintMode, state.editorPanelOpen, state.transformSpace, state.glbUrl]);

  // Responsive: detect viewport width
  const [viewMode, setViewMode] = useState("split"); // "split" | "stack" | "tabs"
  const [activeTab, setActiveTab] = useState("draw");

  useEffect(() => {
    const checkSize = () => {
      const w = window.innerWidth;
      if (w < 600) setViewMode("tabs");
      else if (w < 960) setViewMode("stack");
      else setViewMode("split");
    };
    checkSize();
    window.addEventListener("resize", checkSize);
    return () => window.removeEventListener("resize", checkSize);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      <CanvasTopBar
        onUndo={handleUndo}
        onRedo={handleRedo}
        onClear={handleClear}
        canUndo={canUndo}
        canRedo={canRedo}
      />

      {/* ── Workspace Mode Toggle ── */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100 bg-gray-50/50">
        <div className="flex gap-1">
          {[
            { id: "sketch", label: "Sketch + Render", icon: "M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" },
            { id: "pattern", label: "Pattern + 3D", icon: "M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" },
            { id: "pattern-only", label: "Pattern Editor", icon: "M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" },
          ].map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => setWorkspace(id)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                workspace === id
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-gray-500 hover:bg-gray-100"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
              </svg>
              {label}
            </button>
          ))}
        </div>

        {/* Pattern spec badge */}
        {patternSpec?.panels && (
          <span className="text-[9px] px-2 py-0.5 rounded-full bg-violet-50 text-violet-600 border border-violet-100">
            {patternSpec.panels.length} panels | {patternSpec.metadata?.fabric_type || "cotton"}
          </span>
        )}
      </div>

      {/* Tab switcher for mobile */}
      {viewMode === "tabs" && workspace === "sketch" && (
        <div className="flex border-b border-gray-200 bg-white">
          <button
            onClick={() => setActiveTab("draw")}
            className={`flex-1 py-2 text-[12px] font-medium text-center transition-colors ${
              activeTab === "draw"
                ? "text-indigo-600 border-b-2 border-indigo-500"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Draw
          </button>
          <button
            onClick={() => setActiveTab("render")}
            className={`flex-1 py-2 text-[12px] font-medium text-center transition-colors ${
              activeTab === "render"
                ? "text-indigo-600 border-b-2 border-indigo-500"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Render
          </button>
        </div>
      )}

      {/* Main panels */}
      <div ref={containerRef} className="flex-1 flex relative overflow-hidden" style={{
        flexDirection: viewMode === "stack" ? "column" : "row",
      }}>

        {/* ════════ SKETCH WORKSPACE (Draw + Render) ════════ */}
        {workspace === "sketch" && (
          <>
            {/* Left: Drawing Panel */}
            {(viewMode !== "tabs" || activeTab === "draw") && (
              <div
                className="relative"
                style={{
                  width: viewMode === "split" ? `${splitRatio * 100}%` : "100%",
                  height: viewMode === "stack" ? "50%" : "100%",
                  minWidth: viewMode === "split" ? "360px" : undefined,
                }}
              >
                <DrawingPanel
                  ref={drawingCanvasRef}
                  onHistoryChange={handleHistoryChange}
                />
              </div>
            )}

            {/* Draggable Splitter */}
            {viewMode === "split" && (
              <div
                onMouseDown={handleSplitterMouseDown}
                className={`w-1 cursor-col-resize flex-shrink-0 transition-colors z-10 ${
                  isDragging ? "bg-indigo-500" : "bg-gray-200 hover:bg-indigo-400"
                }`}
              />
            )}

            {/* Right: Render Panel */}
            {(viewMode !== "tabs" || activeTab === "render") && (
              <div
                className="relative"
                style={{
                  width: viewMode === "split" ? `${(1 - splitRatio) * 100}%` : "100%",
                  height: viewMode === "stack" ? "50%" : "100%",
                  minWidth: viewMode === "split" ? "360px" : undefined,
                }}
              >
                <RenderPanel onRetry={handleRetry} />
              </div>
            )}
          </>
        )}

        {/* ════════ PATTERN + 3D WORKSPACE ════════ */}
        {workspace === "pattern" && (
          <>
            {/* Left: 2D Pattern Editor */}
            <div
              className="relative"
              style={{
                width: `${splitRatio * 100}%`,
                height: "100%",
                minWidth: "360px",
              }}
            >
              <PatternEditor2D
                patternSpec={patternSpec}
                onPatternChange={(updatedSpec) => setPatternSpec(updatedSpec)}
                onResimulate={async (spec) => {
                  // Send updated pattern to Blender for re-simulation
                  try {
                    const blenderUrl = process.env.NEXT_PUBLIC_BLENDER_API_URL || "";
                    const res = await fetch("/api/garment-ai", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        prompt: "Re-simulate with updated pattern coordinates",
                        currentSpec: spec,
                      }),
                    });
                    if (res.ok) {
                      const data = await res.json();
                      if (data.glbUrl) {
                        dispatch({ type: "SET_GLB_URL", payload: data.glbUrl });
                        dispatch({ type: "SET_VIEW_MODE", payload: "3d" });
                      }
                    }
                  } catch (err) {
                    console.error("[pattern] Re-simulate failed:", err);
                  }
                }}
              />
            </div>

            {/* Splitter */}
            <div
              onMouseDown={handleSplitterMouseDown}
              className={`w-1 cursor-col-resize flex-shrink-0 transition-colors z-10 ${
                isDragging ? "bg-indigo-500" : "bg-gray-200 hover:bg-violet-400"
              }`}
            />

            {/* Right: 3D Viewer */}
            <div
              className="relative"
              style={{
                width: `${(1 - splitRatio) * 100}%`,
                height: "100%",
                minWidth: "360px",
              }}
            >
              <RenderPanel onRetry={handleRetry} />
            </div>
          </>
        )}

        {/* ════════ PATTERN-ONLY WORKSPACE ════════ */}
        {workspace === "pattern-only" && (
          <div className="relative w-full h-full">
            <PatternEditor2D
              patternSpec={patternSpec}
              onPatternChange={(updatedSpec) => setPatternSpec(updatedSpec)}
              onResimulate={async (spec) => {
                try {
                  const res = await fetch("/api/garment-ai", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      prompt: "Re-simulate with updated pattern coordinates",
                      currentSpec: spec,
                    }),
                  });
                  if (res.ok) {
                    const data = await res.json();
                    if (data.glbUrl) {
                      dispatch({ type: "SET_GLB_URL", payload: data.glbUrl });
                      setWorkspace("pattern"); // Switch to split view to see 3D result
                    }
                  }
                } catch (err) {
                  console.error("[pattern] Re-simulate failed:", err);
                }
              }}
            />
          </div>
        )}

        {/* Co-Pilot Sidebar */}
        {state.coPilotOpen && (
          <CoPilotSidebar />
        )}

        {/* AI Garment Studio Chat */}
        {aiChatOpen && (
          <div className="w-[320px] flex-shrink-0 border-l border-gray-100 h-full">
            <GarmentAIChat
              onGlbGenerated={(glbUrl, spec) => {
                dispatch({ type: "SET_GLB_URL", payload: glbUrl });
                dispatch({ type: "SET_VIEW_MODE", payload: "3d" });
                setPatternSpec(spec);
              }}
              onSpecUpdate={(spec) => setPatternSpec(spec)}
            />
          </div>
        )}
      </div>

      {/* AI Chat toggle button (floating, bottom-right) */}
      <button
        onClick={() => setAiChatOpen(!aiChatOpen)}
        className={`fixed bottom-16 right-4 z-50 w-12 h-12 rounded-2xl shadow-lg flex items-center justify-center transition-all ${
          aiChatOpen
            ? "bg-indigo-600 text-white rotate-0"
            : "bg-gradient-to-br from-violet-500 to-indigo-600 text-white hover:scale-105"
        }`}
        title="AI Garment Studio"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          {aiChatOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          )}
        </svg>
      </button>

      <CanvasStatusBar onExport={() => setShowExport(true)} />

      {/* Export Modal */}
      {showExport && <ExportPanel onClose={() => setShowExport(false)} />}
    </div>
  );
}

export default function CanvasPage() {
  return (
    <DrawingCanvasProvider>
      <CanvasLayout />
    </DrawingCanvasProvider>
  );
}
