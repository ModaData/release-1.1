// File: hooks/useRealtimeEdit.js
// WebSocket client for real-time Blender mesh editing.
// Manages: connection lifecycle, command protocol, vertex delta streaming,
//          face/vertex selection, sculpt strokes, and topology sync.
"use client";

import { useState, useRef, useCallback, useEffect } from "react";

// Edit modes for the toolbar
export const EDIT_TOOLS = {
  select: { label: "Select", icon: "cursor", blenderMode: null },
  move: { label: "Move", icon: "move", blenderMode: "translate_verts" },
  sculpt_push: { label: "Push", icon: "brush", blenderMode: "sculpt_stroke", mode: "push" },
  sculpt_smooth: { label: "Smooth", icon: "feather", blenderMode: "sculpt_stroke", mode: "smooth" },
  sculpt_flatten: { label: "Flatten", icon: "minus", blenderMode: "sculpt_stroke", mode: "flatten" },
  sculpt_inflate: { label: "Inflate", icon: "maximize", blenderMode: "sculpt_stroke", mode: "inflate" },
  extrude: { label: "Extrude", icon: "layers", blenderMode: "extrude_faces" },
  subdivide: { label: "Subdivide", icon: "grid", blenderMode: "subdivide_sel" },
  delete: { label: "Delete", icon: "trash", blenderMode: "delete_faces" },
};

export function useRealtimeEdit({
  wsUrl = null,
  glbPath = null,
  onMeshUpdate = null,
  onTopologyChange = null,
  onSelectionChange = null,
} = {}) {
  // Connection state
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [error, setError] = useState(null);

  // Mesh state
  const [vertexCount, setVertexCount] = useState(0);
  const [faceCount, setFaceCount] = useState(0);
  const [selectedVerts, setSelectedVerts] = useState([]);
  const [selectedFaces, setSelectedFaces] = useState([]);

  // Edit state
  const [activeTool, setActiveTool] = useState("select");
  const [brushRadius, setBrushRadius] = useState(0.05);
  const [brushStrength, setBrushStrength] = useState(0.5);

  // Refs
  const wsRef = useRef(null);
  const pendingCallbacks = useRef(new Map());
  const callbackId = useRef(0);
  const deltaPollingRef = useRef(null);

  // Resolve the WebSocket URL
  const resolveWsUrl = useCallback(() => {
    if (wsUrl) return wsUrl;
    // Derive from BLENDER_API_URL: replace http→ws and port 8000→8765
    const blenderUrl = process.env.NEXT_PUBLIC_BLENDER_WS_URL;
    if (blenderUrl) return blenderUrl;
    // Default: same host, port 8765
    if (typeof window !== "undefined") {
      const host = window.location.hostname;
      return `ws://${host}:8765`;
    }
    return "ws://localhost:8765";
  }, [wsUrl]);

  // Send a command and return a promise for the response
  const sendCommand = useCallback((cmd, data = {}) => {
    return new Promise((resolve, reject) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not connected"));
        return;
      }

      const id = ++callbackId.current;
      const timeout = setTimeout(() => {
        pendingCallbacks.current.delete(id);
        reject(new Error(`Command '${cmd}' timed out`));
      }, 30000);

      pendingCallbacks.current.set(id, { resolve, reject, timeout });

      wsRef.current.send(JSON.stringify({ cmd, ...data, _id: id }));
    });
  }, []);

  // Connect to the WebSocket bridge
  const connect = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setConnecting(true);
    setError(null);

    const url = resolveWsUrl();
    const sid = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      await new Promise((resolve, reject) => {
        ws.onopen = () => {
          // Send init command
          ws.send(JSON.stringify({
            cmd: "init",
            session_id: sid,
            glb_path: glbPath,
          }));
        };

        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);

          // Handle init response
          if (data.session_id) {
            setSessionId(data.session_id);
            setConnected(true);
            setConnecting(false);
            resolve(data);
            return;
          }

          // Handle subsequent responses — resolve pending callbacks (FIFO)
          if (pendingCallbacks.current.size > 0) {
            const [firstId, cb] = pendingCallbacks.current.entries().next().value;
            clearTimeout(cb.timeout);
            pendingCallbacks.current.delete(firstId);
            if (data.error) {
              cb.reject(new Error(data.error));
            } else {
              cb.resolve(data);
            }
            return;
          }

          // Unsolicited message (e.g., broadcast)
          console.log("[useRealtimeEdit] Unsolicited:", data);
        };

        ws.onerror = (err) => {
          console.error("[useRealtimeEdit] WS error:", err);
          setError("WebSocket connection failed");
          setConnecting(false);
          reject(err);
        };

        ws.onclose = () => {
          setConnected(false);
          setSessionId(null);
          // Clear all pending callbacks
          for (const [, cb] of pendingCallbacks.current) {
            clearTimeout(cb.timeout);
            cb.reject(new Error("WebSocket closed"));
          }
          pendingCallbacks.current.clear();
        };
      });
    } catch (err) {
      setError(err.message || "Failed to connect");
      setConnecting(false);
      throw err;
    }
  }, [resolveWsUrl, glbPath]);

  // Disconnect
  const disconnect = useCallback(() => {
    if (deltaPollingRef.current) {
      clearInterval(deltaPollingRef.current);
      deltaPollingRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
    setSessionId(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  // ── Mesh Operations ──

  const loadGlb = useCallback(async (path) => {
    const result = await sendCommand("load_glb", { path });
    if (result.ok) {
      setVertexCount(result.vertex_count);
      setFaceCount(result.face_count);
    }
    return result;
  }, [sendCommand]);

  const getMeshData = useCallback(async () => {
    const result = await sendCommand("get_mesh_data");
    if (result.ok) {
      setVertexCount(result.vertex_count);
      setFaceCount(result.face_count);
    }
    return result;
  }, [sendCommand]);

  const selectFace = useCallback(async (faceIndex, add = false) => {
    const result = await sendCommand("select_face", { face_index: faceIndex, add });
    if (result.ok) {
      setSelectedFaces(result.selected_faces || []);
      setSelectedVerts(result.selected_verts || []);
      onSelectionChange?.({ faces: result.selected_faces, verts: result.selected_verts });
    }
    return result;
  }, [sendCommand, onSelectionChange]);

  const selectVertex = useCallback(async (vertIndex, add = false) => {
    const result = await sendCommand("select_vertex", { vertex_index: vertIndex, add });
    if (result.ok) {
      setSelectedVerts(result.selected_verts || []);
      onSelectionChange?.({ faces: selectedFaces, verts: result.selected_verts });
    }
    return result;
  }, [sendCommand, onSelectionChange, selectedFaces]);

  const translateVerts = useCallback(async (dx, dy, dz, vertexIndices = null) => {
    return await sendCommand("translate_verts", {
      dx, dy, dz, vertex_indices: vertexIndices,
    });
  }, [sendCommand]);

  const sculptStroke = useCallback(async (path, mode = "push") => {
    return await sendCommand("sculpt_stroke", {
      path,
      radius: brushRadius,
      strength: brushStrength,
      mode,
    });
  }, [sendCommand, brushRadius, brushStrength]);

  const extrudeFaces = useCallback(async (distance = 0.01) => {
    const result = await sendCommand("extrude_faces", { distance });
    if (result.ok) {
      setVertexCount(result.vertex_count);
      setFaceCount(result.face_count);
      if (result.topology_changed) onTopologyChange?.();
    }
    return result;
  }, [sendCommand, onTopologyChange]);

  const smoothVerts = useCallback(async (iterations = 1, factor = 0.5) => {
    return await sendCommand("smooth_verts", { iterations, factor });
  }, [sendCommand]);

  const subdivideSel = useCallback(async (cuts = 1) => {
    const result = await sendCommand("subdivide_sel", { cuts });
    if (result.ok) {
      setVertexCount(result.vertex_count);
      setFaceCount(result.face_count);
      if (result.topology_changed) onTopologyChange?.();
    }
    return result;
  }, [sendCommand, onTopologyChange]);

  const deleteFaces = useCallback(async () => {
    const result = await sendCommand("delete_faces");
    if (result.ok) {
      setVertexCount(result.vertex_count);
      setFaceCount(result.face_count);
      setSelectedFaces([]);
      setSelectedVerts([]);
      if (result.topology_changed) onTopologyChange?.();
    }
    return result;
  }, [sendCommand, onTopologyChange]);

  const getDelta = useCallback(async () => {
    const result = await sendCommand("get_delta");
    if (result.ok && !result.topology_changed && result.delta_count > 0) {
      onMeshUpdate?.(result.deltas);
    } else if (result.ok && result.topology_changed) {
      onTopologyChange?.();
    }
    return result;
  }, [sendCommand, onMeshUpdate, onTopologyChange]);

  const exportGlb = useCallback(async (path) => {
    return await sendCommand("export_glb", { path });
  }, [sendCommand]);

  // ── Delta Polling (for multi-user or deferred updates) ──

  const startDeltaPolling = useCallback((intervalMs = 100) => {
    if (deltaPollingRef.current) return;
    deltaPollingRef.current = setInterval(() => {
      if (connected) getDelta().catch(() => {});
    }, intervalMs);
  }, [connected, getDelta]);

  const stopDeltaPolling = useCallback(() => {
    if (deltaPollingRef.current) {
      clearInterval(deltaPollingRef.current);
      deltaPollingRef.current = null;
    }
  }, []);

  return {
    // Connection
    connected,
    connecting,
    sessionId,
    error,
    connect,
    disconnect,

    // Mesh info
    vertexCount,
    faceCount,
    selectedVerts,
    selectedFaces,

    // Edit tools
    activeTool,
    setActiveTool,
    brushRadius,
    setBrushRadius,
    brushStrength,
    setBrushStrength,

    // Operations
    loadGlb,
    getMeshData,
    selectFace,
    selectVertex,
    translateVerts,
    sculptStroke,
    extrudeFaces,
    smoothVerts,
    subdivideSel,
    deleteFaces,
    getDelta,
    exportGlb,

    // Delta polling
    startDeltaPolling,
    stopDeltaPolling,
  };
}
