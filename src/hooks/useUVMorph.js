// File: hooks/useUVMorph.js
// Manages animated transition between 3D garment view and 2D flat pattern layout
// Uses GSAP for smooth vertex interpolation from 3D positions → UV coordinates
"use client";

import { useCallback, useRef, useState } from "react";
import gsap from "gsap";
import * as THREE from "three";
import { findUVIslands, computeIslandSpacing } from "@/lib/uv-tools";

/**
 * useUVMorph — Hook for 3D↔Pattern morph animation.
 *
 * Supports single mesh ref OR array of mesh refs for multi-part garments.
 *
 * Usage:
 *   const { morphToPattern, morphTo3D, isMorphing, morphProgress, isFlattened } = useUVMorph();
 *   morphToPattern(meshRefs);  // Animate 3D → flat pattern (single ref or array)
 *   morphTo3D(meshRefs);       // Animate back to 3D
 */
export function useUVMorph() {
  const [isMorphing, setIsMorphing] = useState(false);
  const [morphProgress, setMorphProgress] = useState(0);
  const [isFlattened, setIsFlattened] = useState(false);

  // Store original 3D positions and computed targets per geometry UUID
  const morphDataRef = useRef(new Map());
  // Active GSAP tween reference for cleanup
  const tweenRef = useRef(null);

  /**
   * Normalize input to array of Three.js Mesh objects.
   */
  const normalizeMeshInputs = useCallback((meshRefs) => {
    const refs = Array.isArray(meshRefs) ? meshRefs : [meshRefs];
    return refs
      .map((r) => r?.current || r)
      .filter((m) => m?.geometry);
  }, []);

  /**
   * Prepare morph data for a mesh (compute targets, store originals).
   * Called lazily on first morph — cached for subsequent toggles.
   */
  const prepareMorphData = useCallback((geometry) => {
    const positions = geometry.attributes.position;
    const uvAttr = geometry.attributes.uv;

    if (!uvAttr || !positions) return null;

    const vertexCount = positions.count;
    const original3D = new Float32Array(positions.array);
    const targets = new Float32Array(positions.array.length);

    // Detect UV islands for spacing
    const islands = findUVIslands(geometry);
    const islandOffsets = computeIslandSpacing(islands, 0.15);

    // Scale factor — controls how large the pattern appears
    const scale = 2.0;

    // Build vertex → island index map
    const vertexIslandMap = new Map();
    for (let idx = 0; idx < islands.length; idx++) {
      for (const vi of islands[idx].vertexIndices) {
        vertexIslandMap.set(vi, idx);
      }
    }

    // Compute target position for each vertex
    for (let vi = 0; vi < vertexCount; vi++) {
      const islandIdx = vertexIslandMap.get(vi);
      const offset = islandIdx !== undefined ? islandOffsets[islandIdx] : { x: 0, y: 0 };

      // UV → flat 2D position (centered at origin)
      const u = uvAttr.getX(vi);
      const v = uvAttr.getY(vi);

      targets[vi * 3] = (u - 0.5) * scale + offset.x;
      targets[vi * 3 + 1] = (v - 0.5) * scale + offset.y;
      // Tiny Z-offset per island to prevent Z-fighting
      targets[vi * 3 + 2] = islandIdx !== undefined ? 0.001 * islandIdx : 0;
    }

    return { original3D, targets, vertexCount, islands };
  }, []);

  /**
   * Animate meshes from 3D → flat pattern layout.
   *
   * @param {React.RefObject|React.RefObject[]|THREE.Mesh|THREE.Mesh[]} meshRefs
   * @param {object} options — { duration, ease, onComplete }
   */
  const morphToPattern = useCallback(
    (meshRefs, options = {}) => {
      const meshes = normalizeMeshInputs(meshRefs);
      if (meshes.length === 0) return;

      const { duration = 1.2, ease = "power2.inOut", onComplete } = options;

      // Kill any running tween
      if (tweenRef.current) {
        tweenRef.current.kill();
        tweenRef.current = null;
      }

      // Prepare morph data for each mesh
      const meshMorphData = [];
      for (const mesh of meshes) {
        const geometry = mesh.geometry;
        const geoId = geometry.uuid;

        if (!morphDataRef.current.has(geoId)) {
          const data = prepareMorphData(geometry);
          if (!data) continue;
          morphDataRef.current.set(geoId, data);
        }

        meshMorphData.push({
          geometry,
          positions: geometry.attributes.position,
          ...morphDataRef.current.get(geoId),
        });
      }

      if (meshMorphData.length === 0) return;

      setIsMorphing(true);
      setMorphProgress(0);

      const proxy = { t: 0 };
      tweenRef.current = gsap.to(proxy, {
        t: 1,
        duration,
        ease,
        onUpdate: () => {
          const t = proxy.t;
          setMorphProgress(t);

          for (const { geometry, positions, original3D, targets, vertexCount } of meshMorphData) {
            const posArray = positions.array;
            for (let i = 0; i < vertexCount; i++) {
              const i3 = i * 3;
              posArray[i3] = THREE.MathUtils.lerp(original3D[i3], targets[i3], t);
              posArray[i3 + 1] = THREE.MathUtils.lerp(original3D[i3 + 1], targets[i3 + 1], t);
              posArray[i3 + 2] = THREE.MathUtils.lerp(original3D[i3 + 2], targets[i3 + 2], t);
            }
            positions.needsUpdate = true;
            geometry.computeBoundingSphere();
            geometry.computeBoundingBox();
          }
        },
        onComplete: () => {
          setIsMorphing(false);
          setIsFlattened(true);
          setMorphProgress(1);
          tweenRef.current = null;
          onComplete?.();
        },
      });
    },
    [prepareMorphData, normalizeMeshInputs]
  );

  /**
   * Animate meshes from flat pattern → 3D.
   *
   * @param {React.RefObject|React.RefObject[]|THREE.Mesh|THREE.Mesh[]} meshRefs
   * @param {object} options — { duration, ease, onComplete }
   */
  const morphTo3D = useCallback(
    (meshRefs, options = {}) => {
      const meshes = normalizeMeshInputs(meshRefs);
      if (meshes.length === 0) return;

      const { duration = 1.2, ease = "power2.inOut", onComplete } = options;

      // Collect morph data for all meshes that have been morphed
      const meshMorphData = [];
      for (const mesh of meshes) {
        const geometry = mesh.geometry;
        const geoId = geometry.uuid;
        const morphData = morphDataRef.current.get(geoId);
        if (!morphData) continue; // Never morphed — skip

        meshMorphData.push({
          geometry,
          positions: geometry.attributes.position,
          ...morphData,
        });
      }

      if (meshMorphData.length === 0) return;

      // Kill any running tween
      if (tweenRef.current) {
        tweenRef.current.kill();
        tweenRef.current = null;
      }

      setIsMorphing(true);

      const proxy = { t: 1 };
      tweenRef.current = gsap.to(proxy, {
        t: 0,
        duration,
        ease,
        onUpdate: () => {
          const t = proxy.t;
          setMorphProgress(t);

          for (const { geometry, positions, original3D, targets, vertexCount } of meshMorphData) {
            const posArray = positions.array;
            for (let i = 0; i < vertexCount; i++) {
              const i3 = i * 3;
              posArray[i3] = THREE.MathUtils.lerp(original3D[i3], targets[i3], t);
              posArray[i3 + 1] = THREE.MathUtils.lerp(original3D[i3 + 1], targets[i3 + 1], t);
              posArray[i3 + 2] = THREE.MathUtils.lerp(original3D[i3 + 2], targets[i3 + 2], t);
            }
            positions.needsUpdate = true;
            geometry.computeBoundingSphere();
            geometry.computeBoundingBox();
          }
        },
        onComplete: () => {
          setIsMorphing(false);
          setIsFlattened(false);
          setMorphProgress(0);
          tweenRef.current = null;
          onComplete?.();
        },
      });
    },
    [normalizeMeshInputs]
  );

  /**
   * Toggle between pattern and 3D view.
   */
  const toggleMorph = useCallback(
    (meshRefs, options = {}) => {
      if (isMorphing) return;
      if (isFlattened) {
        morphTo3D(meshRefs, options);
      } else {
        morphToPattern(meshRefs, options);
      }
    },
    [isMorphing, isFlattened, morphToPattern, morphTo3D]
  );

  /**
   * Reset morph state (e.g., when loading a new mesh).
   */
  const resetMorph = useCallback(() => {
    if (tweenRef.current) {
      tweenRef.current.kill();
      tweenRef.current = null;
    }
    morphDataRef.current.clear();
    setIsMorphing(false);
    setMorphProgress(0);
    setIsFlattened(false);
  }, []);

  return {
    morphToPattern,
    morphTo3D,
    toggleMorph,
    resetMorph,
    isMorphing,
    morphProgress,
    isFlattened,
  };
}
