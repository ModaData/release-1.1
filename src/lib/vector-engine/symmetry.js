/**
 * Symmetry System — Mirror & Ghost Path Generation
 * Detects which side of the canvas a path is on,
 * mirrors it across the vertical center axis,
 * and manages ghost → committed path conversion.
 */

/**
 * Detect which side of the canvas a path is predominantly on
 * @param {object} path - VectorPath with anchors[]
 * @param {number} canvasWidth - Canvas width in CSS pixels
 * @returns {"left"|"right"|"center"}
 */
export function detectSide(path, canvasWidth) {
  if (!path.anchors || path.anchors.length === 0) return "center";

  const axisX = canvasWidth / 2;
  let leftCount = 0;
  let rightCount = 0;

  for (const anchor of path.anchors) {
    if (anchor.x < axisX) leftCount++;
    else rightCount++;
  }

  const total = path.anchors.length;
  // 80% threshold for side detection
  if (leftCount / total >= 0.8) return "left";
  if (rightCount / total >= 0.8) return "right";
  return "center";
}

/**
 * Mirror a path across the vertical center axis
 * @param {object} path - VectorPath to mirror
 * @param {number} axisX - X position of the symmetry axis (canvasWidth / 2)
 * @returns {object} New VectorPath with isGhost=true
 */
export function mirrorPath(path, axisX) {
  const mirroredAnchors = path.anchors.map((anchor) => {
    const newX = 2 * axisX - anchor.x;

    return {
      x: newX,
      y: anchor.y,
      // Swap and negate x-offsets for handles (mirror across vertical)
      handleIn: anchor.handleOut
        ? { x: -anchor.handleOut.x, y: anchor.handleOut.y }
        : null,
      handleOut: anchor.handleIn
        ? { x: -anchor.handleIn.x, y: anchor.handleIn.y }
        : null,
      pressure: anchor.pressure,
      type: anchor.type,
    };
  });

  // Reverse anchor order so the path direction is mirrored correctly
  mirroredAnchors.reverse();

  return {
    id: `ghost_${path.id}`,
    anchors: mirroredAnchors,
    closed: path.closed,
    color: path.color,
    baseWidth: path.baseWidth,
    opacity: 0.2,
    tool: path.tool,
    isGhost: true,
    sourceId: path.id,
  };
}

/**
 * Generate ghost paths for all non-ghost paths that are on a definite side
 * @param {object[]} paths - Array of VectorPath
 * @param {number} canvasWidth - Canvas width
 * @returns {object[]} Array of ghost VectorPaths
 */
export function generateGhosts(paths, canvasWidth) {
  const axisX = canvasWidth / 2;
  const ghosts = [];

  for (const path of paths) {
    if (path.isGhost) continue;

    const side = detectSide(path, canvasWidth);
    if (side === "center") continue;

    ghosts.push(mirrorPath(path, axisX));
  }

  return ghosts;
}

/**
 * Commit all ghost paths — convert them to real paths
 * @param {object[]} ghostPaths - Array of ghost VectorPaths
 * @returns {object[]} Array of committed VectorPaths (isGhost=false, full opacity)
 */
export function commitGhosts(ghostPaths) {
  return ghostPaths.map((ghost) => ({
    ...ghost,
    id: crypto.randomUUID(),
    isGhost: false,
    opacity: 1.0,
    sourceId: undefined,
  }));
}
