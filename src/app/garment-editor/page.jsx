// File: app/garment-editor/page.jsx — MODA DATA Canvas-First Editor (Enterprise SaaS)
"use client";

import { useState, useCallback, useEffect } from "react";
import { useGarmentEditor } from "@/hooks/useGarmentEditor";
import { useSmartSuggestions } from "@/hooks/useSmartSuggestions";
import { useClipInterrogator } from "@/hooks/useClipInterrogator";
import { useComponentDetector } from "@/hooks/useComponentDetector";
import { ControlsPanel } from "@/components/garment-editor/ControlsPanel";
import { StatusMessages } from "@/components/garment-editor/StatusMessages";
import { EditorCanvas } from "@/components/garment-editor/EditorCanvas";
import { BrandBriefWizard } from "@/components/garment-editor/BrandBriefWizard";
import { CanvasToolbar, BRUSH_TYPES } from "@/components/garment-editor/CanvasToolbar";
import {
  Sparkles, Download, Share2, Layers,
  ChevronLeft, ChevronRight, Eye, RotateCcw, Upload,
  Settings, Clock, Zap
} from "lucide-react";

export default function GarmentEditorPage() {
  // Brand brief (pre-design context)
  const [brandBrief, setBrandBrief] = useState(null);
  const [showWizard, setShowWizard] = useState(true); // Show Brand Brief Wizard on first visit
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showBriefModal, setShowBriefModal] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  const { clipDescription, isClipLoading, runClipInterrogator } = useClipInterrogator();
  const { detections, isDetecting, runDetection, getBestDetectionAtPoint } = useComponentDetector();
  const editor = useGarmentEditor(brandBrief, clipDescription);
  const { suggestions, isLoadingSuggestions, fetchSuggestions, clearSuggestions } = useSmartSuggestions(brandBrief);

  // Brush size state (separate from tool default)
  const [brushSize, setBrushSize] = useState(null);
  const activeBrush = BRUSH_TYPES.find((b) => b.id === editor.drawingTool) || BRUSH_TYPES[0];
  const effectiveBrushSize = brushSize || activeBrush.lineWidth;

  // Toast helper
  const showToast = useCallback((msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  }, []);

  // Handle brand brief completion
  const handleBriefComplete = useCallback((brief) => {
    setBrandBrief(brief);
    setShowWizard(false);
    setShowBriefModal(false);
    showToast("Brand context applied ✓");
  }, [showToast]);

  const handleBriefSkip = useCallback(() => {
    setShowWizard(false);
    setShowBriefModal(false);
  }, []);

  // Enhanced image upload that also triggers CLIP + Component Detection
  const handleImageUpload = useCallback(async (file) => {
    await editor.handleImageUpload(file);
    showToast("Analyzing garment with AI...");
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      runClipInterrogator(dataUrl).catch(() => {});
      runDetection(dataUrl).catch(() => {});
    };
    reader.readAsDataURL(file);
  }, [editor, runClipInterrogator, runDetection, showToast]);

  // Fetch smart suggestions when hovering
  const handleCanvasHover = useCallback((e) => {
    const info = editor.handleCanvasHover(e);
    if (info?.label) {
      fetchSuggestions(info.label, clipDescription);
    }
  }, [editor, fetchSuggestions, clipDescription]);

  // Quick action: fill prompt
  const handleQuickAction = useCallback((prompt) => {
    editor.setEditPrompt(prompt);
  }, [editor]);

  // Suggestion click: fill prompt
  const handleSuggestionClick = useCallback((suggestion) => {
    editor.setEditPrompt(suggestion);
  }, [editor]);

  // Show wizard if explicitly requested
  if (showWizard) {
    return (
      <BrandBriefWizard
        onComplete={handleBriefComplete}
        onSkip={handleBriefSkip}
      />
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#08080d]">
      {/* ── Top Navigation Bar ── */}
      <header className="flex-shrink-0 h-12 border-b border-white/[0.04] flex items-center justify-between px-4 bg-[#0a0a12]/90 backdrop-blur-2xl z-50">
        <div className="flex items-center gap-3">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="flex items-center gap-2">
              <h1 className="text-xs font-bold text-white tracking-[0.15em] uppercase">MODA DATA</h1>
              <span className="hidden md:inline text-[9px] text-gray-600 font-medium px-1.5 py-0.5 rounded-md bg-white/[0.03] border border-white/[0.05]">Editor</span>
            </div>
          </div>

          {/* Divider */}
          <div className="w-px h-5 bg-white/[0.06] mx-1" />

          {/* Status chips */}
          <div className="flex items-center gap-2">
            {editor.imageUrl && (
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium transition-all duration-300 ${
                editor.isPerceptionReady
                  ? "bg-emerald-500/8 text-emerald-400 border border-emerald-500/15"
                  : editor.isPerceptionLoading
                  ? "bg-amber-500/8 text-amber-400 border border-amber-500/15"
                  : "bg-white/[0.03] text-gray-500 border border-white/[0.05]"
              }`}>
                <div className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  editor.isPerceptionReady ? "bg-emerald-400" : "bg-amber-400 animate-pulse"
                }`} />
                {editor.isPerceptionReady ? "AI Ready" : editor.isPerceptionLoading ? "Analyzing..." : "Idle"}
              </div>
            )}

            {/* CLIP description badge */}
            {clipDescription && (
              <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-500/8 border border-purple-500/15 text-[10px] text-purple-400 max-w-[200px]">
                <Eye className="w-3 h-3 flex-shrink-0" />
                <span className="truncate font-medium">{clipDescription.substring(0, 50)}...</span>
              </div>
            )}

            {isClipLoading && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-500/8 border border-purple-500/15 text-[10px] text-purple-400">
                <div className="w-2.5 h-2.5 border border-purple-400/30 border-t-purple-400 rounded-full animate-gentle-spin" />
                <span className="font-medium">CLIP analyzing</span>
              </div>
            )}

            {/* Component detection badge */}
            {detections.length > 0 && (
              <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-cyan-500/8 border border-cyan-500/15 text-[10px] text-cyan-400 font-medium">
                <Layers className="w-3 h-3 flex-shrink-0" />
                {detections.length} parts
              </div>
            )}
            {isDetecting && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-cyan-500/8 border border-cyan-500/15 text-[10px] text-cyan-400">
                <div className="w-2.5 h-2.5 border border-cyan-400/30 border-t-cyan-400 rounded-full animate-gentle-spin" />
                <span className="font-medium">Detecting</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* Brand brief toggle */}
          <button
            onClick={() => brandBrief ? setShowBriefModal(true) : setShowWizard(true)}
            className={`hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-all ${
              brandBrief
                ? "bg-indigo-500/8 text-indigo-400 border border-indigo-500/15 hover:bg-indigo-500/12"
                : "text-gray-500 hover:text-gray-300 hover:bg-white/[0.04] border border-transparent hover:border-white/[0.06]"
            }`}
          >
            <Settings className="w-3 h-3" />
            {brandBrief ? "Brand Context" : "Set Brand Context"}
          </button>

          <div className="w-px h-5 bg-white/[0.06] mx-1.5" />

          {/* Action buttons */}
          <button
            onClick={() => {
              if (!editor.canvasRef.current) return;
              const link = document.createElement("a");
              link.download = `moda-data-${Date.now()}.png`;
              link.href = editor.canvasRef.current.toDataURL("image/png");
              link.click();
              showToast("Image downloaded ✓");
            }}
            disabled={!editor.currentImageUrl}
            className="p-2 rounded-lg text-gray-500 hover:text-white hover:bg-white/[0.05] transition-all disabled:opacity-20 disabled:pointer-events-none"
            title="Download"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              if (!editor.canvasRef.current) return;
              editor.canvasRef.current.toBlob((blob) => {
                if (!blob) return;
                navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).then(() => {
                  showToast("Copied to clipboard ✓");
                }).catch(() => {
                  showToast("Copy not supported in this browser");
                });
              });
            }}
            disabled={!editor.currentImageUrl}
            className="p-2 rounded-lg text-gray-500 hover:text-white hover:bg-white/[0.05] transition-all disabled:opacity-20 disabled:pointer-events-none"
            title="Copy to Clipboard"
          >
            <Share2 className="w-4 h-4" />
          </button>

          <div className="w-px h-5 bg-white/[0.06] mx-1" />
          <div className="px-2 py-0.5 rounded-md bg-white/[0.03] border border-white/[0.05] text-[9px] text-gray-600 font-mono font-medium">v2.0</div>
        </div>
      </header>

      {/* ── Main Content ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        <aside className={`${sidebarOpen ? "w-[272px]" : "w-0"} flex-shrink-0 border-r border-white/[0.04] bg-[#0a0a12]/95 backdrop-blur-xl flex flex-col h-full overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]`}>
          {sidebarOpen && (
            <ControlsPanel
              imageUrl={editor.imageUrl}
              selectedMask={editor.selectedMask}
              isGenerating={editor.isGenerating}
              history={editor.history}
              hoverLabel={editor.hoverLabel}
              isPerceptionReady={editor.isPerceptionReady}
              suggestions={suggestions}
              isLoadingSuggestions={isLoadingSuggestions}
              brandBrief={brandBrief}
              componentDetections={detections}
              onImageUpload={handleImageUpload}
              onStartOver={editor.handleStartOver}
              onHistoryItemClick={editor.handleHistoryItemClick}
              onQuickAction={handleQuickAction}
              onSuggestionClick={handleSuggestionClick}
            />
          )}
        </aside>

        {/* Sidebar toggle */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="flex-shrink-0 w-5 flex items-center justify-center border-r border-white/[0.04] bg-[#0a0a12] hover:bg-white/[0.02] transition-colors z-10 group"
        >
          {sidebarOpen ? (
            <ChevronLeft className="w-3 h-3 text-gray-700 group-hover:text-gray-400 transition-colors" />
          ) : (
            <ChevronRight className="w-3 h-3 text-gray-700 group-hover:text-gray-400 transition-colors" />
          )}
        </button>

        {/* Canvas Area — the main stage */}
        <main className="flex-1 flex flex-col overflow-hidden relative">
          {/* Status bar */}
          <div className="flex-shrink-0 px-4 py-1.5 border-b border-white/[0.04] bg-[#0a0a12]/80 backdrop-blur-sm">
            <StatusMessages error={editor.error} status={editor.status} />
          </div>

          {/* Canvas container */}
          <div className="flex-1 flex items-center justify-center p-6 overflow-auto relative">
            <div className="max-w-4xl w-full relative">
              {/* Canvas */}
              <div className="rounded-2xl border border-white/[0.05] bg-[#0c0c14] shadow-2xl shadow-black/40 overflow-hidden transition-all duration-300 hover:border-white/[0.07]">
                <EditorCanvas
                  currentImageUrl={editor.currentImageUrl}
                  canvasRef={editor.canvasRef}
                  maskCanvasRef={editor.maskCanvasRef}
                  drawCanvasRef={editor.drawCanvasRef}
                  selectedMask={editor.selectedMask}
                  isGenerating={editor.isGenerating}
                  drawingTool={editor.drawingTool}
                  drawingColor={editor.drawingColor}
                  brushSize={effectiveBrushSize}
                  hoverLabel={editor.hoverLabel}
                  isPerceptionReady={editor.isPerceptionReady}
                  isPerceptionLoading={editor.isPerceptionLoading}
                  onCanvasClick={editor.handleCanvasClick}
                  onCanvasHover={handleCanvasHover}
                  onCanvasHoverLeave={editor.handleCanvasHoverLeave}
                  onPointerDown={editor.handlePointerDown}
                  onPointerMove={editor.handlePointerMove}
                  onPointerUp={editor.handlePointerUp}
                />
              </div>

              {/* DEBUG PANEL — temporary */}
              <div className="mt-2 p-3 rounded-xl bg-black/80 border border-yellow-500/30 text-[10px] font-mono text-yellow-300 space-y-1">
                <div className="text-yellow-100 font-bold">🔧 DEBUG PANEL</div>
                <div>selectedMask: {editor.selectedMask ? `✅ ${editor.selectedMask.label} (${editor.selectedMask.canvas?.width}×${editor.selectedMask.canvas?.height})` : '❌ null'}</div>
                <div>isGenerating: {editor.isGenerating ? '🔴 true' : '🟢 false'}</div>
                <div>isPerceptionReady: {editor.isPerceptionReady ? '✅' : '❌'}</div>
                <div>pointerDebug: {editor.debugInfo}</div>
                <div>error: {editor.error || 'none'}</div>
                <div>status: {editor.status}</div>
              </div>

              {/* Bottom Toolbar — KREA.ai-style floating toolbar */}
              {editor.selectedMask && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 animate-slide-up">
                  <CanvasToolbar
                    activeTool={editor.drawingTool}
                    activeColor={editor.drawingColor}
                    brushSize={effectiveBrushSize}
                    editPrompt={editor.editPrompt}
                    isGenerating={editor.isGenerating}
                    hasScribble={editor.hasScribble()}
                    hasMask={!!editor.selectedMask}
                    onToolChange={editor.setDrawingTool}
                    onColorChange={editor.setDrawingColor}
                    onBrushSizeChange={setBrushSize}
                    onPromptChange={editor.setEditPrompt}
                    onGenerate={editor.handleGenerateEdit}
                    onClear={editor.handleClearDrawing}
                    onUndo={editor.handleClearDrawing}
                    onAddText={editor.addTextToCanvas}
                    onUploadGraphic={editor.addGraphicToCanvas}
                    onCaptureCamera={editor.addGraphicToCanvas}
                  />
                </div>
              )}

              {/* Bottom hint bar (before mask selection) */}
              {!editor.selectedMask && editor.currentImageUrl && (
                <div className="mt-3 flex items-center justify-center gap-5 text-[10px] text-gray-600 animate-fade-in">
                  {editor.isPerceptionReady && (
                    <>
                      <span className="flex items-center gap-1.5">
                        <kbd className="px-1.5 py-0.5 rounded-md bg-white/[0.03] border border-white/[0.06] text-gray-500 text-[9px] font-mono font-medium">Hover</kbd>
                        Detect parts
                      </span>
                      <span className="flex items-center gap-1.5">
                        <kbd className="px-1.5 py-0.5 rounded-md bg-white/[0.03] border border-white/[0.06] text-gray-500 text-[9px] font-mono font-medium">Click</kbd>
                        Select region
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Estimated generation time indicator */}
          {editor.selectedMask && !editor.isGenerating && (
            <div className="absolute bottom-24 right-6 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#0e0e18]/90 backdrop-blur-xl border border-white/[0.06] text-[10px] text-gray-500 animate-fade-in">
              <Clock className="w-3 h-3" />
              <span>Est. ~30s generation</span>
              <span className="text-gray-700">·</span>
              <span className="text-indigo-400 font-medium flex items-center gap-1">
                <Zap className="w-3 h-3" />
                FLUX.1 Fill Dev
              </span>
            </div>
          )}
        </main>
      </div>

      {/* ── Toast Notification ── */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] animate-slide-up">
          <div className="px-4 py-2.5 rounded-xl bg-[#12121e]/95 backdrop-blur-xl border border-white/[0.08] shadow-2xl shadow-black/50 text-sm text-white font-medium">
            {toastMessage}
          </div>
        </div>
      )}

      {/* ── Brand Brief Modal Overlay ── */}
      {showBriefModal && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => setShowBriefModal(false)}>
          <div className="w-full max-w-2xl max-h-[80vh] overflow-auto bg-[#0c0c14] border border-white/[0.06] rounded-2xl shadow-2xl animate-fade-in-scale" onClick={(e) => e.stopPropagation()}>
            <BrandBriefWizard
              onComplete={handleBriefComplete}
              onSkip={() => setShowBriefModal(false)}
              isModal
            />
          </div>
        </div>
      )}
    </div>
  );
}
