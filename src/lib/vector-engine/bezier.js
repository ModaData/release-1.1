/**
 * Cubic Bezier Math Utilities
 * B(t) = (1-t)^3 * P0 + 3*(1-t)^2*t * P1 + 3*(1-t)*t^2 * P2 + t^3 * P3
 * All points are plain {x, y} objects. Pure functions, no state.
 */

/**
 * Evaluate a cubic Bezier curve at parameter t
 * @param {{x:number,y:number}} p0 - Start point
 * @param {{x:number,y:number}} p1 - Control point 1
 * @param {{x:number,y:number}} p2 - Control point 2
 * @param {{x:number,y:number}} p3 - End point
 * @param {number} t - Parameter [0, 1]
 * @returns {{x:number,y:number}}
 */
export function evaluateCubic(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;

  return {
    x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
    y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y,
  };
}

/**
 * First derivative of cubic Bezier at parameter t (tangent vector)
 * B'(t) = 3*(1-t)^2*(P1-P0) + 6*(1-t)*t*(P2-P1) + 3*t^2*(P3-P2)
 */
export function tangentAtT(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;

  return {
    x: 3 * mt2 * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t2 * (p3.x - p2.x),
    y: 3 * mt2 * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t2 * (p3.y - p2.y),
  };
}

/**
 * Split cubic Bezier at parameter t using De Casteljau subdivision
 * Returns two cubic Bezier curves {left: [p0,p1,p2,p3], right: [p0,p1,p2,p3]}
 */
export function splitCubic(p0, p1, p2, p3, t) {
  // Level 1
  const a = lerp2D(p0, p1, t);
  const b = lerp2D(p1, p2, t);
  const c = lerp2D(p2, p3, t);

  // Level 2
  const d = lerp2D(a, b, t);
  const e = lerp2D(b, c, t);

  // Level 3 — the split point
  const f = lerp2D(d, e, t);

  return {
    left: [p0, a, d, f],
    right: [f, e, c, p3],
  };
}

/**
 * Compute axis-aligned bounding box of a cubic Bezier
 */
export function cubicBBox(p0, p1, p2, p3) {
  let minX = Math.min(p0.x, p3.x);
  let maxX = Math.max(p0.x, p3.x);
  let minY = Math.min(p0.y, p3.y);
  let maxY = Math.max(p0.y, p3.y);

  // Find extrema by solving B'(t) = 0 for each axis
  const extremaX = solveQuadratic(
    -p0.x + 3 * p1.x - 3 * p2.x + p3.x,
    2 * p0.x - 4 * p1.x + 2 * p2.x,
    -p0.x + p1.x
  );

  const extremaY = solveQuadratic(
    -p0.y + 3 * p1.y - 3 * p2.y + p3.y,
    2 * p0.y - 4 * p1.y + 2 * p2.y,
    -p0.y + p1.y
  );

  for (const t of [...extremaX, ...extremaY]) {
    if (t > 0 && t < 1) {
      const pt = evaluateCubic(p0, p1, p2, p3, t);
      minX = Math.min(minX, pt.x);
      maxX = Math.max(maxX, pt.x);
      minY = Math.min(minY, pt.y);
      maxY = Math.max(maxY, pt.y);
    }
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Find the nearest point on a cubic Bezier to a given point
 * Uses uniform sampling + Newton refinement for accuracy
 * @param {{x:number,y:number}} p0
 * @param {{x:number,y:number}} p1
 * @param {{x:number,y:number}} p2
 * @param {{x:number,y:number}} p3
 * @param {{x:number,y:number}} point - Query point
 * @param {number} steps - Number of uniform samples (default 50)
 * @returns {{t: number, dist: number, point: {x:number,y:number}}}
 */
export function nearestPointOnCubic(p0, p1, p2, p3, point, steps = 50) {
  let bestT = 0;
  let bestDist = Infinity;
  let bestPt = p0;

  // Uniform sampling
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const pt = evaluateCubic(p0, p1, p2, p3, t);
    const d = dist2D(pt, point);
    if (d < bestDist) {
      bestDist = d;
      bestT = t;
      bestPt = pt;
    }
  }

  // Newton refinement (3 iterations)
  let t = bestT;
  for (let iter = 0; iter < 3; iter++) {
    const pt = evaluateCubic(p0, p1, p2, p3, t);
    const tan = tangentAtT(p0, p1, p2, p3, t);

    // Dot product of (pt - point) with tangent
    const dx = pt.x - point.x;
    const dy = pt.y - point.y;
    const num = dx * tan.x + dy * tan.y;
    const den = tan.x * tan.x + tan.y * tan.y;

    if (Math.abs(den) < 1e-10) break;

    t = t - num / den;
    t = Math.max(0, Math.min(1, t));
  }

  const finalPt = evaluateCubic(p0, p1, p2, p3, t);
  const finalDist = dist2D(finalPt, point);

  if (finalDist < bestDist) {
    return { t, dist: finalDist, point: finalPt };
  }

  return { t: bestT, dist: bestDist, point: bestPt };
}

/**
 * Get the four control points for a Bezier segment between two anchors
 * Converts anchor-relative handle offsets to absolute positions
 */
export function getSegmentControlPoints(anchor1, anchor2) {
  const p0 = { x: anchor1.x, y: anchor1.y };
  const p3 = { x: anchor2.x, y: anchor2.y };

  // P1 = anchor1 position + anchor1.handleOut offset
  const p1 = anchor1.handleOut
    ? { x: anchor1.x + anchor1.handleOut.x, y: anchor1.y + anchor1.handleOut.y }
    : p0;

  // P2 = anchor2 position + anchor2.handleIn offset
  const p2 = anchor2.handleIn
    ? { x: anchor2.x + anchor2.handleIn.x, y: anchor2.y + anchor2.handleIn.y }
    : p3;

  return { p0, p1, p2, p3 };
}

// ─── Helpers ────────────────────────────────────────────

function lerp2D(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function dist2D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Solve at^2 + bt + c = 0, return real roots in [0,1]
 */
function solveQuadratic(a, b, c) {
  const roots = [];
  if (Math.abs(a) < 1e-10) {
    // Linear
    if (Math.abs(b) > 1e-10) {
      roots.push(-c / b);
    }
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sqrtDisc = Math.sqrt(disc);
      roots.push((-b + sqrtDisc) / (2 * a));
      roots.push((-b - sqrtDisc) / (2 * a));
    }
  }
  return roots.filter((t) => t > 0 && t < 1);
}
