// File: components/drawing-canvas/VertexPaintEngine.jsx
// R3F component for vertex color painting + face selection via raycasting
"use client";

import { useRef, useMemo, useCallback, useEffect } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * VertexPaintEngine — renders inside R3F <Canvas>.
 * Uses raycasting to paint vertex colors on the target mesh.
 *
 * Props:
 *   meshRef    - ref to the Three.js Mesh to paint
 *   paintMode  - "off" | "vertex_paint" | "face_select"
 *   paintColor - hex color string
 *   brushRadius - world-space radius for brush paint
 *   onPaintStart / onPaintEnd - callbacks to disable/enable orbit controls
 */
export default function VertexPaintEngine({
  meshRef,
  paintMode,
  paintColor,
  brushRadius = 0.05,
  onPaintStart,
  onPaintEnd,
}) {
  const { camera, gl, raycaster, pointer } = useThree();
  const isPainting = useRef(false);
  const cursorRef = useRef();

  // Memoize paint color as THREE.Color
  const color3 = useMemo(() => new THREE.Color(paintColor), [paintColor]);

  // Ensure geometry has a vertex color attribute
  useEffect(() => {
    if (!meshRef?.current || paintMode === "off") return;
    const mesh = meshRef.current;
    const geo = mesh.geometry;

    if (!geo.attributes.color) {
      // Initialize all vertices to white
      const count = geo.attributes.position.count;
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < colors.length; i++) colors[i] = 1.0;
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    }

    // Enable vertex colors on material
    if (mesh.material && !mesh.material.vertexColors) {
      mesh.material.vertexColors = true;
      mesh.material.needsUpdate = true;
    }
  }, [meshRef, paintMode]);

  // Clean up vertex colors when paint mode turns off
  useEffect(() => {
    if (paintMode === "off" && meshRef?.current) {
      const mesh = meshRef.current;
      if (mesh.material && mesh.material.vertexColors) {
        // Keep vertex colors but keep flag so they stay visible
      }
    }
  }, [paintMode, meshRef]);

  const paintAtPoint = useCallback(() => {
    if (paintMode === "off" || !meshRef?.current) return;

    const mesh = meshRef.current;
    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObject(mesh, false);
    if (intersects.length === 0) return;

    const hit = intersects[0];
    const geo = mesh.geometry;
    const colors = geo.attributes.color;
    if (!colors) return;

    if (paintMode === "face_select" && hit.face) {
      // Paint entire face (3 vertices)
      const { a, b, c } = hit.face;
      colors.setXYZ(a, color3.r, color3.g, color3.b);
      colors.setXYZ(b, color3.r, color3.g, color3.b);
      colors.setXYZ(c, color3.r, color3.g, color3.b);
    } else if (paintMode === "vertex_paint") {
      // Brush paint: color all vertices within radius
      const positions = geo.attributes.position;
      const hitLocal = hit.point.clone();
      mesh.worldToLocal(hitLocal);
      const v = new THREE.Vector3();

      for (let i = 0; i < positions.count; i++) {
        v.fromBufferAttribute(positions, i);
        if (v.distanceTo(hitLocal) <= brushRadius) {
          // Blend based on distance (soft falloff)
          const dist = v.distanceTo(hitLocal);
          const t = 1.0 - (dist / brushRadius);
          const existing = new THREE.Color(
            colors.getX(i),
            colors.getY(i),
            colors.getZ(i)
          );
          existing.lerp(color3, t * 0.5);
          colors.setXYZ(i, existing.r, existing.g, existing.b);
        }
      }
    }

    colors.needsUpdate = true;
  }, [paintMode, meshRef, camera, raycaster, pointer, color3, brushRadius]);

  // Update brush cursor position each frame
  useFrame(() => {
    if (paintMode === "off" || !meshRef?.current || !cursorRef.current) {
      if (cursorRef.current) cursorRef.current.visible = false;
      return;
    }

    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObject(meshRef.current, false);

    if (intersects.length > 0) {
      cursorRef.current.visible = true;
      cursorRef.current.position.copy(intersects[0].point);
      // Orient cursor to surface normal
      if (intersects[0].face) {
        const normal = intersects[0].face.normal.clone();
        normal.transformDirection(meshRef.current.matrixWorld);
        cursorRef.current.lookAt(
          intersects[0].point.x + normal.x,
          intersects[0].point.y + normal.y,
          intersects[0].point.z + normal.z
        );
      }

      // Paint while button is held
      if (isPainting.current) {
        paintAtPoint();
      }
    } else {
      cursorRef.current.visible = false;
    }
  });

  // Pointer event handlers on the canvas
  useEffect(() => {
    if (paintMode === "off") return;
    const canvas = gl.domElement;

    const onPointerDown = (e) => {
      if (e.button !== 0) return; // left click only
      isPainting.current = true;
      onPaintStart?.();
      paintAtPoint();
    };

    const onPointerUp = () => {
      isPainting.current = false;
      onPaintEnd?.();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerUp);

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerUp);
    };
  }, [paintMode, gl, onPaintStart, onPaintEnd, paintAtPoint]);

  if (paintMode === "off") return null;

  // Render brush cursor ring
  return (
    <mesh ref={cursorRef} visible={false}>
      <ringGeometry args={[brushRadius * 0.9, brushRadius, 32]} />
      <meshBasicMaterial
        color={paintColor}
        transparent
        opacity={0.5}
        side={THREE.DoubleSide}
        depthTest={false}
      />
    </mesh>
  );
}
