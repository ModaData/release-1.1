// File: hooks/useRoboflow.js — Roboflow object detection hook
// Runs Roboflow detection on upload to supplement SegFormer with
// bounding-box-level garment part detection (e.g., buttons, zippers, pockets).
"use client";

import { useState, useCallback } from "react";

/**
 * Runs Roboflow fashion detection on an uploaded garment image.
 * Returns bounding box detections that can overlay on the canvas
 * and supplement SegFormer's pixel-level segmentation.
 */
export function useRoboflow() {
  const [detections, setDetections] = useState([]);
  const [isRoboflowLoading, setIsRoboflowLoading] = useState(false);
  const [roboflowError, setRoboflowError] = useState(null);

  const runRoboflow = useCallback(async (imageDataUrl, confidence = 0.4) => {
    if (!imageDataUrl) return [];

    setIsRoboflowLoading(true);
    setRoboflowError(null);

    try {
      const res = await fetch("/api/roboflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageDataUrl, confidence }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Roboflow error ${res.status}`);
      }

      const data = await res.json();
      const dets = data.detections || [];
      setDetections(dets);
      console.log(`[Roboflow] ${dets.length} detections:`, dets.map(d => d.label).join(", "));
      return dets;
    } catch (err) {
      console.warn("[Roboflow] Detection error:", err.message);
      setRoboflowError(err.message);
      return [];
    } finally {
      setIsRoboflowLoading(false);
    }
  }, []);

  const clearRoboflow = useCallback(() => {
    setDetections([]);
    setRoboflowError(null);
  }, []);

  /**
   * Find detections at a given image coordinate.
   * Returns all detections whose bounding box contains the point.
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
      // Return smallest bounding box (most specific)
      return matches.reduce((best, d) =>
        d.bbox.width * d.bbox.height < best.bbox.width * best.bbox.height ? d : best
      );
    },
    [detections]
  );

  return {
    detections,
    isRoboflowLoading,
    roboflowError,
    runRoboflow,
    clearRoboflow,
    getDetectionsAtPoint,
    getBestDetectionAtPoint,
  };
}
