// File: components/drawing-canvas/PatternSplitView.jsx
// Digital Atelier split view: 3D garment (left) | draggable divider | 2D flat pattern (right)
"use client";

import { Suspense, useRef, useState, useCallback, useEffect, useMemo } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, OrthographicCamera, useGLTF, Grid, Line } from "@react-three/drei";
import * as THREE from "three";
import GarmentViewer3D from "./GarmentViewer3D";

// ── Flat Pattern Canvas (right panel) ──
function FlatPatternModel({ url, highlightedIslandId, onIslandClick, uvSyncEnabled }) {
  const { scene } = useGLTF(url);
  const groupRef = useRef();

  // Extract mesh entries and force flat morph
  const meshEntries = useMemo(() => {
    const entries = [];
    scene.traverse((child) => {
      if (child.isMesh) {
        entries.push({
          name: child.name,
          geometry: child.geometry,
          material: child.material,
          position: child.position.clone(),
          rotation: child.rotation.clone(),
          scale: child.scale.clone(),
          morphTargetDictionary: child.morphTargetDictionary,
          morphTargetInfluences: child.morphTargetInfluences
            ? [...child.morphTargetInfluences]
            : undefined,
        });
      }
    });
    return entries;
  }, [scene]);

  // Compute UV island groups for sync selection
  const islandMap = useMemo(() => {
    const map = new Map(); // islandId -> { faceIndices, meshName }
    meshEntries.forEach((entry) => {
      const uv = entry.geometry.attributes.uv;
      const index = entry.geometry.index;
      if (!uv || !index) return;

      // Group faces by UV island using flood-fill on shared UV edges
      const faceCount = index.count / 3;
      const visited = new Uint8Array(faceCount);
      let islandId = 0;

      for (let f = 0; f < faceCount; f++) {
        if (visited[f]) continue;
        const queue = [f];
        visited[f] = 1;
        const faces = [];

        while (queue.length > 0) {
          const cur = queue.shift();
          faces.push(cur);
          // Check adjacent faces sharing UV edges
          for (let adj = 0; adj < faceCount; adj++) {
            if (visited[adj]) continue;
            if (sharesUVEdge(index, uv, cur, adj)) {
              visited[adj] = 1;
              queue.push(adj);
            }
          }
        }

        map.set(`${entry.name}_island_${islandId}`, {
          faceIndices: faces,
          meshName: entry.name,
        });
        islandId++;
      }
    });
    return map;
  }, [meshEntries]);

  return (
    <group ref={groupRef}>
      {meshEntries.map((entry) => (
        <FlatPatternMesh
          key={entry.name}
          entry={entry}
          highlightedIslandId={highlightedIslandId}
          islandMap={islandMap}
          onIslandClick={onIslandClick}
          uvSyncEnabled={uvSyncEnabled}
        />
      ))}
    </group>
  );
}

// Check if two faces share a UV edge (simplified - checks shared UV vertex pairs)
function sharesUVEdge(index, uvAttr, faceA, faceB) {
  const threshold = 0.001;
  let shared = 0;

  for (let i = 0; i < 3; i++) {
    const uvAx = uvAttr.getX(index.getX(faceA * 3 + i));
    const uvAy = uvAttr.getY(index.getX(faceA * 3 + i));
    for (let j = 0; j < 3; j++) {
      const uvBx = uvAttr.getX(index.getX(faceB * 3 + j));
      const uvBy = uvAttr.getY(index.getX(faceB * 3 + j));
      if (Math.abs(uvAx - uvBx) < threshold && Math.abs(uvAy - uvBy) < threshold) {
        shared++;
        break;
      }
    }
  }
  return shared >= 2; // 2 shared UV verts = shared UV edge
}

// Individual flat mesh with highlight support
function FlatPatternMesh({ entry, highlightedIslandId, islandMap, onIslandClick, uvSyncEnabled }) {
  const meshRef = useRef();

  // Force flat morph target on mount
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || !mesh.morphTargetInfluences) return;
    const dict = mesh.morphTargetDictionary || {};
    const flatIdx = dict["Flat"];
    if (flatIdx !== undefined) {
      // Set all to 0, then flat to 1
      for (let i = 0; i < mesh.morphTargetInfluences.length; i++) {
        mesh.morphTargetInfluences[i] = 0;
      }
      mesh.morphTargetInfluences[flatIdx] = 1;
    } else if (mesh.morphTargetInfluences.length > 0) {
      // Legacy: single key = flat
      mesh.morphTargetInfluences[0] = 1;
    }
  }, [entry]);

  // Create highlight material for selected island
  const material = useMemo(() => {
    const baseMat = entry.material
      ? entry.material.clone()
      : new THREE.MeshBasicMaterial({ color: "#e8e8e8" });
    baseMat.side = THREE.DoubleSide;
    return baseMat;
  }, [entry.material]);

  const handleClick = useCallback(
    (e) => {
      if (!uvSyncEnabled) return;
      e.stopPropagation();
      const faceIndex = e.faceIndex;
      // Find which island this face belongs to
      for (const [islandId, data] of islandMap.entries()) {
        if (data.meshName === entry.name && data.faceIndices.includes(faceIndex)) {
          onIslandClick?.(islandId, data.faceIndices);
          break;
        }
      }
    },
    [uvSyncEnabled, islandMap, entry.name, onIslandClick]
  );

  return (
    <mesh
      ref={meshRef}
      geometry={entry.geometry}
      material={material}
      position={entry.position}
      rotation={entry.rotation}
      scale={entry.scale}
      morphTargetInfluences={entry.morphTargetInfluences}
      onClick={handleClick}
    />
  );
}

// ── Seam Lines Overlay ──
function SeamLinesOverlay({ geometry, seamEdgeIndices }) {
  const points = useMemo(() => {
    if (!geometry || !seamEdgeIndices?.length) return [];
    const pos = geometry.attributes.position;
    const lines = [];

    for (const edgeIdx of seamEdgeIndices) {
      // Edge index → vertex pair (from edge list or index buffer)
      // For indexed geometry, edges need to be derived
      // This is a simplified approach using edge index as sequential pair
      const v1 = edgeIdx * 2;
      const v2 = edgeIdx * 2 + 1;
      if (v1 < pos.count && v2 < pos.count) {
        lines.push([
          new THREE.Vector3(pos.getX(v1), pos.getY(v1), pos.getZ(v1)),
          new THREE.Vector3(pos.getX(v2), pos.getY(v2), pos.getZ(v2)),
        ]);
      }
    }
    return lines;
  }, [geometry, seamEdgeIndices]);

  if (!points.length) return null;

  return (
    <>
      {points.map((pair, i) => (
        <Line key={i} points={pair} color="#ef4444" lineWidth={2} />
      ))}
    </>
  );
}

// ── Flat Pattern Canvas wrapper ──
function FlatPatternCanvas({ patternGlbUrl, highlightedIslandId, onIslandClick, uvSyncEnabled }) {
  return (
    <Canvas
      gl={{ antialias: true, alpha: true }}
      style={{ background: "#f8f8f8" }}
    >
      <OrthographicCamera makeDefault position={[0, 0, 10]} zoom={100} up={[0, 1, 0]} />
      <ambientLight intensity={1.0} />

      <Suspense fallback={null}>
        <FlatPatternModel
          url={patternGlbUrl + "?panel=flat"}
          highlightedIslandId={highlightedIslandId}
          onIslandClick={onIslandClick}
          uvSyncEnabled={uvSyncEnabled}
        />
      </Suspense>

      <Grid
        args={[10, 10]}
        cellSize={0.1}
        cellThickness={0.5}
        cellColor="#e5e7eb"
        sectionSize={0.5}
        sectionThickness={1}
        sectionColor="#d1d5db"
        fadeDistance={20}
        fadeStrength={1}
        infiniteGrid
      />

      <OrbitControls
        enableRotate={false}
        enableDamping
        dampingFactor={0.08}
        minZoom={10}
        maxZoom={500}
        enablePan
      />
    </Canvas>
  );
}

// ── Main PatternSplitView Component ──
export default function PatternSplitView({
  glbUrl,
  patternGlbUrl,
  selectedPart = null,
  hoveredPart = null,
  onHover,
  onSelect,
  onMeshStats,
  onPatternUpdate,
  meshOps,
  // 3D editor passthrough props
  editorTool3D = "select",
  transformSpace = "world",
  materialEditor = null,
  paintMode = "off",
  paintColor = "#ff0000",
  paintBrushRadius = 0.05,
  onCanvasReady,
  isolationMode = false,
  // UV Sync
  highlightedIslandId = null,
  selectedFaceIndices = [],
  uvSyncEnabled = true,
  dispatch,
}) {
  const containerRef = useRef(null);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [isDragging, setIsDragging] = useState(false);
  const [seamEditorActive, setSeamEditorActive] = useState(false);
  const [pendingSeams, setPendingSeams] = useState([]);

  // Draggable divider handlers
  const handleDividerDown = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const x = (e.clientX || e.touches?.[0]?.clientX || 0) - rect.left;
      const ratio = Math.max(0.2, Math.min(0.8, x / rect.width));
      setSplitRatio(ratio);
    };

    const handleUp = () => setIsDragging(false);

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("touchmove", handleMove);
    window.addEventListener("touchend", handleUp);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("touchmove", handleMove);
      window.removeEventListener("touchend", handleUp);
    };
  }, [isDragging]);

  // Handle UV sync: clicking on flat pattern island highlights 3D faces
  const handleIslandClick = useCallback(
    (islandId, faceIndices) => {
      dispatch?.({ type: "HIGHLIGHT_ISLAND", payload: islandId });
      dispatch?.({ type: "SELECT_3D_FACES", payload: faceIndices });
    },
    [dispatch]
  );

  // Commit pending seams
  const handleCommitSeams = useCallback(async () => {
    if (!pendingSeams.length || !meshOps) return;
    const result = await meshOps.seamsAndFlatten(pendingSeams, "mark");
    if (result?.fileDataUrl) {
      onPatternUpdate?.(result.fileDataUrl);
    }
    setPendingSeams([]);
  }, [pendingSeams, meshOps, onPatternUpdate]);

  return (
    <div ref={containerRef} className="absolute inset-0 w-full h-full flex">
      {/* Left: 3D Garment View */}
      <div style={{ width: `${splitRatio * 100}%` }} className="relative h-full overflow-hidden">
        <GarmentViewer3D
          glbUrl={glbUrl}
          viewMode="3d"
          selectedPart={selectedPart}
          hoveredPart={hoveredPart}
          onHover={onHover}
          onSelect={onSelect}
          onMeshStats={onMeshStats}
          editorTool3D={editorTool3D}
          transformSpace={transformSpace}
          materialEditor={materialEditor}
          paintMode={paintMode}
          paintColor={paintColor}
          paintBrushRadius={paintBrushRadius}
          onCanvasReady={onCanvasReady}
          isolationMode={isolationMode}
        />

        {/* Seam editor overlay badge */}
        <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
          <button
            onClick={() => setSeamEditorActive(!seamEditorActive)}
            className={`px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition-colors shadow-sm ${
              seamEditorActive
                ? "bg-red-500 text-white"
                : "bg-white/90 text-gray-600 border border-gray-200 hover:bg-violet-50"
            }`}
          >
            {seamEditorActive ? "Seam Editor ON" : "Seam Editor"}
          </button>
          {pendingSeams.length > 0 && (
            <span className="px-2 py-1 rounded-full bg-orange-100 text-orange-700 text-[9px] font-semibold">
              {pendingSeams.length} pending
            </span>
          )}
        </div>

        {/* 3D label */}
        <div className="absolute bottom-3 left-3 z-20 px-2 py-1 bg-black/60 text-white text-[9px] font-medium rounded-md">
          3D Garment
        </div>
      </div>

      {/* Draggable Divider */}
      <div
        className={`w-2 cursor-col-resize flex items-center justify-center z-30 transition-colors ${
          isDragging ? "bg-violet-400" : "bg-gray-200 hover:bg-violet-300"
        }`}
        onMouseDown={handleDividerDown}
        onTouchStart={handleDividerDown}
      >
        <div className="w-0.5 h-8 rounded-full bg-gray-400" />
      </div>

      {/* Right: 2D Flat Pattern */}
      <div style={{ width: `${(1 - splitRatio) * 100}%` }} className="relative h-full overflow-hidden">
        {patternGlbUrl ? (
          <FlatPatternCanvas
            patternGlbUrl={patternGlbUrl}
            highlightedIslandId={highlightedIslandId}
            onIslandClick={handleIslandClick}
            uvSyncEnabled={uvSyncEnabled}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-50 gap-3">
            <div className="w-12 h-12 rounded-2xl bg-violet-50 border border-violet-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a9 9 0 11-18 0V5.25" />
              </svg>
            </div>
            <p className="text-[11px] text-gray-400 text-center max-w-[200px]">
              Generate a techpack or flatten the pattern to see the 2D view here.
            </p>
          </div>
        )}

        {/* 2D label */}
        <div className="absolute bottom-3 left-3 z-20 px-2 py-1 bg-black/60 text-white text-[9px] font-medium rounded-md">
          2D Flat Pattern
        </div>

        {/* UV Sync toggle */}
        <button
          onClick={() => dispatch?.({ type: "TOGGLE_UV_SYNC" })}
          className={`absolute top-3 right-3 z-20 px-2 py-1 rounded-md text-[9px] font-semibold transition-colors ${
            uvSyncEnabled
              ? "bg-violet-500 text-white shadow-sm"
              : "bg-white/90 text-gray-500 border border-gray-200"
          }`}
        >
          UV Sync {uvSyncEnabled ? "ON" : "OFF"}
        </button>
      </div>

      {/* Bottom bar: Commit Seams */}
      {pendingSeams.length > 0 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-2.5 bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200">
          <span className="text-[10px] text-gray-500">
            {pendingSeams.length} seam edge{pendingSeams.length !== 1 ? "s" : ""} selected
          </span>
          <button
            onClick={handleCommitSeams}
            disabled={meshOps?.isProcessing}
            className="px-4 py-1.5 rounded-lg text-[10px] font-semibold bg-gradient-to-r from-violet-500 to-indigo-600 text-white hover:from-violet-600 hover:to-indigo-700 transition-colors disabled:opacity-40 shadow-sm"
          >
            Commit Seams
          </button>
          <button
            onClick={() => setPendingSeams([])}
            className="text-[9px] text-gray-400 hover:text-gray-600"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
