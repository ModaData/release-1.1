// File: hooks/useMeshOperations.js
// Hook for server-side mesh operations via Blender backend
"use client";

import { useCallback, useRef } from "react";
import { useDrawingCanvas } from "./useDrawingCanvas";

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

export function useMeshOperations() {
  const { state, dispatch } = useDrawingCanvas();

  const runMeshOp = useCallback(
    async (action, params = {}) => {
      if (!state.glbUrl) {
        dispatch({ type: "SET_ERROR", payload: "No 3D model loaded" });
        return;
      }

      dispatch({ type: "SET_MESH_OP_IN_PROGRESS", payload: action });
      dispatch({ type: "SET_STATUS", payload: `Running ${action}...` });

      try {
        // Convert GLB URL to base64 data URL if needed
        let fileDataUrl = state.glbUrl;
        if (!fileDataUrl.startsWith("data:")) {
          const proxyUrl = fileDataUrl.startsWith("/")
            ? fileDataUrl
            : `/api/proxy-model?url=${encodeURIComponent(fileDataUrl)}`;
          const resp = await fetch(proxyUrl);
          const blob = await resp.blob();
          fileDataUrl = await blobToDataUrl(blob);
        }

        const res = await fetch(`/api/blender?action=${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileDataUrl, ...params }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `${action} failed`);

        if (data.fileDataUrl) {
          dispatch({ type: "MESH_OP_COMPLETE", payload: { glbUrl: data.fileDataUrl } });
          dispatch({ type: "SET_STATUS", payload: `${action} complete` });
        } else if (data.imageDataUrl) {
          dispatch({
            type: "PUSH_RENDER",
            payload: { url: data.imageDataUrl, description: `Blender ${action} render` },
          });
          dispatch({ type: "SET_VIEW_MODE", payload: "2d" });
          dispatch({ type: "SET_MESH_OP_IN_PROGRESS", payload: null });
          dispatch({ type: "SET_STATUS", payload: `${action} render complete` });
        }
      } catch (err) {
        console.error(`[mesh-op] ${action} error:`, err.message);
        dispatch({ type: "SET_MESH_OP_IN_PROGRESS", payload: null });
        dispatch({ type: "SET_ERROR", payload: `${action} failed: ${err.message}` });
      }
    },
    [state.glbUrl, dispatch]
  );

  // ── Material description → PBR via GPT-4o ──
  const describeMaterial = useCallback(
    async (description) => {
      if (!description?.trim()) return;
      dispatch({ type: "SET_MESH_OP_IN_PROGRESS", payload: "material-prompt" });
      dispatch({ type: "SET_STATUS", payload: "Analyzing material description..." });
      try {
        const res = await fetch("/api/prompt-to-blender/material", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Material analysis failed");

        // Apply the PBR spec to the current GLB via swap-fabric
        if (state.glbUrl && data.swapFabricParams) {
          dispatch({ type: "SET_STATUS", payload: `Applying ${data.pbrSpec?.fabric || "material"} to mesh...` });
          await runMeshOp("swap-fabric", data.swapFabricParams);
        } else {
          dispatch({ type: "SET_MESH_OP_IN_PROGRESS", payload: null });
          dispatch({ type: "SET_STATUS", payload: `Material spec ready: ${data.pbrSpec?.fabric || "custom"}` });
        }
      } catch (err) {
        dispatch({ type: "SET_MESH_OP_IN_PROGRESS", payload: null });
        dispatch({ type: "SET_ERROR", payload: `Material analysis failed: ${err.message}` });
      }
    },
    [state.glbUrl, dispatch, runMeshOp]
  );

  return {
    autoFix: (quality = "standard") =>
      runMeshOp("auto-fix", { quality }),
    repairMesh: (mergeThreshold = 0.001, fabricMode = false) =>
      runMeshOp("repair-mesh", { merge_threshold: mergeThreshold, fabric_mode: String(fabricMode) }),
    subdivide: (levels = 1, method = "catmull_clark", creaseSeams = true) =>
      runMeshOp("subdivide", { levels, method, crease_seams: String(creaseSeams) }),
    decimate: (targetFaces = 12000) =>
      runMeshOp("clean-mesh", { target_faces: targetFaces, smooth_iterations: 0, use_voxel_remesh: "false" }),
    smooth: (iterations = 2) => runMeshOp("smooth", { iterations, factor: 0.3 }),
    retopologize: (targetFaces = 12000, voxelSize = 0.005) =>
      runMeshOp("clean-mesh", { target_faces: targetFaces, smooth_iterations: 1, voxel_size: voxelSize, use_voxel_remesh: "true" }),
    clothSim: (size = "M", qualityPreset = "standard", fabricType = "cotton", frames = undefined) =>
      runMeshOp("apply-cloth-physics", {
        size,
        quality_preset: qualityPreset,
        fabric_type: fabricType,
        ...(frames !== undefined ? { frames } : {}),
      }),
    swapFabric: (fabricType = "cotton") =>
      runMeshOp("swap-fabric", { fabric_type: fabricType }),
    swapFabricPBR: (fabricType, pbrParams = {}) =>
      runMeshOp("swap-fabric", { fabric_type: fabricType, ...pbrParams }),
    flattenPattern: (join = true, scale = 1.0) =>
      runMeshOp("flatten-pattern", { join: String(join), scale }),
    setSeams: (edgeIndices = [], operation = "mark", objectName = null) =>
      runMeshOp("set-seams", {
        edge_indices: JSON.stringify(edgeIndices),
        operation,
        ...(objectName ? { object_name: objectName } : {}),
      }),
    editPart: (editPart, partSpec = {}, pbrJson = null) =>
      runMeshOp("edit-part", {
        edit_part: editPart,
        part_spec: JSON.stringify(partSpec),
        ...(pbrJson ? { pbr_json: pbrJson } : {}),
      }),
    applyGN: (part, gnParams = {}) =>
      runMeshOp("apply-gn", { part, gn_params: JSON.stringify(gnParams) }),
    // ── Morph UV Phase 2 ──
    seamsAndFlatten: (edgeIndices = [], operation = "mark", objectName = null, scale = 1.0, join = false) =>
      runMeshOp("seams-and-flatten", {
        edge_indices: JSON.stringify(edgeIndices),
        operation,
        scale,
        join: String(join),
        ...(objectName ? { object_name: objectName } : {}),
      }),
    // ── Fabric Refinement ──
    addThickness: (fabricType = "cotton", thicknessMultiplier = 1.0, useRim = true) =>
      runMeshOp("add-thickness", {
        fabric_type: fabricType,
        thickness_multiplier: thicknessMultiplier,
        use_rim: String(useRim),
      }),
    extrudeEdges: (offset = 0.015, objectName = null, creaseExtrusion = true) =>
      runMeshOp("extrude-edges", {
        offset,
        crease_extrusion: String(creaseExtrusion),
        ...(objectName ? { object_name: objectName } : {}),
      }),
    // ── Smart UV Suite ──
    autoSeam: (garmentType = "shirt", maxIslands = 8) =>
      runMeshOp("auto-seam", { garment_type: garmentType, max_islands: maxIslands }),
    uvStretchMap: (threshold = 0.05) =>
      runMeshOp("uv-stretch-map", { threshold }),
    uvPackNest: (fabricWidth = 1.5, grainDirection = "warp", seamAllowance = 0.015, scale = 1.0) =>
      runMeshOp("uv-pack-nest", {
        fabric_width: fabricWidth,
        grain_direction: grainDirection,
        seam_allowance: seamAllowance,
        scale,
      }),
    resize: (size = "M") => runMeshOp("resize-garment", { size }),
    renderScene: (resolution = 1024) =>
      runMeshOp("render-scene", { resolution, samples: 128 }),
    turntableRender: (frames = 36, resolution = 512, samples = 32) =>
      runMeshOp("turntable-render", { frames, resolution, samples }),
    bakePBR: (textureDataUrl, resolution = 2048) =>
      runMeshOp("bake-pbr", { textureDataUrl, resolution }),
    describeMaterial,
    isProcessing: state.meshOpInProgress !== null,
    currentOp: state.meshOpInProgress,
  };
}
