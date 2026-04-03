// File: components/drawing-canvas/Editor3DToolbar.jsx
// Floating vertical toolbar for 3D editing — transform, mesh ops, paint, part selection
"use client";

import { useDrawingCanvas } from "@/hooks/useDrawingCanvas";
import { useMeshOperations } from "@/hooks/useMeshOperations";

const TRANSFORM_TOOLS = [
  { id: "select", label: "Select", shortcut: "Q", icon: "M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59" },
  { id: "translate", label: "Move", shortcut: "G", icon: "M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" },
  { id: "rotate", label: "Rotate", shortcut: "R", icon: "M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" },
  { id: "scale", label: "Scale", shortcut: "S", icon: "M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" },
];

const PART_SELECTION_MODES = [
  { id: "whole", label: "Whole", icon: "M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" },
  { id: "face_select", label: "Faces", icon: "M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zm0 9.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zm9.75-9.75A2.25 2.25 0 0115.75 3.75H18a2.25 2.25 0 012.25 2.25v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zm0 9.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" },
  { id: "sam_auto", label: "SAM", icon: "M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" },
];

function ToolButton({ active, onClick, icon, label, shortcut, small }) {
  return (
    <button
      onClick={onClick}
      title={`${label}${shortcut ? ` (${shortcut})` : ""}`}
      className={`flex items-center justify-center rounded-lg transition-all ${
        small ? "w-7 h-7" : "w-8 h-8"
      } ${
        active
          ? "bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200"
          : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
      }`}
    >
      <svg
        className={small ? "w-3.5 h-3.5" : "w-4 h-4"}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
      </svg>
    </button>
  );
}

function Divider() {
  return <div className="w-full h-px bg-gray-200 my-1" />;
}

function SectionLabel({ children }) {
  return (
    <span className="text-[7px] font-bold uppercase tracking-widest text-gray-300 px-1 select-none">
      {children}
    </span>
  );
}

export default function Editor3DToolbar() {
  const { state, dispatch } = useDrawingCanvas();
  const meshOps = useMeshOperations();

  const is3DView = ["3d", "normalmap", "retopo", "pattern"].includes(state.viewMode);

  if (!is3DView || !state.glbUrl) return null;

  return (
    <div className="absolute left-3 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-1 p-1.5 rounded-2xl bg-white/95 backdrop-blur-sm border border-gray-200 shadow-lg">
      {/* ── Transform tools ── */}
      <SectionLabel>Transform</SectionLabel>
      {TRANSFORM_TOOLS.map((tool) => (
        <ToolButton
          key={tool.id}
          active={state.editorTool3D === tool.id}
          onClick={() => dispatch({ type: "SET_EDITOR_TOOL_3D", payload: tool.id })}
          icon={tool.icon}
          label={tool.label}
          shortcut={tool.shortcut}
        />
      ))}

      {/* World / Local toggle */}
      <button
        onClick={() =>
          dispatch({
            type: "SET_TRANSFORM_SPACE",
            payload: state.transformSpace === "world" ? "local" : "world",
          })
        }
        title={`Space: ${state.transformSpace} (W)`}
        className="w-8 h-5 rounded text-[7px] font-bold uppercase tracking-wider text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 transition-colors"
      >
        {state.transformSpace === "world" ? "WLD" : "LCL"}
      </button>

      <Divider />

      {/* ── Mesh operations — direct action buttons ── */}
      <SectionLabel>Mesh</SectionLabel>
      {/* Repair Mesh — fill holes, fix non-manifold (critical for HunYuan meshes) */}
      <ToolButton
        active={state.meshOpInProgress === "repair-mesh"}
        onClick={() => !meshOps.isProcessing && meshOps.repairMesh()}
        icon="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085"
        label="Repair Mesh"
      />
      {/* Retopologize — clean topology + smooth */}
      <ToolButton
        active={state.meshOpInProgress === "clean-mesh"}
        onClick={() => !meshOps.isProcessing && meshOps.retopologize()}
        icon="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"
        label="Retopologize"
      />
      {/* Subdivide */}
      <ToolButton
        active={state.meshOpInProgress === "subdivide"}
        onClick={() => !meshOps.isProcessing && meshOps.subdivide(1)}
        icon="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zm0 9.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zm9.75-9.75A2.25 2.25 0 0115.75 3.75H18a2.25 2.25 0 012.25 2.25v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zm0 9.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
        label="Subdivide"
      />
      {/* Smooth */}
      <ToolButton
        active={state.meshOpInProgress === "smooth"}
        onClick={() => !meshOps.isProcessing && meshOps.smooth(2)}
        icon="M12 3c4.97 0 9 4.03 9 9s-4.03 9-9 9-9-4.03-9-9 4.03-9 9-9z"
        label="Smooth"
      />
      {/* More Mesh Ops — opens full panel */}
      <ToolButton
        active={state.editorPanelOpen === "mesh_ops"}
        onClick={() =>
          dispatch({
            type: "SET_EDITOR_PANEL",
            payload: state.editorPanelOpen === "mesh_ops" ? "none" : "mesh_ops",
          })
        }
        icon="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z"
        label="More Ops"
        small
      />
      {/* AI Effect Tools — opens effects panel */}
      <ToolButton
        active={state.editorPanelOpen === "ai_effects"}
        onClick={() =>
          dispatch({
            type: "SET_EDITOR_PANEL",
            payload: state.editorPanelOpen === "ai_effects" ? "none" : "ai_effects",
          })
        }
        icon="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455 2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z"
        label="AI Effects"
        small
      />
      {/* Bake PBR — shown when an AI render exists */}
      {state.currentRenderUrl && (
        <ToolButton
          active={false}
          onClick={() => !meshOps.isProcessing && meshOps.bakePBR(state.currentRenderUrl)}
          icon="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
          label="Bake PBR"
        />
      )}

      <Divider />

      {/* ── Material / Paint ── */}
      <SectionLabel>Paint</SectionLabel>
      <ToolButton
        active={state.editorPanelOpen === "material"}
        onClick={() =>
          dispatch({
            type: "SET_EDITOR_PANEL",
            payload: state.editorPanelOpen === "material" ? "none" : "material",
          })
        }
        icon="M4.098 19.902a3.75 3.75 0 005.304 0l6.401-6.402M6.75 21A3.75 3.75 0 013 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 003.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008z"
        label="Material (M)"
        shortcut="M"
      />
      <ToolButton
        active={state.paintMode !== "off"}
        onClick={() =>
          dispatch({
            type: "SET_PAINT_MODE",
            payload: state.paintMode === "off" ? "vertex_paint" : "off",
          })
        }
        icon="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42"
        label="Vertex Paint (V)"
        shortcut="V"
      />

      {/* Paint color swatch */}
      {state.paintMode !== "off" && (
        <div
          className="w-6 h-6 rounded-md border-2 border-white shadow-sm cursor-pointer"
          style={{ backgroundColor: state.paintColor }}
          onClick={() =>
            dispatch({
              type: "SET_EDITOR_PANEL",
              payload: state.editorPanelOpen === "paint" ? "none" : "paint",
            })
          }
          title="Paint color"
        />
      )}

      <Divider />

      {/* ── Part selection mode ── */}
      <SectionLabel>Select</SectionLabel>
      {PART_SELECTION_MODES.map((mode) => (
        <ToolButton
          key={mode.id}
          small
          active={state.partSelectionMode === mode.id}
          onClick={() =>
            dispatch({ type: "SET_PART_SELECTION_MODE", payload: mode.id })
          }
          icon={mode.icon}
          label={mode.label}
        />
      ))}

      <Divider />

      {/* ── 3D Undo / Redo ── */}
      <div className="flex gap-0.5">
        <button
          onClick={() => dispatch({ type: "UNDO_3D" })}
          disabled={state.glbHistoryIndex <= 0}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Undo 3D (Ctrl+Z)"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
          </svg>
        </button>
        <button
          onClick={() => dispatch({ type: "REDO_3D" })}
          disabled={state.glbHistoryIndex >= state.glbHistory.length - 1}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Redo 3D (Ctrl+Shift+Z)"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3" />
          </svg>
        </button>
      </div>

      {/* ── Active tool indicator ── */}
      {state.editorTool3D !== "select" && (
        <div className="px-2 py-0.5 rounded-md bg-indigo-500 text-white text-[7px] font-bold uppercase tracking-wider">
          {state.editorTool3D}
        </div>
      )}
      {state.meshOpInProgress && (
        <div className="px-2 py-0.5 rounded-md bg-amber-500 text-white text-[7px] font-bold uppercase tracking-wider animate-pulse">
          {state.meshOpInProgress}
        </div>
      )}
    </div>
  );
}
