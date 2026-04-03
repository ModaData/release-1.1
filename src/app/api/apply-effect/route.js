// File: app/api/apply-effect/route.js
// AI Effect Tool Executor — takes a tool instruction + GLB → applies effect in Blender → returns modified GLB
import { NextResponse } from "next/server";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const BLENDER_API_URL = () => (process.env.BLENDER_API_URL || "http://localhost:8000").trim();

// System prompt for effect-specific bpy code generation
const EFFECT_SYSTEM = `You are a Blender Python expert. Generate ONLY valid Python code — no markdown, no backticks.

The scene already contains a garment mesh loaded from GLB. Your job is to MODIFY it by applying a specific effect.

CRITICAL RULES:
1. The garment mesh is already in the scene — find it with: garment = [o for o in bpy.data.objects if o.type=="MESH"][0]
2. Do NOT delete or recreate the mesh — only MODIFY it
3. Use bmesh for precise vertex/face operations
4. After modifications, ensure the mesh data is updated: bm.to_mesh(garment.data); bm.free()
5. Keep all existing materials — add new material slots if needed for effects
6. Work in world coordinates — the hit position is in world space

HELPER:
import bpy, bmesh, math
from mathutils import Vector, kdtree

garment = [o for o in bpy.data.objects if o.type=="MESH"][0]
bpy.context.view_layer.objects.active = garment

def get_verts_in_radius(obj, center, radius):
    """Find vertex indices within radius of a world-space point."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    indices = []
    for v in bm.verts:
        world_pos = obj.matrix_world @ v.co
        if (world_pos - center).length <= radius:
            indices.append(v.index)
    bm.free()
    return indices

def hex_to_rgb(h):
    h = h.lstrip("#")
    r,g,b = int(h[0:2],16)/255, int(h[2:4],16)/255, int(h[4:6],16)/255
    return (r**2.2, g**2.2, b**2.2)

Now apply the following effect:`;

async function generateEffectCode(instruction, previousEffects = []) {
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not configured");

  const messages = [
    { role: "system", content: EFFECT_SYSTEM },
  ];

  // Include previous effects for cumulative modifications
  if (previousEffects.length > 0) {
    messages.push({
      role: "user",
      content: `Previous effects applied (already in the mesh):\n${previousEffects.map(e => `- ${e.toolName} at (${e.position.x.toFixed(2)}, ${e.position.y.toFixed(2)}, ${e.position.z.toFixed(2)})`).join("\n")}\n\nNow apply this NEW effect:`,
    });
  }

  messages.push({
    role: "user",
    content: instruction,
  });

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      messages,
      temperature: 0.2,
      max_tokens: 3000,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`OpenAI API error (${res.status}): ${err.substring(0, 200)}`);
  }

  const data = await res.json();
  let code = data.choices?.[0]?.message?.content || "";
  code = code.replace(/^```python\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();

  return code;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { glbBase64, bpyInstruction, toolId, toolName, position, previousEffects = [] } = body;

    if (!glbBase64 || !bpyInstruction) {
      return NextResponse.json({ error: "Missing glbBase64 or bpyInstruction" }, { status: 400 });
    }

    console.log(`[apply-effect] ${toolName} at (${position?.x?.toFixed(2)}, ${position?.y?.toFixed(2)}, ${position?.z?.toFixed(2)})`);

    // Step 1: GPT-4 generates effect-specific bpy code
    const effectCode = await generateEffectCode(bpyInstruction, previousEffects);

    if (!effectCode || effectCode.length < 30) {
      return NextResponse.json({ error: "GPT-4 generated insufficient code" }, { status: 500 });
    }

    console.log(`[apply-effect] Generated ${effectCode.length} chars of effect code`);

    // Step 2: Build the full execution code (load GLB → apply effect → export)
    // We pass the GLB as base64, the Blender script decodes and loads it
    const fullCode = `
import bpy
import bmesh
import math
import base64
import tempfile
import os
from mathutils import Vector

# Load the garment from base64 GLB
glb_b64 = """${glbBase64.substring(0, 50000)}"""  # Truncated for safety
glb_bytes = base64.b64decode(glb_b64)
tmp_in = tempfile.mktemp(suffix=".glb")
with open(tmp_in, "wb") as f:
    f.write(glb_bytes)

bpy.ops.import_scene.gltf(filepath=tmp_in)
os.unlink(tmp_in)

# Find the garment mesh
garment = [o for o in bpy.data.objects if o.type=="MESH"][0] if any(o.type=="MESH" for o in bpy.data.objects) else None
if not garment:
    print("[effect] ERROR: No mesh found after import")
    import sys; sys.exit(1)

bpy.context.view_layer.objects.active = garment
garment.select_set(True)
print(f"[effect] Loaded garment: {garment.name}, {len(garment.data.vertices)} verts")

# Helper functions
def get_verts_in_radius(obj, center, radius):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    indices = []
    for v in bm.verts:
        world_pos = obj.matrix_world @ v.co
        if (world_pos - center).length <= radius:
            indices.append(v.index)
    bm.free()
    return indices

def hex_to_rgb(h):
    h = h.lstrip("#")
    r,g,b = int(h[0:2],16)/255, int(h[2:4],16)/255, int(h[4:6],16)/255
    return (r**2.2, g**2.2, b**2.2)

# ═══ APPLY EFFECT ═══
${effectCode}
# ═══ END EFFECT ═══

print("[effect] Effect applied successfully")
`;

    // Step 3: Execute on Blender pod
    const url = BLENDER_API_URL();
    const execRes = await fetch(`${url}/api/blender-execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: fullCode }),
      signal: AbortSignal.timeout(60000),
    });

    if (!execRes.ok) {
      const err = await execRes.text().catch(() => "");
      console.error(`[apply-effect] Blender execution failed: ${err.substring(0, 300)}`);
      return NextResponse.json({
        error: `Effect execution failed: ${err.substring(0, 200)}`,
        code: effectCode,
      }, { status: 500 });
    }

    const contentType = execRes.headers.get("content-type") || "";
    if (contentType.includes("model/gltf-binary") || contentType.includes("application/octet-stream")) {
      const buffer = await execRes.arrayBuffer();
      const base64Result = Buffer.from(buffer).toString("base64");
      console.log(`[apply-effect] Success! Modified GLB: ${Math.round(buffer.byteLength / 1024)}KB`);

      return NextResponse.json({
        glbUrl: `data:model/gltf-binary;base64,${base64Result}`,
        code: effectCode,
        message: `${toolName} applied successfully`,
      });
    }

    return NextResponse.json({ error: "Unexpected response from Blender" }, { status: 500 });

  } catch (err) {
    console.error("[apply-effect] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
