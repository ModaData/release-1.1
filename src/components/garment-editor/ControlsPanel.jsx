// File: components/garment-editor/ControlsPanel.jsx — MODA DATA Enterprise Sidebar
"use client";

import { useState } from "react";
import { Sparkles, Upload, RotateCcw, ScanSearch, ChevronDown, ChevronUp, FolderOpen } from "lucide-react";
import { QuickActions } from "./QuickActions";

export function ControlsPanel({
  imageUrl,
  selectedMask,
  isGenerating,
  history,
  hoverLabel,
  isPerceptionReady,
  suggestions,
  isLoadingSuggestions,
  brandBrief,
  componentDetections,
  onImageUpload,
  onStartOver,
  onHistoryItemClick,
  onQuickAction,
  onSuggestionClick,
}) {
  const [expandedSections, setExpandedSections] = useState({
    detections: true,
    suggestions: true,
    quickActions: true,
    context: false,
    history: false,
  });

  const toggleSection = (key) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const SectionHeader = ({ label, sectionKey, icon: Icon, badge }) => (
    <button
      onClick={() => toggleSection(sectionKey)}
      className="w-full flex items-center justify-between py-1.5 group"
    >
      <div className="flex items-center gap-1.5 section-label mb-0">
        {Icon && <Icon className="w-3 h-3 text-gray-600 group-hover:text-gray-400 transition-colors" />}
        <span className="group-hover:text-gray-400 transition-colors">{label}</span>
        {badge && (
          <span className="ml-1 px-1.5 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-[8px] text-gray-500 font-mono">
            {badge}
          </span>
        )}
      </div>
      {expandedSections[sectionKey] ? (
        <ChevronUp className="w-3 h-3 text-gray-700 group-hover:text-gray-500 transition-colors" />
      ) : (
        <ChevronDown className="w-3 h-3 text-gray-700 group-hover:text-gray-500 transition-colors" />
      )}
    </button>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {!imageUrl ? (
          /* ── Upload Zone ── */
          <div className="animate-fade-in">
            <div className="section-label">Get Started</div>
            <label className="group block border border-dashed border-white/[0.06] rounded-2xl p-8 text-center cursor-pointer hover:border-indigo-500/40 hover:bg-indigo-500/[0.03] transition-all duration-300">
              <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-indigo-500/15 to-purple-500/15 border border-indigo-500/10 flex items-center justify-center group-hover:scale-105 transition-transform duration-300">
                <Upload className="w-5 h-5 text-indigo-400" />
              </div>
              <div className="text-sm font-semibold text-gray-300 mb-1">Upload Garment</div>
              <div className="text-[11px] text-gray-600">PNG, JPG, or WebP · Drag & drop</div>
              <div className="mt-3 text-[10px] text-gray-700">AI will automatically detect garment parts</div>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onImageUpload(file);
                  e.target.value = "";
                }}
              />
            </label>

            {/* Quick workflow steps */}
            <div className="mt-5 space-y-2">
              <div className="section-label">How it works</div>
              {[
                { num: "1", text: "Upload a garment image", active: true },
                { num: "2", text: "Hover to detect, click to select", active: false },
                { num: "3", text: "Draw + prompt → AI generates", active: false },
              ].map((step) => (
                <div key={step.num} className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-all ${
                  step.active ? "bg-white/[0.02] border border-white/[0.05]" : ""
                }`}>
                  <span className={`flex-shrink-0 w-5 h-5 rounded-full text-[9px] font-bold flex items-center justify-center ${
                    step.active
                      ? "bg-indigo-500/15 text-indigo-400 border border-indigo-500/20"
                      : "bg-white/[0.03] text-gray-700 border border-white/[0.05]"
                  }`}>
                    {step.num}
                  </span>
                  <span className={`text-[11px] ${step.active ? "text-gray-300 font-medium" : "text-gray-600"}`}>
                    {step.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* ── Editing Controls ── */
          <div className="space-y-3 animate-fade-in">
            {/* Detected Part */}
            {hoverLabel && !selectedMask && (
              <div className="animate-fade-in-scale">
                <div className="section-label">Detected Part</div>
                <div className="px-3 py-2.5 rounded-xl bg-indigo-500/[0.06] border border-indigo-500/15 flex items-center gap-2.5">
                  <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                  <span className="text-xs font-semibold text-indigo-300">{hoverLabel}</span>
                  <span className="text-[9px] text-indigo-500/50 ml-auto font-medium">Click to select</span>
                </div>
              </div>
            )}

            {/* Selected Region */}
            {selectedMask && (
              <div className="animate-fade-in-scale">
                <div className="section-label">Selected Region</div>
                <div className="px-3 py-2.5 rounded-xl bg-blue-500/[0.06] border border-blue-500/15 flex items-center gap-2.5">
                  <div className="w-2 h-2 rounded-full bg-blue-400" />
                  <span className="text-xs font-semibold text-blue-300">{selectedMask.label}</span>
                  <span className="text-[9px] text-blue-400/40 ml-auto font-mono">Active</span>
                </div>
              </div>
            )}

            {/* Smart AI Suggestions */}
            {(suggestions?.length > 0 || isLoadingSuggestions) && (
              <div>
                <SectionHeader label="AI Suggestions" sectionKey="suggestions" icon={Sparkles} badge={suggestions?.length || "..."} />
                {expandedSections.suggestions && (
                  <div className="animate-fade-in">
                    {isLoadingSuggestions ? (
                      <div className="flex items-center gap-2 px-3 py-2.5 text-[10px] text-gray-500">
                        <div className="w-3 h-3 border border-indigo-400/30 border-t-indigo-400 rounded-full animate-gentle-spin" />
                        Generating suggestions...
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {suggestions.map((s, i) => (
                          <button
                            key={i}
                            onClick={() => onSuggestionClick?.(s)}
                            className="w-full text-left px-3 py-2 rounded-xl text-[11px] text-gray-400 
                                     hover:bg-indigo-500/[0.06] hover:text-indigo-300 border border-transparent
                                     hover:border-indigo-500/15 transition-all duration-200 flex items-center gap-2"
                          >
                            <Sparkles className="w-3 h-3 flex-shrink-0 text-indigo-500/40" />
                            <span className="leading-relaxed">{s}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Quick Actions */}
            <QuickActions
              hoveredPart={hoverLabel}
              selectedMask={selectedMask}
              onActionSelect={onQuickAction}
            />

            {/* Detected Components */}
            {componentDetections?.length > 0 && (
              <div>
                <SectionHeader label="Detected Components" sectionKey="detections" icon={ScanSearch} badge={componentDetections.length} />
                {expandedSections.detections && (
                  <div className="space-y-0.5 animate-fade-in">
                    {componentDetections.slice(0, 8).map((det, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-white/[0.01] border border-white/[0.03] hover:border-cyan-500/20 hover:bg-cyan-500/[0.03] transition-all duration-200 cursor-pointer group"
                        onClick={() => onQuickAction?.(`Redesign the ${det.label}`)}
                      >
                        <div className="w-1.5 h-1.5 rounded-full bg-cyan-400/50 group-hover:bg-cyan-400 transition-colors" />
                        <span className="text-[11px] text-gray-400 flex-1 truncate group-hover:text-gray-300 transition-colors">{det.label}</span>
                        <span className="text-[9px] text-gray-700 font-mono">{Math.round(det.confidence * 100)}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Workflow Steps (when idle) */}
            {!selectedMask && !hoverLabel && (
              <div>
                <div className="section-label">Workflow</div>
                <div className="space-y-1">
                  {[
                    { num: 1, text: "Hover to detect garment parts", active: isPerceptionReady },
                    { num: 2, text: "Click to select a region", active: false },
                    { num: 3, text: "Draw + prompt → Generate", active: false },
                  ].map((step) => (
                    <div key={step.num} className={`flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all ${
                      step.active ? "bg-white/[0.02] border border-white/[0.05]" : ""
                    }`}>
                      <span className={`flex-shrink-0 w-5 h-5 rounded-full text-[9px] font-bold flex items-center justify-center ${
                        step.active
                          ? "bg-indigo-500/15 text-indigo-400 border border-indigo-500/20"
                          : "bg-white/[0.03] text-gray-700 border border-white/[0.05]"
                      }`}>
                        {step.num}
                      </span>
                      <span className={`text-[11px] ${step.active ? "text-gray-300 font-medium" : "text-gray-600"}`}>
                        {step.text}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Design Context from Brand Brief */}
            {brandBrief && (
              <div>
                <SectionHeader label="Design Context" sectionKey="context" icon={FolderOpen} />
                {expandedSections.context && (
                  <div className="space-y-1.5 animate-fade-in">
                    {brandBrief.fabric && (
                      <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/[0.01] border border-white/[0.04]">
                        <div className={`w-5 h-5 rounded-lg bg-gradient-to-br ${brandBrief.fabric.color}`} />
                        <span className="text-[11px] text-gray-400 font-medium">{brandBrief.fabric.label}</span>
                        <span className="text-[9px] text-gray-600 ml-auto font-mono">{brandBrief.fabric.weight}</span>
                      </div>
                    )}
                    {brandBrief.season && (
                      <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/[0.01] border border-white/[0.04]">
                        <span className="text-[11px] text-gray-400 font-medium">{brandBrief.season.label}</span>
                      </div>
                    )}
                    {brandBrief.silhouette && (
                      <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/[0.01] border border-white/[0.04]">
                        <span className="text-[11px] text-gray-400 font-medium">{brandBrief.silhouette.label} silhouette</span>
                      </div>
                    )}
                    {brandBrief.fabricContext?.summary && (
                      <div className="px-3 py-2 rounded-xl bg-indigo-500/[0.04] border border-indigo-500/10">
                        <span className="text-[10px] text-indigo-400/70 font-medium">{brandBrief.fabricContext.summary}</span>
                      </div>
                    )}
                    {brandBrief.colorPalette?.length > 0 && (
                      <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.01] border border-white/[0.04]">
                        {brandBrief.colorPalette.map((c, i) => (
                          <div key={i} className="w-4 h-4 rounded-md border border-white/[0.08]" style={{ background: c }} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="pt-1">
              <button
                onClick={onStartOver}
                disabled={isGenerating}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-gray-500 hover:text-gray-300 bg-white/[0.02] border border-white/[0.04] hover:border-white/[0.08] hover:bg-white/[0.04] transition-all disabled:opacity-30 disabled:pointer-events-none"
              >
                <RotateCcw className="w-3 h-3" />
                Start Over
              </button>
            </div>

            {/* History */}
            {history.length > 1 && (
              <div>
                <SectionHeader label="History" sectionKey="history" badge={history.length} />
                {expandedSections.history && (
                  <div className="space-y-0.5 max-h-32 overflow-y-auto animate-fade-in">
                    {history.map((item, i) => (
                      <button
                        key={i}
                        onClick={() => onHistoryItemClick(item.imageUrl)}
                        className="w-full text-left px-3 py-2 rounded-xl text-[11px] text-gray-500 hover:bg-white/[0.03] hover:text-gray-300 transition-all flex items-center gap-2"
                      >
                        <span className="w-4 h-4 rounded-md bg-white/[0.03] border border-white/[0.05] text-[8px] flex items-center justify-center text-gray-600 font-mono font-medium">{i + 1}</span>
                        <span className="truncate">{item.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sidebar Footer */}
      <div className="flex-shrink-0 px-3 py-2.5 border-t border-white/[0.04]">
        <div className="flex items-center justify-between text-[9px] text-gray-600">
          <span className="font-semibold tracking-[0.15em] uppercase">MODA DATA</span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-emerald-500/70 font-medium">Online</span>
          </span>
        </div>
      </div>
    </div>
  );
}
