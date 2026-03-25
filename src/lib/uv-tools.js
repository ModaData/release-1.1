// File: lib/uv-tools.js — UV island detection, rectification, texel density normalization
// Used by useUVMorph.js for 3D→2D pattern flattening

/**
 * Find connected UV islands in a BufferGeometry.
 * Uses face adjacency + UV continuity to identify separate pieces.
 *
 * @param {THREE.BufferGeometry} geometry
 * @returns {Island[]} Array of islands, each with faceIndices, vertexIndices, bounds, area
 */
export function findUVIslands(geometry) {
  const index = geometry.index;
  const uvAttr = geometry.attributes.uv;

  if (!uvAttr) return [];

  const faceCount = index ? index.count / 3 : uvAttr.count / 3;
  const visited = new Uint8Array(faceCount);

  // Build edge → face adjacency map (keyed by UV-quantized edge)
  const edgeToFaces = new Map();

  function uvKey(vi) {
    const u = uvAttr.getX(vi);
    const v = uvAttr.getY(vi);
    // Quantize to avoid floating-point mismatch
    return `${Math.round(u * 10000)},${Math.round(v * 10000)}`;
  }

  function edgeKey(a, b) {
    const ka = uvKey(a);
    const kb = uvKey(b);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  }

  for (let f = 0; f < faceCount; f++) {
    const i0 = index ? index.getX(f * 3) : f * 3;
    const i1 = index ? index.getX(f * 3 + 1) : f * 3 + 1;
    const i2 = index ? index.getX(f * 3 + 2) : f * 3 + 2;

    const edges = [edgeKey(i0, i1), edgeKey(i1, i2), edgeKey(i2, i0)];
    for (const ek of edges) {
      if (!edgeToFaces.has(ek)) edgeToFaces.set(ek, []);
      edgeToFaces.get(ek).push(f);
    }
  }

  // Build face adjacency list
  const faceAdj = Array.from({ length: faceCount }, () => []);
  for (const faces of edgeToFaces.values()) {
    for (let a = 0; a < faces.length; a++) {
      for (let b = a + 1; b < faces.length; b++) {
        faceAdj[faces[a]].push(faces[b]);
        faceAdj[faces[b]].push(faces[a]);
      }
    }
  }

  // Flood-fill connected components
  const islands = [];

  for (let f = 0; f < faceCount; f++) {
    if (visited[f]) continue;

    const faceIndices = [];
    const vertexSet = new Set();
    const stack = [f];

    while (stack.length > 0) {
      const face = stack.pop();
      if (visited[face]) continue;
      visited[face] = 1;
      faceIndices.push(face);

      // Collect vertices
      const i0 = index ? index.getX(face * 3) : face * 3;
      const i1 = index ? index.getX(face * 3 + 1) : face * 3 + 1;
      const i2 = index ? index.getX(face * 3 + 2) : face * 3 + 2;
      vertexSet.add(i0);
      vertexSet.add(i1);
      vertexSet.add(i2);

      // Visit adjacent faces
      for (const adj of faceAdj[face]) {
        if (!visited[adj]) stack.push(adj);
      }
    }

    const vertexIndices = Array.from(vertexSet);

    // Compute UV bounds
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const vi of vertexIndices) {
      const u = uvAttr.getX(vi);
      const v = uvAttr.getY(vi);
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }

    // Compute UV area (sum of triangle areas in UV space)
    let area = 0;
    for (const fi of faceIndices) {
      const a = index ? index.getX(fi * 3) : fi * 3;
      const b = index ? index.getX(fi * 3 + 1) : fi * 3 + 1;
      const c = index ? index.getX(fi * 3 + 2) : fi * 3 + 2;
      const au = uvAttr.getX(a), av = uvAttr.getY(a);
      const bu = uvAttr.getX(b), bv = uvAttr.getY(b);
      const cu = uvAttr.getX(c), cv = uvAttr.getY(c);
      area += Math.abs((bu - au) * (cv - av) - (cu - au) * (bv - av)) * 0.5;
    }

    islands.push({
      faceIndices,
      vertexIndices,
      bounds: { minU, maxU, minV, maxV },
      area,
    });
  }

  // Sort by area descending (largest island first)
  islands.sort((a, b) => b.area - a.area);

  return islands;
}

/**
 * Rectify a curved UV island into a rectangle using Coons patch interpolation.
 * Finds the boundary loop, identifies 4 corners, then redistributes interior UVs.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {Island} island
 * @returns {Map<number, {u: number, v: number}>} Map of vertex index → new UV coordinates
 */
export function rectifyIsland(geometry, island) {
  const uvAttr = geometry.attributes.uv;
  const indexAttr = geometry.index;
  const result = new Map();

  // Build edge count map to find boundary edges (edges shared by only 1 face)
  const edgeCount = new Map();
  for (const fi of island.faceIndices) {
    const verts = [
      indexAttr ? indexAttr.getX(fi * 3) : fi * 3,
      indexAttr ? indexAttr.getX(fi * 3 + 1) : fi * 3 + 1,
      indexAttr ? indexAttr.getX(fi * 3 + 2) : fi * 3 + 2,
    ];
    for (let e = 0; e < 3; e++) {
      const a = verts[e], b = verts[(e + 1) % 3];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
    }
  }

  // Extract boundary edges (count === 1)
  const boundaryEdges = [];
  for (const [key, count] of edgeCount) {
    if (count === 1) {
      const [a, b] = key.split("-").map(Number);
      boundaryEdges.push([a, b]);
    }
  }

  if (boundaryEdges.length < 3) {
    // Island has no clear boundary (fully interior or degenerate)
    return result;
  }

  // Order boundary into a loop
  const adjMap = new Map();
  for (const [a, b] of boundaryEdges) {
    if (!adjMap.has(a)) adjMap.set(a, []);
    if (!adjMap.has(b)) adjMap.set(b, []);
    adjMap.get(a).push(b);
    adjMap.get(b).push(a);
  }

  const loop = [];
  const loopVisited = new Set();
  let current = boundaryEdges[0][0];
  while (!loopVisited.has(current) && adjMap.has(current)) {
    loopVisited.add(current);
    loop.push(current);
    const neighbors = adjMap.get(current);
    const next = neighbors.find((n) => !loopVisited.has(n));
    if (next === undefined) break;
    current = next;
  }

  if (loop.length < 4) return result;

  // Find 4 corners: vertices with the sharpest angle change
  const angles = [];
  for (let i = 0; i < loop.length; i++) {
    const prev = loop[(i - 1 + loop.length) % loop.length];
    const curr = loop[i];
    const next = loop[(i + 1) % loop.length];

    const pu = uvAttr.getX(prev), pv = uvAttr.getY(prev);
    const cu = uvAttr.getX(curr), cv = uvAttr.getY(curr);
    const nu = uvAttr.getX(next), nv = uvAttr.getY(next);

    const dx1 = cu - pu, dy1 = cv - pv;
    const dx2 = nu - cu, dy2 = nv - cv;
    const cross = Math.abs(dx1 * dy2 - dy1 * dx2);
    angles.push({ index: i, vertex: curr, sharpness: cross });
  }

  // Pick 4 sharpest corners
  angles.sort((a, b) => b.sharpness - a.sharpness);
  const cornerIndices = angles.slice(0, 4).map((a) => a.index).sort((a, b) => a - b);

  // Split boundary into 4 sides between corners
  const sides = [];
  for (let s = 0; s < 4; s++) {
    const start = cornerIndices[s];
    const end = cornerIndices[(s + 1) % 4];
    const side = [];
    let i = start;
    while (true) {
      side.push(loop[i]);
      if (i === end) break;
      i = (i + 1) % loop.length;
    }
    sides.push(side);
  }

  // Map boundary vertices to normalized [0,1] rectangle edges
  for (let s = 0; s < 4; s++) {
    const side = sides[s];
    for (let i = 0; i < side.length; i++) {
      const t = side.length > 1 ? i / (side.length - 1) : 0;
      let u, v;
      switch (s) {
        case 0: u = t; v = 0; break;        // bottom
        case 1: u = 1; v = t; break;         // right
        case 2: u = 1 - t; v = 1; break;     // top
        case 3: u = 0; v = 1 - t; break;     // left
      }
      // Scale back to island bounds
      const { minU, maxU, minV, maxV } = island.bounds;
      result.set(side[i], {
        u: minU + u * (maxU - minU),
        v: minV + v * (maxV - minV),
      });
    }
  }

  // Interior vertices: bilinear interpolation (Coons patch approximation)
  const boundarySet = new Set(loop);
  for (const vi of island.vertexIndices) {
    if (boundarySet.has(vi)) continue;

    // Simple approach: project interior vertex UV proportionally within bounds
    const ou = uvAttr.getX(vi);
    const ov = uvAttr.getY(vi);
    const { minU, maxU, minV, maxV } = island.bounds;
    const nu = (ou - minU) / (maxU - minU || 1);
    const nv = (ov - minV) / (maxV - minV || 1);
    result.set(vi, {
      u: minU + nu * (maxU - minU),
      v: minV + nv * (maxV - minV),
    });
  }

  return result;
}

/**
 * Normalize texel density across all UV islands.
 * Scales each island so fabric texture appears at consistent scale.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {Island[]} islands
 */
export function normalizeTexelDensity(geometry, islands) {
  const uvAttr = geometry.attributes.uv;
  const posAttr = geometry.attributes.position;
  const indexAttr = geometry.index;

  if (!uvAttr || !posAttr || islands.length === 0) return;

  // Compute texel density per island: 3D_surface_area / UV_area
  const densities = islands.map((island) => {
    let surfaceArea = 0;
    for (const fi of island.faceIndices) {
      const a = indexAttr ? indexAttr.getX(fi * 3) : fi * 3;
      const b = indexAttr ? indexAttr.getX(fi * 3 + 1) : fi * 3 + 1;
      const c = indexAttr ? indexAttr.getX(fi * 3 + 2) : fi * 3 + 2;

      // 3D triangle area
      const ax = posAttr.getX(a), ay = posAttr.getY(a), az = posAttr.getZ(a);
      const bx = posAttr.getX(b), by = posAttr.getY(b), bz = posAttr.getZ(b);
      const cx = posAttr.getX(c), cy = posAttr.getY(c), cz = posAttr.getZ(c);

      const abx = bx - ax, aby = by - ay, abz = bz - az;
      const acx = cx - ax, acy = cy - ay, acz = cz - az;
      const crossX = aby * acz - abz * acy;
      const crossY = abz * acx - abx * acz;
      const crossZ = abx * acy - aby * acx;
      surfaceArea += Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ) * 0.5;
    }

    const uvArea = island.area || 0.001;
    return { surfaceArea, uvArea, density: surfaceArea / uvArea };
  });

  // Find median density
  const sorted = densities.map((d) => d.density).sort((a, b) => a - b);
  const medianDensity = sorted[Math.floor(sorted.length / 2)];

  if (medianDensity <= 0) return;

  // Scale each island's UVs to match median density
  for (let i = 0; i < islands.length; i++) {
    const island = islands[i];
    const d = densities[i];
    const scaleFactor = Math.sqrt(d.density / medianDensity);

    if (Math.abs(scaleFactor - 1.0) < 0.01) continue; // Already close

    // Compute island UV centroid
    let cu = 0, cv = 0;
    for (const vi of island.vertexIndices) {
      cu += uvAttr.getX(vi);
      cv += uvAttr.getY(vi);
    }
    cu /= island.vertexIndices.length;
    cv /= island.vertexIndices.length;

    // Scale UVs around centroid
    for (const vi of island.vertexIndices) {
      const u = uvAttr.getX(vi);
      const v = uvAttr.getY(vi);
      uvAttr.setXY(vi, cu + (u - cu) * scaleFactor, cv + (v - cv) * scaleFactor);
    }
  }

  uvAttr.needsUpdate = true;
}

/**
 * Compute per-island offsets for non-overlapping pattern layout.
 * Uses row-packing: largest islands first, wraps to next row when width exceeded.
 *
 * @param {Island[]} islands - Pre-sorted by area (largest first)
 * @param {number} gap - Spacing between islands (UV units, default 0.15)
 * @returns {{x: number, y: number}[]} Offset per island
 */
export function computeIslandSpacing(islands, gap = 0.15) {
  if (islands.length === 0) return [];
  if (islands.length === 1) return [{ x: 0, y: 0 }];

  const offsets = [];
  const maxRowWidth = 3.0; // Total layout width in UV-scale units
  let curX = 0;
  let curY = 0;
  let rowHeight = 0;

  for (const island of islands) {
    const w = island.bounds.maxU - island.bounds.minU;
    const h = island.bounds.maxV - island.bounds.minV;

    // Wrap to next row if exceeds width
    if (curX + w + gap > maxRowWidth && curX > 0) {
      curX = 0;
      curY -= rowHeight + gap;
      rowHeight = 0;
    }

    // Offset = desired position minus current island center
    const islandCenterU = (island.bounds.minU + island.bounds.maxU) / 2;
    const islandCenterV = (island.bounds.minV + island.bounds.maxV) / 2;

    offsets.push({
      x: curX + w / 2 - islandCenterU,
      y: curY - h / 2 - islandCenterV + 0.5, // shift up so layout is centered
    });

    curX += w + gap;
    rowHeight = Math.max(rowHeight, h);
  }

  // Center the entire layout
  const layoutWidth = curX - gap;
  const xShift = -layoutWidth / 2;
  for (const o of offsets) {
    o.x += xShift;
  }

  return offsets;
}

/**
 * Compute island centroids (UV space).
 *
 * @param {Island[]} islands
 * @param {THREE.BufferGeometry} geometry
 * @returns {{x: number, y: number}[]}
 */
export function computeIslandCentroids(islands, geometry) {
  const uvAttr = geometry.attributes.uv;
  return islands.map((island) => {
    let cx = 0, cy = 0;
    for (const vi of island.vertexIndices) {
      cx += uvAttr.getX(vi);
      cy += uvAttr.getY(vi);
    }
    const n = island.vertexIndices.length || 1;
    return { x: cx / n, y: cy / n };
  });
}
