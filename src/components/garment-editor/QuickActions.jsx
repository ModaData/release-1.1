// File: components/garment-editor/QuickActions.jsx — Enterprise-grade context-aware actions
"use client";

import { useState } from "react";
import {
  Scissors, Plus, Minus, RotateCcw, Maximize2, Minimize2,
  Zap, Layers, CircleDot, ArrowUpRight, Shirt, ChevronDown, ChevronUp
} from "lucide-react";

/**
 * Context-aware quick action buttons that change based on the hovered part.
 * These are "pre-baked" common operations that fill in the prompt automatically.
 */

const PART_ACTIONS = {
  // Neckline / Collar
  Collar: [
    { icon: RotateCcw, label: "Change collar style", prompt: "change to a different collar style" },
    { icon: Scissors, label: "Remove collar", prompt: "remove the collar completely, clean neckline" },
    { icon: Plus, label: "Add contrast trim", prompt: "add contrast color trim to the collar edge" },
    { icon: Maximize2, label: "Make wider", prompt: "make the collar wider and more prominent" },
  ],
  Neckline: [
    { icon: RotateCcw, label: "Change to V-neck", prompt: "change neckline to V-neck shape" },
    { icon: Plus, label: "Add hood", prompt: "add a hood attachment to the neckline" },
    { icon: ArrowUpRight, label: "Raise neckline", prompt: "raise the neckline higher, more coverage" },
    { icon: Minimize2, label: "Lower neckline", prompt: "lower the neckline for a more open look" },
  ],
  Sleeves: [
    { icon: Scissors, label: "Make sleeveless", prompt: "remove sleeves completely, sleeveless design" },
    { icon: Maximize2, label: "Widen sleeves", prompt: "make sleeves wider, more relaxed fit" },
    { icon: Minimize2, label: "Taper sleeves", prompt: "make sleeves more tapered and fitted" },
    { icon: Layers, label: "Add cuff detail", prompt: "add decorative cuff detail at sleeve end" },
  ],
  Cuffs: [
    { icon: RotateCcw, label: "Change cuff style", prompt: "change to ribbed knit cuffs" },
    { icon: Plus, label: "Add button cuffs", prompt: "add button closure to the cuffs" },
    { icon: Maximize2, label: "French cuffs", prompt: "change to french fold-back cuffs" },
    { icon: Scissors, label: "Remove cuffs", prompt: "remove cuffs, raw hem sleeve edge" },
  ],
  "Button Placket": [
    { icon: Scissors, label: "Remove buttons", prompt: "remove all buttons, clean front closure" },
    { icon: Plus, label: "Add zipper", prompt: "replace buttons with a center zipper closure" },
    { icon: CircleDot, label: "Hidden placket", prompt: "change to hidden button placket, clean look" },
    { icon: Layers, label: "Double breasted", prompt: "change to double breasted button layout" },
  ],
  "Chest Pockets": [
    { icon: Scissors, label: "Remove pocket", prompt: "remove the chest pocket completely" },
    { icon: Plus, label: "Add flap", prompt: "add a flap closure to the chest pocket" },
    { icon: Maximize2, label: "Enlarge pocket", prompt: "make the chest pocket larger" },
    { icon: Layers, label: "Patch pocket", prompt: "change to a patch pocket style" },
  ],
  Hem: [
    { icon: ArrowUpRight, label: "Crop shorter", prompt: "crop the hem shorter, cropped fit" },
    { icon: Maximize2, label: "Extend longer", prompt: "extend the hem longer, more coverage" },
    { icon: Layers, label: "Add split", prompt: "add a side split at the hem" },
    { icon: RotateCcw, label: "Curved hem", prompt: "change to a curved hem shape" },
  ],
  Body: [
    { icon: Layers, label: "Add pocket", prompt: "add a kangaroo pocket to the front body" },
    { icon: Plus, label: "Add print", prompt: "add a minimal graphic print to the center chest" },
    { icon: Zap, label: "Add texture", prompt: "add subtle textured pattern to the body fabric" },
    { icon: Shirt, label: "Change fit", prompt: "change to a more oversized relaxed fit" },
  ],
  Shoulders: [
    { icon: Maximize2, label: "Drop shoulders", prompt: "change to dropped shoulder seam placement" },
    { icon: Plus, label: "Add epaulettes", prompt: "add epaulette shoulder details" },
    { icon: Layers, label: "Padded shoulders", prompt: "add structured shoulder padding" },
    { icon: Minimize2, label: "Narrow shoulders", prompt: "make the shoulder seam narrower" },
  ],
  // Pants / Lower body
  Waistband: [
    { icon: Maximize2, label: "High waist", prompt: "change to a high-rise waistband" },
    { icon: Minimize2, label: "Low rise", prompt: "change to a low-rise waistband" },
    { icon: Plus, label: "Add belt loops", prompt: "add belt loops to the waistband" },
    { icon: Layers, label: "Elastic waist", prompt: "change to an elastic waistband" },
  ],
  "Side Pockets": [
    { icon: Scissors, label: "Remove pockets", prompt: "remove the side pockets" },
    { icon: Plus, label: "Add cargo pocket", prompt: "add large cargo-style side pockets" },
    { icon: RotateCcw, label: "Welt pockets", prompt: "change to welt pocket style" },
    { icon: Layers, label: "Zipper pockets", prompt: "add zipper closures to the pockets" },
  ],
  Belt: [
    { icon: Scissors, label: "Remove belt", prompt: "remove the belt completely" },
    { icon: RotateCcw, label: "Change buckle", prompt: "change to a different belt buckle style" },
    { icon: Plus, label: "Add D-rings", prompt: "add D-ring hardware to the belt" },
    { icon: Maximize2, label: "Wider belt", prompt: "make the belt wider and more prominent" },
  ],
};

// Default actions for any part not specifically listed
const DEFAULT_ACTIONS = [
  { icon: RotateCcw, label: "Redesign", prompt: "redesign this area with a modern aesthetic" },
  { icon: Plus, label: "Add detail", prompt: "add a subtle design detail to this area" },
  { icon: Scissors, label: "Simplify", prompt: "simplify this area, remove unnecessary details" },
  { icon: Layers, label: "Change texture", prompt: "change the texture and material of this area" },
];

// Map left/right variants and aliases to their base PART_ACTIONS key
function normalizePartKey(key) {
  if (!key) return null;
  // Direct match first
  if (PART_ACTIONS[key]) return key;
  // Strip Left/Right prefix — "Left Sleeve" → "Sleeves", "Right Cuff" → "Cuffs"
  const stripped = key.replace(/^(Left|Right)\s+/i, "");
  if (PART_ACTIONS[stripped]) return stripped;
  // Try plural
  if (PART_ACTIONS[stripped + "s"]) return stripped + "s";
  // Aliases
  const ALIASES = {
    "Chest Area": "Body",
    "Left Chest Pocket": "Chest Pockets",
    "Right Chest Pocket": "Chest Pockets",
    "Left Shoulder": "Shoulders",
    "Right Shoulder": "Shoulders",
    "Left Sleeve": "Sleeves",
    "Right Sleeve": "Sleeves",
    "Left Cuff": "Cuffs",
    "Right Cuff": "Cuffs",
    "Lapel": "Collar",
  };
  return ALIASES[key] || null;
}

export function QuickActions({ hoveredPart, selectedMask, onActionSelect }) {
  const [expanded, setExpanded] = useState(true);

  // Determine which part to show actions for
  const rawPartKey = selectedMask?.subRegion || selectedMask?.label || hoveredPart;
  const partKey = normalizePartKey(rawPartKey);
  if (!rawPartKey) return null;

  const actions = (partKey && PART_ACTIONS[partKey]) || DEFAULT_ACTIONS;

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between py-1.5 group"
      >
        <div className="flex items-center gap-1.5 section-label mb-0">
          <Zap className="w-3 h-3 text-gray-600 group-hover:text-gray-400 transition-colors" />
          <span className="group-hover:text-gray-400 transition-colors">Quick Edits</span>
          <span className="ml-1 px-1.5 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-[8px] text-gray-500 font-mono">
            {rawPartKey}
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="w-3 h-3 text-gray-700 group-hover:text-gray-500 transition-colors" />
        ) : (
          <ChevronDown className="w-3 h-3 text-gray-700 group-hover:text-gray-500 transition-colors" />
        )}
      </button>

      {expanded && (
        <div className="space-y-1 animate-fade-in">
          {actions.map((action, i) => {
            const Icon = action.icon;
            return (
              <button
                key={i}
                onClick={() => onActionSelect(action.prompt)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left
                         bg-white/[0.01] border border-white/[0.04] hover:border-indigo-500/20 
                         hover:bg-indigo-500/[0.04] transition-all duration-200 group"
              >
                <div className="w-7 h-7 rounded-lg bg-white/[0.03] border border-white/[0.06] flex items-center justify-center 
                              group-hover:bg-indigo-500/10 group-hover:border-indigo-500/20 transition-all duration-200">
                  <Icon className="w-3.5 h-3.5 text-gray-500 group-hover:text-indigo-400 transition-colors duration-200" />
                </div>
                <span className="text-[11px] text-gray-400 group-hover:text-gray-200 transition-colors duration-200 font-medium">
                  {action.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
