/**
 * svg-to-anchors.js — Parse SVG path `d` attributes into VectorEngine AnchorPoint arrays
 *
 * Supports SVG path commands:
 *   M x y       — moveTo (start new subpath)
 *   L x y       — lineTo (corner anchor)
 *   C x1 y1 x2 y2 x y — cubic Bezier (smooth anchor with handleIn/handleOut)
 *   Q x1 y1 x y — quadratic Bezier (converted to cubic via 2/3 rule)
 *   Z           — closePath
 *
 * Each parsed subpath becomes one set of anchors for a VectorPath.
 */

/**
 * Parse a single SVG path `d` string into one or more subpaths of anchors.
 * @param {string} dString - SVG path `d` attribute
 * @returns {{ anchors: AnchorPoint[], closed: boolean }[]} Array of subpaths
 */
export function svgPathToAnchors(dString) {
  if (!dString || typeof dString !== "string") return [];

  const tokens = tokenize(dString);
  const subpaths = [];
  let currentAnchors = [];
  let currentPos = { x: 0, y: 0 };
  let subpathStart = { x: 0, y: 0 };
  let closed = false;
  let i = 0;

  while (i < tokens.length) {
    const cmd = tokens[i];
    i++;

    switch (cmd) {
      case "M":
      case "m": {
        // Start new subpath — flush any existing
        if (currentAnchors.length > 0) {
          subpaths.push({ anchors: currentAnchors, closed });
        }
        currentAnchors = [];
        closed = false;

        const x = cmd === "M" ? parseFloat(tokens[i]) : currentPos.x + parseFloat(tokens[i]);
        const y = cmd === "M" ? parseFloat(tokens[i + 1]) : currentPos.y + parseFloat(tokens[i + 1]);
        i += 2;

        currentPos = { x, y };
        subpathStart = { x, y };

        currentAnchors.push({
          x, y,
          handleIn: null,
          handleOut: null,
          pressure: 0.5,
          type: "corner",
        });

        // Additional coordinate pairs after M are treated as L
        while (i < tokens.length && isNumber(tokens[i])) {
          const lx = cmd === "M" ? parseFloat(tokens[i]) : currentPos.x + parseFloat(tokens[i]);
          const ly = cmd === "M" ? parseFloat(tokens[i + 1]) : currentPos.y + parseFloat(tokens[i + 1]);
          i += 2;
          currentPos = { x: lx, y: ly };
          currentAnchors.push({
            x: lx, y: ly,
            handleIn: null,
            handleOut: null,
            pressure: 0.5,
            type: "corner",
          });
        }
        break;
      }

      case "L":
      case "l": {
        while (i < tokens.length && isNumber(tokens[i])) {
          const x = cmd === "L" ? parseFloat(tokens[i]) : currentPos.x + parseFloat(tokens[i]);
          const y = cmd === "L" ? parseFloat(tokens[i + 1]) : currentPos.y + parseFloat(tokens[i + 1]);
          i += 2;
          currentPos = { x, y };
          currentAnchors.push({
            x, y,
            handleIn: null,
            handleOut: null,
            pressure: 0.5,
            type: "corner",
          });
        }
        break;
      }

      case "H":
      case "h": {
        while (i < tokens.length && isNumber(tokens[i])) {
          const x = cmd === "H" ? parseFloat(tokens[i]) : currentPos.x + parseFloat(tokens[i]);
          i++;
          currentPos = { x, y: currentPos.y };
          currentAnchors.push({
            x, y: currentPos.y,
            handleIn: null,
            handleOut: null,
            pressure: 0.5,
            type: "corner",
          });
        }
        break;
      }

      case "V":
      case "v": {
        while (i < tokens.length && isNumber(tokens[i])) {
          const y = cmd === "V" ? parseFloat(tokens[i]) : currentPos.y + parseFloat(tokens[i]);
          i++;
          currentPos = { x: currentPos.x, y };
          currentAnchors.push({
            x: currentPos.x, y,
            handleIn: null,
            handleOut: null,
            pressure: 0.5,
            type: "corner",
          });
        }
        break;
      }

      case "C":
      case "c": {
        while (i + 5 < tokens.length && isNumber(tokens[i])) {
          const isRel = cmd === "c";
          const bx = isRel ? currentPos.x : 0;
          const by = isRel ? currentPos.y : 0;

          const cp1x = bx + parseFloat(tokens[i]);
          const cp1y = by + parseFloat(tokens[i + 1]);
          const cp2x = bx + parseFloat(tokens[i + 2]);
          const cp2y = by + parseFloat(tokens[i + 3]);
          const ex = bx + parseFloat(tokens[i + 4]);
          const ey = by + parseFloat(tokens[i + 5]);
          i += 6;

          // Set handleOut on previous anchor
          const prevAnchor = currentAnchors[currentAnchors.length - 1];
          if (prevAnchor) {
            prevAnchor.handleOut = {
              x: cp1x - prevAnchor.x,
              y: cp1y - prevAnchor.y,
            };
            prevAnchor.type = "smooth";
          }

          // Create new anchor with handleIn from cp2
          currentPos = { x: ex, y: ey };
          currentAnchors.push({
            x: ex, y: ey,
            handleIn: { x: cp2x - ex, y: cp2y - ey },
            handleOut: null,
            pressure: 0.5,
            type: "smooth",
          });
        }
        break;
      }

      case "Q":
      case "q": {
        // Quadratic Bezier → convert to cubic using 2/3 rule
        while (i + 3 < tokens.length && isNumber(tokens[i])) {
          const isRel = cmd === "q";
          const bx = isRel ? currentPos.x : 0;
          const by = isRel ? currentPos.y : 0;

          const qx = bx + parseFloat(tokens[i]);
          const qy = by + parseFloat(tokens[i + 1]);
          const ex = bx + parseFloat(tokens[i + 2]);
          const ey = by + parseFloat(tokens[i + 3]);
          i += 4;

          // Convert Q control point to C control points: CP1 = P0 + 2/3*(Q - P0), CP2 = P3 + 2/3*(Q - P3)
          const cp1x = currentPos.x + (2 / 3) * (qx - currentPos.x);
          const cp1y = currentPos.y + (2 / 3) * (qy - currentPos.y);
          const cp2x = ex + (2 / 3) * (qx - ex);
          const cp2y = ey + (2 / 3) * (qy - ey);

          const prevAnchor = currentAnchors[currentAnchors.length - 1];
          if (prevAnchor) {
            prevAnchor.handleOut = {
              x: cp1x - prevAnchor.x,
              y: cp1y - prevAnchor.y,
            };
            prevAnchor.type = "smooth";
          }

          currentPos = { x: ex, y: ey };
          currentAnchors.push({
            x: ex, y: ey,
            handleIn: { x: cp2x - ex, y: cp2y - ey },
            handleOut: null,
            pressure: 0.5,
            type: "smooth",
          });
        }
        break;
      }

      case "Z":
      case "z": {
        closed = true;
        currentPos = { ...subpathStart };
        break;
      }

      default:
        // Skip unknown commands
        break;
    }
  }

  // Flush last subpath
  if (currentAnchors.length > 0) {
    subpaths.push({ anchors: currentAnchors, closed });
  }

  return subpaths;
}

/**
 * Convert API response paths to VectorPath objects
 * @param {Array<{ d: string, stroke?: string, strokeWidth?: number, label?: string }>} apiPaths
 * @returns {VectorPath[]}
 */
export function apiPathsToVectorPaths(apiPaths) {
  const vectorPaths = [];

  for (const apiPath of apiPaths) {
    const subpaths = svgPathToAnchors(apiPath.d);

    for (const subpath of subpaths) {
      if (subpath.anchors.length < 2) continue;

      vectorPaths.push({
        id: crypto.randomUUID(),
        anchors: subpath.anchors,
        closed: subpath.closed,
        color: apiPath.stroke || "#000000",
        baseWidth: Math.max(apiPath.strokeWidth || 3, 6),
        opacity: 1.0,
        tool: "pencil",
        isGhost: false,
      });
    }
  }

  return vectorPaths;
}

// ─── Internal Helpers ────────────────────────────────────

/**
 * Tokenize an SVG path `d` string into commands and numbers.
 */
function tokenize(d) {
  const tokens = [];
  // Match commands (single letters) and numbers (including negatives, decimals)
  const regex = /([a-zA-Z])|(-?\d+\.?\d*(?:e[+-]?\d+)?)/g;
  let match;
  while ((match = regex.exec(d)) !== null) {
    tokens.push(match[0]);
  }
  return tokens;
}

/**
 * Check if a token looks like a number.
 */
function isNumber(token) {
  if (!token) return false;
  return /^-?\d/.test(token);
}
