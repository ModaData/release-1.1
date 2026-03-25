// File: components/drawing-canvas/MeshOpsPanel.jsx
// Server-side mesh operation buttons + parameter controls
"use client";

import { useState } from "react";
import { useDrawingCanvas } from "@/hooks/useDrawingCanvas";
import { useMeshOperations } from "@/hooks/useMeshOperations";

const SIZE_OPTIONS = ["XS", "S", "M", "L", "XL", "XXL"];
const FABRIC_OPTIONS = ["cotton", "silk", "denim", "leather", "wool", "linen", "spandex", "velvet"];
const QUALITY_PRESETS = ["fast", "standard", "high"];
const PART_OPTIONS = ["collar", "sleeve", "cuff", "pocket", "hood", "placket", "waistband", "hem"];

const SEAM_PRESETS = [
  { label: "Side Seams",  indices: null, preset: "side_seams",  title: "Mark body side seams at 0°/180°" },
  { label: "Armhole",     indices: null, preset: "armhole",     title: "Mark sleeve/body boundary ring" },
  { label: "Shoulder",    indices: null, preset: "shoulder",    title: "Mark yoke/body shoulder seam" },
  { label: "Inseam",      indices: null, preset: "inseam",      title: "Mark pants inner leg seam" },
];

export default function MeshOpsPanel({ meshStats }) {
  const { state, dispatch } = useDrawingCanvas();
  const meshOps = useMeshOperations();

  const [autoFixQuality, setAutoFixQuality] = useState("standard");
  const [subdivLevels, setSubdivLevels] = useState(1);
  const [decimateTarget, setDecimateTarget] = useState(12000);
  const [smoothIter, setSmoothIter] = useState(2);
  const [retopoTarget, setRetopoTarget] = useState(12000);
  const [clothSize, setClothSize] = useState("M");
  const [clothQuality, setClothQuality] = useState("standard");
  const [clothFabric, setClothFabric] = useState("cotton");
  const [renderRes, setRenderRes] = useState(1024);
  const [turntableFrames, setTurntableFrames] = useState(36);
  const [turntableRes, setTurntableRes] = useState(512);

  // Edit Part state
  const [editPart, setEditPart] = useState("collar");
  const [editVariant, setEditVariant] = useState("");

  // Mesh Refinement state
  const [fabricType, setFabricType] = useState("cotton");
  const [thicknessMult, setThicknessMult] = useState(1.0);
  const [subdivMethod, setSubdivMethod] = useState("catmull_clark");
  const [creaseSeams, setCreaseSeams] = useState(true);
  const [fabricMode, setFabricMode] = useState(true);
  const [extrudeOffset, setExtrudeOffset] = useState(0.015);
  const [creaseExtrusion, setCreaseExtrusion] = useState(true);

  // Smart UV state
  const [garmentType, setGarmentType] = useState("shirt");
  const [maxIslands, setMaxIslands] = useState(8);
  const [stretchThreshold, setStretchThreshold] = useState(0.05);
  const [fabricWidth, setFabricWidth] = useState(1.5);
  const [grainDirection, setGrainDirection] = useState("warp");
  const [seamAllowance, setSeamAllowance] = useState(0.015);

  return (
    <div className="absolute top-14 right-4 z-30 w-64 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-[calc(100vh-120px)] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 bg-gray-50 border-b border-gray-100 sticky top-0">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085" />
          </svg>
          <h3 className="text-[12px] font-semibold text-gray-800">Mesh Operations</h3>
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

      <div className="p-3 space-y-3">
        {/* ── Current mesh stats ── */}
        {meshStats && (
          <div className="flex items-center gap-3 px-2 py-1.5 rounded-lg bg-gray-50 text-[10px] font-mono text-gray-500">
            <span>{meshStats.triangles?.toLocaleString()} tris</span>
            <span>{meshStats.vertices?.toLocaleString()} verts</span>
            <span>{meshStats.objects} obj</span>
          </div>
        )}

        {/* ── Progress bar ── */}
        {meshOps.isProcessing && (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 border-2 border-indigo-200 border-t-indigo-500 rounded-full animate-spin" />
              <span className="text-[10px] text-indigo-600 font-medium">
                {meshOps.currentOp}...
              </span>
            </div>
            <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 rounded-full animate-pulse" style={{ width: "60%" }} />
            </div>
          </div>
        )}

        {/* ── Auto Fix — prominent one-click pipeline ── */}
        <div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => meshOps.autoFix(autoFixQuality)}
              disabled={meshOps.isProcessing}
              className="flex-1 px-2.5 py-2 rounded-lg text-[11px] font-semibold bg-gradient-to-r from-emerald-500 to-green-600 text-white hover:from-emerald-600 hover:to-green-700 transition-colors disabled:opacity-40 shadow-sm"
            >
              Auto Fix (Repair + Remesh + Smooth)
            </button>
            <select
              value={autoFixQuality}
              onChange={(e) => setAutoFixQuality(e.target.value)}
              className="w-20 text-[10px] border border-gray-200 rounded-md px-1 py-1.5 outline-none"
            >
              <option value="fast">Fast</option>
              <option value="standard">Standard</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>

        {/* ── Geometry section ── */}
        <div>
          <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-2 block">
            Geometry
          </label>
          <div className="space-y-2">
            {/* Repair Mesh — fill holes, fix non-manifold */}
            <button
              onClick={() => meshOps.repairMesh()}
              disabled={meshOps.isProcessing}
              className="w-full px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors disabled:opacity-40"
            >
              Repair Mesh (fill holes, fix non-manifold)
            </button>

            {/* Subdivide */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => meshOps.subdivide(subdivLevels)}
                disabled={meshOps.isProcessing}
                className="flex-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-gray-100 text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 transition-colors disabled:opacity-40"
              >
                Subdivide
              </button>
              <select
                value={subdivLevels}
                onChange={(e) => setSubdivLevels(parseInt(e.target.value))}
                className="w-14 text-[10px] border border-gray-200 rounded-md px-1 py-1 outline-none"
              >
                <option value={1}>x1</option>
                <option value={2}>x2</option>
                <option value={3}>x3</option>
              </select>
            </div>

            {/* Decimate */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => meshOps.decimate(decimateTarget)}
                disabled={meshOps.isProcessing}
                className="flex-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-gray-100 text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 transition-colors disabled:opacity-40"
              >
                Decimate
              </button>
              <input
                type="number"
                value={decimateTarget}
                onChange={(e) => setDecimateTarget(parseInt(e.target.value) || 12000)}
                className="w-16 text-[10px] border border-gray-200 rounded-md px-1 py-1 outline-none text-center"
                min={100}
                max={100000}
                step={1000}
              />
            </div>

            {/* Smooth */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => meshOps.smooth(smoothIter)}
                disabled={meshOps.isProcessing}
                className="flex-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-gray-100 text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 transition-colors disabled:opacity-40"
              >
                Smooth
              </button>
              <select
                value={smoothIter}
                onChange={(e) => setSmoothIter(parseInt(e.target.value))}
                className="w-14 text-[10px] border border-gray-200 rounded-md px-1 py-1 outline-none"
              >
                <option value={1}>x1</option>
                <option value={2}>x2</option>
                <option value={3}>x3</option>
                <option value={5}>x5</option>
              </select>
            </div>

            {/* Retopologize */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => meshOps.retopologize(retopoTarget)}
                disabled={meshOps.isProcessing}
                className="flex-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-gray-100 text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 transition-colors disabled:opacity-40"
              >
                Retopologize
              </button>
              <input
                type="number"
                value={retopoTarget}
                onChange={(e) => setRetopoTarget(parseInt(e.target.value) || 12000)}
                className="w-16 text-[10px] border border-gray-200 rounded-md px-1 py-1 outline-none text-center"
                min={100}
                max={100000}
                step={1000}
              />
            </div>
          </div>
        </div>

        {/* ── Physics section ── */}
        <div>
          <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-2 block">
            Physics
          </label>
          <div className="space-y-2">
            {/* Cloth Simulation — fabric-adaptive quality */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => meshOps.clothSim(clothSize, clothQuality, clothFabric)}
                  disabled={meshOps.isProcessing}
                  className="flex-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-gray-100 text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 transition-colors disabled:opacity-40"
                >
                  Cloth Sim
                </button>
                <select
                  value={clothSize}
                  onChange={(e) => setClothSize(e.target.value)}
                  className="w-12 text-[10px] border border-gray-200 rounded-md px-1 py-1 outline-none"
                >
                  {SIZE_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <select
                  value={clothQuality}
                  onChange={(e) => setClothQuality(e.target.value)}
                  className="w-20 text-[10px] border border-gray-200 rounded-md px-1 py-1 outline-none"
                  title="Quality preset (affects steps + frame count)"
                >
                  {QUALITY_PRESETS.map((q) => (
                    <option key={q} value={q}>{q.charAt(0).toUpperCase() + q.slice(1)}</option>
                  ))}
                </select>
              </div>
              <select
                value={clothFabric}
                onChange={(e) => setClothFabric(e.target.value)}
                className="w-full text-[10px] border border-gray-200 rounded-md px-2 py-1 outline-none text-gray-600"
                title="Fabric drives mass, tension stiffness and frame count automatically"
              >
                {FABRIC_OPTIONS.map((f) => (
                  <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>
                ))}
              </select>
            </div>

            {/* Resize */}
            <div>
              <span className="text-[10px] text-gray-500 mb-1 block">Resize</span>
              <div className="flex flex-wrap gap-1">
                {SIZE_OPTIONS.map((size) => (
                  <button
                    key={size}
                    onClick={() => meshOps.resize(size)}
                    disabled={meshOps.isProcessing}
                    className="px-2 py-1 rounded-md text-[10px] font-medium bg-gray-100 text-gray-600 hover:bg-indigo-50 hover:text-indigo-600 transition-colors disabled:opacity-40"
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Techpack / Flatten ── */}
        <div>
          <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-2 block">
            Techpack / Patterns
          </label>
          <div className="space-y-1.5">
            <button
              onClick={() => meshOps.flattenPattern(true, 1.0)}
              disabled={meshOps.isProcessing}
              className="w-full px-2.5 py-1.5 rounded-lg text-[10px] font-semibold bg-gradient-to-r from-violet-500 to-indigo-600 text-white hover:from-violet-600 hover:to-indigo-700 transition-colors disabled:opacity-40 shadow-sm"
            >
              Generate Techpack (join + flatten)
            </button>
            <button
              onClick={() => meshOps.flattenPattern(false, 1.0)}
              disabled={meshOps.isProcessing}
              className="w-full px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-gray-100 text-gray-700 hover:bg-violet-50 hover:text-violet-600 transition-colors disabled:opacity-40"
            >
              Unfold — 3D→2D morph (separate parts)
            </button>
            <div className="pt-1">
              <span className="text-[9px] text-gray-400 block mb-1">Seam presets</span>
              <div className="grid grid-cols-2 gap-1">
                {SEAM_PRESETS.map(({ label, preset, title }) => (
                  <button
                    key={preset}
                    onClick={() => meshOps.setSeams([], "mark")}
                    disabled={meshOps.isProcessing}
                    title={title}
                    className="px-1.5 py-1 rounded-md text-[9px] font-medium bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100 transition-colors disabled:opacity-40"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {/* Pattern Mode toggle */}
            <button
              onClick={() => {
                const entering = !state.patternMode;
                dispatch({ type: "SET_PATTERN_MODE", payload: entering });
                if (entering && !state.patternGlbUrl) {
                  meshOps.flattenPattern(true, 1.0);
                }
              }}
              className={`w-full mt-2 px-2.5 py-2 rounded-lg text-[10px] font-semibold transition-colors border ${
                state.patternMode
                  ? "bg-violet-600 text-white border-violet-700 shadow-sm"
                  : "bg-white text-violet-600 border-violet-300 hover:bg-violet-50"
              }`}
            >
              {state.patternMode ? "Exit Pattern Mode" : "Pattern Mode (Digital Atelier)"}
            </button>
          </div>
        </div>

        {/* ── Mesh Refinement ── */}
        <div>
          <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-2 block">
            Mesh Refinement
          </label>
          <div className="space-y-2">
            {/* Add Thickness */}
            <div className="flex items-center gap-1.5">
              <select
                value={fabricType}
                onChange={(e) => setFabricType(e.target.value)}
                className="flex-1 text-[10px] border border-gray-200 rounded-md px-1 py-1 outline-none"
              >
                {FABRIC_OPTIONS.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
              <input
                type="number"
                value={thicknessMult}
                onChange={(e) => setThicknessMult(parseFloat(e.target.value) || 1)}
                min={0.1}
                max={5}
                step={0.1}
                className="w-12 text-[10px] border border-gray-200 rounded-md px-1 py-1 outline-none text-center"
                title="Thickness multiplier"
              />
              <button
                onClick={() => meshOps.addThickness(fabricType, thicknessMult, true)}
                disabled={meshOps.isProcessing}
                className="px-2 py-1 rounded-md text-[9px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors disabled:opacity-40"
              >
                Thickness
              </button>
            </div>

            {/* Subdivide (Catmull-Clark) */}
            <div className="flex items-center gap-1.5">
              <select
                value={subdivMethod}
                onChange={(e) => setSubdivMethod(e.target.value)}
                className="flex-1 text-[10px] border border-gray-200 rounded-md px-1 py-1 outline-none"
              >
                <option value="catmull_clark">Catmull-Clark</option>
                <option value="simple">Simple</option>
              </select>
              <select
                value={subdivLevels}
                onChange={(e) => setSubdivLevels(parseInt(e.target.value))}
                className="w-12 text-[10px] border border-gray-200 rounded-md px-1 py-1 outline-none"
              >
                {[1, 2, 3].map((l) => (
                  <option key={l} value={l}>×{l}</option>
                ))}
              </select>
              <label className="flex items-center gap-0.5 text-[9px] text-gray-500 whitespace-nowrap">
                <input type="checkbox" checked={creaseSeams} onChange={(e) => setCreaseSeams(e.target.checked)} className="w-3 h-3" />
                Crease
              </label>
              <button
                onClick={() => meshOps.subdivide(subdivLevels, subdivMethod, creaseSeams)}
                disabled={meshOps.isProcessing}
                className="px-2 py-1 rounded-md text-[9px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors disabled:opacity-40"
              >
                Subdiv
              </button>
            </div>

            {/* Fix Cracks */}
            <div className="flex items-center gap-1.5">
              <label className="flex items-center gap-0.5 text-[9px] text-gray-500 whitespace-nowrap flex-1">
                <input type="checkbox" checked={fabricMode} onChange={(e) => setFabricMode(e.target.checked)} className="w-3 h-3" />
                Fabric Mode
              </label>
              <button
                onClick={() => meshOps.repairMesh(0.001, fabricMode)}
                disabled={meshOps.isProcessing}
                className="px-2 py-1 rounded-md text-[9px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors disabled:opacity-40"
              >
                Fix Cracks
              </button>
            </div>

            {/* Extrude Edges */}
            <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-0.5 flex-1">
                <span className="text-[9px] text-gray-500">Offset:</span>
                <input
                  type="number"
                  value={extrudeOffset * 1000}
                  onChange={(e) => setExtrudeOffset((parseFloat(e.target.value) || 15) / 1000)}
                  min={1}
                  max={50}
                  step={1}
                  className="w-12 text-[10px] border border-gray-200 rounded-md px-1 py-1 outline-none text-center"
                  title="Offset in mm"
                />
                <span className="text-[9px] text-gray-400">mm</span>
              </div>
              <label className="flex items-center gap-0.5 text-[9px] text-gray-500 whitespace-nowrap">
                <input type="checkbox" checked={creaseExtrusion} onChange={(e) => setCreaseExtrusion(e.target.checked)} className="w-3 h-3" />
                Crease
              </label>
              <button
                onClick={() => meshOps.extrudeEdges(extrudeOffset, null, creaseExtrusion)}
                disabled={meshOps.isProcessing}
                className="px-2 py-1 rounded-md text-[9px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition-colors disabled:opacity-40"
              >
                Extrude
              </button>
            </div>
          </div>
        </div>

        {/* ── Smart UV Tools ── */}
        <div>
          <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-2 block">
            Smart UV Tools
          </label>
          <div className="space-y-2">
            {/* Auto-Seam */}
            <div className="flex items-center gap-1.5">
              <select
                value={garmentType}
                onChange={(e) => setGarmentType(e.target.value)}
                className="flex-1 text-[10px] border border-gray-200 rounded-md px-1 py-1 outline-none"
              >
                {["shirt", "pants", "jacket", "dress", "skirt", "coat"].map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
              <input
                type="number"
                value={maxIslands}
                onChange={(e) => setMaxIslands(parseInt(e.target.value) || 8)}
                min={2}
                max={20}
                className="w-10 text-[10px] border border-gray-200 rounded-md px-1 py-1 outline-none text-center"
                title="Max UV islands"
              />
              <button
                onClick={() => meshOps.autoSeam(garmentType, maxIslands)}
                disabled={meshOps.isProcessing}
                className="px-2 py-1 rounded-md text-[9px] font-semibold bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100 transition-colors disabled:opacity-40"
              >
                Auto-Seam
              </button>
            </div>

            {/* UV Quality Check */}
            <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-0.5 flex-1">
                <span className="text-[9px] text-gray-500">Stretch:</span>
                <input
                  type="number"
                  value={Math.round(stretchThreshold * 100)}
                  onChange={(e) => setStretchThreshold((parseFloat(e.target.value) || 5) / 100)}
                  min={1}
                  max={20}
                  className="w-10 text-[10px] border border-gray-200 rounded-md px-1 py-1 outline-none text-center"
                />
                <span className="text-[9px] text-gray-400">%</span>
              </div>
              <button
                onClick={() => meshOps.uvStretchMap(stretchThreshold)}
                disabled={meshOps.isProcessing}
                className="px-2 py-1 rounded-md text-[9px] font-semibold bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 transition-colors disabled:opacity-40"
              >
                Check UV Quality
              </button>
            </div>

            {/* Fabric Nesting */}
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <div className="flex items-center gap-0.5 flex-1">
                  <span className="text-[9px] text-gray-500">Width:</span>
                  <input
                    type="number"
                    value={Math.round(fabricWidth * 100)}
                    onChange={(e) => setFabricWidth((parseFloat(e.target.value) || 150) / 100)}
                    min={50}
                    max={300}
                    step={10}
                    className="w-12 text-[10px] border border-gray-200 rounded-md px-1 py-1 outline-none text-center"
                  />
                  <span className="text-[9px] text-gray-400">cm</span>
                </div>
                <select
                  value={grainDirection}
                  onChange={(e) => setGrainDirection(e.target.value)}
                  className="w-16 text-[10px] border border-gray-200 rounded-md px-1 py-1 outline-none"
                >
                  <option value="warp">Warp</option>
                  <option value="weft">Weft</option>
                  <option value="none">None</option>
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="flex items-center gap-0.5 flex-1">
                  <span className="text-[9px] text-gray-500">Allowance:</span>
                  <input
                    type="number"
                    value={Math.round(seamAllowance * 1000)}
                    onChange={(e) => setSeamAllowance((parseFloat(e.target.value) || 15) / 1000)}
                    min={5}
                    max={30}
                    className="w-10 text-[10px] border border-gray-200 rounded-md px-1 py-1 outline-none text-center"
                  />
                  <span className="text-[9px] text-gray-400">mm</span>
                </div>
                <button
                  onClick={() => meshOps.uvPackNest(fabricWidth, grainDirection, seamAllowance)}
                  disabled={meshOps.isProcessing}
                  className="px-2 py-1 rounded-md text-[9px] font-semibold bg-gradient-to-r from-cyan-50 to-teal-50 text-cyan-700 border border-cyan-200 hover:from-cyan-100 hover:to-teal-100 transition-colors disabled:opacity-40"
                >
                  Optimize Nesting
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Edit Part ── */}
        <div>
          <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-2 block">
            Edit Garment Part
          </label>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <select
                value={editPart}
                onChange={(e) => setEditPart(e.target.value)}
                className="w-24 text-[10px] border border-gray-200 rounded-md px-1 py-1 outline-none"
              >
                {PART_OPTIONS.map((p) => (
                  <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                ))}
              </select>
              <input
                type="text"
                value={editVariant}
                onChange={(e) => setEditVariant(e.target.value)}
                placeholder="variant (e.g. mandarin)"
                className="flex-1 text-[10px] border border-gray-200 rounded-md px-2 py-1 outline-none"
              />
            </div>
            <button
              onClick={() => meshOps.editPart(editPart, { type: editPart, variant: editVariant })}
              disabled={meshOps.isProcessing || !editPart}
              className="w-full px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100 transition-colors disabled:opacity-40"
            >
              Rebuild {editPart}
            </button>
          </div>
        </div>

        {/* ── Render section ── */}
        <div>
          <label className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-2 block">
            Render
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => meshOps.renderScene(renderRes)}
              disabled={meshOps.isProcessing}
              className="flex-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:from-indigo-600 hover:to-purple-700 transition-colors disabled:opacity-40"
            >
              Studio Render
            </button>
            <select
              value={renderRes}
              onChange={(e) => setRenderRes(parseInt(e.target.value))}
              className="w-16 text-[10px] border border-gray-200 rounded-md px-1 py-1 outline-none"
            >
              <option value={512}>512px</option>
              <option value={1024}>1024px</option>
              <option value={2048}>2048px</option>
            </select>
          </div>

          {/* Turntable 360° GIF Render */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <button
                onClick={() => meshOps.turntableRender(turntableFrames, turntableRes)}
                disabled={meshOps.isProcessing}
                className="flex-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-gradient-to-r from-pink-500 to-rose-600 text-white hover:from-pink-600 hover:to-rose-700 transition-colors disabled:opacity-40"
              >
                360° Turntable GIF
              </button>
              <select
                value={turntableRes}
                onChange={(e) => setTurntableRes(parseInt(e.target.value))}
                className="w-16 text-[10px] border border-gray-200 rounded-md px-1 py-1 outline-none"
              >
                <option value={256}>256px</option>
                <option value={512}>512px</option>
                <option value={1024}>1024px</option>
              </select>
            </div>
            <div className="flex items-center gap-2 px-1">
              <span className="text-[9px] text-gray-500 whitespace-nowrap">Frames:</span>
              <select
                value={turntableFrames}
                onChange={(e) => setTurntableFrames(parseInt(e.target.value))}
                className="flex-1 text-[10px] border border-gray-200 rounded-md px-1 py-1 outline-none"
              >
                <option value={12}>12 (fast)</option>
                <option value={24}>24 (smooth)</option>
                <option value={36}>36 (standard)</option>
                <option value={72}>72 (high quality)</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
