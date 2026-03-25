// File: hooks/useSmartSuggestions.js — GPT-4 powered edit suggestions on hover
"use client";

import { useState, useRef, useCallback } from "react";

/**
 * Fetches AI-powered edit suggestions when hovering over garment parts.
 * Uses OpenAI GPT-4o-mini via our /api/openai proxy.
 * Caches results to avoid redundant API calls.
 */
export function useSmartSuggestions(brandBrief) {
  const [suggestions, setSuggestions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const lastPartRef = useRef(null);
  const cacheRef = useRef(new Map());
  const abortRef = useRef(null);

  const fetchSuggestions = useCallback(
    async (hoveredPart, garmentDescription) => {
      if (!hoveredPart || hoveredPart === lastPartRef.current) return;
      lastPartRef.current = hoveredPart;

      // Check cache first
      const cacheKey = `${hoveredPart}-${brandBrief?.brief || ""}`;
      if (cacheRef.current.has(cacheKey)) {
        setSuggestions(cacheRef.current.get(cacheKey));
        return;
      }

      // Abort previous request
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      setIsLoading(true);
      try {
        const res = await fetch("/api/openai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            garmentType: garmentDescription || "fashion garment",
            hoveredPart,
            brandAesthetic: brandBrief?.brief || "modern fashion",
            fabric: brandBrief?.fabric?.label || undefined,
            season: brandBrief?.season?.label || undefined,
            colorPalette: brandBrief?.colorPalette?.join(", ") || undefined,
          }),
          signal: abortRef.current.signal,
        });

        if (!res.ok) {
          console.warn("Smart suggestions API error:", res.status);
          setSuggestions([]);
          return;
        }

        const data = await res.json();
        const result = data.suggestions || [];
        cacheRef.current.set(cacheKey, result);
        setSuggestions(result);
      } catch (err) {
        if (err.name !== "AbortError") {
          console.warn("Smart suggestions error:", err);
          setSuggestions([]);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [brandBrief]
  );

  const clearSuggestions = useCallback(() => {
    setSuggestions([]);
    lastPartRef.current = null;
  }, []);

  return {
    suggestions,
    isLoadingSuggestions: isLoading,
    fetchSuggestions,
    clearSuggestions,
  };
}
