/**
 * useVectorEngine — State Machine, Document Model, Undo/Redo, Event Processing
 *
 * Manages the complete vector canvas state:
 * - VectorDocument (paths, ghosts, selection, mode)
 * - State machine transitions (IDLE → DRAWING → IDLE, etc.)
 * - Delta-based undo/redo history
 * - RDP simplification + Bezier fitting on pen-up
 * - Snap-to-anchor (12px threshold)
 * - Symmetry ghost generation
 */

import { useRef, useCallback } from "react";
import { simplifyRDP } from "@/lib/vector-engine/rdp";
import { fitBezierAnchors, enforceC2 } from "@/lib/vector-engine/bezier-fit";
import { hitTestAll } from "@/lib/vector-engine/hit-test";
import { generateGhosts, commitGhosts } from "@/lib/vector-engine/symmetry";
import { dist2D } from "@/lib/vector-engine/bezier";

// ─── Constants ────────────────────────────────────────
const SNAP_THRESHOLD = 12;
const RDP_EPSILON = 2.0;

// ─── Create Empty Document ────────────────────────────
function createEmptyDoc() {
  return {
    paths: [],
    ghostPaths: [],
    activePath: null,
    activeAnchor: null,
    activeHandle: null,
    mode: "IDLE",
    symmetryEnabled: false,
  };
}

/**
 * @param {object} options
 * @param {Function} options.onHistoryChange - Callback(undoCount, redoCount)
 * @param {Function} options.onStroke - Callback("move"|"up")
 * @param {Function} options.onModeChange - Callback(mode) for UI updates
 * @param {Function} options.getCanvasWidth - Returns current canvas CSS width
 */
export function useVectorEngine({ onHistoryChange, onStroke, onModeChange, getCanvasWidth }) {
  // ─── Refs (mutable state for 60fps perf) ───────────
  const docRef = useRef(createEmptyDoc());
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const tempPointsRef = useRef([]);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef(null);
  const needsRedrawRef = useRef(true);
  const strokeCountRef = useRef(0);

  // ─── Helpers ────────────────────────────────────────

  const markDirty = useCallback(() => {
    needsRedrawRef.current = true;
  }, []);

  const setMode = useCallback((mode) => {
    docRef.current.mode = mode;
    onModeChange?.(mode);
    markDirty();
  }, [onModeChange, markDirty]);

  const notifyHistory = useCallback(() => {
    onHistoryChange?.(undoStackRef.current.length, redoStackRef.current.length);
  }, [onHistoryChange]);

  const pushUndo = useCallback((entry) => {
    undoStackRef.current.push(entry);
    redoStackRef.current = [];
    notifyHistory();
  }, [notifyHistory]);

  // Deep clone a path for history snapshots
  const clonePath = (path) => ({
    ...path,
    anchors: path.anchors.map((a) => ({
      ...a,
      handleIn: a.handleIn ? { ...a.handleIn } : null,
      handleOut: a.handleOut ? { ...a.handleOut } : null,
    })),
  });

  // ─── Snap-to-Anchor ────────────────────────────────
  const findSnapTarget = useCallback((point, excludePathIndex = -1) => {
    const doc = docRef.current;
    for (let pi = 0; pi < doc.paths.length; pi++) {
      if (pi === excludePathIndex) continue;
      const path = doc.paths[pi];
      // Check first anchor
      if (path.anchors.length > 0) {
        const first = path.anchors[0];
        if (dist2D(point, first) <= SNAP_THRESHOLD) {
          return { pathIndex: pi, anchorIndex: 0, point: { x: first.x, y: first.y } };
        }
        // Check last anchor
        const last = path.anchors[path.anchors.length - 1];
        if (dist2D(point, last) <= SNAP_THRESHOLD) {
          return { pathIndex: pi, anchorIndex: path.anchors.length - 1, point: { x: last.x, y: last.y } };
        }
      }
    }
    return null;
  }, []);

  // ─── Regenerate Ghosts ─────────────────────────────
  const updateGhosts = useCallback(() => {
    const doc = docRef.current;
    if (doc.symmetryEnabled) {
      const width = getCanvasWidth?.() || 800;
      doc.ghostPaths = generateGhosts(doc.paths, width);
    } else {
      doc.ghostPaths = [];
    }
    markDirty();
  }, [getCanvasWidth, markDirty]);

  // ─── Pointer Event Handlers ────────────────────────

  const handlePointerDown = useCallback((point, drawingState) => {
    const doc = docRef.current;

    // In IDLE mode: check for hit on existing elements first
    if (doc.mode === "IDLE") {
      const hit = hitTestAll(doc, point);

      if (hit) {
        if (hit.type === "handle") {
          // Start curving mode
          doc.activePath = hit.pathIndex;
          doc.activeAnchor = hit.anchorIndex;
          doc.activeHandle = hit.handle;
          isDraggingRef.current = true;
          dragStartRef.current = {
            type: "handle",
            pathIndex: hit.pathIndex,
            anchorIndex: hit.anchorIndex,
            handle: hit.handle,
            before: clonePath(doc.paths[hit.pathIndex]),
          };
          setMode("CURVING");
          return;
        }

        if (hit.type === "anchor") {
          // Start editing mode
          doc.activePath = hit.pathIndex;
          doc.activeAnchor = hit.anchorIndex;
          doc.activeHandle = null;
          isDraggingRef.current = true;
          dragStartRef.current = {
            type: "anchor",
            pathIndex: hit.pathIndex,
            anchorIndex: hit.anchorIndex,
            before: clonePath(doc.paths[hit.pathIndex]),
          };
          setMode("EDITING");
          return;
        }

        if (hit.type === "segment") {
          // Select the path (future: could insert anchor at t)
          doc.activePath = hit.pathIndex;
          doc.activeAnchor = null;
          doc.activeHandle = null;
          setMode("IDLE");
          markDirty();
          return;
        }
      }

      // No hit — start drawing new path
      if (drawingState.tool === "lasso") return; // Lasso handled separately

      doc.activePath = null;
      doc.activeAnchor = null;
      doc.activeHandle = null;
      tempPointsRef.current = [point];
      isDraggingRef.current = true;
      setMode("DRAWING");
      return;
    }
  }, [setMode, markDirty]);

  const handlePointerMove = useCallback((point, drawingState) => {
    const doc = docRef.current;

    if (doc.mode === "DRAWING" && isDraggingRef.current) {
      // Collect raw points during drawing
      tempPointsRef.current.push(point);
      markDirty();
      onStroke?.("move");
      return;
    }

    if (doc.mode === "EDITING" && isDraggingRef.current && dragStartRef.current) {
      // Drag anchor
      const { pathIndex, anchorIndex } = dragStartRef.current;
      const path = doc.paths[pathIndex];
      if (path && path.anchors[anchorIndex]) {
        path.anchors[anchorIndex].x = point.x;
        path.anchors[anchorIndex].y = point.y;
        markDirty();
      }
      return;
    }

    if (doc.mode === "CURVING" && isDraggingRef.current && dragStartRef.current) {
      // Drag handle
      const { pathIndex, anchorIndex, handle } = dragStartRef.current;
      const path = doc.paths[pathIndex];
      if (path && path.anchors[anchorIndex]) {
        const anchor = path.anchors[anchorIndex];
        // Handle is stored as offset from anchor position
        const offset = { x: point.x - anchor.x, y: point.y - anchor.y };

        if (handle === "in") {
          anchor.handleIn = offset;
        } else {
          anchor.handleOut = offset;
        }

        // Enforce C2 continuity for smooth anchors
        if (anchor.type === "smooth") {
          enforceC2(anchor, handle);
        }

        markDirty();
      }
      return;
    }
  }, [markDirty, onStroke]);

  const handlePointerUp = useCallback((point, drawingState) => {
    const doc = docRef.current;

    if (doc.mode === "DRAWING" && isDraggingRef.current) {
      isDraggingRef.current = false;
      const rawPoints = tempPointsRef.current;
      tempPointsRef.current = [];

      if (rawPoints.length < 2) {
        setMode("IDLE");
        return;
      }

      // 1. RDP simplify
      const simplified = simplifyRDP(rawPoints, RDP_EPSILON);

      // 2. Bezier fit
      const anchors = fitBezierAnchors(simplified);

      if (anchors.length < 2) {
        setMode("IDLE");
        return;
      }

      // 3. Snap-to-anchor: check if start/end is near an existing anchor
      const startSnap = findSnapTarget(anchors[0]);
      const endSnap = findSnapTarget(anchors[anchors.length - 1]);

      if (startSnap) {
        anchors[0].x = startSnap.point.x;
        anchors[0].y = startSnap.point.y;
      }
      if (endSnap) {
        anchors[anchors.length - 1].x = endSnap.point.x;
        anchors[anchors.length - 1].y = endSnap.point.y;
      }

      // 4. Create new VectorPath
      const newPath = {
        id: crypto.randomUUID(),
        anchors,
        closed: false,
        color: drawingState.strokeColor,
        baseWidth: drawingState.strokeWidth,
        opacity: drawingState.opacity,
        tool: drawingState.tool,
        isGhost: false,
      };

      // 5. Add to document
      doc.paths.push(newPath);
      strokeCountRef.current++;

      // 6. Push undo
      pushUndo({
        type: "ADD_PATH",
        pathIndex: doc.paths.length - 1,
        after: clonePath(newPath),
      });

      // 7. Update ghosts
      updateGhosts();

      // 8. Notify
      setMode("IDLE");
      onStroke?.("up");
      return;
    }

    if ((doc.mode === "EDITING" || doc.mode === "CURVING") && isDraggingRef.current && dragStartRef.current) {
      isDraggingRef.current = false;
      const { pathIndex, before, type } = dragStartRef.current;

      // Push undo with before/after snapshots
      pushUndo({
        type: type === "anchor" ? "MOVE_ANCHOR" : "MOVE_HANDLE",
        pathIndex,
        before,
        after: clonePath(doc.paths[pathIndex]),
      });

      dragStartRef.current = null;
      updateGhosts();
      setMode("IDLE");
      return;
    }

    isDraggingRef.current = false;
  }, [setMode, pushUndo, findSnapTarget, updateGhosts, onStroke]);

  // ─── Hover (for cursor + hover indicators) ─────────

  const handleHover = useCallback((point) => {
    const doc = docRef.current;
    if (doc.mode !== "IDLE") return null;

    const hit = hitTestAll(doc, point);
    return hit; // VectorCanvas uses this for cursor + overlay rendering
  }, []);

  // ─── Undo/Redo ─────────────────────────────────────

  const undo = useCallback(() => {
    const doc = docRef.current;
    if (undoStackRef.current.length === 0) return;

    const entry = undoStackRef.current.pop();
    redoStackRef.current.push(entry);

    switch (entry.type) {
      case "ADD_PATH":
        doc.paths.splice(entry.pathIndex, 1);
        break;
      case "REMOVE_PATH":
        doc.paths.splice(entry.pathIndex, 0, clonePath(entry.before));
        break;
      case "MOVE_ANCHOR":
      case "MOVE_HANDLE":
      case "MODIFY_PATH":
        doc.paths[entry.pathIndex] = clonePath(entry.before);
        break;
    }

    doc.activePath = null;
    doc.activeAnchor = null;
    doc.activeHandle = null;
    updateGhosts();
    markDirty();
    notifyHistory();
  }, [updateGhosts, markDirty, notifyHistory]);

  const redo = useCallback(() => {
    const doc = docRef.current;
    if (redoStackRef.current.length === 0) return;

    const entry = redoStackRef.current.pop();
    undoStackRef.current.push(entry);

    switch (entry.type) {
      case "ADD_PATH":
        doc.paths.splice(entry.pathIndex, 0, clonePath(entry.after));
        break;
      case "REMOVE_PATH":
        doc.paths.splice(entry.pathIndex, 1);
        break;
      case "MOVE_ANCHOR":
      case "MOVE_HANDLE":
      case "MODIFY_PATH":
        doc.paths[entry.pathIndex] = clonePath(entry.after);
        break;
    }

    doc.activePath = null;
    doc.activeAnchor = null;
    doc.activeHandle = null;
    updateGhosts();
    markDirty();
    notifyHistory();
  }, [updateGhosts, markDirty, notifyHistory]);

  // ─── Clear ─────────────────────────────────────────

  const clear = useCallback(() => {
    docRef.current = createEmptyDoc();
    undoStackRef.current = [];
    redoStackRef.current = [];
    strokeCountRef.current = 0;
    tempPointsRef.current = [];
    isDraggingRef.current = false;
    dragStartRef.current = null;
    markDirty();
    notifyHistory();
    onModeChange?.("IDLE");
  }, [markDirty, notifyHistory, onModeChange]);

  // ─── Symmetry Toggle ───────────────────────────────

  const toggleSymmetry = useCallback(() => {
    docRef.current.symmetryEnabled = !docRef.current.symmetryEnabled;
    updateGhosts();
  }, [updateGhosts]);

  const setSymmetry = useCallback((enabled) => {
    if (docRef.current.symmetryEnabled !== enabled) {
      docRef.current.symmetryEnabled = enabled;
      updateGhosts();
    }
  }, [updateGhosts]);

  // ─── Programmatic Path Insertion (for AI commands) ───
  const addPaths = useCallback((newPaths) => {
    const doc = docRef.current;
    for (const path of newPaths) {
      doc.paths.push(path);
      pushUndo({
        type: "ADD_PATH",
        pathIndex: doc.paths.length - 1,
        after: clonePath(path),
      });
      strokeCountRef.current++;
    }
    updateGhosts();
    markDirty();
    // getSnapshot() now does synchronous rendering, so no delay needed
    onStroke?.("up");
  }, [pushUndo, updateGhosts, markDirty, onStroke]);

  const applySymmetry = useCallback(() => {
    const doc = docRef.current;
    if (doc.ghostPaths.length === 0) return;

    const committed = commitGhosts(doc.ghostPaths);
    const beforeLen = doc.paths.length;

    for (const path of committed) {
      doc.paths.push(path);
      pushUndo({
        type: "ADD_PATH",
        pathIndex: doc.paths.length - 1,
        after: clonePath(path),
      });
    }

    doc.ghostPaths = [];
    strokeCountRef.current += committed.length;
    updateGhosts();
    onStroke?.("up");
  }, [pushUndo, updateGhosts, onStroke]);

  // ─── Getters ───────────────────────────────────────

  const getDocument = useCallback(() => docRef.current, []);
  const getTempPoints = useCallback(() => tempPointsRef.current, []);
  const getNeedsRedraw = useCallback(() => {
    const val = needsRedrawRef.current;
    needsRedrawRef.current = false;
    return val;
  }, []);
  const getPathCount = useCallback(() => docRef.current.paths.length, []);
  const getStrokeCountSinceRender = useCallback(() => strokeCountRef.current, []);
  const resetStrokeCount = useCallback(() => { strokeCountRef.current = 0; }, []);

  return {
    // Event handlers
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleHover,

    // Actions
    undo,
    redo,
    clear,
    addPaths,
    toggleSymmetry,
    setSymmetry,
    applySymmetry,

    // Getters (for RAF loop)
    getDocument,
    getTempPoints,
    getNeedsRedraw,
    getPathCount,
    getStrokeCountSinceRender,
    resetStrokeCount,

    // Refs (for direct access)
    needsRedrawRef,
    markDirty,
  };
}
