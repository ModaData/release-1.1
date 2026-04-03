// File: components/drawing-canvas/AIEffectTools.jsx
// AI-Prebaked Garment Effect Tools
//
// Each tool is a specific garment modification effect that applies on hover/stroke.
// User selects a tool, hovers over the 3D garment, and the effect applies to that area.
// Behind the scenes: GPT-4 generates targeted bpy code for the specific effect + location.
"use client";

import { useState, useCallback, useRef } from "react";

// ══════════════════════════════════════════════════════════════
// Effect Tool Definitions — each tool knows what it does
// ══════════════════════════════════════════════════════════════
const EFFECT_TOOLS = {
  // ── Distressing ──
  rip: {
    name: "Rip / Tear",
    icon: "✂",
    category: "distress",
    cursor: "crosshair",
    description: "Rip holes and tears in fabric",
    bpyPrompt: (params) => `Create a realistic rip/tear in the garment mesh at world position (${params.x.toFixed(3)}, ${params.y.toFixed(3)}, ${params.z.toFixed(3)}) with radius ${params.radius.toFixed(3)}m. Use bmesh to: 1) Select faces within radius of the hit point, 2) Delete some faces to create a hole, 3) Displace remaining border vertices outward slightly for frayed edges, 4) Add a wireframe modifier on the torn edges only. Make it look like worn denim ripping naturally.`,
    settings: { radius: 0.03, intensity: 0.7 },
  },
  fray: {
    name: "Fray Edges",
    icon: "〰",
    category: "distress",
    cursor: "crosshair",
    description: "Fray and unravel fabric edges",
    bpyPrompt: (params) => `Add fraying to garment edges near world position (${params.x.toFixed(3)}, ${params.y.toFixed(3)}, ${params.z.toFixed(3)}). Use bmesh to: 1) Find boundary edges near the point, 2) Extrude them outward slightly with random displacement, 3) Subdivide the extruded edges 2x for thread-like strands, 4) Add slight random vertex displacement for natural fray look.`,
    settings: { radius: 0.02, intensity: 0.5 },
  },
  burn: {
    name: "Burn Mark",
    icon: "🔥",
    category: "distress",
    cursor: "crosshair",
    description: "Scorch and burn marks on fabric",
    bpyPrompt: (params) => `Create a burn/scorch mark on the garment at world position (${params.x.toFixed(3)}, ${params.y.toFixed(3)}, ${params.z.toFixed(3)}) with radius ${params.radius.toFixed(3)}m. 1) Select faces in radius, 2) Create a new vertex color layer "BurnMask", 3) Paint the selected area dark brown/black gradient (center=black, edges=dark brown), 4) Create a second material slot with a darkened, high-roughness version of the base material, 5) Use vertex colors to blend between original and burned material.`,
    settings: { radius: 0.025, intensity: 0.8 },
  },
  fade: {
    name: "Sun Fade",
    icon: "☀",
    category: "distress",
    cursor: "pointer",
    description: "Bleach and fade areas of fabric",
    bpyPrompt: (params) => `Create a sun-faded/bleached area on the garment at world position (${params.x.toFixed(3)}, ${params.y.toFixed(3)}, ${params.z.toFixed(3)}) with radius ${params.radius.toFixed(3)}m. 1) Add vertex color layer "FadeMask", 2) Paint gradient from white (center) to original color (edges), 3) Mix the vertex color with the base color using a MixRGB node set to LIGHTEN, factor controlled by the vertex color alpha.`,
    settings: { radius: 0.04, intensity: 0.6 },
  },
  wrinkle: {
    name: "Wrinkle",
    icon: "🌊",
    category: "distress",
    cursor: "crosshair",
    description: "Add deep wrinkles and creases",
    bpyPrompt: (params) => `Add wrinkles/creases to the garment at world position (${params.x.toFixed(3)}, ${params.y.toFixed(3)}, ${params.z.toFixed(3)}) with radius ${params.radius.toFixed(3)}m. 1) Select vertices in radius, 2) Proportional edit: displace vertices inward along normals by ${(params.intensity * 0.005).toFixed(4)}m with smooth falloff, 3) Apply a displacement modifier with a cloud texture (scale=50, strength=0.002) to add fine wrinkle detail, 4) Smooth the surrounding area to blend naturally.`,
    settings: { radius: 0.03, intensity: 0.5 },
  },

  // ── Surface Decoration ──
  emboss: {
    name: "Emboss Pattern",
    icon: "⬡",
    category: "surface",
    cursor: "crosshair",
    description: "Raise a pattern from the surface",
    bpyPrompt: (params) => `Emboss a decorative pattern on the garment at world position (${params.x.toFixed(3)}, ${params.y.toFixed(3)}, ${params.z.toFixed(3)}) with radius ${params.radius.toFixed(3)}m. 1) Add a displace modifier with a voronoi texture (scale=30), 2) Use a vertex group to limit the effect to the area around the hit point, 3) Strength: ${(params.intensity * 0.003).toFixed(4)}m outward, 4) Apply the modifier.`,
    settings: { radius: 0.03, intensity: 0.6 },
  },
  stitch_line: {
    name: "Stitch Line",
    icon: "---",
    category: "surface",
    cursor: "crosshair",
    description: "Add decorative stitch lines",
    bpyPrompt: (params) => `Add a visible stitch line on the garment surface near world position (${params.x.toFixed(3)}, ${params.y.toFixed(3)}, ${params.z.toFixed(3)}). 1) Use bmesh to create a path of edges along the surface at that height (follow the Z-plane contour), 2) Mark those edges as freestyle edges, 3) Extrude them slightly outward (0.001m) along normals to create a raised stitch line, 4) Apply a contrasting thread-colored material to the stitch faces.`,
    settings: { radius: 0.01, intensity: 1.0 },
  },
  patch: {
    name: "Fabric Patch",
    icon: "🏷",
    category: "surface",
    cursor: "crosshair",
    description: "Apply a fabric patch overlay",
    bpyPrompt: (params) => `Add a fabric patch on the garment at world position (${params.x.toFixed(3)}, ${params.y.toFixed(3)}, ${params.z.toFixed(3)}). 1) Create a small flat plane (${(params.radius * 2).toFixed(3)}m x ${(params.radius * 2).toFixed(3)}m), 2) Shrinkwrap it onto the garment surface with offset 0.002m, 3) Add stitching detail around the edges (extruded boundary loop), 4) Apply a different fabric material (slightly darker, different roughness). The patch should look like a sewn-on repair or decorative element.`,
    settings: { radius: 0.03, intensity: 1.0 },
  },

  // ── Structural ──
  pleat: {
    name: "Add Pleat",
    icon: "≡",
    category: "structure",
    cursor: "crosshair",
    description: "Create a fabric pleat or fold",
    bpyPrompt: (params) => `Create a pleat/fold in the garment at world position (${params.x.toFixed(3)}, ${params.y.toFixed(3)}, ${params.z.toFixed(3)}). 1) Select an edge loop or ring near the click point, 2) Duplicate and offset the loop inward by 0.01m, 3) Bridge the original and duplicated loops to form the pleat fold, 4) Scale the inner loop down by 0.9x to create the tuck. The pleat should run vertically (parallel to Z axis).`,
    settings: { radius: 0.02, intensity: 0.8 },
  },
  gather: {
    name: "Gather / Ruche",
    icon: "}{",
    category: "structure",
    cursor: "crosshair",
    description: "Gather fabric for ruching effect",
    bpyPrompt: (params) => `Create a fabric gather/ruching at world position (${params.x.toFixed(3)}, ${params.y.toFixed(3)}, ${params.z.toFixed(3)}) with radius ${params.radius.toFixed(3)}m. 1) Select vertices in the area, 2) Scale them toward the center point along the horizontal axis by 0.5x (compress), 3) Add wave displacement along the compressed direction (scale=40, amplitude=0.003), 4) This creates the bunched-up gathered fabric effect.`,
    settings: { radius: 0.04, intensity: 0.7 },
  },
  dart: {
    name: "Sewing Dart",
    icon: "◁",
    category: "structure",
    cursor: "crosshair",
    description: "Add a tailoring dart for shaping",
    bpyPrompt: (params) => `Create a sewing dart (triangle fold) at world position (${params.x.toFixed(3)}, ${params.y.toFixed(3)}, ${params.z.toFixed(3)}). 1) Select a small triangle of faces near the point, 2) Scale the selection along the local horizontal by 0.3x (pinch), 3) Move the pinched center slightly inward along the normal, 4) This creates the appearance of a tailoring dart that shapes the garment to the body.`,
    settings: { radius: 0.02, intensity: 0.8 },
  },
  pocket: {
    name: "Add Pocket",
    icon: "🪺",
    category: "structure",
    cursor: "crosshair",
    description: "Place a pocket at clicked location",
    bpyPrompt: (params) => `Add a patch pocket on the garment at world position (${params.x.toFixed(3)}, ${params.y.toFixed(3)}, ${params.z.toFixed(3)}). 1) Create a rounded rectangle mesh (0.10m wide x 0.12m tall), 2) Shrinkwrap it onto the garment surface with 0.002m offset, 3) Add stitch detail: extrude the boundary loop outward by 0.0005m and apply a contrasting thread material, 4) Leave the top edge open (the pocket opening), 5) Apply the same fabric material as the garment but slightly offset the color.`,
    settings: { radius: 0.05, intensity: 1.0 },
  },

  // ── Material Effects ──
  wet: {
    name: "Wet Spot",
    icon: "💧",
    category: "material",
    cursor: "crosshair",
    description: "Make an area look wet/damp",
    bpyPrompt: (params) => `Create a wet/damp spot on the garment at world position (${params.x.toFixed(3)}, ${params.y.toFixed(3)}, ${params.z.toFixed(3)}) with radius ${params.radius.toFixed(3)}m. 1) Add a vertex color layer "WetMask", 2) Paint a radial gradient (white center to black edges), 3) In the material node graph, add a Mix Shader: mix between the original fabric BSDF and a "wet" BSDF (same color but darker by 30%, roughness=0.15, specular=0.9), 4) Use the vertex color as the mix factor.`,
    settings: { radius: 0.035, intensity: 0.8 },
  },
  sparkle: {
    name: "Sequins / Glitter",
    icon: "✨",
    category: "material",
    cursor: "crosshair",
    description: "Add sparkle, sequins, or metallic flecks",
    bpyPrompt: (params) => `Add sequins/glitter to the garment at world position (${params.x.toFixed(3)}, ${params.y.toFixed(3)}, ${params.z.toFixed(3)}) with radius ${params.radius.toFixed(3)}m. 1) In the material node graph, add a Voronoi Texture (scale=100, randomness=1.0) as a mask, 2) Use a ColorRamp to threshold it (create small circular spots), 3) Mix between the base fabric BSDF and a metallic BSDF (metallic=0.9, roughness=0.1, base_color=gold/silver), 4) Limit to the area using a vertex color mask painted at the hit position.`,
    settings: { radius: 0.04, intensity: 0.7 },
  },
  paint_splash: {
    name: "Paint Splash",
    icon: "🎨",
    category: "material",
    cursor: "crosshair",
    description: "Splatter paint effect on fabric",
    bpyPrompt: (params) => `Create a paint splash on the garment at world position (${params.x.toFixed(3)}, ${params.y.toFixed(3)}, ${params.z.toFixed(3)}) with radius ${params.radius.toFixed(3)}m. Splash color: ${params.color || "#FF0000"}. 1) Add vertex color layer "PaintSplash", 2) Paint the splash color in an organic splatter pattern (use noise texture as stencil), 3) In material nodes, mix the paint color with base color using the vertex color mask, 4) Slightly increase roughness in the painted area (paint sits on top of fabric).`,
    settings: { radius: 0.05, intensity: 0.9, color: "#FF0000" },
  },
};

const CATEGORIES = {
  distress: { name: "Distressing", icon: "⚡" },
  surface: { name: "Surface", icon: "✏" },
  structure: { name: "Structure", icon: "📐" },
  material: { name: "Material FX", icon: "🎨" },
};

// ══════════════════════════════════════════════════════════════
// AI Effect Tools Panel Component
// ══════════════════════════════════════════════════════════════
export default function AIEffectTools({ onApplyEffect, isProcessing, currentGlbUrl }) {
  const [activeTool, setActiveTool] = useState(null);
  const [toolSettings, setToolSettings] = useState({});
  const [expandedCategory, setExpandedCategory] = useState("distress");
  const [effectHistory, setEffectHistory] = useState([]);
  const [splashColor, setSplashColor] = useState("#FF0000");

  const handleToolSelect = useCallback((toolId) => {
    if (activeTool === toolId) {
      setActiveTool(null); // Deselect
      return;
    }
    setActiveTool(toolId);
    setToolSettings(EFFECT_TOOLS[toolId].settings);
  }, [activeTool]);

  const handleApplyAtPosition = useCallback((hitPoint, faceNormal) => {
    if (!activeTool || !currentGlbUrl || isProcessing) return;

    const tool = EFFECT_TOOLS[activeTool];
    const params = {
      ...toolSettings,
      x: hitPoint.x,
      y: hitPoint.y,
      z: hitPoint.z,
      nx: faceNormal?.x || 0,
      ny: faceNormal?.y || 0,
      nz: faceNormal?.z || 1,
      color: splashColor,
    };

    const bpyInstruction = tool.bpyPrompt(params);

    // Add to history
    setEffectHistory((prev) => [
      ...prev,
      { tool: activeTool, position: hitPoint, timestamp: Date.now() },
    ]);

    // Call parent to execute via blender-mcp
    onApplyEffect?.({
      toolId: activeTool,
      toolName: tool.name,
      bpyInstruction,
      position: hitPoint,
      settings: params,
    });
  }, [activeTool, toolSettings, currentGlbUrl, isProcessing, onApplyEffect, splashColor]);

  const activeDef = activeTool ? EFFECT_TOOLS[activeTool] : null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-100">
        <h3 className="text-[11px] font-bold text-gray-800 uppercase tracking-wider">
          AI Effect Tools
        </h3>
        {activeDef && (
          <p className="text-[10px] text-violet-600 mt-0.5">{activeDef.name}: {activeDef.description}</p>
        )}
      </div>

      {/* Tool Grid by Category */}
      <div className="flex-1 overflow-y-auto px-2 py-1.5">
        {Object.entries(CATEGORIES).map(([catId, cat]) => (
          <div key={catId} className="mb-2">
            <button
              onClick={() => setExpandedCategory(expandedCategory === catId ? null : catId)}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[10px] font-semibold text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded-md transition-colors"
            >
              <span>{cat.icon}</span>
              <span className="uppercase tracking-wider">{cat.name}</span>
              <span className="ml-auto text-gray-400">{expandedCategory === catId ? "▾" : "▸"}</span>
            </button>

            {expandedCategory === catId && (
              <div className="grid grid-cols-2 gap-1 mt-1 px-1">
                {Object.entries(EFFECT_TOOLS)
                  .filter(([, def]) => def.category === catId)
                  .map(([toolId, def]) => (
                    <button
                      key={toolId}
                      onClick={() => handleToolSelect(toolId)}
                      disabled={!currentGlbUrl}
                      className={`flex flex-col items-center gap-0.5 px-2 py-2 rounded-lg text-center transition-all ${
                        activeTool === toolId
                          ? "bg-violet-100 border-2 border-violet-400 text-violet-700 shadow-sm"
                          : currentGlbUrl
                          ? "bg-white border border-gray-200 text-gray-600 hover:border-violet-200 hover:bg-violet-50"
                          : "bg-gray-50 border border-gray-100 text-gray-300 cursor-not-allowed"
                      }`}
                    >
                      <span className="text-[16px] leading-none">{def.icon}</span>
                      <span className="text-[9px] font-medium leading-tight">{def.name}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Active Tool Settings */}
      {activeDef && (
        <div className="px-3 py-2 border-t border-gray-100 bg-gray-50/50">
          <div className="space-y-2">
            {/* Radius */}
            <div>
              <label className="text-[9px] font-medium text-gray-500 uppercase">
                Radius: {(toolSettings.radius * 100).toFixed(0)}cm
              </label>
              <input
                type="range"
                min={0.01}
                max={0.1}
                step={0.005}
                value={toolSettings.radius || 0.03}
                onChange={(e) => setToolSettings((s) => ({ ...s, radius: parseFloat(e.target.value) }))}
                className="w-full h-1 accent-violet-500"
              />
            </div>

            {/* Intensity */}
            <div>
              <label className="text-[9px] font-medium text-gray-500 uppercase">
                Intensity: {Math.round((toolSettings.intensity || 0.5) * 100)}%
              </label>
              <input
                type="range"
                min={0.1}
                max={1.0}
                step={0.1}
                value={toolSettings.intensity || 0.5}
                onChange={(e) => setToolSettings((s) => ({ ...s, intensity: parseFloat(e.target.value) }))}
                className="w-full h-1 accent-violet-500"
              />
            </div>

            {/* Color picker for paint tools */}
            {activeTool === "paint_splash" && (
              <div className="flex items-center gap-2">
                <label className="text-[9px] font-medium text-gray-500 uppercase">Color</label>
                <input
                  type="color"
                  value={splashColor}
                  onChange={(e) => setSplashColor(e.target.value)}
                  className="w-6 h-6 rounded border border-gray-200 cursor-pointer"
                />
                <span className="text-[9px] text-gray-400">{splashColor}</span>
              </div>
            )}
          </div>

          {/* Apply hint */}
          <p className="text-[9px] text-gray-400 mt-2 text-center">
            Click on the 3D model to apply {activeDef.name.toLowerCase()}
          </p>
        </div>
      )}

      {/* Effect History */}
      {effectHistory.length > 0 && (
        <div className="px-3 py-1.5 border-t border-gray-100">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-medium text-gray-500 uppercase">
              Applied: {effectHistory.length} effects
            </span>
            <button
              onClick={() => setEffectHistory([])}
              className="text-[9px] text-red-400 hover:text-red-600"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Export for use in other components
export { EFFECT_TOOLS, CATEGORIES };
