"use client";

import { useDrawingCanvas } from "@/hooks/useDrawingCanvas";
import { useState } from "react";

/**
 * InterpretationBadge — Floating badge showing real-time fashion term extraction
 *
 * Positioned at top-left of the drawing canvas, shows extracted fashion terms
 * as small pills. Updates after each AI interpretation cycle. Collapsible.
 */
export default function InterpretationBadge() {
  const { state } = useDrawingCanvas();
  const [collapsed, setCollapsed] = useState(false);

  const terms = state.fashionTerms || [];
  if (terms.length === 0) return null;

  const MAX_VISIBLE = 6;
  const visibleTerms = terms.slice(0, MAX_VISIBLE);
  const overflowCount = Math.max(0, terms.length - MAX_VISIBLE);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="absolute top-14 left-3 z-20 flex items-center gap-1 px-2 py-1.5 bg-white/90 backdrop-blur-sm border border-gray-100 rounded-lg shadow-sm hover:bg-white transition-colors"
        title="Show detected fashion terms"
      >
        <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <span className="text-[9px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-full">
          {terms.length}
        </span>
      </button>
    );
  }

  return (
    <div className="absolute top-14 left-3 z-20 max-w-[320px] bg-white/90 backdrop-blur-sm border border-gray-100 rounded-xl shadow-sm px-3 py-2">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5">
          <svg className="w-3 h-3 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <span className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">
            Detected
          </span>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="text-gray-300 hover:text-gray-500 transition-colors"
          title="Collapse"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Terms */}
      <div className="flex flex-wrap gap-1">
        {visibleTerms.map((term) => (
          <span
            key={term}
            className="inline-block bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full text-[9px] font-medium whitespace-nowrap border border-indigo-100/50"
          >
            {term}
          </span>
        ))}
        {overflowCount > 0 && (
          <span className="inline-block bg-gray-50 text-gray-400 px-2 py-0.5 rounded-full text-[9px] font-medium">
            +{overflowCount} more
          </span>
        )}
      </div>
    </div>
  );
}
