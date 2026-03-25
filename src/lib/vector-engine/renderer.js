/**
 * Canvas 2D Renderer for Vector Engine
 * Two rendering modes:
 *   renderDocument() — main canvas: paths only (included in AI snapshot)
 *   renderOverlay()  — overlay canvas: selection UI, anchors, handles, ghosts (excluded from snapshot)
 */

import { evaluateCubic, getSegmentControlPoints } from "./bezier";

// ─── Main Canvas Rendering ────────────────────────────

/**
 * Render all committed paths onto the main canvas (for AI snapshot)
 * NO selection UI, NO ghosts, NO handles — only clean path strokes
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} doc - VectorDocument
 * @param {object} options - { width, height }
 */
export function renderDocument(ctx, doc, options) {
  const { width, height } = options;
  ctx.clearRect(0, 0, width, height);

  // White background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  // Background (grid or croquis) — delegated to renderBackground
  if (options.bgType) {
    renderBackground(ctx, width, height, options.bgType, options.bgImage);
  }

  // Render committed paths
  for (const path of doc.paths) {
    if (path.isGhost) continue;
    renderPath(ctx, path);
  }

  // Render live drawing preview (temp points as simple polyline)
  if (options.tempPoints && options.tempPoints.length >= 2) {
    renderTempStroke(ctx, options.tempPoints, options.tempStrokeStyle);
  }
}

/**
 * Render background (grid or croquis image)
 */
export function renderBackground(ctx, width, height, bgType, bgImage) {
  if (bgType === "grid") {
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= width; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y <= height; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  } else if (bgImage) {
    ctx.save();
    ctx.globalAlpha = 0.06;
    const scale = Math.min(width / bgImage.width, height / bgImage.height) * 0.8;
    const iw = bgImage.width * scale;
    const ih = bgImage.height * scale;
    ctx.drawImage(bgImage, (width - iw) / 2, (height - ih) / 2, iw, ih);
    ctx.restore();
  }
}

// ─── Overlay Canvas Rendering ─────────────────────────

/**
 * Render selection UI onto the overlay canvas
 * Includes: ghost paths, selected path highlight, anchor points, handles, hover indicators
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} doc - VectorDocument
 * @param {object} options - { width, height, hoverPoint, canvasWidth }
 */
export function renderOverlay(ctx, doc, options) {
  const { width, height } = options;
  ctx.clearRect(0, 0, width, height);

  // 1. Render ghost paths (dashed, 0.2 alpha)
  for (const ghost of (doc.ghostPaths || [])) {
    renderGhostPath(ctx, ghost);
  }

  // 2. Render symmetry axis line when symmetry is enabled
  if (doc.symmetryEnabled && options.canvasWidth) {
    const axisX = options.canvasWidth / 2;
    ctx.save();
    ctx.strokeStyle = "rgba(99, 102, 241, 0.15)";
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(axisX, 0);
    ctx.lineTo(axisX, height);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // 3. Selected path highlight
  if (doc.activePath !== null && doc.activePath < doc.paths.length) {
    const activePath = doc.paths[doc.activePath];
    renderPathHighlight(ctx, activePath);
    renderAnchorsAndHandles(ctx, activePath, doc.activeAnchor, doc.activeHandle);
  }

  // 4. Hover indicator
  if (options.hoverHit) {
    renderHoverIndicator(ctx, doc, options.hoverHit);
  }
}

// ─── Path Rendering ───────────────────────────────────

/**
 * Render a single vector path as smooth Bezier curves
 */
function renderPath(ctx, path) {
  if (path.anchors.length < 2) {
    // Single point — draw a dot
    if (path.anchors.length === 1) {
      ctx.save();
      ctx.fillStyle = path.color;
      ctx.globalAlpha = path.opacity;
      ctx.beginPath();
      ctx.arc(path.anchors[0].x, path.anchors[0].y, path.baseWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    return;
  }

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

  if (path.tool === "brush") {
    // Variable-width rendering: draw each segment separately with pressure-based width
    renderBrushPath(ctx, path);
  } else {
    // Uniform-width rendering: single continuous path
    ctx.lineWidth = path.baseWidth;
    ctx.beginPath();

    const anchors = path.anchors;
    ctx.moveTo(anchors[0].x, anchors[0].y);

    const segCount = path.closed ? anchors.length : anchors.length - 1;
    for (let i = 0; i < segCount; i++) {
      const a1 = anchors[i];
      const a2 = anchors[(i + 1) % anchors.length];
      const { p1, p2, p3 } = getSegmentControlPoints(a1, a2);
      ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    }

    if (path.closed) ctx.closePath();
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Render a brush path with variable width based on anchor pressure
 * Draws each segment as a series of short line segments with interpolated width
 */
function renderBrushPath(ctx, path) {
  const anchors = path.anchors;
  const segCount = path.closed ? anchors.length : anchors.length - 1;
  const STEPS = 12; // Subdivisions per segment for variable width

  for (let si = 0; si < segCount; si++) {
    const a1 = anchors[si];
    const a2 = anchors[(si + 1) % anchors.length];
    const { p0, p1, p2, p3 } = getSegmentControlPoints(a1, a2);

    const pressure1 = a1.pressure ?? 0.5;
    const pressure2 = a2.pressure ?? 0.5;

    for (let step = 0; step < STEPS; step++) {
      const t1 = step / STEPS;
      const t2 = (step + 1) / STEPS;

      const pt1 = evaluateCubic(p0, p1, p2, p3, t1);
      const pt2 = evaluateCubic(p0, p1, p2, p3, t2);

      // Interpolate pressure
      const pressure = pressure1 + (pressure2 - pressure1) * ((t1 + t2) / 2);
      ctx.lineWidth = path.baseWidth * (0.5 + pressure);

      ctx.beginPath();
      ctx.moveTo(pt1.x, pt1.y);
      ctx.lineTo(pt2.x, pt2.y);
      ctx.stroke();
    }
  }
}

/**
 * Render temporary drawing stroke (raw pointer points, not yet converted to Bezier)
 */
function renderTempStroke(ctx, points, style = {}) {
  if (points.length < 2) return;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = style.color || "#000000";
  ctx.lineWidth = style.width || 2;
  ctx.globalAlpha = style.opacity || 1.0;

  if (style.tool === "eraser") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "rgba(0,0,0,1)";
  }

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.restore();
}

// ─── Ghost Path Rendering ─────────────────────────────

function renderGhostPath(ctx, ghost) {
  if (ghost.anchors.length < 2) return;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = 0.2;
  ctx.strokeStyle = ghost.color || "#6366f1";
  ctx.lineWidth = ghost.baseWidth || 2;
  ctx.setLineDash([6, 4]);

  ctx.beginPath();
  const anchors = ghost.anchors;
  ctx.moveTo(anchors[0].x, anchors[0].y);

  const segCount = ghost.closed ? anchors.length : anchors.length - 1;
  for (let i = 0; i < segCount; i++) {
    const a1 = anchors[i];
    const a2 = anchors[(i + 1) % anchors.length];
    const { p1, p2, p3 } = getSegmentControlPoints(a1, a2);
    ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
  }

  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// ─── Selection UI Rendering ───────────────────────────

/**
 * Render highlighted outline for the active/selected path
 */
function renderPathHighlight(ctx, path) {
  if (path.anchors.length < 2) return;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(99, 102, 241, 0.3)";
  ctx.lineWidth = path.baseWidth + 4;

  ctx.beginPath();
  const anchors = path.anchors;
  ctx.moveTo(anchors[0].x, anchors[0].y);

  const segCount = path.closed ? anchors.length : anchors.length - 1;
  for (let i = 0; i < segCount; i++) {
    const a1 = anchors[i];
    const a2 = anchors[(i + 1) % anchors.length];
    const { p1, p2, p3 } = getSegmentControlPoints(a1, a2);
    ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
  }

  ctx.stroke();
  ctx.restore();
}

/**
 * Render anchor points and Bezier handles for the selected path
 */
function renderAnchorsAndHandles(ctx, path, activeAnchorIdx, activeHandle) {
  for (let i = 0; i < path.anchors.length; i++) {
    const anchor = path.anchors[i];
    const isActive = i === activeAnchorIdx;

    // Draw handle lines and points
    if (anchor.handleIn) {
      const hx = anchor.x + anchor.handleIn.x;
      const hy = anchor.y + anchor.handleIn.y;
      renderHandleLine(ctx, anchor.x, anchor.y, hx, hy);
      renderHandlePoint(ctx, hx, hy, isActive && activeHandle === "in");
    }

    if (anchor.handleOut) {
      const hx = anchor.x + anchor.handleOut.x;
      const hy = anchor.y + anchor.handleOut.y;
      renderHandleLine(ctx, anchor.x, anchor.y, hx, hy);
      renderHandlePoint(ctx, hx, hy, isActive && activeHandle === "out");
    }

    // Draw anchor point on top of handle lines
    renderAnchorPoint(ctx, anchor.x, anchor.y, isActive);
  }
}

/**
 * Draw anchor point — 6px white circle with border
 */
function renderAnchorPoint(ctx, x, y, isActive) {
  ctx.save();

  // Outer ring
  ctx.beginPath();
  ctx.arc(x, y, isActive ? 5 : 4, 0, Math.PI * 2);
  ctx.fillStyle = isActive ? "#6366f1" : "#ffffff";
  ctx.fill();
  ctx.strokeStyle = isActive ? "#4f46e5" : "#9ca3af";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Inner dot for active
  if (isActive) {
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  }

  ctx.restore();
}

/**
 * Draw handle line — thin gray line from anchor to handle
 */
function renderHandleLine(ctx, ax, ay, hx, hy) {
  ctx.save();
  ctx.strokeStyle = "rgba(156, 163, 175, 0.6)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw handle point — 5px circle
 */
function renderHandlePoint(ctx, x, y, isActive) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, isActive ? 4 : 3, 0, Math.PI * 2);
  ctx.fillStyle = isActive ? "#818cf8" : "#e5e7eb";
  ctx.fill();
  ctx.strokeStyle = isActive ? "#6366f1" : "#9ca3af";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/**
 * Render hover indicator — enlarged circle at hovered element
 */
function renderHoverIndicator(ctx, doc, hit) {
  ctx.save();
  ctx.strokeStyle = "rgba(99, 102, 241, 0.5)";
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 3]);

  if (hit.type === "anchor" && hit.pathIndex < doc.paths.length) {
    const anchor = doc.paths[hit.pathIndex].anchors[hit.anchorIndex];
    if (anchor) {
      ctx.beginPath();
      ctx.arc(anchor.x, anchor.y, 8, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (hit.type === "handle" && hit.pathIndex < doc.paths.length) {
    const anchor = doc.paths[hit.pathIndex].anchors[hit.anchorIndex];
    if (anchor) {
      const handle = hit.handle === "in" ? anchor.handleIn : anchor.handleOut;
      if (handle) {
        ctx.beginPath();
        ctx.arc(anchor.x + handle.x, anchor.y + handle.y, 7, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  } else if (hit.type === "segment" && hit.pathIndex < doc.paths.length) {
    const path = doc.paths[hit.pathIndex];
    const a1 = path.anchors[hit.segmentIndex];
    const a2 = path.anchors[(hit.segmentIndex + 1) % path.anchors.length];
    if (a1 && a2) {
      const { p0, p1, p2, p3 } = getSegmentControlPoints(a1, a2);
      const pt = evaluateCubic(p0, p1, p2, p3, hit.t);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.setLineDash([]);
  ctx.restore();
}
