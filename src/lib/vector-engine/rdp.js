/**
 * Ramer-Douglas-Peucker Point Simplification
 * Reduces a polyline to fewer points while preserving shape.
 * Used to simplify raw pointer samples into optimized anchor positions.
 */

/**
 * Simplify a polyline using the Ramer-Douglas-Peucker algorithm
 * @param {Array<{x:number, y:number, pressure?:number}>} points - Raw input points
 * @param {number} epsilon - Distance threshold in pixels (default 2.0)
 * @returns {Array<{x:number, y:number, pressure?:number}>} - Simplified points
 */
export function simplifyRDP(points, epsilon = 2.0) {
  if (points.length <= 2) return [...points];

  // Find the point with maximum distance from the line (first → last)
  const first = points[0];
  const last = points[points.length - 1];

  let maxDist = 0;
  let maxIndex = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIndex = i;
    }
  }

  // If max distance exceeds epsilon, recursively simplify both halves
  if (maxDist > epsilon) {
    const left = simplifyRDP(points.slice(0, maxIndex + 1), epsilon);
    const right = simplifyRDP(points.slice(maxIndex), epsilon);

    // Combine, removing the duplicate point at the junction
    return [...left.slice(0, -1), ...right];
  }

  // All points between first and last are within epsilon — keep only endpoints
  return [first, last];
}

/**
 * Calculate perpendicular distance from point to line segment (p1 → p2)
 */
function perpendicularDistance(point, p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq < 1e-10) {
    // p1 and p2 are the same point
    const ex = point.x - p1.x;
    const ey = point.y - p1.y;
    return Math.sqrt(ex * ex + ey * ey);
  }

  // Project point onto line, get parameter t
  const t = ((point.x - p1.x) * dx + (point.y - p1.y) * dy) / lenSq;

  // Clamp t to [0, 1] for segment distance
  const ct = Math.max(0, Math.min(1, t));

  const projX = p1.x + ct * dx;
  const projY = p1.y + ct * dy;

  const ex = point.x - projX;
  const ey = point.y - projY;

  return Math.sqrt(ex * ex + ey * ey);
}
