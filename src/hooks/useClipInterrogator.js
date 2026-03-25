// File: hooks/useClipInterrogator.js — Auto-describe uploaded garments via CLIP
"use client";

import { useState, useCallback } from "react";

/**
 * Runs CLIP Interrogator on an uploaded image to auto-detect
 * garment type, fabric, style, and pattern.
 * Result feeds into FLUX prompts for better inpainting quality.
 */
export function useClipInterrogator() {
  const [clipDescription, setClipDescription] = useState(null);
  const [isClipLoading, setIsClipLoading] = useState(false);
  const [clipError, setClipError] = useState(null);

  const runClipInterrogator = useCallback(async (imageDataUrl) => {
    if (!imageDataUrl) return;

    setIsClipLoading(true);
    setClipError(null);

    try {
      const res = await fetch("/api/clip-interrogator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageDataUrl }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `CLIP error ${res.status}`);
      }

      const data = await res.json();
      setClipDescription(data.description || null);
      return data.description;
    } catch (err) {
      console.warn("CLIP Interrogator error:", err);
      setClipError(err.message);
      return null;
    } finally {
      setIsClipLoading(false);
    }
  }, []);

  const clearClip = useCallback(() => {
    setClipDescription(null);
    setClipError(null);
  }, []);

  return {
    clipDescription,
    isClipLoading,
    clipError,
    runClipInterrogator,
    clearClip,
  };
}
