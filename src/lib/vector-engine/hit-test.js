/**
 * Proximity-Based Hit Testing for Vector Canvas
 * Tests anchors, handles, and path segments within threshold distance.
 * Anchors/handles checked first (higher priority), then segments.
 */

import { dist2D, nearestPointOnCubic, getSegmentControlPoints } from "./bezier";

/**
 * Hit test all anchor points in the document
 * Checks active/selected path first for priority, then all paths
 * @param {object} doc - VectorDocument
 * @param {{x:number, y:number}} point - Query point
 * @param {number} threshold - Distance threshold in pixels (default 12)
 * @returns {{pathIndex:number, anchorIndex:number}|null}
 */
export function hitTestAnchors(doc, point, threshold = 12) {
  // Check active path first (higher priority)
  if (doc.activePath !== null && doc.activePath < doc.paths.length) {
    const result = testPathAnchors(doc.paths[doc.activePath], point, threshold);
    if (result !== null) {
      return { pathIndex: doc.activePath, anchorIndex: result };
    }
  }

  // Then check all other paths
  for (let pi = 0; pi < doc.paths.length; pi++) {
    if (pi === doc.activePath) continue;
    const result = testPathAnchors(doc.paths[pi], point, threshold);
    if (result !== null) {
      return { pathIndex: pi, anchorIndex: result };
    }
  }

  return null;
}

/**
 * Hit test handle control points (only for the active/selected path)
 * Handles are only visible/interactive when a path is selected
 * @param {object} doc - VectorDocument
 * @param {{x:number, y:number}} point - Query point
 * @param {number} threshold - Distance threshold in pixels (default 12)
 * @returns {{pathIndex:number, anchorIndex:number, handle:"in"|"out"}|null}
 */
export function hitTestHandles(doc, point, threshold = 12) {
  if (doc.activePath === null || doc.activePath >= doc.paths.length) return null;

  const path = doc.paths[doc.activePath];

  for (let ai = 0; ai < path.anchors.length; ai++) {
    const anchor = path.anchors[ai];

    // Check handleIn
    if (anchor.handleIn) {
      const handlePos = {
        x: anchor.x + anchor.handleIn.x,
        y: anchor.y + anchor.handleIn.y,
      };
      if (dist2D(handlePos, point) <= threshold) {
        return { pathIndex: doc.activePath, anchorIndex: ai, handle: "in" };
      }
    }

    // Check handleOut
    if (anchor.handleOut) {
      const handlePos = {
        x: anchor.x + anchor.handleOut.x,
        y: anchor.y + anchor.handleOut.y,
      };
      if (dist2D(handlePos, point) <= threshold) {
        return { pathIndex: doc.activePath, anchorIndex: ai, handle: "out" };
      }
    }
  }

  return null;
}

/**
 * Hit test path segments (curves between anchors)
 * Only checks the active path for segment hits
 * @param {object} doc - VectorDocument
 * @param {{x:number, y:number}} point - Query point
 * @param {number} threshold - Distance threshold in pixels (default 8)
 * @returns {{pathIndex:number, segmentIndex:number, t:number}|null}
 */
export function hitTestSegment(doc, point, threshold = 8) {
  // Check active path first
  if (doc.activePath !== null && doc.activePath < doc.paths.length) {
    const result = testPathSegments(doc.paths[doc.activePath], point, threshold);
    if (result !== null) {
      return { pathIndex: doc.activePath, ...result };
    }
  }

  // Then check all other paths
  for (let pi = 0; pi < doc.paths.length; pi++) {
    if (pi === doc.activePath) continue;
    const result = testPathSegments(doc.paths[pi], point, threshold);
    if (result !== null) {
      return { pathIndex: pi, ...result };
    }
  }

  return null;
}

/**
 * Combined hit test — checks handles first, then anchors, then segments
 * Returns the highest-priority hit result
 * @param {object} doc - VectorDocument
 * @param {{x:number, y:number}} point - Query point
 * @returns {{type:"handle"|"anchor"|"segment", ...details}|null}
 */
export function hitTestAll(doc, point) {
  // 1. Handles (highest priority — smallest targets)
  const handleHit = hitTestHandles(doc, point, 12);
  if (handleHit) return { type: "handle", ...handleHit };

  // 2. Anchors
  const anchorHit = hitTestAnchors(doc, point, 12);
  if (anchorHit) return { type: "anchor", ...anchorHit };

  // 3. Segments (lowest priority)
  const segmentHit = hitTestSegment(doc, point, 8);
  if (segmentHit) return { type: "segment", ...segmentHit };

  return null;
}

// ─── Internal Helpers ─────────────────────────────────

/**
 * Test anchors within a single path
 * @returns {number|null} anchorIndex or null
 */
function testPathAnchors(path, point, threshold) {
  let bestDist = Infinity;
  let bestIdx = null;

  for (let i = 0; i < path.anchors.length; i++) {
    const d = dist2D(path.anchors[i], point);
    if (d <= threshold && d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }

  return bestIdx;
}

/**
 * Test segments within a single path
 * @returns {{segmentIndex:number, t:number}|null}
 */
function testPathSegments(path, point, threshold) {
  if (path.anchors.length < 2) return null;

  let bestDist = Infinity;
  let bestResult = null;

  const segCount = path.closed ? path.anchors.length : path.anchors.length - 1;

  for (let si = 0; si < segCount; si++) {
    const a1 = path.anchors[si];
    const a2 = path.anchors[(si + 1) % path.anchors.length];
    const { p0, p1, p2, p3 } = getSegmentControlPoints(a1, a2);

    const nearest = nearestPointOnCubic(p0, p1, p2, p3, point, 30);
    if (nearest.dist <= threshold && nearest.dist < bestDist) {
      bestDist = nearest.dist;
      bestResult = { segmentIndex: si, t: nearest.t };
    }
  }

  return bestResult;
}
