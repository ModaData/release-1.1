/**
 * Bezier Fitting — Convert Simplified Points to Smooth Bezier Anchors
 * Uses Catmull-Rom style handle placement with C2 continuity.
 * Handle length = 30% of distance to neighboring anchor.
 * Handle direction = tangent from prev → next neighbor.
 */

import { dist2D } from "./bezier";

/**
 * @typedef {Object} AnchorPoint
 * @property {number} x
 * @property {number} y
 * @property {{x:number, y:number}|null} handleIn  - Control point offset (relative to anchor)
 * @property {{x:number, y:number}|null} handleOut - Control point offset (relative to anchor)
 * @property {number} pressure
 * @property {"smooth"|"corner"} type
 */

/**
 * Convert RDP-simplified points into smooth Bezier anchor points
 * @param {Array<{x:number, y:number, pressure?:number}>} points - Simplified points (min 2)
 * @returns {AnchorPoint[]}
 */
export function fitBezierAnchors(points) {
  if (points.length === 0) return [];

  if (points.length === 1) {
    return [{
      x: points[0].x,
      y: points[0].y,
      handleIn: null,
      handleOut: null,
      pressure: points[0].pressure ?? 0.5,
      type: "smooth",
    }];
  }

  const anchors = [];
  const n = points.length;
  const HANDLE_FACTOR = 0.3; // 30% of distance to neighbor

  for (let i = 0; i < n; i++) {
    const pt = points[i];
    const prev = i > 0 ? points[i - 1] : null;
    const next = i < n - 1 ? points[i + 1] : null;

    let handleIn = null;
    let handleOut = null;

    if (prev && next) {
      // Interior point — tangent direction from prev to next
      const tangentX = next.x - prev.x;
      const tangentY = next.y - prev.y;
      const tangentLen = Math.sqrt(tangentX * tangentX + tangentY * tangentY);

      if (tangentLen > 1e-6) {
        const tx = tangentX / tangentLen;
        const ty = tangentY / tangentLen;

        // Handle lengths proportional to distances to neighbors
        const distPrev = dist2D(pt, prev);
        const distNext = dist2D(pt, next);

        const inLen = distPrev * HANDLE_FACTOR;
        const outLen = distNext * HANDLE_FACTOR;

        // handleIn points backward along tangent (negative direction)
        handleIn = { x: -tx * inLen, y: -ty * inLen };
        // handleOut points forward along tangent
        handleOut = { x: tx * outLen, y: ty * outLen };
      }
    } else if (!prev && next) {
      // First point — handleOut only, pointing toward next
      const dx = next.x - pt.x;
      const dy = next.y - pt.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1e-6) {
        const len = d * HANDLE_FACTOR;
        handleOut = { x: (dx / d) * len, y: (dy / d) * len };
      }
    } else if (prev && !next) {
      // Last point — handleIn only, pointing from prev
      const dx = pt.x - prev.x;
      const dy = pt.y - prev.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1e-6) {
        const len = d * HANDLE_FACTOR;
        handleIn = { x: -(dx / d) * len, y: -(dy / d) * len };
      }
    }

    anchors.push({
      x: pt.x,
      y: pt.y,
      handleIn,
      handleOut,
      pressure: pt.pressure ?? 0.5,
      type: "smooth",
    });
  }

  return anchors;
}

/**
 * Enforce C2 continuity on a smooth anchor — make handleIn and handleOut collinear
 * Call this after dragging a handle to maintain smoothness
 * @param {AnchorPoint} anchor
 * @param {"in"|"out"} movedHandle - Which handle was moved
 */
export function enforceC2(anchor, movedHandle) {
  if (anchor.type !== "smooth") return;

  if (movedHandle === "out" && anchor.handleOut && anchor.handleIn) {
    // User moved handleOut — mirror direction to handleIn, keep handleIn length
    const outLen = Math.sqrt(anchor.handleOut.x ** 2 + anchor.handleOut.y ** 2);
    const inLen = Math.sqrt(anchor.handleIn.x ** 2 + anchor.handleIn.y ** 2);
    if (outLen > 1e-6) {
      const dx = anchor.handleOut.x / outLen;
      const dy = anchor.handleOut.y / outLen;
      anchor.handleIn = { x: -dx * inLen, y: -dy * inLen };
    }
  } else if (movedHandle === "in" && anchor.handleIn && anchor.handleOut) {
    // User moved handleIn — mirror direction to handleOut, keep handleOut length
    const inLen = Math.sqrt(anchor.handleIn.x ** 2 + anchor.handleIn.y ** 2);
    const outLen = Math.sqrt(anchor.handleOut.x ** 2 + anchor.handleOut.y ** 2);
    if (inLen > 1e-6) {
      const dx = anchor.handleIn.x / inLen;
      const dy = anchor.handleIn.y / inLen;
      anchor.handleOut = { x: -dx * outLen, y: -dy * outLen };
    }
  }
}
