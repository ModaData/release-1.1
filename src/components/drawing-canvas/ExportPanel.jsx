"use client";

import { useState, useCallback } from "react";
import { useDrawingCanvas } from "@/hooks/useDrawingCanvas";

export default function ExportPanel({ onClose }) {
  const { state, dispatch } = useDrawingCanvas();
  const [isProcessing, setIsProcessing] = useState(false);
  const [processType, setProcessType] = useState(null);

  const imageUrl = state.lockedRenderUrl || state.currentRenderUrl;

  const handleDownload = useCallback(async (format) => {
    if (!imageUrl) return;

    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `moda-canvas-render-${Date.now()}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      dispatch({ type: "SET_ERROR", payload: "Download failed: " + err.message });
    }
  }, [imageUrl, dispatch]);

  const handleUpscale = useCallback(async () => {
    if (!imageUrl || isProcessing) return;
    setIsProcessing(true);
    setProcessType("upscale");

    try {
      const res = await fetch("/api/upscale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageUrl, scale: 4, face_enhance: false }),
      });

      if (!res.ok) throw new Error("Upscale failed");
      const data = await res.json();

      // Open upscaled image in new tab
      window.open(data.resultUrl, "_blank");
    } catch (err) {
      dispatch({ type: "SET_ERROR", payload: err.message });
    } finally {
      setIsProcessing(false);
      setProcessType(null);
    }
  }, [imageUrl, isProcessing, dispatch]);

  const handleRemoveBg = useCallback(async () => {
    if (!imageUrl || isProcessing) return;
    setIsProcessing(true);
    setProcessType("rembg");

    try {
      const res = await fetch("/api/remove-bg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageUrl }),
      });

      if (!res.ok) throw new Error("Background removal failed");
      const data = await res.json();

      window.open(data.resultUrl, "_blank");
    } catch (err) {
      dispatch({ type: "SET_ERROR", payload: err.message });
    } finally {
      setIsProcessing(false);
      setProcessType(null);
    }
  }, [imageUrl, isProcessing, dispatch]);

  if (!imageUrl) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xl w-[360px] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
          <h3 className="text-[14px] font-semibold text-gray-900">Export Render</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Preview */}
        <div className="p-4">
          <div className="w-full aspect-square rounded-xl overflow-hidden bg-gray-50 border border-gray-200 mb-4">
            <img src={imageUrl} alt="Export preview" className="w-full h-full object-contain" />
          </div>

          {/* Actions */}
          <div className="space-y-2">
            <button
              onClick={() => handleDownload("png")}
              className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl bg-gray-50 border border-gray-200 hover:bg-gray-100 transition-colors text-left"
            >
              <div className="flex items-center gap-2.5">
                <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                <span className="text-[12px] font-medium text-gray-700">Download PNG</span>
              </div>
              <span className="text-[10px] text-gray-400">768x768</span>
            </button>

            <button
              onClick={handleUpscale}
              disabled={isProcessing}
              className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl bg-gray-50 border border-gray-200 hover:bg-gray-100 disabled:opacity-50 transition-colors text-left"
            >
              <div className="flex items-center gap-2.5">
                {isProcessing && processType === "upscale" ? (
                  <div className="w-4 h-4 border-2 border-indigo-200 border-t-indigo-500 rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                  </svg>
                )}
                <span className="text-[12px] font-medium text-gray-700">Upscale 4x</span>
              </div>
              <span className="text-[10px] text-gray-400">Real-ESRGAN</span>
            </button>

            <button
              onClick={handleRemoveBg}
              disabled={isProcessing}
              className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl bg-gray-50 border border-gray-200 hover:bg-gray-100 disabled:opacity-50 transition-colors text-left"
            >
              <div className="flex items-center gap-2.5">
                {isProcessing && processType === "rembg" ? (
                  <div className="w-4 h-4 border-2 border-indigo-200 border-t-indigo-500 rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
                <span className="text-[12px] font-medium text-gray-700">Remove Background</span>
              </div>
              <span className="text-[10px] text-gray-400">rembg</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
