// File: hooks/useComponentDetector.js — GPT-4o-mini Vision garment component detector
// Replaces useRoboflow: uses OpenAI Vision to detect small garment components
// (buttons, zippers, pockets, collars, cuffs, seams, rivets, etc.)
// Drop-in replacement — same return shape as useRoboflow for compatibility.
"use client";

import { useState, useCallback } from "react";

/**
 * Runs GPT-4o-mini Vision detection on an uploaded garment image.
 * Returns component detections with bounding boxes and confidence scores.
 * API-compatible with the old useRoboflow hook.
 */
export function useComponentDetector() {
  const [detections, setDetections] = useState([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectError, setDetectError] = useState(null);

  const runDetection = useCallback(async (imageDataUrl, confidence = 0.4) => {
    if (!imageDataUrl) return [];

    setIsDetecting(true);
    setDetectError(null);

    try {
      const res = await fetch("/api/openai-detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageDataUrl, confidence }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Detection error ${res.status}`);
      }

      const data = await res.json();
      const dets = data.detections || [];
      setDetections(dets);
      console.log(
        `[ComponentDetector] ${dets.length} detections:`,
        dets.map((d) => d.label).join(", ")
      );
      return dets;
    } catch (err) {
      console.warn("[ComponentDetector] Detection error:", err.message);
      setDetectError(err.message);
      return [];
    } finally {
      setIsDetecting(false);
    }
  }, []);

  const clearDetections = useCallback(() => {
    setDetections([]);
    setDetectError(null);
  }, []);

  /**
   * Find detections at a given image coordinate.
   */
  const getDetectionsAtPoint = useCallback(
    (imgX, imgY) => {
      return detections.filter((d) => {
        const { x, y, width, height } = d.bbox;
        return imgX >= x && imgX <= x + width && imgY >= y && imgY <= y + height;
      });
    },
    [detections]
  );

  /**
   * Get the most specific (smallest bbox) detection at a point.
   */
  const getBestDetectionAtPoint = useCallback(
    (imgX, imgY) => {
      const matches = detections.filter((d) => {
        const { x, y, width, height } = d.bbox;
        return imgX >= x && imgX <= x + width && imgY >= y && imgY <= y + height;
      });
      if (matches.length === 0) return null;
      return matches.reduce((best, d) =>
        d.bbox.width * d.bbox.height < best.bbox.width * best.bbox.height ? d : best
      );
    },
    [detections]
  );

  return {
    detections,
    isDetecting,
    detectError,
    runDetection,
    clearDetections,
    getDetectionsAtPoint,
    getBestDetectionAtPoint,
    // Backward-compatible aliases
    isRoboflowLoading: isDetecting,
    runRoboflow: runDetection,
  };
}
