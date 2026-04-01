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
const BLENDER_CODE_SYSTEM = `You are an expert Blender Python developer specializing in fashion/garment 3D modeling.
Output ONLY valid Python code. No markdown, no backticks, no explanations. The scene is pre-cleared.

You MUST produce a HIGH-QUALITY assembled 3D garment with:
- Realistic garment silhouette (not a generic tube)
- Proper PBR fabric material with procedural texture nodes
- Subdivision surface for smooth curves
- Solidify modifier for fabric thickness

CONSTRUCTION METHOD — Cross-section rings with bmesh:
1. Define 20+ height levels with width_x and depth_y arrays for the garment silhouette
2. Create elliptical rings at each height (16-20 vertices per ring)
3. Connect rings with quad faces
4. Add sleeves as tapered cylinders joined to armhole openings
5. Add details (collar, lapels, pockets) as additional geometry
6. Apply: Subdivision Surface (level 2) + Solidify (0.002m thickness) + Smooth shading
7. Create PBR fabric material with procedural texture nodes

BODY REFERENCE (Size M, all in METERS):
- Shoulder height: 1.45, Chest: 1.25, Waist: 1.05, Hip: 0.92, Crotch: 0.80
- Half-shoulder width: 0.22, Half-chest width: 0.24, Half-waist: 0.20, Half-hip: 0.25
- Chest depth: 0.13, Waist depth: 0.11
- Sleeve length: 0.62 (shoulder to wrist)

GARMENT-SPECIFIC SILHOUETTE RULES:
- T-SHIRT: 15 rings from hem(0.80) to shoulder(1.45). Slight waist taper. Short sleeves(0.20m long).
- SHIRT: 18 rings from hem(0.75) to collar(1.48). Button placket overlap at center-front. Long sleeves with cuffs. Add collar stand(0.03m tall) + collar(0.04m tall, angled outward).
- BLAZER: 20 rings from hem(0.70) to shoulder(1.46). WIDER at shoulders(+0.03m each side). Front panels overlap 0.03m at center. Lapels: extrude neckline verts outward and upward. Longer sleeves. Structured back.
- PANTS: Waist ring(1.05) to ankle(0.10). SPLIT into two legs below crotch(0.80). Each leg: 12 rings tapering from thigh to ankle. Add waistband ring at top.
- DRESS: Full length from hem(0.40-0.70 depending on length) to shoulder(1.45). A-line: flare widths below waist. Fitted: follow body closely. Neckline shape matters.
- SKIRT: Waist(1.05) to hem(0.50-0.70). A-line flare or pencil taper. Waistband at top.
- HOODIE: T-shirt base but RELAXED fit(+0.04m all widths). Hood: half-sphere attached at neckline. Kangaroo pocket: slight bulge at front center.

MANDATORY HELPER FUNCTIONS (define these at the top):
import bpy, bmesh, math
from mathutils import Vector

def hex_to_rgb(h):
    h = h.lstrip("#")
    r,g,b = int(h[0:2],16)/255, int(h[2:4],16)/255, int(h[4:6],16)/255
    return (r**2.2, g**2.2, b**2.2)

def make_fabric_material(name, color_hex, fabric_type="cotton"):
    """Create PBR fabric material with procedural texture nodes."""
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    # Principled BSDF
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (0, 0)
    rgb = hex_to_rgb(color_hex)
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    # Fabric-specific roughness
    rough_map = {"cotton":0.85,"silk":0.30,"wool":0.92,"denim":0.90,"leather":0.55,"velvet":0.98,"chiffon":0.35,"satin":0.25,"jersey":0.75,"linen":0.88,"tweed":0.93,"polyester":0.70}
    bsdf.inputs["Roughness"].default_value = rough_map.get(fabric_type, 0.85)
    bsdf.inputs["Metallic"].default_value = 0.0
    # Subsurface for fabric translucency (silk, chiffon)
    if fabric_type in ("silk","chiffon","satin"):
        bsdf.inputs["Subsurface Weight"].default_value = 0.05
    # Procedural bump for weave/grain texture
    tex_coord = nodes.new("ShaderNodeTexCoord")
    tex_coord.location = (-800, 0)
    noise = nodes.new("ShaderNodeTexNoise")
    noise.location = (-500, 0)
    scale_map = {"cotton":300,"silk":500,"wool":150,"denim":200,"leather":80,"velvet":400,"jersey":350,"linen":250,"tweed":100}
    noise.inputs["Scale"].default_value = scale_map.get(fabric_type, 250)
    noise.inputs["Detail"].default_value = 8
    noise.inputs["Roughness"].default_value = 0.7
    links.new(tex_coord.outputs["Object"], noise.inputs["Vector"])
    bump = nodes.new("ShaderNodeBump")
    bump.location = (-200, -200)
    strength_map = {"cotton":0.03,"silk":0.01,"wool":0.08,"denim":0.06,"leather":0.10,"velvet":0.02,"tweed":0.12}
    bump.inputs["Strength"].default_value = strength_map.get(fabric_type, 0.04)
    bump.inputs["Distance"].default_value = 0.001
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    # For leather: add voronoi grain
    if fabric_type == "leather":
        voronoi = nodes.new("ShaderNodeTexVoronoi")
        voronoi.location = (-500, -300)
        voronoi.inputs["Scale"].default_value = 60
        voronoi.distance = "MINKOWSKI"
        links.new(tex_coord.outputs["Object"], voronoi.inputs["Vector"])
        mix = nodes.new("ShaderNodeMixRGB")
        mix.location = (-300, 0)
        mix.blend_type = "OVERLAY"
        mix.inputs["Fac"].default_value = 0.15
        mix.inputs["Color1"].default_value = (*rgb, 1.0)
        links.new(voronoi.outputs["Distance"], mix.inputs["Color2"])
        links.new(mix.outputs["Color"], bsdf.inputs["Base Color"])
    # For denim: slight color variation
    if fabric_type == "denim":
        wave = nodes.new("ShaderNodeTexWave")
        wave.location = (-500, -300)
        wave.inputs["Scale"].default_value = 80
        wave.inputs["Distortion"].default_value = 2
        wave.wave_type = "RINGS"
        links.new(tex_coord.outputs["Object"], wave.inputs["Vector"])
        mix = nodes.new("ShaderNodeMixRGB")
        mix.location = (-300, 0)
        mix.blend_type = "MULTIPLY"
        mix.inputs["Fac"].default_value = 0.1
        mix.inputs["Color1"].default_value = (*rgb, 1.0)
        links.new(wave.outputs["Color"], mix.inputs["Color2"])
        links.new(mix.outputs["Color"], bsdf.inputs["Base Color"])
    # Output
    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (300, 0)
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    return mat

def build_ring_body(heights, widths_x, depths_y, n_sides=16):
    """Build garment body from cross-section rings. Returns bmesh."""
    bm = bmesh.new()
    rings = []
    for i, h in enumerate(heights):
        ring = []
        for j in range(n_sides):
            angle = 2 * math.pi * j / n_sides
            x = widths_x[i] * math.cos(angle)
            y = depths_y[i] * math.sin(angle)
            ring.append(bm.verts.new((x, y, h)))
        rings.append(ring)
    bm.verts.ensure_lookup_table()
    for i in range(len(rings)-1):
        for j in range(n_sides):
            j2 = (j+1) % n_sides
            try:
                bm.faces.new([rings[i][j], rings[i][j2], rings[i+1][j2], rings[i+1][j]])
            except: pass
    # Cap bottom
    try: bm.faces.new(rings[0])
    except: pass
    return bm, rings

def add_tapered_sleeve(side, shoulder_pos, length, radius_top, radius_bottom, angle_deg=75):
    """Add a tapered sleeve cylinder. side: -1=left, 1=right."""
    bpy.ops.mesh.primitive_cone_add(
        vertices=14, radius1=radius_top, radius2=radius_bottom,
        depth=length,
        location=(side * shoulder_pos[0], shoulder_pos[1], shoulder_pos[2]),
        rotation=(0, math.radians(side * angle_deg), 0)
    )
    sleeve = bpy.context.active_object
    sleeve.name = f"Sleeve_{'R' if side>0 else 'L'}"
    bpy.ops.object.shade_smooth()
    return sleeve

def finalize_garment(name, fabric_type, color_hex):
    """Join all objects, add modifiers, apply material."""
    bpy.ops.object.select_all(action="SELECT")
    objs = [o for o in bpy.context.selected_objects if o.type=="MESH"]
    if not objs: return None
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    garment = bpy.context.active_object
    garment.name = name
    # Subdivision surface
    mod = garment.modifiers.new("Subdiv", "SUBSURF")
    mod.levels = 2
    mod.render_levels = 2
    bpy.ops.object.modifier_apply(modifier="Subdiv")
    # Solidify for fabric thickness
    sol = garment.modifiers.new("Solidify", "SOLIDIFY")
    sol.thickness = 0.002
    sol.offset = -1
    sol.use_even_offset = True
    bpy.ops.object.modifier_apply(modifier="Solidify")
    # Smooth shading
    bpy.ops.object.shade_smooth()
    # Recalculate normals
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    # Material
    mat = make_fabric_material(f"{fabric_type}_{name}", color_hex, fabric_type)
    garment.data.materials.append(mat)
    return garment

USE THESE FUNCTIONS. Generate the body using build_ring_body with garment-appropriate height/width/depth arrays (20+ entries for quality). Add sleeves with add_tapered_sleeve. Call finalize_garment at the end.

CRITICAL RULES:
- 20+ ring levels minimum for smooth garments
- 16 vertices per ring minimum
- Always call finalize_garment() as the LAST step
- Garment name should match what user asked for
- Use the CORRECT fabric_type string for materials`;

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
