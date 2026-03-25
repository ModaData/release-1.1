"use client";

import {
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import { useDrawingCanvas } from "@/hooks/useDrawingCanvas";
import { useVectorEngine } from "@/hooks/useVectorEngine";
import { renderDocument, renderOverlay, renderBackground } from "@/lib/vector-engine/renderer";

/**
 * VectorCanvas — High-performance dual-canvas vector drawing component
 *
 * Replaces the raster DrawingCanvas with a Bezier-based vector engine.
 * Exposes the same imperative API for seamless integration with
 * useContinuousRender and the AI pipeline.
 *
 * Architecture:
 *   mainCanvas   — committed paths (included in AI snapshot via getSnapshot())
 *   overlayCanvas — selection UI, anchors, handles, ghosts (excluded from snapshot)
 */
const VectorCanvas = forwardRef(function VectorCanvas(
  { onStroke, onHistoryChange },
  ref
) {
  const { state, dispatch } = useDrawingCanvas();
  const containerRef = useRef(null);
  const mainCanvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const mainCtxRef = useRef(null);
  const overlayCtxRef = useRef(null);
  const rafIdRef = useRef(null);
  const hoverHitRef = useRef(null);
  const canvasSizeRef = useRef({ w: 0, h: 0 });
  const bgImageRef = useRef(null);
  const isDestroyedRef = useRef(false);

  // Keep render state in a ref so getSnapshot() can access current values
  // without needing state in its dependency array
  const renderStateRef = useRef({
    canvasBackground: state.canvasBackground,
    strokeColor: state.strokeColor,
    strokeWidth: state.strokeWidth,
    opacity: state.opacity,
    tool: state.tool,
  });
  // Sync ref on every render
  renderStateRef.current = {
    canvasBackground: state.canvasBackground,
    strokeColor: state.strokeColor,
    strokeWidth: state.strokeWidth,
    opacity: state.opacity,
    tool: state.tool,
  };

  // Canvas width getter for symmetry calculations
  const getCanvasWidth = useCallback(() => canvasSizeRef.current.w, []);

  // Vector engine hook
  const engine = useVectorEngine({
    onHistoryChange,
    onStroke,
    onModeChange: (mode) => {
      dispatch({ type: "SET_VECTOR_MODE", payload: mode });
    },
    getCanvasWidth,
  });

  // ─── Canvas Sizing (DPR-aware) ───────────────────

  const resizeCanvases = useCallback(() => {
    const container = containerRef.current;
    const mainCanvas = mainCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (!container || !mainCanvas || !overlayCanvas) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width;
    const h = rect.height;

    canvasSizeRef.current = { w, h };

    // Main canvas
    mainCanvas.width = w * dpr;
    mainCanvas.height = h * dpr;
    mainCanvas.style.width = `${w}px`;
    mainCanvas.style.height = `${h}px`;
    const mainCtx = mainCanvas.getContext("2d");
    mainCtx.scale(dpr, dpr);
    mainCtxRef.current = mainCtx;

    // Overlay canvas
    overlayCanvas.width = w * dpr;
    overlayCanvas.height = h * dpr;
    overlayCanvas.style.width = `${w}px`;
    overlayCanvas.style.height = `${h}px`;
    const overlayCtx = overlayCanvas.getContext("2d");
    overlayCtx.scale(dpr, dpr);
    overlayCtxRef.current = overlayCtx;

    // Force full redraw after resize
    engine.markDirty();
  }, [engine]);

  // Initialize + ResizeObserver
  useEffect(() => {
    resizeCanvases();
    const observer = new ResizeObserver(resizeCanvases);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [resizeCanvases]);

  // ─── Background Image Loading ────────────────────

  useEffect(() => {
    if (state.canvasBackground === "blank" || state.canvasBackground === "grid") {
      bgImageRef.current = null;
      engine.markDirty();
      return;
    }

    const bgMap = {
      croquis_women: "/assets/croquis/women_9head.png",
      croquis_men: "/assets/croquis/men_8head.png",
      croquis_neutral: "/assets/croquis/neutral.png",
    };

    const src = bgMap[state.canvasBackground];
    if (!src) {
      bgImageRef.current = null;
      engine.markDirty();
      return;
    }

    const img = new Image();
    img.onload = () => {
      bgImageRef.current = img;
      engine.markDirty();
    };
    img.onerror = () => {
      bgImageRef.current = null;
      engine.markDirty();
    };
    img.src = src;
  }, [state.canvasBackground, engine]);

  // Redraw when background changes
  useEffect(() => {
    engine.markDirty();
  }, [state.canvasBackground, engine]);

  // ─── Sync Symmetry State from Context ────────────
  useEffect(() => {
    engine.setSymmetry(state.symmetryEnabled);
  }, [state.symmetryEnabled, engine]);

  // ─── RAF Rendering Loop ──────────────────────────

  useEffect(() => {
    isDestroyedRef.current = false;

    const loop = () => {
      if (isDestroyedRef.current) return;

      if (engine.needsRedrawRef.current) {
        engine.needsRedrawRef.current = false;

        const mainCtx = mainCtxRef.current;
        const overlayCtx = overlayCtxRef.current;
        const { w, h } = canvasSizeRef.current;

        if (mainCtx && overlayCtx && w > 0 && h > 0) {
          const doc = engine.getDocument();
          const tempPoints = engine.getTempPoints();

          // Render main canvas (paths — for AI snapshot)
          renderDocument(mainCtx, doc, {
            width: w,
            height: h,
            bgType: state.canvasBackground === "grid" ? "grid" : state.canvasBackground,
            bgImage: bgImageRef.current,
            tempPoints: tempPoints.length >= 2 ? tempPoints : null,
            tempStrokeStyle: {
              color: state.strokeColor,
              width: state.strokeWidth,
              opacity: state.opacity,
              tool: state.tool,
            },
          });

          // Render overlay canvas (selection UI — excluded from snapshot)
          renderOverlay(overlayCtx, doc, {
            width: w,
            height: h,
            canvasWidth: w,
            hoverHit: hoverHitRef.current,
          });
        }
      }

      rafIdRef.current = requestAnimationFrame(loop);
    };

    rafIdRef.current = requestAnimationFrame(loop);
    return () => {
      isDestroyedRef.current = true;
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, [engine, state.canvasBackground, state.strokeColor, state.strokeWidth, state.opacity, state.tool]);

  // ─── Pointer Event Handlers ──────────────────────

  const getPos = useCallback((e) => {
    const container = containerRef.current;
    if (!container) return { x: 0, y: 0, pressure: 0.5 };
    const rect = container.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      pressure: e.pressure || 0.5,
    };
  }, []);

  const handlePointerDown = useCallback(
    (e) => {
      if (state.tool === "lasso") return;
      e.preventDefault();
      const pos = getPos(e);

      engine.handlePointerDown(pos, {
        tool: state.tool,
        strokeColor: state.strokeColor,
        strokeWidth: state.strokeWidth,
        opacity: state.opacity,
      });

      containerRef.current?.setPointerCapture(e.pointerId);
    },
    [engine, getPos, state.tool, state.strokeColor, state.strokeWidth, state.opacity]
  );

  const handlePointerMove = useCallback(
    (e) => {
      const pos = getPos(e);

      const doc = engine.getDocument();

      if (doc.mode === "IDLE") {
        // Hover detection for cursor and indicators
        const hit = engine.handleHover(pos);
        hoverHitRef.current = hit;
        engine.markDirty();
      } else {
        // Active interaction
        e.preventDefault();
        engine.handlePointerMove(pos, {
          tool: state.tool,
          strokeColor: state.strokeColor,
          strokeWidth: state.strokeWidth,
          opacity: state.opacity,
        });
      }
    },
    [engine, getPos, state.tool, state.strokeColor, state.strokeWidth, state.opacity]
  );

  const handlePointerUp = useCallback(
    (e) => {
      const pos = getPos(e);

      engine.handlePointerUp(pos, {
        tool: state.tool,
        strokeColor: state.strokeColor,
        strokeWidth: state.strokeWidth,
        opacity: state.opacity,
      });

      containerRef.current?.releasePointerCapture(e.pointerId);
    },
    [engine, getPos, state.tool, state.strokeColor, state.strokeWidth, state.opacity]
  );

  // ─── Cursor Logic ────────────────────────────────

  const getCursor = () => {
    const doc = engine.getDocument();
    if (doc.mode === "DRAWING") return "crosshair";
    if (doc.mode === "EDITING") return "grabbing";
    if (doc.mode === "CURVING") return "grabbing";

    // IDLE — check hover
    const hit = hoverHitRef.current;
    if (hit) {
      if (hit.type === "anchor") return "grab";
      if (hit.type === "handle") return "pointer";
      if (hit.type === "segment") return "pointer";
    }

    return "crosshair";
  };

  // ─── Imperative API (matches DrawingCanvas contract) ──

  useImperativeHandle(
    ref,
    () => ({
      undo() {
        engine.undo();
      },
      redo() {
        engine.redo();
      },
      clear() {
        engine.clear();
      },
      getSnapshot() {
        // Force synchronous render to ensure canvas has latest content
        // This prevents transparent snapshots caused by:
        //   - ResizeObserver clearing canvas between RAF frames
        //   - Snapshot called before RAF loop paints new paths
        const mainCtx = mainCtxRef.current;
        const { w, h } = canvasSizeRef.current;
        if (mainCtx && w > 0 && h > 0) {
          const doc = engine.getDocument();
          const rs = renderStateRef.current;
          renderDocument(mainCtx, doc, {
            width: w,
            height: h,
            bgType: rs.canvasBackground === "grid" ? "grid" : rs.canvasBackground,
            bgImage: bgImageRef.current,
            tempPoints: null,
            tempStrokeStyle: null,
          });
        }
        return mainCanvasRef.current?.toDataURL("image/png") || null;
      },
      getStrokeCountSinceRender() {
        return engine.getStrokeCountSinceRender();
      },
      resetStrokeCount() {
        engine.resetStrokeCount();
      },
      getPathCount() {
        return engine.getPathCount();
      },
      restoreSnapshot(dataUrl) {
        // Load an image and draw it on the main canvas (for AI render display)
        const img = new Image();
        img.onload = () => {
          const canvas = mainCanvasRef.current;
          const ctx = mainCtxRef.current;
          if (!canvas || !ctx) return;
          const { w, h } = canvasSizeRef.current;
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          // Clear vector data when restoring a raster snapshot
          engine.clear();
        };
        img.src = dataUrl;
      },
      // AI command API
      addPaths(paths) {
        engine.addPaths(paths);
      },
      getCanvasSize() {
        return { ...canvasSizeRef.current };
      },
      // Extended API for vector-specific features
      toggleSymmetry() {
        engine.toggleSymmetry();
      },
      applySymmetry() {
        engine.applySymmetry();
      },
      getDocument() {
        return engine.getDocument();
      },
    }),
    [engine]
  );

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 touch-none"
      style={{ cursor: getCursor() }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <canvas
        ref={mainCanvasRef}
        className="absolute inset-0"
      />
      <canvas
        ref={overlayCanvasRef}
        className="absolute inset-0"
        style={{ pointerEvents: "none" }}
      />
    </div>
  );
});

export default VectorCanvas;
