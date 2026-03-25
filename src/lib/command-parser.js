// File: lib/command-parser.js — Maps slash commands to Blender/3D API payloads

/**
 * 3D pipeline commands — recognized by CommandInput.
 * Returns { type, endpoint, payload } or null if not a 3D command.
 */
export function parseBlenderCommand(cmd, state) {
  const normalized = cmd.replace(/^\//, "").trim().toLowerCase();
  const parts = normalized.split(/\s+/);
  const action = parts[0];
  const arg = parts.slice(1).join(" ");

  switch (action) {
    // ── View mode commands ──
    case "view-3d":
    case "3d":
      return { type: "dispatch", actions: [{ type: "SET_VIEW_MODE", payload: "3d" }] };

    case "view-2d":
    case "2d":
      return { type: "dispatch", actions: [{ type: "SET_VIEW_MODE", payload: "2d" }] };

    case "view-normals":
    case "normals":
    case "normalmap":
      return { type: "dispatch", actions: [{ type: "SET_VIEW_MODE", payload: "normalmap" }] };

    case "view-retopo":
    case "retopo-view":
    case "wireframe":
      return { type: "dispatch", actions: [{ type: "SET_VIEW_MODE", payload: "retopo" }] };

    case "view-pattern":
    case "pattern":
    case "flatten":
      return { type: "dispatch", actions: [{ type: "SET_VIEW_MODE", payload: "pattern" }] };

    // ── 3D generation ──
    case "generate-3d":
    case "gen3d":
    case "to3d":
      return { type: "generate-3d" };

    // ── Auto Fix — one-click pipeline ──
    case "auto-fix":
    case "autofix":
    case "fix":
      return {
        type: "blender",
        endpoint: "auto-fix",
        payload: { quality: arg || "standard" },
      };

    case "auto-fix-fast":
      return {
        type: "blender",
        endpoint: "auto-fix",
        payload: { quality: "fast" },
      };

    case "auto-fix-high":
      return {
        type: "blender",
        endpoint: "auto-fix",
        payload: { quality: "high" },
      };

    // ── Blender commands (require GLB) ──
    case "repair":
    case "repair-mesh":
    case "fix-mesh":
    case "fill-holes":
      return {
        type: "blender",
        endpoint: "repair-mesh",
        payload: {},
      };

    case "retopologize":
    case "retopo":
    case "clean-mesh":
      return {
        type: "blender",
        endpoint: "clean-mesh",
        payload: {
          target_faces: parseInt(arg) || 12000,
          smooth_iterations: 1,
          voxel_size: 0.005,
          use_voxel_remesh: "true",
        },
      };

    case "apply-fabric":
    case "swap-fabric":
    case "fabric": {
      const fabricType = arg || "cotton";
      return {
        type: "blender",
        endpoint: "swap-fabric",
        payload: { fabric_type: fabricType },
      };
    }

    case "resize":
    case "resize-garment": {
      const size = (arg || "M").toUpperCase();
      return {
        type: "blender",
        endpoint: "resize-garment",
        payload: { size },
      };
    }

    case "place-logo":
    case "apply-logo": {
      const position = arg || "chest_center";
      return {
        type: "blender",
        endpoint: "apply-logo",
        payload: { position, scale: 0.15 },
      };
    }

    case "cloth-sim":
    case "cloth":
    case "drape": {
      // Supports: /cloth-sim [size] [quality_preset] — e.g. "/cloth-sim M fast" or "/cloth-sim silk"
      const argParts = (arg || "").trim().toUpperCase().split(/\s+/);
      const sizes = ["XS", "S", "M", "L", "XL", "XXL"];
      const presets = ["FAST", "STANDARD", "HIGH"];
      let size = "M";
      let quality_preset = "standard";
      for (const p of argParts) {
        if (sizes.includes(p)) size = p;
        else if (presets.includes(p)) quality_preset = p.toLowerCase();
      }
      return {
        type: "blender",
        endpoint: "apply-cloth-physics",
        payload: { size, quality_preset },
      };
    }

    case "render-3d":
    case "render":
      return {
        type: "blender",
        endpoint: "render-scene",
        payload: {
          resolution: parseInt(arg) || 1024,
          samples: 128,
        },
      };

    case "turntable":
    case "turntable-render":
    case "360":
    case "spin": {
      const turntableFrames = parseInt(arg) || 36;
      return {
        type: "blender",
        endpoint: "turntable-render",
        payload: {
          frames: turntableFrames,
          resolution: 512,
          samples: 32,
        },
      };
    }

    case "bake-texture":
    case "bake-pbr":
    case "bake":
      return {
        type: "blender",
        endpoint: "bake-pbr",
        payload: {
          resolution: parseInt(arg) || 2048,
          textureDataUrl: state?.currentRenderUrl || null,
        },
      };

    case "rectify-uvs":
    case "rectify":
      return {
        type: "dispatch",
        actions: [
          { type: "SET_VIEW_MODE", payload: "pattern" },
          { type: "SET_STATUS", payload: "UV rectification applied — switch to Pattern view" },
        ],
      };

    // ── Morph UV / Techpack (3D→2D flat pattern with shape keys) ──
    case "techpack":
    case "gen-pattern":
    case "make-pattern":
      return {
        type: "blender",
        endpoint: "flatten-pattern",
        payload: { join: "true", scale: 1.0 },
      };

    case "unfold":
    case "flatten-3d":
      return {
        type: "blender",
        endpoint: "flatten-pattern",
        payload: { join: "false", scale: 1.0 },
      };

    // ── Seam editing ──
    case "set-seams":
    case "mark-seams":
    case "seams":
      return {
        type: "blender",
        endpoint: "set-seams",
        payload: { edge_indices: "[]", operation: "mark" },
      };

    // ── Material description → PBR (via GPT-4o) ──
    case "material":
    case "describe-material":
    case "mat": {
      if (!arg) return null;
      return { type: "material-prompt", description: arg };
    }

    // ── Modular part editing ──
    case "edit":
    case "edit-part": {
      const editTokens = arg.trim().split(/\s+/);
      const partType = editTokens[0] || "collar";
      const variant = editTokens.slice(1).join(" ");
      return {
        type: "blender",
        endpoint: "edit-part",
        payload: {
          edit_part: partType,
          part_spec: JSON.stringify({ type: partType, variant: variant || "" }),
        },
      };
    }

    // ── Geometry Nodes sliders ──
    case "apply-gn":
    case "gn": {
      const gnTokens = arg.trim().split(/\s+/);
      const gnPart = gnTokens[0] || "collar";
      let gnParams = {};
      try {
        gnParams = gnTokens.length > 1 ? JSON.parse(gnTokens.slice(1).join(" ")) : {};
      } catch {
        // ignore bad JSON
      }
      return {
        type: "blender",
        endpoint: "apply-gn",
        payload: { part: gnPart, gn_params: JSON.stringify(gnParams) },
      };
    }

    // ── Prompt-to-Blender assembly ──
    case "assemble":
    case "build":
    case "create-garment":
    case "build-garment":
      return {
        type: "prompt-to-blender",
        prompt: arg,
      };

    default:
      return null; // Not a 3D command
  }
}

/**
 * Handle the result from a Blender API call.
 * Updates state with new GLB URL or render image.
 */
export function handleBlenderResult(data, dispatch) {
  if (data.fileDataUrl) {
    // New GLB mesh returned — update viewer
    dispatch({ type: "SET_GLB_URL", payload: data.fileDataUrl });
    dispatch({ type: "SET_VIEW_MODE", payload: "3d" });
    dispatch({ type: "SET_STATUS", payload: "Blender processing complete — mesh updated" });
  } else if (data.imageDataUrl) {
    // Rendered image returned
    dispatch({
      type: "PUSH_RENDER",
      payload: { url: data.imageDataUrl, description: "Blender 3D render" },
    });
    dispatch({ type: "SET_VIEW_MODE", payload: "2d" });
    dispatch({ type: "SET_STATUS", payload: "3D render complete" });
  }
}

/**
 * List of all 3D command suggestions for the CommandInput dropdown.
 */
export const COMMAND_3D_SUGGESTIONS = [
  { cmd: "auto-fix", label: "Auto Fix", desc: "One-click repair + remesh + smooth (fast/standard/high)" },
  { cmd: "generate-3d", label: "Generate 3D", desc: "Convert 2D render to 3D mesh via HunYuan" },
  { cmd: "assemble white linen shirt with french cuff", label: "Assemble garment", desc: "Describe a garment to build from components" },
  { cmd: "repair-mesh", label: "Repair mesh", desc: "Fill holes, fix non-manifold, merge doubles (HunYuan fix)" },
  { cmd: "retopologize", label: "Retopologize", desc: "Voxel remesh + clean topology + smooth" },
  { cmd: "apply-fabric cotton", label: "Apply fabric", desc: "Swap fabric material (cotton, denim, silk, leather, spandex, wool, velvet)" },
  { cmd: "material aged indigo denim", label: "Describe material", desc: "GPT-4o PBR spec from natural language (aged/worn/glossy/matte)" },
  { cmd: "resize L", label: "Resize garment", desc: "Parametric resize (XS, S, M, L, XL, XXL)" },
  { cmd: "place-logo", label: "Place logo", desc: "Map logo onto garment UV (chest, back, sleeve)" },
  { cmd: "cloth-sim M standard", label: "Cloth simulation", desc: "Fabric-adaptive draping (size + fast/standard/high preset)" },
  { cmd: "techpack", label: "Generate Techpack", desc: "Unfold 3D garment to flat sewing patterns (shape-key morph)" },
  { cmd: "unfold", label: "Unfold pattern", desc: "3D→2D UV morph without joining parts" },
  { cmd: "edit collar mandarin", label: "Edit part", desc: "Swap or edit a named garment part (collar, sleeve, cuff, pocket...)" },
  { cmd: "render-3d", label: "Render 3D", desc: "Cycles studio render of 3D garment" },
  { cmd: "turntable", label: "360° Turntable", desc: "Animated 360° rotating GIF of garment (12-72 frames)" },
  { cmd: "view-3d", label: "View 3D", desc: "Switch to 3D viewer" },
  { cmd: "view-2d", label: "View 2D", desc: "Switch to 2D render view" },
  { cmd: "view-normals", label: "View normals", desc: "Switch to normal map visualization" },
  { cmd: "view-retopo", label: "View retopo", desc: "Switch to retopology wireframe view" },
  { cmd: "view-pattern", label: "View pattern", desc: "Switch to flat 2D pattern layout" },
  { cmd: "bake-texture", label: "Bake PBR", desc: "Project AI render onto mesh UVs with Normal + AO maps" },
  { cmd: "rectify-uvs", label: "Rectify UVs", desc: "Straighten curved UV islands into rectangles" },
];
