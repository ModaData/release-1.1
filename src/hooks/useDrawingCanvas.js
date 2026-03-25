"use client";

import { useReducer, useContext, createContext, useCallback, useMemo } from "react";

// ─── Initial State ───────────────────────────────────────
const initialState = {
  // Context (Step 1)
  garmentCategory: null,
  selectedFiber: null,
  selectedConstruction: null,
  gsm: null,
  fabricPromptFragment: null,
  gender: "women",
  styleNotes: "",
  referenceImageUrl: null,

  // Drawing
  tool: "pencil",
  strokeColor: "#000000",
  strokeWidth: 2,
  opacity: 1.0,
  canvasBackground: "blank",

  // Render
  renderMode: "freestyle",
  controlStrength: 0.65,
  currentRenderUrl: null,
  previousRenderUrl: null,
  renderHistory: [],
  isGenerating: false,
  renderCount: 0,

  // Refinement (Co-Pilot controls)
  selectedColor: null,
  detailNotes: "",
  fitValue: 0.5,
  lengthValue: 0.5,

  // Co-Pilot
  currentInterpretation: "",
  constraintViolations: [],
  suggestions: [],

  // Annotations
  annotations: [],

  // Lock & Export
  isLocked: false,
  lockedRenderUrl: null,

  // UI
  coPilotOpen: false,
  splitRatio: 0.5,

  // Vector engine
  vectorMode: "IDLE",
  symmetryEnabled: false,

  // Render engine
  throttleMs: 800,
  manualRenderMode: false,

  // AI features
  previewUrl: null,
  fashionTerms: [],
  commandInputOpen: false,

  // Image overlay (uploaded reference)
  uploadedOverlayImage: null, // { dataUrl, width, height, x, y, scale, opacity }
  uploadedOverlayVisible: true,

  // 3D pipeline
  viewMode: "2d", // "2d" | "3d" | "normalmap" | "retopo"
  glbUrl: null,
  isGenerating3D: false,

  // Interactive 3D — garment config + part selection
  garmentConfig: null, // JSON config from prompt-to-blender
  selectedPart: null, // currently selected garment part name
  hoveredPart: null, // currently hovered garment part name

  // ── 3D Editor ──────────────────────────────────────────
  // Transform controls
  editorTool3D: "select", // "select" | "translate" | "rotate" | "scale"
  transformSpace: "world", // "world" | "local"

  // Material editing
  materialEditor: {
    color: "#cccccc",
    metalness: 0.0,
    roughness: 0.5,
    opacity: 1.0,
    fabricPreset: null, // null | "cotton" | "silk" | "denim" etc.
    wireframe: false,
  },

  // Vertex painting
  paintMode: "off", // "off" | "vertex_paint" | "face_select"
  paintColor: "#ff0000",
  paintBrushRadius: 0.05,
  paintOpacity: 1.0,

  // Part selection mode
  partSelectionMode: "whole", // "whole" | "face_select" | "sam_auto"
  samSegmentMasks: [], // Array of { maskDataUrl, label, confidence }
  samIsProcessing: false,

  // Mesh operations (server-side, async)
  meshOpInProgress: null, // null | "subdivide" | "decimate" | "smooth" | "retopo"

  // UV Morph (3D↔Pattern view)
  uvMorphProgress: 0, // 0-1 animation progress
  isPatternView: false, // true when flattened to 2D pattern

  // Digital Atelier — Pattern Split View
  patternMode: false, // true = render PatternSplitView instead of single Canvas
  patternGlbUrl: null, // separate flat-state GLB URL (post seams-and-flatten)
  pendingSeamIndices: [], // edge indices collected before commit
  seamEditorActive: false, // enables seam edge picking on 3D panel

  // UV Sync Selection (Blender 5.0-style bidirectional sync)
  highlightedIslandId: null, // which UV island is currently highlighted
  selectedFaceIndices: [], // faces selected via UV panel click-back
  uvSyncEnabled: true, // toggle for sync behavior

  // 3D editor panel visibility
  editorPanelOpen: "none", // "none" | "material" | "mesh_ops" | "paint"

  // Undo stack for 3D edits
  glbHistory: [], // Array of glbUrl strings for 3D undo
  glbHistoryIndex: -1,

  // Status
  error: null,
  status: "Set your context above, then start drawing — AI renders in real-time",
};

// ─── Reducer ─────────────────────────────────────────────
function drawingCanvasReducer(state, action) {
  switch (action.type) {
    // Context
    case "SET_GARMENT_CATEGORY":
      return { ...state, garmentCategory: action.payload };
    case "SET_FIBER":
      return { ...state, selectedFiber: action.payload };
    case "SET_CONSTRUCTION":
      return { ...state, selectedConstruction: action.payload };
    case "SET_GSM":
      return { ...state, gsm: action.payload };
    case "SET_FABRIC_PROMPT_FRAGMENT":
      return { ...state, fabricPromptFragment: action.payload };
    case "SET_GENDER":
      return { ...state, gender: action.payload };
    case "SET_STYLE_NOTES":
      return { ...state, styleNotes: action.payload };
    case "SET_REFERENCE_IMAGE":
      return { ...state, referenceImageUrl: action.payload };

    // Drawing
    case "SET_TOOL":
      return { ...state, tool: action.payload };
    case "SET_STROKE_COLOR":
      return { ...state, strokeColor: action.payload };
    case "SET_STROKE_WIDTH":
      return { ...state, strokeWidth: action.payload };
    case "SET_OPACITY":
      return { ...state, opacity: action.payload };
    case "SET_CANVAS_BACKGROUND":
      return { ...state, canvasBackground: action.payload };

    // Render
    case "SET_RENDER_MODE":
      return { ...state, renderMode: action.payload };
    case "SET_CONTROL_STRENGTH":
      return { ...state, controlStrength: action.payload };
    case "PUSH_RENDER":
      return {
        ...state,
        previousRenderUrl: state.currentRenderUrl,
        currentRenderUrl: action.payload.url,
        renderHistory: [
          ...state.renderHistory,
          {
            id: crypto.randomUUID(),
            renderUrl: action.payload.url,
            snapshotUrl: action.payload.snapshot,
            description: action.payload.description,
            timestamp: Date.now(),
          },
        ],
        renderCount: state.renderCount + 1,
        isGenerating: false,
        currentInterpretation: action.payload.description || state.currentInterpretation,
        status: `Render ${state.renderCount + 1} complete`,
      };
    case "SET_GENERATING":
      return { ...state, isGenerating: action.payload };
    case "REVERT_TO_RENDER": {
      const target = state.renderHistory.find((r) => r.id === action.payload);
      if (!target) return state;
      return {
        ...state,
        previousRenderUrl: state.currentRenderUrl,
        currentRenderUrl: target.renderUrl,
        currentInterpretation: target.description || state.currentInterpretation,
      };
    }

    // Refinement
    case "SET_COLOR":
      return { ...state, selectedColor: action.payload };
    case "SET_DETAIL_NOTES":
      return { ...state, detailNotes: action.payload };
    case "SET_FIT":
      return { ...state, fitValue: action.payload };
    case "SET_LENGTH":
      return { ...state, lengthValue: action.payload };

    // Co-Pilot
    case "SET_INTERPRETATION":
      return { ...state, currentInterpretation: action.payload };
    case "SET_VIOLATIONS":
      return { ...state, constraintViolations: action.payload };
    case "SET_SUGGESTIONS":
      return { ...state, suggestions: action.payload };
    case "TOGGLE_CO_PILOT":
      return { ...state, coPilotOpen: !state.coPilotOpen };
    case "SET_VECTOR_MODE":
      return { ...state, vectorMode: action.payload };
    case "TOGGLE_SYMMETRY":
      return { ...state, symmetryEnabled: !state.symmetryEnabled };
    case "SET_SYMMETRY":
      return { ...state, symmetryEnabled: action.payload };

    // Annotations
    case "ADD_ANNOTATION":
      return { ...state, annotations: [...state.annotations, action.payload] };
    case "REMOVE_ANNOTATION":
      return {
        ...state,
        annotations: state.annotations.filter((a) => a.id !== action.payload),
      };

    // Lock & Export
    case "LOCK_RENDER":
      return { ...state, isLocked: true, lockedRenderUrl: state.currentRenderUrl };
    case "UNLOCK_RENDER":
      return { ...state, isLocked: false, lockedRenderUrl: null };

    // UI
    case "SET_SPLIT_RATIO":
      return { ...state, splitRatio: action.payload };
    case "SET_ERROR":
      return { ...state, error: action.payload };
    case "SET_STATUS":
      return { ...state, status: action.payload };
    case "SET_MANUAL_RENDER_MODE":
      return { ...state, manualRenderMode: action.payload };

    // AI features
    case "SET_FASHION_TERMS":
      return { ...state, fashionTerms: action.payload };
    case "SET_PREVIEW_URL":
      return { ...state, previewUrl: action.payload };
    case "CLEAR_ERROR":
      return { ...state, error: null };
    case "SET_COMMAND_INPUT_OPEN":
      return { ...state, commandInputOpen: action.payload };

    // Image overlay
    case "SET_UPLOADED_OVERLAY":
      return { ...state, uploadedOverlayImage: action.payload, uploadedOverlayVisible: true };
    case "TOGGLE_UPLOADED_OVERLAY":
      return { ...state, uploadedOverlayVisible: !state.uploadedOverlayVisible };
    case "CLEAR_UPLOADED_OVERLAY":
      return { ...state, uploadedOverlayImage: null, uploadedOverlayVisible: true };

    // 3D pipeline
    case "SET_VIEW_MODE":
      return { ...state, viewMode: action.payload };
    case "SET_GLB_URL":
      return {
        ...state,
        glbUrl: action.payload,
        glbHistory: action.payload
          ? [...state.glbHistory.slice(0, state.glbHistoryIndex + 1), action.payload]
          : state.glbHistory,
        glbHistoryIndex: action.payload
          ? state.glbHistory.slice(0, state.glbHistoryIndex + 1).length
          : state.glbHistoryIndex,
      };
    case "SET_GENERATING_3D":
      return { ...state, isGenerating3D: action.payload };

    // Interactive 3D — garment config + part selection
    case "SET_GARMENT_CONFIG":
      return { ...state, garmentConfig: action.payload };
    case "SET_SELECTED_PART":
      return { ...state, selectedPart: action.payload };
    case "SET_HOVERED_PART":
      return { ...state, hoveredPart: action.payload };
    case "REMOVE_GARMENT_PART":
      return {
        ...state,
        selectedPart: null,
        garmentConfig: state.garmentConfig
          ? { ...state.garmentConfig, _removedPart: action.payload }
          : null,
      };
    case "REPLACE_GARMENT_PART":
      return {
        ...state,
        garmentConfig: state.garmentConfig
          ? { ...state.garmentConfig, _replacedPart: action.payload }
          : null,
      };

    // ── 3D Editor ──────────────────────────────────────────
    // Transform
    case "SET_EDITOR_TOOL_3D":
      return { ...state, editorTool3D: action.payload };
    case "SET_TRANSFORM_SPACE":
      return { ...state, transformSpace: action.payload };

    // Material
    case "SET_MATERIAL_EDITOR":
      return { ...state, materialEditor: { ...state.materialEditor, ...action.payload } };
    case "APPLY_FABRIC_PRESET":
      return { ...state, materialEditor: { ...state.materialEditor, fabricPreset: action.payload } };

    // Vertex painting
    case "SET_PAINT_MODE":
      return { ...state, paintMode: action.payload };
    case "SET_PAINT_COLOR":
      return { ...state, paintColor: action.payload };
    case "SET_PAINT_BRUSH_RADIUS":
      return { ...state, paintBrushRadius: action.payload };

    // Part selection
    case "SET_PART_SELECTION_MODE":
      return { ...state, partSelectionMode: action.payload, selectedPart: null };
    case "SET_SAM_MASKS":
      return { ...state, samSegmentMasks: action.payload, samIsProcessing: false };
    case "SET_SAM_PROCESSING":
      return { ...state, samIsProcessing: action.payload };

    // Mesh operations
    case "SET_MESH_OP_IN_PROGRESS":
      return { ...state, meshOpInProgress: action.payload };
    case "MESH_OP_COMPLETE":
      return {
        ...state,
        meshOpInProgress: null,
        glbUrl: action.payload.glbUrl,
        glbHistory: [...state.glbHistory.slice(0, state.glbHistoryIndex + 1), action.payload.glbUrl],
        glbHistoryIndex: state.glbHistoryIndex + 1,
      };

    // UV Morph
    case "SET_UV_MORPH_PROGRESS":
      return { ...state, uvMorphProgress: action.payload };
    case "SET_PATTERN_VIEW":
      return { ...state, isPatternView: action.payload };

    // Digital Atelier — Pattern Split View
    case "SET_PATTERN_MODE":
      return { ...state, patternMode: action.payload };
    case "SET_PATTERN_GLB":
      return { ...state, patternGlbUrl: action.payload };
    case "ADD_SEAM_INDEX":
      return { ...state, pendingSeamIndices: [...state.pendingSeamIndices, action.payload] };
    case "CLEAR_PENDING_SEAMS":
      return { ...state, pendingSeamIndices: [] };
    case "SET_SEAM_EDITOR":
      return { ...state, seamEditorActive: action.payload };

    // UV Sync Selection
    case "HIGHLIGHT_ISLAND":
      return { ...state, highlightedIslandId: action.payload };
    case "SELECT_3D_FACES":
      return { ...state, selectedFaceIndices: action.payload };
    case "TOGGLE_UV_SYNC":
      return { ...state, uvSyncEnabled: !state.uvSyncEnabled };

    // Editor panels
    case "SET_EDITOR_PANEL":
      return { ...state, editorPanelOpen: action.payload };

    // 3D undo/redo
    case "UNDO_3D":
      if (state.glbHistoryIndex <= 0) return state;
      return {
        ...state,
        glbHistoryIndex: state.glbHistoryIndex - 1,
        glbUrl: state.glbHistory[state.glbHistoryIndex - 1],
      };
    case "REDO_3D":
      if (state.glbHistoryIndex >= state.glbHistory.length - 1) return state;
      return {
        ...state,
        glbHistoryIndex: state.glbHistoryIndex + 1,
        glbUrl: state.glbHistory[state.glbHistoryIndex + 1],
      };

    case "RESET":
      return { ...initialState };

    default:
      return state;
  }
}

// ─── Context ─────────────────────────────────────────────
const DrawingCanvasContext = createContext(null);

export function DrawingCanvasProvider({ children }) {
  const [state, dispatch] = useReducer(drawingCanvasReducer, initialState);

  const value = useMemo(() => ({ state, dispatch }), [state]);

  return (
    <DrawingCanvasContext.Provider value={value}>
      {children}
    </DrawingCanvasContext.Provider>
  );
}

export function useDrawingCanvas() {
  const ctx = useContext(DrawingCanvasContext);
  if (!ctx) throw new Error("useDrawingCanvas must be used within DrawingCanvasProvider");
  return ctx;
}

export { initialState };
