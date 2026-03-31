// File: app/api/blender-mcp/route.js
// Blender-Claude MCP Bridge: Natural language → GPT-4 → bpy code → Blender → GLB
//
// This is the "Blender with ChatGPT" feature.
// User types: "Navy blazer with peak lapels"
// GPT-4 generates: Actual Blender Python code (bpy.ops, bmesh, modifiers)
// Blender runs: The code on the RunPod pod
// Returns: GLB file displayed in the 3D viewer
import { NextResponse } from "next/server";
import { GarmentFactory, FABRIC_PROPERTIES, STANDARD_MEASUREMENTS } from "@/lib/garment-factory";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const BLENDER_API_URL = () => (process.env.BLENDER_API_URL || "http://localhost:8000").trim();

// ── System prompt: GPT-4 as a Blender Python expert ──
const BLENDER_CODE_SYSTEM = `You are a Blender Python expert specializing in garment 3D modeling. Generate ONLY valid Blender Python code (bpy, bmesh, mathutils) that creates 3D garment models.

CRITICAL RULES:
1. Output ONLY Python code — no markdown, no \`\`\`, no explanations
2. The scene is pre-cleared for you. Create objects from scratch.
3. All measurements are in METERS (1cm = 0.01m)
4. Always apply smooth shading: bpy.ops.object.shade_smooth()
5. Always create proper materials with Principled BSDF
6. Use bmesh for precise geometry — never use text/curve objects
7. For garments, build 2D panels first, then position them around a body
8. Export is handled automatically — just create the objects

GARMENT CONSTRUCTION APPROACH:
- Create each pattern panel as a flat mesh (Z=0) using bmesh
- Subdivide panels for smooth cloth draping
- Position panels around a mannequin body
- Add cloth physics modifier for realistic draping
- Run simulation to drape the garment

AVAILABLE BODY MEASUREMENTS (Size M, in meters):
- Chest circumference: 0.96m
- Waist: 0.78m, Hips: 1.00m
- Shoulder to shoulder: 0.43m
- Back length (neck to waist): 0.43m
- Sleeve length: 0.62m
- Armhole depth: 0.22m

COLOR FORMAT: Use hex_to_linear_rgb() helper:
def hex_to_linear_rgb(h):
    h = h.lstrip("#")
    r,g,b = int(h[0:2],16)/255, int(h[2:4],16)/255, int(h[4:6],16)/255
    return (r**2.2, g**2.2, b**2.2)

MATERIAL TEMPLATE:
mat = bpy.data.materials.new(name="FabricName")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (*hex_to_linear_rgb("#HEX"), 1.0)
bsdf.inputs["Roughness"].default_value = 0.85  # cotton=0.85, silk=0.35, leather=0.55
obj.data.materials.append(mat)

EXAMPLE — Simple T-shirt:
import bpy, bmesh
from mathutils import Vector, Matrix
import math

def hex_to_linear_rgb(h):
    h = h.lstrip("#")
    r,g,b = int(h[0:2],16)/255, int(h[2:4],16)/255, int(h[4:6],16)/255
    return (r**2.2, g**2.2, b**2.2)

def create_panel(name, verts_cm, location, rotation_z=0):
    """Create a flat mesh panel from 2D coordinates (in cm)."""
    mesh = bpy.data.meshes.new(f"Mesh_{name}")
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)

    vertices = [(v[0]*0.01, v[1]*0.01, 0) for v in verts_cm]
    faces = [list(range(len(vertices)))]
    mesh.from_pydata(vertices, [], faces)
    mesh.update()

    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.subdivide(number_cuts=3)
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")

    obj.location = location
    obj.rotation_euler = (math.radians(90), 0, math.radians(rotation_z))
    bpy.ops.object.shade_smooth()
    obj.select_set(False)
    return obj

# Front panel
front = create_panel("Front", [
    [0,0], [48,0], [48,30], [24,48], [22,48], [26,48], [0,30]
], location=(0, 0.22, 1.15))

# Back panel
back = create_panel("Back", [
    [0,0], [48,0], [48,30], [24,46], [22,46], [26,46], [0,30]
], location=(0, -0.22, 1.15), rotation_z=180)

# Material
mat = bpy.data.materials.new(name="Cotton")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
bsdf.inputs["Roughness"].default_value = 0.85
for obj in bpy.data.objects:
    if obj.type == "MESH":
        obj.data.materials.append(mat)

Remember: Generate code for the SPECIFIC garment the user describes. Include proper measurements, fabric properties, and color.`;

// ── Edit system prompt ──
const BLENDER_EDIT_SYSTEM = `You are a Blender Python expert. The user wants to modify an existing 3D garment.
You will receive the PREVIOUS code that created the garment and the user's modification request.
Generate COMPLETE updated Python code (not a diff) that creates the modified garment from scratch.
Follow all the same rules as before — output ONLY Python code, no markdown.`;

// ── Generate bpy code from prompt ──
async function promptToBlenderCode(prompt, previousCode = null) {
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not configured");

  const messages = [];

  if (previousCode) {
    messages.push({ role: "system", content: BLENDER_EDIT_SYSTEM });
    messages.push({ role: "assistant", content: previousCode });
    messages.push({ role: "user", content: `Modify this garment: ${prompt}` });
  } else {
    messages.push({ role: "system", content: BLENDER_CODE_SYSTEM });

    // Also include GarmentFactory data for reference
    const factory = new GarmentFactory();
    const guessType = prompt.toLowerCase();
    let templateType = "tshirt";
    if (guessType.includes("blazer") || guessType.includes("jacket")) templateType = "blazer";
    else if (guessType.includes("shirt") || guessType.includes("button")) templateType = "shirt";
    else if (guessType.includes("pants") || guessType.includes("trouser")) templateType = "pants";
    else if (guessType.includes("dress")) templateType = "dress";
    else if (guessType.includes("skirt")) templateType = "skirt";
    else if (guessType.includes("hoodie") || guessType.includes("sweat")) templateType = "hoodie";
    else if (guessType.includes("tank")) templateType = "tank_top";

    const spec = factory.create(templateType, { size: "M", fit: "regular" });
    const panelRef = spec.panels.map(p =>
      `Panel "${p.name}": ${p.vertices.length} vertices, ${Math.round(p.width_cm)}x${Math.round(p.height_cm)}cm`
    ).join("\n");

    messages.push({
      role: "user",
      content: `Create a 3D Blender model of: "${prompt}"

Reference panel dimensions from our pattern system:
${panelRef}

Use these dimensions as a guide for realistic proportions. Generate the complete bpy code.`
    });
  }

  console.log(`[blender-mcp] GPT-4 generating bpy code for: "${prompt.substring(0, 60)}..."`)

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      messages,
      temperature: 0.3,
      max_tokens: 4000,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`OpenAI API error (${res.status}): ${err.substring(0, 200)}`);
  }

  const data = await res.json();
  let code = data.choices?.[0]?.message?.content || "";

  // Strip markdown code fences if GPT-4 adds them despite instructions
  code = code.replace(/^```python\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();

  console.log(`[blender-mcp] Generated ${code.length} chars of bpy code`);
  return code;
}

// ── Execute code on Blender pod ──
async function executeOnBlender(code) {
  const url = BLENDER_API_URL();
  console.log(`[blender-mcp] Executing on ${url}/api/blender-execute...`);

  const res = await fetch(`${url}/api/blender-execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    console.error(`[blender-mcp] Execution failed (${res.status}): ${err.substring(0, 300)}`);
    return { error: err.substring(0, 300), status: res.status };
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("model/gltf-binary") || contentType.includes("application/octet-stream")) {
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    console.log(`[blender-mcp] GLB received: ${Math.round(buffer.byteLength / 1024)}KB`);
    return { glbUrl: `data:model/gltf-binary;base64,${base64}` };
  }

  return { error: "Unexpected response format" };
}

// ── POST handler ──
export async function POST(request) {
  try {
    const body = await request.json();
    const { prompt, previousCode = null, mode = "generate" } = body;

    if (!prompt) {
      return NextResponse.json({ error: "Missing 'prompt'" }, { status: 400 });
    }

    // Step 1: GPT-4 generates Blender Python code
    const code = await promptToBlenderCode(prompt, previousCode);

    if (!code || code.length < 50) {
      return NextResponse.json({
        error: "GPT-4 generated insufficient code",
        code,
      }, { status: 500 });
    }

    // Step 2: Execute on Blender pod
    const result = await executeOnBlender(code);

    if (result.error) {
      // Return the code even on failure so the user can see what was attempted
      return NextResponse.json({
        error: result.error,
        code,
        message: `Blender execution failed. The generated code is included for debugging.`,
      }, { status: result.status || 500 });
    }

    return NextResponse.json({
      glbUrl: result.glbUrl,
      code,
      message: `3D garment created via Blender-native pipeline`,
    });

  } catch (err) {
    console.error("[blender-mcp] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
