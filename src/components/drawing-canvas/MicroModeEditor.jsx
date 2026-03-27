// File: components/drawing-canvas/MicroModeEditor.jsx
// "Microsoft Paint simplicity, Blender granularity" mesh editor
// Provides face/vertex hover highlighting, brush tools, and real-time WebSocket editing
"use client";

import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";

// ── Face Highlight Overlay — shows hovered/selected faces ──
export function FaceHighlighter({ meshRef, hoveredFace, selectedFaces = [], enabled = false }) {
  const highlightRef = useRef();
  const lineRef = useRef();

  useFrame(() => {
    if (!enabled || !meshRef?.current || !highlightRef.current) return;

    const mesh = meshRef.current;
    const geo = mesh.geometry;
    if (!geo || !geo.index) return;

    const positions = geo.attributes.position;
    const index = geo.index;

    // Build highlight geometry from selected + hovered faces
    const facesToShow = new Set(selectedFaces);
    if (hoveredFace !== null && hoveredFace !== undefined) {
      facesToShow.add(hoveredFace);
    }

    if (facesToShow.size === 0) {
      highlightRef.current.visible = false;
      if (lineRef.current) lineRef.current.visible = false;
      return;
    }

    // Create triangle geometry for highlighted faces
    const verts = [];
    const edgeVerts = [];

    for (const faceIdx of facesToShow) {
      const baseIdx = faceIdx * 3;
      if (baseIdx + 2 >= index.count) continue;

      const i0 = index.getX(baseIdx);
      const i1 = index.getX(baseIdx + 1);
      const i2 = index.getX(baseIdx + 2);

      const v0 = new THREE.Vector3().fromBufferAttribute(positions, i0);
      const v1 = new THREE.Vector3().fromBufferAttribute(positions, i1);
      const v2 = new THREE.Vector3().fromBufferAttribute(positions, i2);

      // Offset slightly along face normal to prevent z-fighting
      const normal = new THREE.Vector3()
        .crossVectors(
          new THREE.Vector3().subVectors(v1, v0),
          new THREE.Vector3().subVectors(v2, v0)
        )
        .normalize()
        .multiplyScalar(0.0005);

      verts.push(
        v0.x + normal.x, v0.y + normal.y, v0.z + normal.z,
        v1.x + normal.x, v1.y + normal.y, v1.z + normal.z,
        v2.x + normal.x, v2.y + normal.y, v2.z + normal.z
      );

      // Edge wireframe
      edgeVerts.push(
        v0.x + normal.x, v0.y + normal.y, v0.z + normal.z,
        v1.x + normal.x, v1.y + normal.y, v1.z + normal.z,
        v1.x + normal.x, v1.y + normal.y, v1.z + normal.z,
        v2.x + normal.x, v2.y + normal.y, v2.z + normal.z,
        v2.x + normal.x, v2.y + normal.y, v2.z + normal.z,
        v0.x + normal.x, v0.y + normal.y, v0.z + normal.z
      );
    }

    // Update highlight mesh
    const bufGeo = highlightRef.current.geometry;
    bufGeo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    bufGeo.computeVertexNormals();
    highlightRef.current.visible = true;

    // Update edge lines
    if (lineRef.current) {
      const lineGeo = lineRef.current.geometry;
      lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(edgeVerts, 3));
      lineRef.current.visible = true;
    }
  });

  if (!enabled) return null;

  return (
    <>
      {/* Semi-transparent face highlight */}
      <mesh ref={highlightRef} renderOrder={1}>
        <bufferGeometry />
        <meshBasicMaterial
          color={hoveredFace !== null ? "#818cf8" : "#6366f1"}
          transparent
          opacity={0.35}
          side={THREE.DoubleSide}
          depthTest={true}
          depthWrite={false}
        />
      </mesh>

      {/* Edge wireframe outline */}
      <lineSegments ref={lineRef} renderOrder={2}>
        <bufferGeometry />
        <lineBasicMaterial color="#4f46e5" linewidth={1.5} depthTest={true} />
      </lineSegments>
    </>
  );
}


// ── Vertex Dots — shows vertices as small spheres ──
export function VertexDots({ meshRef, selectedVerts = [], hoveredVert = null, enabled = false }) {
  const dotsRef = useRef();

  useFrame(() => {
    if (!enabled || !meshRef?.current || !dotsRef.current) return;

    const mesh = meshRef.current;
    const positions = mesh.geometry?.attributes?.position;
    if (!positions) return;

    const vertsToShow = new Set(selectedVerts);
    if (hoveredVert !== null) vertsToShow.add(hoveredVert);

    if (vertsToShow.size === 0) {
      dotsRef.current.visible = false;
      return;
    }

    const dotPositions = [];
    for (const idx of vertsToShow) {
      if (idx < positions.count) {
        dotPositions.push(
          positions.getX(idx),
          positions.getY(idx),
          positions.getZ(idx)
        );
      }
    }

    const geo = dotsRef.current.geometry;
    geo.setAttribute("position", new THREE.Float32BufferAttribute(dotPositions, 3));
    dotsRef.current.visible = true;
  });

  if (!enabled) return null;

  return (
    <points ref={dotsRef} renderOrder={3}>
      <bufferGeometry />
      <pointsMaterial color="#f59e0b" size={6} sizeAttenuation={false} depthTest={false} />
    </points>
  );
}


// ── Raycaster for face/vertex picking ──
export function useMeshPicker(meshRef, enabled = false) {
  const { camera, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const mouse = useRef(new THREE.Vector2());
  const [hoveredFace, setHoveredFace] = useState(null);
  const [hoveredVert, setHoveredVert] = useState(null);

  const onPointerMove = useCallback((event) => {
    if (!enabled || !meshRef?.current) return;

    const rect = gl.domElement.getBoundingClientRect();
    mouse.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse.current, camera);
    const intersects = raycaster.intersectObject(meshRef.current, false);

    if (intersects.length > 0) {
      const hit = intersects[0];
      setHoveredFace(hit.faceIndex ?? null);

      // Find nearest vertex to intersection point
      const face = hit.face;
      if (face) {
        const positions = meshRef.current.geometry.attributes.position;
        const candidates = [face.a, face.b, face.c];
        let nearestIdx = candidates[0];
        let nearestDist = Infinity;

        for (const idx of candidates) {
          const vPos = new THREE.Vector3().fromBufferAttribute(positions, idx);
          meshRef.current.localToWorld(vPos);
          const d = vPos.distanceTo(hit.point);
          if (d < nearestDist) {
            nearestDist = d;
            nearestIdx = idx;
          }
        }
        setHoveredVert(nearestIdx);
      }
    } else {
      setHoveredFace(null);
      setHoveredVert(null);
    }
  }, [enabled, meshRef, camera, gl, raycaster]);

  useEffect(() => {
    if (!enabled) return;
    const canvas = gl.domElement;
    canvas.addEventListener("pointermove", onPointerMove);
    return () => canvas.removeEventListener("pointermove", onPointerMove);
  }, [enabled, gl, onPointerMove]);

  return { hoveredFace, hoveredVert };
}


// ── Brush Cursor — shows the sculpt brush radius on the mesh surface ──
export function BrushCursor({ meshRef, radius = 0.05, enabled = false }) {
  const cursorRef = useRef();
  const { camera, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const mouse = useRef(new THREE.Vector2());

  useEffect(() => {
    if (!enabled) return;

    const onMove = (event) => {
      if (!meshRef?.current || !cursorRef.current) return;

      const rect = gl.domElement.getBoundingClientRect();
      mouse.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse.current, camera);
      const hits = raycaster.intersectObject(meshRef.current, false);

      if (hits.length > 0) {
        const hit = hits[0];
        cursorRef.current.position.copy(hit.point);
        cursorRef.current.lookAt(hit.point.clone().add(hit.face.normal));
        cursorRef.current.visible = true;
      } else {
        cursorRef.current.visible = false;
      }
    };

    const canvas = gl.domElement;
    canvas.addEventListener("pointermove", onMove);
    return () => canvas.removeEventListener("pointermove", onMove);
  }, [enabled, meshRef, camera, gl, raycaster]);

  if (!enabled) return null;

  return (
    <mesh ref={cursorRef} renderOrder={10}>
      <ringGeometry args={[radius * 0.95, radius, 32]} />
      <meshBasicMaterial
        color="#818cf8"
        transparent
        opacity={0.6}
        side={THREE.DoubleSide}
        depthTest={false}
      />
    </mesh>
  );
}


// ── Edit Toolbar Overlay ──
export function EditToolbar({
  activeTool,
  onToolChange,
  brushRadius,
  onRadiusChange,
  brushStrength,
  onStrengthChange,
  connected,
  vertexCount,
  faceCount,
  selectedFaces = [],
}) {
  const tools = [
    { id: "select", label: "Select", icon: "S" },
    { id: "move", label: "Move", icon: "M" },
    { id: "sculpt_push", label: "Push", icon: "P" },
    { id: "sculpt_smooth", label: "Smooth", icon: "~" },
    { id: "sculpt_flatten", label: "Flatten", icon: "F" },
    { id: "extrude", label: "Extrude", icon: "E" },
    { id: "subdivide", label: "Subdiv", icon: "D" },
    { id: "delete", label: "Delete", icon: "X" },
  ];

  const isSculpt = activeTool.startsWith("sculpt_");

  return (
    <div className="absolute top-3 left-3 z-30 flex flex-col gap-2">
      {/* Connection status */}
      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-medium ${
        connected ? "bg-green-50 text-green-600 border border-green-100" : "bg-gray-50 text-gray-400 border border-gray-100"
      }`}>
        <div className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-green-500" : "bg-gray-300"}`} />
        {connected ? "Live Edit" : "View Only"}
        {connected && (
          <span className="text-[8px] text-gray-400 ml-1">
            {vertexCount}v / {faceCount}f
          </span>
        )}
      </div>

      {/* Tool buttons */}
      <div className="flex flex-wrap gap-1 bg-white/90 backdrop-blur-sm rounded-xl p-1.5 shadow-lg border border-gray-100">
        {tools.map((tool) => (
          <button
            key={tool.id}
            onClick={() => onToolChange(tool.id)}
            className={`w-8 h-8 rounded-lg text-[10px] font-bold flex items-center justify-center transition-colors ${
              activeTool === tool.id
                ? "bg-indigo-600 text-white"
                : "bg-gray-50 text-gray-500 hover:bg-indigo-50"
            }`}
            title={tool.label}
          >
            {tool.icon}
          </button>
        ))}
      </div>

      {/* Brush settings (sculpt tools only) */}
      {isSculpt && (
        <div className="bg-white/90 backdrop-blur-sm rounded-xl p-2.5 shadow-lg border border-gray-100 space-y-2">
          <div>
            <label className="text-[9px] text-gray-400 block mb-0.5">Radius</label>
            <input
              type="range"
              min={0.01}
              max={0.2}
              step={0.005}
              value={brushRadius}
              onChange={(e) => onRadiusChange(parseFloat(e.target.value))}
              className="w-full accent-indigo-500"
            />
            <span className="text-[9px] text-gray-500">{(brushRadius * 100).toFixed(0)}%</span>
          </div>
          <div>
            <label className="text-[9px] text-gray-400 block mb-0.5">Strength</label>
            <input
              type="range"
              min={0.1}
              max={1.0}
              step={0.05}
              value={brushStrength}
              onChange={(e) => onStrengthChange(parseFloat(e.target.value))}
              className="w-full accent-indigo-500"
            />
            <span className="text-[9px] text-gray-500">{(brushStrength * 100).toFixed(0)}%</span>
          </div>
        </div>
      )}

      {/* Selection info */}
      {selectedFaces.length > 0 && (
        <div className="bg-white/90 backdrop-blur-sm rounded-xl px-2.5 py-1.5 shadow-lg border border-gray-100">
          <span className="text-[9px] text-indigo-600 font-medium">
            {selectedFaces.length} face{selectedFaces.length > 1 ? "s" : ""} selected
          </span>
        </div>
      )}
    </div>
  );
}
