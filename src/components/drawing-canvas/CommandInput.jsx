"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useDrawingCanvas } from "@/hooks/useDrawingCanvas";
import { apiPathsToVectorPaths } from "@/lib/vector-engine/svg-to-anchors";
import { parseBlenderCommand, handleBlenderResult, COMMAND_3D_SUGGESTIONS } from "@/lib/command-parser";

const DRAWING_SUGGESTIONS = [
  { cmd: "add-pockets", label: "Add pockets", desc: "Draw patch pockets at hip level" },
  { cmd: "add-collar", label: "Add collar", desc: "Draw collar at neckline" },
  { cmd: "add-hood", label: "Add hood", desc: "Draw hood from neckline" },
  { cmd: "add-buttons", label: "Add buttons", desc: "Draw button line down center" },
  { cmd: "add-belt", label: "Add belt", desc: "Draw belt at waist" },
  { cmd: "add-pleats", label: "Add pleats", desc: "Draw pleated lines" },
  { cmd: "make-oversized", label: "Make oversized", desc: "Draw wider silhouette" },
  { cmd: "make-fitted", label: "Make fitted", desc: "Draw tailored silhouette" },
  { cmd: "make-cropped", label: "Make cropped", desc: "Shorten to cropped length" },
  { cmd: "draw-hoodie", label: "Draw hoodie", desc: "Full hoodie silhouette" },
  { cmd: "draw-blazer", label: "Draw blazer", desc: "Structured blazer outline" },
  { cmd: "draw-dress", label: "Draw dress", desc: "Dress silhouette" },
  { cmd: "draw-pants", label: "Draw pants", desc: "Pants/trousers outline" },
  { cmd: "draw-skirt", label: "Draw skirt", desc: "Skirt silhouette" },
];

const SUGGESTIONS = [...DRAWING_SUGGESTIONS, ...COMMAND_3D_SUGGESTIONS];

/**
 * CommandInput — Slash command input for natural language canvas commands.
 *
 * Appears when "/" is pressed, positioned above the toolbar.
 * Sends commands to /api/prompt-to-vector which returns SVG paths,
 * then parses them to VectorEngine anchors and adds to canvas.
 */
export default function CommandInput({ canvasRef }) {
  const { state, dispatch } = useDrawingCanvas();
  const inputRef = useRef(null);
  const [value, setValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(true);

  const isOpen = state.commandInputOpen;

  // Auto-focus when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      setValue("");
      setError(null);
      setShowSuggestions(true);
    }
  }, [isOpen]);

  const close = useCallback(() => {
    dispatch({ type: "SET_COMMAND_INPUT_OPEN", payload: false });
    setValue("");
    setError(null);
    setIsLoading(false);
  }, [dispatch]);

  // Global Escape listener (so Escape works even without focus)
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [isOpen, close]);

  const executeCommand = useCallback(async (commandText) => {
    if (!commandText.trim() || isLoading) return;

    setIsLoading(true);
    setError(null);
    setShowSuggestions(false);

    try {
      // ── Check if this is a 3D/Blender command ──
      const blenderCmd = parseBlenderCommand(commandText, state);

      if (blenderCmd) {
        // Handle dispatch-only commands (view mode switches)
        if (blenderCmd.type === "dispatch") {
          for (const action of blenderCmd.actions) {
            dispatch(action);
          }
          dispatch({ type: "SET_STATUS", payload: `Switched view mode` });
          close();
          return;
        }

        // Handle generate-3d command
        if (blenderCmd.type === "generate-3d") {
          const imageUrl = state.isLocked ? state.lockedRenderUrl : state.currentRenderUrl;
          if (!imageUrl) {
            throw new Error("No 2D render available. Draw and render first, then generate 3D.");
          }

          dispatch({ type: "SET_GENERATING_3D", payload: true });
          dispatch({ type: "SET_STATUS", payload: "Generating 3D mesh with HunYuan..." });
          close();

          // Convert to data URL if needed
          let imageDataUrl = imageUrl;
          if (!imageUrl.startsWith("data:")) {
            const response = await fetch(imageUrl);
            const blob = await response.blob();
            imageDataUrl = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            });
          }

          const res = await fetch("/api/generate-3d", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageDataUrl }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "3D generation failed");

          dispatch({ type: "SET_GLB_URL", payload: data.glbUrl });
          dispatch({ type: "SET_VIEW_MODE", payload: "3d" });
          dispatch({ type: "SET_GENERATING_3D", payload: false });
          dispatch({ type: "SET_STATUS", payload: "3D mesh generated!" });
          return;
        }

        // Handle prompt-to-Blender assembly
        if (blenderCmd.type === "prompt-to-blender") {
          if (!blenderCmd.prompt) {
            throw new Error("Please describe the garment to assemble (e.g., /assemble white linen shirt with french cuff)");
          }

          dispatch({ type: "SET_GENERATING_3D", payload: true });
          dispatch({ type: "SET_STATUS", payload: "Parsing garment description..." });
          close();

          const res = await fetch("/api/prompt-to-blender/assemble", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: blenderCmd.prompt,
              garmentContext: {
                category: state.garmentCategory,
                fiber: state.selectedFiber,
                construction: state.selectedConstruction,
              },
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Assembly failed");

          dispatch({ type: "SET_GLB_URL", payload: data.glbDataUrl });
          dispatch({ type: "SET_GARMENT_CONFIG", payload: data.config });
          dispatch({ type: "SET_VIEW_MODE", payload: "3d" });
          dispatch({ type: "SET_GENERATING_3D", payload: false });
          dispatch({ type: "SET_STATUS", payload: "Garment assembled from components!" });
          return;
        }

        // Handle Blender backend commands
        if (blenderCmd.type === "blender") {
          if (!state.glbUrl) {
            throw new Error("No 3D mesh loaded. Generate 3D first with /generate-3d");
          }

          // Bake-pbr requires a rendered texture
          if (blenderCmd.endpoint === "bake-pbr" && !blenderCmd.payload?.textureDataUrl) {
            throw new Error("No AI render available. Draw and render a design first, then bake PBR textures.");
          }

          dispatch({ type: "SET_STATUS", payload: `Running Blender: ${blenderCmd.endpoint}...` });

          // Convert GLB URL to data URL for sending to backend
          let fileDataUrl = state.glbUrl;
          if (!state.glbUrl.startsWith("data:")) {
            const proxyUrl = state.glbUrl.startsWith("/")
              ? state.glbUrl
              : `/api/proxy-model?url=${encodeURIComponent(state.glbUrl)}`;
            const response = await fetch(proxyUrl);
            const blob = await response.blob();
            fileDataUrl = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            });
          }

          // Convert textureDataUrl from URL to base64 data URL if needed (for bake-pbr)
          const payload = { ...blenderCmd.payload };
          if (payload.textureDataUrl && !payload.textureDataUrl.startsWith("data:")) {
            try {
              const texResp = await fetch(payload.textureDataUrl);
              const texBlob = await texResp.blob();
              payload.textureDataUrl = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.readAsDataURL(texBlob);
              });
            } catch {
              throw new Error("Failed to load render texture. Make sure a render exists before baking.");
            }
          }

          let res;
          try {
            res = await fetch(`/api/blender?action=${blenderCmd.endpoint}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...payload, fileDataUrl }),
            });
          } catch {
            throw new Error("Blender backend is not running. Start the Docker container with: docker compose up");
          }
          const data = await res.json();
          if (!res.ok) {
            const errMsg = data.error || `Blender ${blenderCmd.endpoint} failed`;
            throw new Error(
              errMsg.includes("fetch failed")
                ? "Blender backend is not running. Start the Docker container with: docker compose up"
                : errMsg
            );
          }

          handleBlenderResult(data, dispatch);
          close();
          return;
        }
      }

      // ── Default: Drawing command (prompt-to-vector) ──
      const canvasSize = canvasRef.current?.getCanvasSize?.() || { w: 800, h: 1000 };

      const res = await fetch("/api/prompt-to-vector", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: commandText.replace(/^\//, "").replace(/-/g, " "),
          canvasWidth: Math.round(canvasSize.w),
          canvasHeight: Math.round(canvasSize.h),
          existingDescription: state.currentInterpretation || "",
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Command failed");

      if (!data.paths || data.paths.length === 0) {
        throw new Error("No paths generated");
      }

      // Convert API SVG paths to VectorEngine paths
      const vectorPaths = apiPathsToVectorPaths(data.paths);

      if (vectorPaths.length === 0) {
        throw new Error("Could not parse generated paths");
      }

      // Add paths to canvas
      if (canvasRef.current?.addPaths) {
        canvasRef.current.addPaths(vectorPaths);
      }

      // Show result message
      dispatch({
        type: "SET_STATUS",
        payload: `Added ${vectorPaths.length} path${vectorPaths.length > 1 ? "s" : ""}: ${data.explanation || commandText}`,
      });

      close();
    } catch (err) {
      console.error("[command-input] Error:", err.message);
      setError(err.message);
      setIsLoading(false);
      dispatch({ type: "SET_GENERATING_3D", payload: false });
    }
  }, [canvasRef, state, dispatch, close, isLoading]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      executeCommand(value);
    }
  }, [close, executeCommand, value]);

  // Filter suggestions based on input
  const filteredSuggestions = SUGGESTIONS.filter((s) => {
    if (!value) return true;
    const search = value.replace(/^\//, "").toLowerCase();
    return s.cmd.includes(search) || s.label.toLowerCase().includes(search);
  }).slice(0, 6);

  if (!isOpen) return null;

  return (
    <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 w-80">
      {/* Input bar */}
      <div className={`flex items-center gap-2 bg-white border rounded-xl shadow-lg px-4 py-2.5 transition-colors ${
        error ? "border-red-300" : "border-gray-200"
      }`}>
        <span className="text-[14px] font-medium text-gray-300 select-none">/</span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setShowSuggestions(true);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Type a command... (e.g., add-pockets)"
          disabled={isLoading}
          className="flex-1 text-[13px] text-gray-700 placeholder:text-gray-300 outline-none bg-transparent disabled:opacity-50"
        />

        {/* Loading spinner */}
        {isLoading && (
          <div className="w-4 h-4 border-2 border-indigo-200 border-t-indigo-500 rounded-full animate-spin" />
        )}

        {/* Close button */}
        {!isLoading && (
          <button
            onClick={close}
            className="text-gray-300 hover:text-gray-500 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Suggestions dropdown (below input) */}
      {showSuggestions && filteredSuggestions.length > 0 && !isLoading && (
        <div className="mt-1.5 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-[200px] overflow-y-auto">
          {filteredSuggestions.map((suggestion) => (
            <button
              key={suggestion.cmd}
              onClick={() => {
                setValue(suggestion.cmd);
                executeCommand(suggestion.cmd);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
            >
              <span className="text-[11px] font-medium text-gray-700">
                /{suggestion.cmd}
              </span>
              <span className="text-[10px] text-gray-400 truncate">
                {suggestion.desc}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="mt-1.5 px-3 py-1.5 bg-red-50 border border-red-100 rounded-lg">
          <p className="text-[10px] text-red-500">{error}</p>
        </div>
      )}

      {/* Keyboard hint */}
      <div className="mt-1.5 flex items-center justify-center gap-3 text-[9px] text-gray-300">
        <span>Enter to execute</span>
        <span>·</span>
        <span>Esc to cancel</span>
      </div>
    </div>
  );
}
