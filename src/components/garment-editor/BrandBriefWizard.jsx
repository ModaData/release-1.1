// File: components/garment-editor/BrandBriefWizard.jsx — MODA DATA Brand Brief + Fabric Picker
"use client";

import { useState, useMemo } from "react";
import {
  Sparkles, ChevronRight, ChevronLeft, X, Check,
  Shirt, Palette, Calendar, FileText, Layers, Info,
  AlertTriangle, BookOpen, Ruler, Droplets, Sun, Wind,
  SlidersHorizontal
} from "lucide-react";
import {
  FIBER_CATALOG,
  CONSTRUCTION_CATALOG,
  getFiber,
  getConstruction,
  getVisualDescriptors,
  getHandDescriptors,
  generateFabricPromptFragment,
  getFabricSummary,
  validateFabricConstraints,
  getWeightDescriptor,
  getDrapeDescriptor,
} from "@/lib/fabric-db";

// ─── Season Options ───────────────────────────────────
const SEASONS = [
  { id: "ss", label: "Spring/Summer", icon: "☀️", desc: "Lightweight, breathable, vibrant" },
  { id: "aw", label: "Autumn/Winter", icon: "❄️", desc: "Heavier weight, layering, warm tones" },
  { id: "resort", label: "Resort/Cruise", icon: "🌊", desc: "Relaxed luxury, resort wear" },
  { id: "prefall", label: "Pre-Fall", icon: "🍂", desc: "Transitional, versatile" },
];

// ─── Silhouette Options ───────────────────────────────
const SILHOUETTES = [
  { id: "fitted", label: "Fitted", desc: "Body-conscious, follows contours" },
  { id: "structured", label: "Structured", desc: "Tailored, architectural, holds shape" },
  { id: "oversized", label: "Oversized", desc: "Relaxed, voluminous, modern" },
  { id: "draped_fluid", label: "Draped / Fluid", desc: "Soft, flowing, movement" },
];

// ─── Price Tier ────────────────────────────────────────
const PRICE_TIERS = [
  { id: "budget", label: "Budget", range: "<$30", desc: "Mass market" },
  { id: "mid", label: "Mid-Range", range: "$30–$100", desc: "Contemporary" },
  { id: "premium", label: "Premium", range: "$100–$300", desc: "Advanced contemporary" },
  { id: "luxury", label: "Luxury", range: "$300+", desc: "Designer / couture" },
];

// ─── Default Color Palette ─────────────────────────────
const DEFAULT_COLORS = [
  "#1a1a2e", "#16213e", "#0f3460", "#e94560",
  "#f5f5dc", "#d4a373", "#8b5e3c", "#2d6a4f",
  "#264653", "#e76f51", "#f4a261", "#2a9d8f",
];

// ─── Wizard Steps ──────────────────────────────────────
const STEPS = [
  { id: "brief", label: "Brand Brief", icon: FileText },
  { id: "fabric", label: "Fabric", icon: Layers },
  { id: "details", label: "Details", icon: SlidersHorizontal },
  { id: "review", label: "Review", icon: Check },
];

export function BrandBriefWizard({ onComplete, onSkip, isModal = false }) {
  const [step, setStep] = useState(0);

  // Brief state
  const [brief, setBrief] = useState("");
  const [season, setSeason] = useState(null);
  const [silhouette, setSilhouette] = useState(null);
  const [priceTier, setPriceTier] = useState(null);
  const [colorPalette, setColorPalette] = useState([]);

  // Fabric state
  const [selectedFiber, setSelectedFiber] = useState(null);
  const [selectedConstruction, setSelectedConstruction] = useState(null);
  const [gsm, setGsm] = useState(200);

  // Derived: constraints
  const violations = useMemo(() => {
    if (!selectedFiber) return [];
    return validateFabricConstraints(
      { fiberId: selectedFiber, constructionId: selectedConstruction, gsm },
      { silhouette, priceRange: priceTier }
    );
  }, [selectedFiber, selectedConstruction, gsm, silhouette, priceTier]);

  // Derived: visual descriptors for selected fiber
  const visualDescriptors = useMemo(() => {
    return selectedFiber ? getVisualDescriptors(selectedFiber) : [];
  }, [selectedFiber]);

  const handDescriptors = useMemo(() => {
    return selectedFiber ? getHandDescriptors(selectedFiber) : [];
  }, [selectedFiber]);

  // Derived: prompt preview
  const fabricPromptFragment = useMemo(() => {
    return generateFabricPromptFragment({
      fiberId: selectedFiber,
      constructionId: selectedConstruction,
      gsm,
    });
  }, [selectedFiber, selectedConstruction, gsm]);

  const fabricSummary = useMemo(() => {
    return getFabricSummary({
      fiberId: selectedFiber,
      constructionId: selectedConstruction,
      gsm,
    });
  }, [selectedFiber, selectedConstruction, gsm]);

  // Navigation
  const canNext = step < STEPS.length - 1;
  const canPrev = step > 0;
  const goNext = () => canNext && setStep(step + 1);
  const goPrev = () => canPrev && setStep(step - 1);

  // Completion
  const handleComplete = () => {
    const fiber = selectedFiber ? getFiber(selectedFiber) : null;
    const construction = selectedConstruction ? getConstruction(selectedConstruction) : null;

    onComplete({
      brief,
      season: season ? SEASONS.find((s) => s.id === season) : null,
      silhouette: silhouette ? SILHOUETTES.find((s) => s.id === silhouette) : null,
      priceTier: priceTier ? PRICE_TIERS.find((p) => p.id === priceTier) : null,
      colorPalette,
      // Legacy fabric field for backward compat
      fabric: fiber ? {
        label: fiber.name + (construction ? ` ${construction.name}` : ""),
        weight: `${gsm}gsm`,
        color: FIBER_CATALOG.find((f) => f.id === selectedFiber)?.gradient || "from-gray-500/30 to-gray-700/20",
      } : null,
      // Rich fabric context for FLUX prompt generation
      fabricContext: selectedFiber ? {
        fiberId: selectedFiber,
        constructionId: selectedConstruction,
        gsm,
        promptFragment: fabricPromptFragment,
        summary: fabricSummary,
        fiberData: fiber,
        constructionData: construction,
      } : null,
    });
  };

  // GSM range from construction or fiber defaults
  const gsmRange = useMemo(() => {
    if (selectedConstruction) {
      const c = getConstruction(selectedConstruction);
      return { min: c?.gsm_range?.min || 60, max: c?.gsm_range?.max || 500 };
    }
    return { min: 60, max: 500 };
  }, [selectedConstruction]);

  return (
    <div className={`${isModal ? "" : "min-h-screen flex items-center justify-center bg-[#08080d]"}`}>
      <div className={`w-full ${isModal ? "" : "max-w-2xl mx-auto px-4 py-8"}`}>
        {/* Header */}
        <div className="text-center mb-6 px-4 pt-4">
          <div className="inline-flex items-center gap-2.5 mb-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-lg font-bold text-white tracking-tight">Brand Brief</h1>
          </div>
          <p className="text-[11px] text-gray-500 max-w-md mx-auto leading-relaxed">
            Set your design context — fabric, season, and aesthetic. This guides AI-powered edits with physically-accurate fabric behavior.
          </p>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center justify-center gap-1 mb-6 px-4">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const isActive = i === step;
            const isDone = i < step;
            return (
              <button
                key={s.id}
                onClick={() => setStep(i)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-all duration-200 ${
                  isActive
                    ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                    : isDone
                    ? "bg-emerald-500/8 text-emerald-400/70 border border-emerald-500/15"
                    : "text-gray-600 border border-transparent hover:text-gray-400"
                }`}
              >
                <Icon className="w-3 h-3" />
                {s.label}
              </button>
            );
          })}
        </div>

        {/* Step Content */}
        <div className="px-4 pb-4 min-h-[360px]">
          {/* ── STEP 0: Brand Brief ── */}
          {step === 0 && (
            <div className="space-y-5 animate-fade-in">
              {/* Free-text brief */}
              <div>
                <label className="block text-[11px] text-gray-400 font-medium mb-2">Design Brief (optional)</label>
                <textarea
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  placeholder="e.g. Modern minimalist menswear brand targeting 25-35 urban professionals. Clean lines, muted tones, premium materials..."
                  rows={3}
                  className="w-full bg-white/[0.02] border border-white/[0.06] rounded-xl px-3 py-2.5 text-sm text-gray-300 placeholder:text-gray-700 focus:outline-none focus:border-indigo-500/30 focus:ring-1 focus:ring-indigo-500/10 transition-all resize-none"
                />
              </div>

              {/* Season */}
              <div>
                <label className="block text-[11px] text-gray-400 font-medium mb-2">Season</label>
                <div className="grid grid-cols-2 gap-2">
                  {SEASONS.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSeason(season === s.id ? null : s.id)}
                      className={`px-3 py-2.5 rounded-xl text-left transition-all duration-200 border ${
                        season === s.id
                          ? "bg-indigo-500/8 border-indigo-500/25 text-indigo-300"
                          : "bg-white/[0.01] border-white/[0.05] text-gray-400 hover:border-white/[0.1] hover:bg-white/[0.02]"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm">{s.icon}</span>
                        <span className="text-[11px] font-semibold">{s.label}</span>
                      </div>
                      <div className="text-[9px] text-gray-600">{s.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Silhouette */}
              <div>
                <label className="block text-[11px] text-gray-400 font-medium mb-2">Silhouette Intent</label>
                <div className="grid grid-cols-2 gap-2">
                  {SILHOUETTES.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSilhouette(silhouette === s.id ? null : s.id)}
                      className={`px-3 py-2.5 rounded-xl text-left transition-all duration-200 border ${
                        silhouette === s.id
                          ? "bg-indigo-500/8 border-indigo-500/25 text-indigo-300"
                          : "bg-white/[0.01] border-white/[0.05] text-gray-400 hover:border-white/[0.1] hover:bg-white/[0.02]"
                      }`}
                    >
                      <span className="text-[11px] font-semibold">{s.label}</span>
                      <div className="text-[9px] text-gray-600 mt-0.5">{s.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Price Tier */}
              <div>
                <label className="block text-[11px] text-gray-400 font-medium mb-2">Price Tier</label>
                <div className="flex gap-2">
                  {PRICE_TIERS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPriceTier(priceTier === p.id ? null : p.id)}
                      className={`flex-1 px-2 py-2 rounded-xl text-center transition-all duration-200 border ${
                        priceTier === p.id
                          ? "bg-indigo-500/8 border-indigo-500/25 text-indigo-300"
                          : "bg-white/[0.01] border-white/[0.05] text-gray-400 hover:border-white/[0.1] hover:bg-white/[0.02]"
                      }`}
                    >
                      <div className="text-[11px] font-semibold">{p.label}</div>
                      <div className="text-[9px] text-gray-600">{p.range}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 1: Fabric Selection ── */}
          {step === 1 && (
            <div className="space-y-5 animate-fade-in">
              {/* Fiber Picker */}
              <div>
                <label className="block text-[11px] text-gray-400 font-medium mb-2">Fiber / Material</label>
                <div className="grid grid-cols-3 gap-2">
                  {FIBER_CATALOG.map((fiber) => (
                    <button
                      key={fiber.id}
                      onClick={() => setSelectedFiber(selectedFiber === fiber.id ? null : fiber.id)}
                      className={`relative px-3 py-3 rounded-xl text-left transition-all duration-200 border overflow-hidden group ${
                        selectedFiber === fiber.id
                          ? "border-indigo-500/30 ring-1 ring-indigo-500/15"
                          : "border-white/[0.05] hover:border-white/[0.12] hover:bg-white/[0.02]"
                      }`}
                    >
                      {/* Gradient swatch background */}
                      <div className={`absolute inset-0 bg-gradient-to-br ${fiber.gradient} opacity-60 group-hover:opacity-80 transition-opacity`} />
                      <div className="relative z-10">
                        <div className="text-[11px] font-bold text-gray-200 mb-0.5">{fiber.name}</div>
                        <div className="text-[9px] text-gray-500 capitalize">{fiber.category.replace(/_/g, " ")}</div>
                        {/* Hand descriptors preview */}
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {(fiber.handDescriptors || []).slice(0, 2).map((d, i) => (
                            <span key={i} className="px-1.5 py-0.5 rounded-md bg-black/30 text-[8px] text-gray-400 font-medium">{d}</span>
                          ))}
                        </div>
                      </div>
                      {/* Selected check */}
                      {selectedFiber === fiber.id && (
                        <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-indigo-500 flex items-center justify-center">
                          <Check className="w-2.5 h-2.5 text-white" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Construction Picker */}
              <div>
                <label className="block text-[11px] text-gray-400 font-medium mb-2">Construction Method</label>
                <div className="grid grid-cols-2 gap-2">
                  {CONSTRUCTION_CATALOG.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setSelectedConstruction(selectedConstruction === c.id ? null : c.id)}
                      className={`px-3 py-2.5 rounded-xl text-left transition-all duration-200 border ${
                        selectedConstruction === c.id
                          ? "bg-indigo-500/8 border-indigo-500/25 text-indigo-300"
                          : "bg-white/[0.01] border-white/[0.05] text-gray-400 hover:border-white/[0.1] hover:bg-white/[0.02]"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[11px] font-semibold">{c.name}</span>
                        <span className="text-[8px] text-gray-600 font-mono capitalize">{c.category}</span>
                      </div>
                      <div className="text-[9px] text-gray-600 line-clamp-1">{c.surface}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[8px] text-gray-600 font-mono">{c.gsmRange?.min}–{c.gsmRange?.max} gsm</span>
                        {c.costTier && (
                          <span className="text-[8px] text-gray-600">· {c.costTier}</span>
                        )}
                      </div>
                      {selectedConstruction === c.id && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {(c.typicalGarments || []).slice(0, 3).map((g, i) => (
                            <span key={i} className="px-1.5 py-0.5 rounded-md bg-indigo-500/10 text-[8px] text-indigo-400/70 font-medium">{g}</span>
                          ))}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* GSM Slider */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] text-gray-400 font-medium">Fabric Weight (GSM)</label>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-indigo-400 font-mono">{gsm} gsm</span>
                    <span className="px-1.5 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06] text-[9px] text-gray-500 font-medium">
                      {getWeightDescriptor(gsm)}
                    </span>
                  </div>
                </div>
                <input
                  type="range"
                  min={gsmRange.min}
                  max={gsmRange.max}
                  value={gsm}
                  onChange={(e) => setGsm(Number(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none bg-white/[0.06] accent-indigo-500 cursor-pointer"
                />
                <div className="flex justify-between mt-1 text-[9px] text-gray-700 font-mono">
                  <span>{gsmRange.min}</span>
                  <span>{gsmRange.max}</span>
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 2: Details & Visual Feedback ── */}
          {step === 2 && (
            <div className="space-y-5 animate-fade-in">
              {/* Color Palette Picker */}
              <div>
                <label className="block text-[11px] text-gray-400 font-medium mb-2">Brand Color Palette</label>
                <div className="flex flex-wrap gap-2">
                  {DEFAULT_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => {
                        setColorPalette((prev) =>
                          prev.includes(color)
                            ? prev.filter((c) => c !== color)
                            : prev.length < 6 ? [...prev, color] : prev
                        );
                      }}
                      className={`w-8 h-8 rounded-lg border-2 transition-all duration-200 hover:scale-110 ${
                        colorPalette.includes(color)
                          ? "border-white ring-1 ring-white/20 scale-110"
                          : "border-transparent hover:border-white/20"
                      }`}
                      style={{ background: color }}
                    />
                  ))}
                </div>
                {colorPalette.length > 0 && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="text-[9px] text-gray-600">Selected:</span>
                    {colorPalette.map((c, i) => (
                      <div key={i} className="w-5 h-5 rounded-md border border-white/10" style={{ background: c }} />
                    ))}
                  </div>
                )}
              </div>

              {/* Visual Descriptors (from Fabric DB) */}
              {selectedFiber && visualDescriptors.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <BookOpen className="w-3 h-3 text-gray-500" />
                    <label className="text-[11px] text-gray-400 font-medium">Fabric Visual Descriptors</label>
                  </div>
                  <div className="space-y-1.5">
                    {visualDescriptors.map((desc) => (
                      <div key={desc.key} className="flex items-start gap-2.5 px-3 py-2 rounded-xl bg-white/[0.015] border border-white/[0.04]">
                        <div className="flex-shrink-0 mt-0.5">
                          {desc.key === "surface" && <Layers className="w-3 h-3 text-amber-400/60" />}
                          {desc.key === "foldCharacter" && <Shirt className="w-3 h-3 text-blue-400/60" />}
                          {desc.key === "lightBehavior" && <Sun className="w-3 h-3 text-yellow-400/60" />}
                          {desc.key === "transparency" && <Droplets className="w-3 h-3 text-cyan-400/60" />}
                          {desc.key === "wrinklePattern" && <Wind className="w-3 h-3 text-purple-400/60" />}
                          {desc.key === "movement" && <Wind className="w-3 h-3 text-emerald-400/60" />}
                          {desc.key === "edgeBehavior" && <Ruler className="w-3 h-3 text-red-400/60" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] text-gray-500 font-medium uppercase tracking-wide">{desc.label}</div>
                          <div className="text-[11px] text-gray-300 leading-relaxed">{desc.value}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Hand Descriptors */}
              {handDescriptors.length > 0 && (
                <div>
                  <label className="block text-[11px] text-gray-400 font-medium mb-2">Hand Feel</label>
                  <div className="flex flex-wrap gap-1.5">
                    {handDescriptors.map((d, i) => (
                      <span key={i} className="px-2.5 py-1 rounded-lg bg-indigo-500/6 border border-indigo-500/12 text-[10px] text-indigo-400/80 font-medium">
                        {d}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Constraint Violations */}
              {violations.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <AlertTriangle className="w-3 h-3 text-amber-400" />
                    <label className="text-[11px] text-amber-400 font-medium">Compatibility Warnings</label>
                  </div>
                  <div className="space-y-1.5">
                    {violations.map((v, i) => (
                      <div
                        key={i}
                        className={`px-3 py-2 rounded-xl border text-[10px] leading-relaxed ${
                          v.severity === "error"
                            ? "bg-red-500/6 border-red-500/20 text-red-400/90"
                            : "bg-amber-500/6 border-amber-500/20 text-amber-400/90"
                        }`}
                      >
                        <div className="font-semibold mb-0.5">{v.ruleId}</div>
                        <div>{v.message}</div>
                        <div className="text-[9px] mt-1 opacity-60">Source: {v.source}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* FLUX Prompt Preview */}
              {fabricPromptFragment && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Sparkles className="w-3 h-3 text-purple-400" />
                    <label className="text-[11px] text-gray-400 font-medium">FLUX Prompt Preview</label>
                  </div>
                  <div className="px-3 py-2.5 rounded-xl bg-purple-500/5 border border-purple-500/15 text-[11px] text-purple-300/80 leading-relaxed font-mono">
                    &quot;{fabricPromptFragment}&quot;
                  </div>
                  <p className="text-[9px] text-gray-600 mt-1.5 leading-relaxed">
                    This fabric context will be automatically injected into every FLUX inpainting prompt, ensuring physically-accurate texture, drape, and light behavior.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 3: Review ── */}
          {step === 3 && (
            <div className="space-y-4 animate-fade-in">
              <div className="text-center mb-4">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/8 border border-emerald-500/15 text-[11px] text-emerald-400 font-medium">
                  <Check className="w-3.5 h-3.5" />
                  Ready to apply
                </div>
              </div>

              {/* Summary Cards */}
              <div className="space-y-2">
                {/* Brief */}
                {brief && (
                  <div className="px-3 py-2.5 rounded-xl bg-white/[0.015] border border-white/[0.04]">
                    <div className="text-[9px] text-gray-600 font-medium uppercase tracking-wide mb-1">Brand Brief</div>
                    <div className="text-[11px] text-gray-300 leading-relaxed">{brief}</div>
                  </div>
                )}

                {/* Season & Silhouette */}
                <div className="grid grid-cols-2 gap-2">
                  {season && (
                    <div className="px-3 py-2.5 rounded-xl bg-white/[0.015] border border-white/[0.04]">
                      <div className="text-[9px] text-gray-600 font-medium uppercase tracking-wide mb-1">Season</div>
                      <div className="text-[11px] text-gray-300 font-medium">{SEASONS.find((s) => s.id === season)?.label}</div>
                    </div>
                  )}
                  {silhouette && (
                    <div className="px-3 py-2.5 rounded-xl bg-white/[0.015] border border-white/[0.04]">
                      <div className="text-[9px] text-gray-600 font-medium uppercase tracking-wide mb-1">Silhouette</div>
                      <div className="text-[11px] text-gray-300 font-medium">{SILHOUETTES.find((s) => s.id === silhouette)?.label}</div>
                    </div>
                  )}
                </div>

                {/* Fabric Summary */}
                {fabricSummary && (
                  <div className="px-3 py-2.5 rounded-xl bg-indigo-500/5 border border-indigo-500/15">
                    <div className="text-[9px] text-indigo-400/60 font-medium uppercase tracking-wide mb-1">Fabric</div>
                    <div className="text-[11px] text-indigo-300 font-semibold">{fabricSummary}</div>
                  </div>
                )}

                {/* Price Tier */}
                {priceTier && (
                  <div className="px-3 py-2.5 rounded-xl bg-white/[0.015] border border-white/[0.04]">
                    <div className="text-[9px] text-gray-600 font-medium uppercase tracking-wide mb-1">Price Tier</div>
                    <div className="text-[11px] text-gray-300 font-medium">
                      {PRICE_TIERS.find((p) => p.id === priceTier)?.label} ({PRICE_TIERS.find((p) => p.id === priceTier)?.range})
                    </div>
                  </div>
                )}

                {/* Color Palette */}
                {colorPalette.length > 0 && (
                  <div className="px-3 py-2.5 rounded-xl bg-white/[0.015] border border-white/[0.04]">
                    <div className="text-[9px] text-gray-600 font-medium uppercase tracking-wide mb-1.5">Color Palette</div>
                    <div className="flex gap-1.5">
                      {colorPalette.map((c, i) => (
                        <div key={i} className="w-6 h-6 rounded-lg border border-white/10" style={{ background: c }} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Prompt Preview */}
                {fabricPromptFragment && (
                  <div className="px-3 py-2.5 rounded-xl bg-purple-500/5 border border-purple-500/15">
                    <div className="text-[9px] text-purple-400/60 font-medium uppercase tracking-wide mb-1">AI Fabric Context</div>
                    <div className="text-[10px] text-purple-300/70 font-mono leading-relaxed">{fabricPromptFragment}</div>
                  </div>
                )}

                {/* Violations */}
                {violations.length > 0 && (
                  <div className="px-3 py-2.5 rounded-xl bg-amber-500/5 border border-amber-500/15">
                    <div className="text-[9px] text-amber-400/60 font-medium uppercase tracking-wide mb-1">
                      ⚠ {violations.length} constraint warning{violations.length > 1 ? "s" : ""}
                    </div>
                    {violations.map((v, i) => (
                      <div key={i} className="text-[10px] text-amber-400/70 leading-relaxed">• {v.message}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.04]">
          <button
            onClick={onSkip}
            className="text-[11px] text-gray-600 hover:text-gray-400 transition-colors font-medium"
          >
            {isModal ? "Cancel" : "Skip for now"}
          </button>

          <div className="flex items-center gap-2">
            {canPrev && (
              <button
                onClick={goPrev}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-medium text-gray-400 hover:text-white bg-white/[0.02] border border-white/[0.06] hover:border-white/[0.1] transition-all"
              >
                <ChevronLeft className="w-3 h-3" />
                Back
              </button>
            )}
            {canNext ? (
              <button
                onClick={goNext}
                className="flex items-center gap-1 px-4 py-1.5 rounded-lg text-[11px] font-semibold text-white bg-indigo-500/80 hover:bg-indigo-500 border border-indigo-500/30 transition-all shadow-lg shadow-indigo-500/10"
              >
                Next
                <ChevronRight className="w-3 h-3" />
              </button>
            ) : (
              <button
                onClick={handleComplete}
                className="flex items-center gap-1.5 px-5 py-2 rounded-lg text-[11px] font-bold text-white bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-400 hover:to-purple-400 border border-indigo-500/30 transition-all shadow-lg shadow-indigo-500/20"
              >
                <Check className="w-3.5 h-3.5" />
                Apply Brand Brief
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
