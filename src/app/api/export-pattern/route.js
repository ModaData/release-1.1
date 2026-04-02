// File: app/api/export-pattern/route.js
// Export 2D patterns as DXF (CLO3D/Gerber), SVG, or JSON
// DXF/SVG require the Blender backend, JSON works locally
import { NextResponse } from "next/server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const BLENDER_API_URL = () => (process.env.BLENDER_API_URL || "http://localhost:8000").trim();

export async function POST(request) {
  try {
    const body = await request.json();
    const { spec, format = "json" } = body;

    if (!spec || !spec.panels || spec.panels.length === 0) {
      return NextResponse.json({ error: "No pattern spec provided" }, { status: 400 });
    }

    // JSON export works locally — no backend needed
    if (format === "json") {
      const jsonStr = JSON.stringify(spec, null, 2);
      return new NextResponse(jsonStr, {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="pattern_${spec.metadata?.garment_type || "garment"}_${Date.now()}.json"`,
        },
      });
    }

    // DXF and SVG require the backend
    const url = BLENDER_API_URL();
    const endpoint = format === "dxf" ? "/api/export-dxf" : "/api/export-svg";

    console.log(`[export-pattern] Exporting ${format.toUpperCase()} via ${url}${endpoint}...`);

    const res = await fetch(`${url}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spec }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error(`[export-pattern] Backend error (${res.status}): ${err.substring(0, 200)}`);
      return NextResponse.json(
        { error: `Export failed: ${err.substring(0, 200)}` },
        { status: res.status }
      );
    }

    const contentType = res.headers.get("content-type") || "application/octet-stream";
    const buffer = await res.arrayBuffer();
    const ext = format === "dxf" ? "dxf" : "svg";
    const filename = `pattern_${spec.metadata?.garment_type || "garment"}_${Date.now()}.${ext}`;

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("[export-pattern] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
