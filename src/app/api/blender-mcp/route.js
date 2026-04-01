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
const BLENDER_CODE_SYSTEM = `You are a Blender Python expert. Generate ONLY valid Python code — no markdown, no backticks, no explanations.

The scene is pre-cleared. You MUST produce an ASSEMBLED 3D garment, NOT separate flat panels.

MANDATORY APPROACH — Use the Skin modifier + Subdivision Surface method:
1. Create the garment silhouette using vertices+edges (like drawing the outline)
2. Add Skin modifier to give it volume/thickness
3. Add Subdivision Surface for smooth shape
4. Adjust skin radii per-vertex for proper garment proportions
5. Apply modifiers to get final mesh
6. Add PBR material

This produces a SOLID, ASSEMBLED garment — not flat panels.

BODY REFERENCE (Size M, meters):
- Torso center: (0, 0, 1.1)
- Shoulder height: 1.45m, Waist: 1.0m, Hip: 0.9m
- Half-shoulder width: 0.215m
- Half-chest depth: 0.12m

HELPER FUNCTIONS YOU MUST DEFINE:
def hex_to_rgb(h):
    h = h.lstrip("#")
    r,g,b = int(h[0:2],16)/255, int(h[2:4],16)/255, int(h[4:6],16)/255
    return (r**2.2, g**2.2, b**2.2)

def make_material(name, color_hex, roughness=0.85):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*hex_to_rgb(color_hex), 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    return mat

EXAMPLE — T-shirt (use this EXACT pattern for upper-body garments):
import bpy, bmesh
from mathutils import Vector
import math

def hex_to_rgb(h):
    h = h.lstrip("#")
    r,g,b = int(h[0:2],16)/255, int(h[2:4],16)/255, int(h[4:6],16)/255
    return (r**2.2, g**2.2, b**2.2)

def make_material(name, color_hex, roughness=0.85):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*hex_to_rgb(color_hex), 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    return mat

# Build torso using bmesh
bm = bmesh.new()

# Cross-section rings (front-back profile at each height)
# Each ring: list of (x, y, z) positions forming the garment silhouette
rings = []
heights =   [0.75, 0.85, 0.95, 1.0,  1.05, 1.1,  1.2,  1.3,  1.4,  1.45]
widths_x =  [0.22, 0.23, 0.24, 0.24, 0.23, 0.22, 0.22, 0.23, 0.24, 0.20]
depths_y =  [0.13, 0.14, 0.14, 0.13, 0.12, 0.12, 0.12, 0.12, 0.12, 0.10]

n_sides = 12
for i, h in enumerate(heights):
    ring = []
    for j in range(n_sides):
        angle = 2 * math.pi * j / n_sides
        x = widths_x[i] * math.cos(angle)
        y = depths_y[i] * math.sin(angle)
        ring.append(bm.verts.new((x, y, h)))
    rings.append(ring)

bm.verts.ensure_lookup_table()

# Connect rings with faces
for i in range(len(rings) - 1):
    for j in range(n_sides):
        j_next = (j + 1) % n_sides
        try:
            bm.faces.new([rings[i][j], rings[i][j_next], rings[i+1][j_next], rings[i+1][j]])
        except:
            pass

# Cap the bottom (hem)
try:
    bm.faces.new(rings[0])
except:
    pass

# Create mesh object
mesh = bpy.data.meshes.new("Torso")
bm.to_mesh(mesh)
bm.free()
mesh.update()

torso = bpy.data.objects.new("Garment_Body", mesh)
bpy.context.collection.objects.link(torso)
bpy.context.view_layer.objects.active = torso
torso.select_set(True)

# Smooth + subdivide for quality
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.subdivide(number_cuts=1)
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode="OBJECT")

# Add subdivision surface modifier
mod = torso.modifiers.new("Subdiv", "SUBSURF")
mod.levels = 2
mod.render_levels = 2
bpy.ops.object.modifier_apply(modifier="Subdiv")

bpy.ops.object.shade_smooth()

# Add sleeves as separate cylinders
for side in [-1, 1]:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=12, radius=0.06, depth=0.30,
        location=(side * 0.26, 0, 1.30),
        rotation=(0, math.radians(side * 75), 0)
    )
    sleeve = bpy.context.active_object
    sleeve.name = f"Sleeve_{'R' if side > 0 else 'L'}"
    # Taper the sleeve
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bm_s = bmesh.from_edit_mesh(sleeve.data)
    # Find bottom verts (wrist end) and scale them down
    bm_s.verts.ensure_lookup_table()
    max_local_z = max(v.co.z for v in bm_s.verts)
    for v in bm_s.verts:
        if v.co.z > max_local_z - 0.01:
            v.co.x *= 0.7
            v.co.y *= 0.7
    bmesh.update_edit_mesh(sleeve.data)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.shade_smooth()

# Join everything
bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = torso
bpy.ops.object.join()
garment = bpy.context.active_object
garment.name = "T-Shirt"

# Material
mat = make_material("Cotton", "#FFFFFF", 0.85)
garment.data.materials.append(mat)

ADAPT THIS PATTERN for each garment type:
- Blazer: Add lapel vertices at neckline, longer body, structured shoulders (wider widths_x at shoulder height)
- Pants: Two leg cylinders joined at crotch, waistband ring at top
- Dress: Extended heights list going down to 0.4m (knee) or lower
- Skirt: Only lower rings from waist (1.0m) to hem
- Hoodie: T-shirt base + hood shape at neckline

ROUGHNESS VALUES: cotton=0.85, silk=0.35, wool=0.90, denim=0.90, leather=0.55, velvet=0.98, chiffon=0.40

CRITICAL: The final object must be ONE joined mesh named after the garment. Always apply smooth shading.`;

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
