// File: components/drawing-canvas/GarmentViewer3D.jsx
// Three.js GLB viewer with 4 view modes + interactive part selection + 3D editing
"use client";

import { Suspense, useMemo, useRef, useState, useCallback, useEffect, Component } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, TransformControls, useGLTF, Environment, Center, Outlines, Html } from "@react-three/drei";
import * as THREE from "three";
import { isGarmentPart, parsePartName } from "@/lib/garment-naming";
import VertexPaintEngine from "./VertexPaintEngine";
import { useUVMorph } from "@/hooks/useUVMorph";

// ── Normal map shaders ──
const normalMapVertexShader = `
  varying vec3 vViewNormal;
  void main() {
    vViewNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const normalMapFragmentShader = `
  varying vec3 vViewNormal;
  void main() {
    vec3 color = vViewNormal * 0.5 + 0.5;
    gl_FragColor = vec4(color, 1.0);
  }
`;

// ── Retopology wireframe shaders (barycentric edge detection) ──
// NOTE: Do NOT add #extension GL_OES_standard_derivatives here —
// Three.js handles it via ShaderMaterial.extensions.derivatives.
// Hardcoding it causes silent shader compilation failures in WebGL2.
const retopologyVertexShader = `
  attribute vec3 barycentric;
  varying vec3 vBarycentric;
  varying vec3 vNormal;
  void main() {
    vBarycentric = barycentric;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const retopologyFragmentShader = `
  varying vec3 vBarycentric;
  varying vec3 vNormal;
  uniform float wireWidth;
  uniform vec3 wireColor;
  uniform vec3 fillColor;

  float edgeFactor() {
    vec3 d = fwidth(vBarycentric);
    vec3 a3 = smoothstep(vec3(0.0), d * wireWidth, vBarycentric);
    return min(min(a3.x, a3.y), a3.z);
  }

  void main() {
    float edge = edgeFactor();
    float light = dot(vNormal, normalize(vec3(0.5, 0.8, 0.6))) * 0.3 + 0.7;
    vec3 base = fillColor * light;
    gl_FragColor = vec4(mix(wireColor, base, edge), 1.0);
  }
`;

// ── Helper: add barycentric attribute to non-indexed geometry ──
function addBarycentricAttribute(geometry) {
  // Convert to non-indexed so each triangle has unique vertices
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry.clone();

  // Ensure normals exist (some GLB meshes omit them)
  if (!nonIndexed.attributes.normal) {
    nonIndexed.computeVertexNormals();
  }

  const count = nonIndexed.attributes.position.count;
  const baryArr = new Float32Array(count * 3);

  for (let i = 0; i < count; i += 3) {
    // Triangle vertex 0
    baryArr[i * 3] = 1;
    baryArr[i * 3 + 1] = 0;
    baryArr[i * 3 + 2] = 0;
    // Triangle vertex 1
    baryArr[(i + 1) * 3] = 0;
    baryArr[(i + 1) * 3 + 1] = 1;
    baryArr[(i + 1) * 3 + 2] = 0;
    // Triangle vertex 2
    baryArr[(i + 2) * 3] = 0;
    baryArr[(i + 2) * 3 + 1] = 0;
    baryArr[(i + 2) * 3 + 2] = 1;
  }

  nonIndexed.setAttribute("barycentric", new THREE.BufferAttribute(baryArr, 3));

  // Recompute bounds — critical for frustum culling and Center positioning
  nonIndexed.computeBoundingBox();
  nonIndexed.computeBoundingSphere();

  return nonIndexed;
}

// ── Create material for a given view mode ──
function createMaterial(viewMode, originalMaterial) {
  if (viewMode === "normalmap") {
    return new THREE.ShaderMaterial({
      vertexShader: normalMapVertexShader,
      fragmentShader: normalMapFragmentShader,
      side: THREE.DoubleSide,
    });
  }
  if (viewMode === "pattern") {
    // Pattern mode: use original textured material with flat lighting, double-sided
    const patternMat = originalMaterial
      ? originalMaterial.clone()
      : new THREE.MeshBasicMaterial({ color: "#cccccc" });
    patternMat.side = THREE.DoubleSide;
    return patternMat;
  }
  // For 3d mode, return cloned original material
  return originalMaterial ? originalMaterial.clone() : new THREE.MeshStandardMaterial({ color: "#cccccc" });
}

// ── Error Boundary ──
class Viewer3DErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[GarmentViewer3D] Render error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#f9fafb] gap-3 p-8">
          <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center">
            <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
            </svg>
          </div>
          <p className="text-[12px] text-red-500 text-center max-w-[260px]">
            3D viewer encountered an error loading the model.
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-4 py-2 rounded-lg text-[11px] font-medium bg-indigo-50 text-indigo-600 border border-indigo-100 hover:bg-indigo-100 transition-colors"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Canvas Reporter — exposes gl.domElement for SAM screenshots ──
function CanvasReporter({ onCanvasReady }) {
  const { gl } = useThree();
  useEffect(() => {
    if (onCanvasReady && gl?.domElement) {
      onCanvasReady(gl.domElement);
    }
  }, [gl, onCanvasReady]);
  return null;
}

// ── Individual Garment Part (interactive mesh) ──
function GarmentPart({
  meshData, viewMode, isHovered, isSelected, isGhosted,
  onPointerOver, onPointerOut, onClick,
  materialEditor, onMeshRef, morphStage,
}) {
  const meshRef = useRef();

  // Expose mesh ref to parent for TransformControls + VertexPaint
  useEffect(() => {
    if (onMeshRef) onMeshRef(meshRef);
    return () => { if (onMeshRef) onMeshRef(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Choose geometry + material based on view mode
  const { geometry, material } = useMemo(() => {
    if (viewMode === "retopo") {
      const retopoGeom = addBarycentricAttribute(meshData.geometry);
      const retopoMat = new THREE.ShaderMaterial({
        vertexShader: retopologyVertexShader,
        fragmentShader: retopologyFragmentShader,
        uniforms: {
          wireWidth: { value: 1.5 },
          wireColor: { value: new THREE.Color(0.2, 0.2, 0.2) },
          fillColor: { value: new THREE.Color(0.75, 0.75, 0.75) },
        },
        side: THREE.DoubleSide,
        extensions: { derivatives: true },
      });
      return { geometry: retopoGeom, material: retopoMat };
    }
    const baseMat = createMaterial(viewMode, meshData.material);
    if (isGhosted) {
      // Ghost: semi-transparent wireframe overlay for non-selected parts
      const ghostMat = baseMat.clone ? baseMat.clone() : new THREE.MeshStandardMaterial();
      ghostMat.opacity = 0.12;
      ghostMat.transparent = true;
      ghostMat.depthWrite = false;
      ghostMat.wireframe = true;
      ghostMat.needsUpdate = true;
      return { geometry: meshData.geometry, material: ghostMat };
    }
    return { geometry: meshData.geometry, material: baseMat };
  }, [viewMode, meshData, isGhosted]);

  // Apply material editor changes in real-time (3D mode only)
  useEffect(() => {
    if (!materialEditor || viewMode !== "3d" || !meshRef.current || isGhosted) return;
    const mat = meshRef.current.material;
    if (!mat) return;
    if (mat.color) mat.color.set(materialEditor.color);
    if ("metalness" in mat) mat.metalness = materialEditor.metalness;
    if ("roughness" in mat) mat.roughness = materialEditor.roughness;
    mat.opacity = materialEditor.opacity;
    mat.transparent = materialEditor.opacity < 1;
    mat.wireframe = !!materialEditor.wireframe;
    mat.needsUpdate = true;
  }, [materialEditor, viewMode, isGhosted]);

  // Apply shape key morph (morphStage: 0=Assembled, 1=Draped, 2=Flat)
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || morphStage === undefined) return;
    const dict = mesh.morphTargetDictionary || {};
    const count = mesh.morphTargetInfluences?.length || 0;
    if (!count) return;

    if (count === 1) {
      // Legacy: only "Flat" key (no cloth sim)
      mesh.morphTargetInfluences[0] = morphStage >= 1 ? 1 : 0;
    } else {
      // Multi-key: "Draped" + "Flat"
      const drapeIdx = dict["Draped"] ?? 0;
      const flatIdx  = dict["Flat"]   ?? 1;
      mesh.morphTargetInfluences[drapeIdx] = morphStage >= 1 ? 1 : 0;
      mesh.morphTargetInfluences[flatIdx]  = morphStage >= 2 ? 1 : 0;
    }
  }, [morphStage]);

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      position={meshData.position}
      rotation={meshData.rotation}
      scale={meshData.scale}
      frustumCulled={viewMode !== "retopo"}
      morphTargetInfluences={meshData.morphTargetInfluences}
      onPointerOver={(e) => { e.stopPropagation(); if (!isGhosted) onPointerOver?.(); }}
      onPointerOut={(e) => { e.stopPropagation(); onPointerOut?.(); }}
      onClick={(e) => { e.stopPropagation(); if (!isGhosted) onClick?.(); }}
    >
      {(isHovered || isSelected) && viewMode !== "retopo" && !isGhosted && (
        <Outlines
          thickness={isSelected ? 3 : 1.5}
          color={isSelected ? "#6366f1" : "#a5b4fc"}
          angle={Math.PI}
        />
      )}
    </mesh>
  );
}

// ── Camera Focus — smoothly zooms to selected part's bounding box ──
function CameraFocus({ targetMeshRef, enabled }) {
  const { camera } = useThree();
  const targetPos = useRef(null);
  const targetLook = useRef(new THREE.Vector3(0, 0, 0));

  useEffect(() => {
    if (!enabled || !targetMeshRef?.current) {
      targetPos.current = null;
      return;
    }
    const mesh = targetMeshRef.current;
    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const distance = Math.max(size * 1.5, 0.5);
    const dir = camera.position.clone().sub(center).normalize();
    targetPos.current = center.clone().addScaledVector(dir, distance);
    targetLook.current = center.clone();
  }, [enabled, targetMeshRef, camera]);

  useFrame(() => {
    if (!targetPos.current) return;
    camera.position.lerp(targetPos.current, 0.06);
  });

  return null;
}

// ── Part Tooltip (floating label on hover) ──
function PartTooltip({ partName }) {
  if (!partName) return null;
  const parsed = parsePartName(partName);
  if (!parsed) return null;

  return (
    <Html center style={{ pointerEvents: "none" }}>
      <div className="px-2 py-1 rounded-md bg-black/80 text-white text-[10px] font-medium whitespace-nowrap shadow-lg">
        {parsed.displayName}
      </div>
    </Html>
  );
}

// ── Transform Controls Wrapper ──
function TransformGizmo({ selectedMeshRef, mode, space, orbitControlsRef }) {
  const transformRef = useRef();

  // Disable orbit controls during transform drag
  useEffect(() => {
    const controls = transformRef.current;
    if (!controls) return;
    const callback = (e) => {
      if (orbitControlsRef?.current) {
        orbitControlsRef.current.enabled = !e.value;
      }
    };
    controls.addEventListener("dragging-changed", callback);
    return () => controls.removeEventListener("dragging-changed", callback);
  }, [orbitControlsRef]);

  if (!selectedMeshRef?.current) return null;

  return (
    <TransformControls
      ref={transformRef}
      object={selectedMeshRef.current}
      mode={mode}
      space={space}
      size={0.7}
    />
  );
}

// ── Interactive Garment Model ──
function InteractiveGarmentModel({
  url, viewMode, selectedPart, hoveredPart,
  onHover, onSelect, onMeshStats,
  editorTool3D, transformSpace, materialEditor,
  orbitControlsRef, paintMode, paintColor, paintBrushRadius,
  onPaintStart, onPaintEnd,
  isolationMode, morphStage, onHasMorphTargets, onMorphKeyCount,
}) {
  const { scene } = useGLTF(url);
  const groupRef = useRef();
  const meshRefsMap = useRef({});
  const [selectedMeshRef, setSelectedMeshRef] = useState(null);

  // UV Morph — 3D↔Pattern flattening animation
  const { morphToPattern, morphTo3D, resetMorph, isMorphing, isFlattened } = useUVMorph();
  const prevViewModeRef = useRef(viewMode);

  // Extract all mesh children with metadata
  const meshEntries = useMemo(() => {
    const entries = [];
    scene.traverse((child) => {
      if (child.isMesh) {
        const parsed = parsePartName(child.name);
        entries.push({
          name: child.name,
          geometry: child.geometry,
          material: child.material,
          position: child.position.clone(),
          rotation: child.rotation.clone(),
          scale: child.scale.clone(),
          parsed,
          morphTargetInfluences: child.morphTargetInfluences ? [...child.morphTargetInfluences] : undefined,
        });
      }
    });
    return entries;
  }, [scene]);

  // Report morph target availability + key count to parent
  useEffect(() => {
    const keyCount = meshEntries.reduce((max, e) => {
      const cnt = e.morphTargetInfluences?.length || 0;
      return Math.max(max, cnt);
    }, 0);
    onHasMorphTargets?.(keyCount > 0);
    onMorphKeyCount?.(keyCount);
  }, [meshEntries, onHasMorphTargets, onMorphKeyCount]);

  // Auto-select single mesh for HunYuan models (Objects: 1)
  useEffect(() => {
    if (meshEntries.length === 1 && !selectedPart) {
      onSelect?.(meshEntries[0].name);
    }
  }, [meshEntries, selectedPart, onSelect]);

  // Update selectedMeshRef when selection changes
  useEffect(() => {
    if (selectedPart && meshRefsMap.current[selectedPart]) {
      setSelectedMeshRef(meshRefsMap.current[selectedPart]);
    } else {
      setSelectedMeshRef(null);
    }
  }, [selectedPart]);

  // Compute mesh stats for retopo overlay
  useEffect(() => {
    if (!onMeshStats) return;
    let triangles = 0;
    let vertices = 0;
    for (const entry of meshEntries) {
      const geo = entry.geometry;
      vertices += geo.attributes.position?.count || 0;
      if (geo.index) {
        triangles += geo.index.count / 3;
      } else {
        triangles += (geo.attributes.position?.count || 0) / 3;
      }
    }
    onMeshStats({
      triangles: Math.round(triangles),
      vertices,
      objects: meshEntries.length,
    });
  }, [meshEntries, onMeshStats]);

  // ── UV Morph: trigger pattern flattening when viewMode changes ──
  useEffect(() => {
    const prev = prevViewModeRef.current;
    prevViewModeRef.current = viewMode;

    if (prev === viewMode) return;

    // Collect all mesh refs
    const allMeshRefs = Object.values(meshRefsMap.current).filter(Boolean);
    if (allMeshRefs.length === 0) return;

    if (viewMode === "pattern" && prev !== "pattern") {
      // Switching TO pattern — flatten 3D → UV layout
      // Stop auto-rotate first so vertices don't fight the rotation
      if (groupRef.current) groupRef.current.rotation.y = 0;
      morphToPattern(allMeshRefs);
    } else if (prev === "pattern" && viewMode !== "pattern") {
      // Switching FROM pattern — restore 3D positions
      morphTo3D(allMeshRefs);
    }
  }, [viewMode, morphToPattern, morphTo3D]);

  // Reset morph data when GLB URL changes (new model loaded)
  useEffect(() => {
    resetMorph();
  }, [url, resetMorph]);

  // Gentle auto-rotate (stop when editing, a part is selected, in pattern mode, or morphing)
  useFrame((_, delta) => {
    if (groupRef.current && !selectedPart && editorTool3D === "select" && paintMode === "off" && viewMode !== "pattern" && !isMorphing) {
      groupRef.current.rotation.y += delta * 0.15;
    }
  });

  // Determine if transform gizmo should show
  const transformMode = ["translate", "rotate", "scale"].includes(editorTool3D) ? editorTool3D : null;

  // Ghost mode: when a part is selected and isolation is active, ghost others
  const isIsolating = isolationMode && !!selectedPart && meshEntries.length > 1;

  return (
    <>
      <Center>
        <group ref={groupRef}>
          {meshEntries.map((entry) => (
            <GarmentPart
              key={`${entry.name}-${viewMode === "retopo" ? "retopo" : "standard"}`}
              meshData={entry}
              viewMode={viewMode}
              isHovered={hoveredPart === entry.name}
              isSelected={selectedPart === entry.name}
              isGhosted={isIsolating && selectedPart !== entry.name}
              materialEditor={materialEditor}
              morphStage={morphStage}
              onPointerOver={() => onHover?.(entry.name)}
              onPointerOut={() => onHover?.(null)}
              onClick={() => onSelect?.(entry.name)}
              onMeshRef={(ref) => {
                if (ref) {
                  meshRefsMap.current[entry.name] = ref;
                  if (entry.name === selectedPart) setSelectedMeshRef(ref);
                } else {
                  delete meshRefsMap.current[entry.name];
                }
              }}
            />
          ))}
        </group>
      </Center>

      {/* Camera focus — zoom to selected part when isolation mode is on */}
      <CameraFocus targetMeshRef={selectedMeshRef} enabled={isolationMode && !!selectedPart} />

      {/* TransformControls gizmo */}
      {transformMode && selectedMeshRef && (
        <TransformGizmo
          selectedMeshRef={selectedMeshRef}
          mode={transformMode}
          space={transformSpace}
          orbitControlsRef={orbitControlsRef}
        />
      )}

      {/* Vertex Paint Engine */}
      {paintMode !== "off" && selectedMeshRef && (
        <VertexPaintEngine
          meshRef={selectedMeshRef}
          paintMode={paintMode}
          paintColor={paintColor}
          brushRadius={paintBrushRadius}
          onPaintStart={onPaintStart}
          onPaintEnd={onPaintEnd}
        />
      )}
    </>
  );
}

// ── Loading spinner ──
function LoadingFallback() {
  return (
    <mesh>
      <boxGeometry args={[0.5, 0.5, 0.5]} />
      <meshStandardMaterial color="#6366f1" wireframe />
    </mesh>
  );
}

// ── Main Viewer (exported) ──
export default function GarmentViewer3D({
  glbUrl,
  viewMode = "3d",
  selectedPart = null,
  hoveredPart = null,
  onHover,
  onSelect,
  onMeshStats,
  // 3D editor props
  editorTool3D = "select",
  transformSpace = "world",
  materialEditor = null,
  paintMode = "off",
  paintColor = "#ff0000",
  paintBrushRadius = 0.05,
  onCanvasReady,
  // Isolation: ghost non-selected parts + zoom camera
  isolationMode = false,
  // Pattern mode: renders PatternSplitView instead of single canvas
  patternMode = false,
}) {
  const orbitControlsRef = useRef();
  const [hasMorphTargets, setHasMorphTargets] = useState(false);
  const [morphStage, setMorphStage] = useState(0);
  const [morphKeyCount, setMorphKeyCount] = useState(0);

  if (!glbUrl) return null;

  const orbitEnabled = editorTool3D === "select" && paintMode === "off";

  const bgColor = {
    "3d": "#f9fafb",
    normalmap: "#1a1a2e",
    retopo: "#2a2a3e",
    pattern: "#ffffff",
  }[viewMode] || "#f9fafb";

  return (
    <div className="absolute inset-0 w-full h-full">
      <Viewer3DErrorBoundary>
        <Canvas
          camera={{ position: [0, 0, 3], fov: 45 }}
          gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
          style={{
            background: bgColor,
            cursor: paintMode !== "off"
              ? "crosshair"
              : hoveredPart
              ? "pointer"
              : "grab",
          }}
        >
          <Suspense fallback={<LoadingFallback />}>
            <CanvasReporter onCanvasReady={onCanvasReady} />

            {viewMode === "3d" && (
              <>
                <ambientLight intensity={0.6} />
                <directionalLight position={[5, 5, 5]} intensity={0.8} />
                <directionalLight position={[-3, 3, -3]} intensity={0.3} />
                <Environment preset="studio" />
              </>
            )}
            {viewMode === "normalmap" && <ambientLight intensity={1.0} />}
            {viewMode === "retopo" && (
              <>
                <ambientLight intensity={0.8} />
                <directionalLight position={[3, 5, 4]} intensity={0.5} />
              </>
            )}
            {viewMode === "pattern" && <ambientLight intensity={1.0} />}

            <InteractiveGarmentModel
              url={glbUrl}
              viewMode={viewMode}
              selectedPart={selectedPart}
              hoveredPart={hoveredPart}
              onHover={onHover}
              onSelect={onSelect}
              onMeshStats={onMeshStats}
              editorTool3D={editorTool3D}
              transformSpace={transformSpace}
              materialEditor={materialEditor}
              orbitControlsRef={orbitControlsRef}
              paintMode={paintMode}
              paintColor={paintColor}
              paintBrushRadius={paintBrushRadius}
              isolationMode={isolationMode}
              morphStage={morphStage}
              onHasMorphTargets={setHasMorphTargets}
              onMorphKeyCount={setMorphKeyCount}
              onPaintStart={() => {
                if (orbitControlsRef.current) orbitControlsRef.current.enabled = false;
              }}
              onPaintEnd={() => {
                if (orbitControlsRef.current) orbitControlsRef.current.enabled = orbitEnabled;
              }}
            />

            <OrbitControls
              ref={orbitControlsRef}
              enabled={orbitEnabled}
              enableRotate={viewMode !== "pattern"}
              enableDamping
              dampingFactor={0.08}
              minDistance={1}
              maxDistance={10}
              enablePan
            />
          </Suspense>
        </Canvas>

        {/* ── Shape key morph segmented control ── */}
        {hasMorphTargets && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex gap-1 px-3 py-2 bg-white/90 backdrop-blur-sm rounded-xl shadow-lg border border-gray-100">
            {(morphKeyCount <= 1
              ? [["3D", 0], ["Flat", 1]]
              : [["Assembled", 0], ["Draped", 1], ["Flat", 2]]
            ).map(([label, stage]) => (
              <button
                key={stage}
                onClick={() => setMorphStage(stage)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-colors ${
                  morphStage === stage
                    ? "bg-violet-600 text-white shadow-sm"
                    : "bg-gray-100 text-gray-500 hover:bg-violet-50 hover:text-violet-600"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* ── Isolation mode exit hint ── */}
        {isolationMode && selectedPart && (
          <div
            className="absolute top-3 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 bg-indigo-600/90 text-white text-[10px] font-medium rounded-full shadow cursor-pointer hover:bg-indigo-700 transition-colors"
            onClick={() => onSelect?.(null)}
          >
            Editing: {selectedPart} — click to exit isolation
          </div>
        )}
      </Viewer3DErrorBoundary>
    </div>
  );
}
