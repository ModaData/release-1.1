"use client";

import { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from "react";
import { useDrawingCanvas } from "@/hooks/useDrawingCanvas";

const DrawingCanvas = forwardRef(function DrawingCanvas({ onStroke, onHistoryChange }, ref) {
  const { state } = useDrawingCanvas();
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const isDrawingRef = useRef(false);
  const currentPathRef = useRef(null);
  const pathsRef = useRef([]);
  const redoStackRef = useRef([]);
  const strokeCountSinceRenderRef = useRef(0);
  const bgImageRef = useRef(null);

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      const rect = canvas.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      const ctx = canvas.getContext("2d");
      ctx.scale(dpr, dpr);
      ctxRef.current = ctx;
      redrawCanvas();
    };

    resizeCanvas();
    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(canvas.parentElement);
    return () => observer.disconnect();
  }, []);

  // Load background image when background changes
  useEffect(() => {
    if (state.canvasBackground === "blank" || state.canvasBackground === "grid") {
      bgImageRef.current = null;
      redrawCanvas();
      return;
    }

    const bgMap = {
      croquis_women: "/assets/croquis/women_9head.png",
      croquis_men: "/assets/croquis/men_8head.png",
      croquis_neutral: "/assets/croquis/neutral.png",
    };

    const src = bgMap[state.canvasBackground];
    if (!src) { bgImageRef.current = null; redrawCanvas(); return; }

    const img = new Image();
    img.onload = () => { bgImageRef.current = img; redrawCanvas(); };
    img.onerror = () => { bgImageRef.current = null; redrawCanvas(); };
    img.src = src;
  }, [state.canvasBackground]);

  // Redraw canvas from stored paths
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    // Grid
    if (state.canvasBackground === "grid") {
      ctx.strokeStyle = "#e5e7eb";
      ctx.lineWidth = 0.5;
      for (let x = 0; x <= w; x += 20) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y <= h; y += 20) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
    }

    // Croquis background
    if (bgImageRef.current) {
      ctx.globalAlpha = 0.06;
      const img = bgImageRef.current;
      const scale = Math.min(w / img.width, h / img.height) * 0.8;
      const iw = img.width * scale;
      const ih = img.height * scale;
      ctx.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
      ctx.globalAlpha = 1.0;
    }

    // Replay paths
    for (const path of pathsRef.current) {
      drawPath(ctx, path);
    }
  }, [state.canvasBackground]);

  // Redraw when background changes
  useEffect(() => {
    redrawCanvas();
  }, [state.canvasBackground, redrawCanvas]);

  // Draw a single path
  function drawPath(ctx, path) {
    if (path.points.length < 2) return;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = path.opacity;

    if (path.tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = path.color;
    }

    ctx.lineWidth = path.width;

    // Brush: vary width with pressure
    if (path.tool === "brush") {
      for (let i = 1; i < path.points.length; i++) {
        const prev = path.points[i - 1];
        const curr = path.points[i];
        const pressure = curr.pressure || 0.5;
        ctx.lineWidth = path.width * (0.5 + pressure);
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(curr.x, curr.y);
        ctx.stroke();
      }
    } else {
      ctx.beginPath();
      ctx.moveTo(path.points[0].x, path.points[0].y);
      for (let i = 1; i < path.points.length; i++) {
        ctx.lineTo(path.points[i].x, path.points[i].y);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  // Get position from pointer event
  function getPos(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      pressure: e.pressure || 0.5,
    };
  }

  // Pointer handlers
  const handlePointerDown = useCallback((e) => {
    if (state.tool === "lasso") return; // Lasso handled separately
    e.preventDefault();
    isDrawingRef.current = true;
    const pos = getPos(e);

    currentPathRef.current = {
      id: crypto.randomUUID(),
      tool: state.tool,
      color: state.strokeColor,
      width: state.strokeWidth,
      opacity: state.opacity,
      points: [pos],
      timestamp: Date.now(),
    };

    canvasRef.current?.setPointerCapture(e.pointerId);
  }, [state.tool, state.strokeColor, state.strokeWidth, state.opacity]);

  const handlePointerMove = useCallback((e) => {
    if (!isDrawingRef.current || !currentPathRef.current) return;
    e.preventDefault();
    const pos = getPos(e);
    currentPathRef.current.points.push(pos);

    // Draw incrementally for performance
    const ctx = ctxRef.current;
    const path = currentPathRef.current;
    const pts = path.points;
    if (pts.length < 2) return;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = path.opacity;

    if (path.tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = path.color;
    }

    const pressure = pos.pressure || 0.5;
    ctx.lineWidth = path.tool === "brush" ? path.width * (0.5 + pressure) : path.width;

    ctx.beginPath();
    ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.stroke();
    ctx.restore();

    // Notify for throttled rendering
    if (onStroke) onStroke("move");
  }, [onStroke]);

  const handlePointerUp = useCallback((e) => {
    if (!isDrawingRef.current || !currentPathRef.current) return;
    isDrawingRef.current = false;

    // Only add if there are meaningful points
    if (currentPathRef.current.points.length >= 2) {
      pathsRef.current.push(currentPathRef.current);
      redoStackRef.current = [];
      strokeCountSinceRenderRef.current++;

      onHistoryChange?.(pathsRef.current.length, redoStackRef.current.length);

      // Notify parent for immediate render on pen-lift
      if (onStroke) onStroke("up");
    }

    currentPathRef.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
  }, [onStroke, onHistoryChange]);

  // Imperative methods exposed to parent
  useImperativeHandle(ref, () => ({
    undo() {
      if (pathsRef.current.length === 0) return;
      const popped = pathsRef.current.pop();
      redoStackRef.current.push(popped);
      redrawCanvas();
      onHistoryChange?.(pathsRef.current.length, redoStackRef.current.length);
    },
    redo() {
      if (redoStackRef.current.length === 0) return;
      const popped = redoStackRef.current.pop();
      pathsRef.current.push(popped);
      redrawCanvas();
      onHistoryChange?.(pathsRef.current.length, redoStackRef.current.length);
    },
    clear() {
      pathsRef.current = [];
      redoStackRef.current = [];
      strokeCountSinceRenderRef.current = 0;
      redrawCanvas();
      onHistoryChange?.(0, 0);
    },
    getSnapshot() {
      return canvasRef.current?.toDataURL("image/png") || null;
    },
    getStrokeCountSinceRender() {
      return strokeCountSinceRenderRef.current;
    },
    resetStrokeCount() {
      strokeCountSinceRenderRef.current = 0;
    },
    getPathCount() {
      return pathsRef.current.length;
    },
    restoreSnapshot(dataUrl) {
      // Load an image and set as the only content
      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current;
        const ctx = ctxRef.current;
        if (!canvas || !ctx) return;
        const dpr = window.devicePixelRatio || 1;
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
        ctx.drawImage(img, 0, 0, canvas.width / dpr, canvas.height / dpr);
        pathsRef.current = [];
        redoStackRef.current = [];
        onHistoryChange?.(0, 0);
      };
      img.src = dataUrl;
    },
  }), [redrawCanvas, onHistoryChange]);

  // Cursor based on tool
  const cursorMap = {
    pencil: "crosshair",
    brush: "crosshair",
    eraser: "crosshair",
    lasso: "crosshair",
  };

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 touch-none"
      style={{ cursor: cursorMap[state.tool] || "crosshair" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    />
  );
});

export default DrawingCanvas;
