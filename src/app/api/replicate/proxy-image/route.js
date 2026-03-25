// File: app/api/replicate/proxy-image/route.js
// Proxies a remote image URL to a base64 data URL to avoid CORS issues.
// Used for FLUX Fill Dev results from replicate.delivery CDN.
import { NextResponse } from "next/server";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const { url } = await request.json();

    if (!url || !url.startsWith("http")) {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    console.log("[proxy-image] Fetching:", url.substring(0, 80) + "...");

    const res = await fetch(url);
    if (!res.ok) {
      console.error("[proxy-image] Fetch failed:", res.status);
      return NextResponse.json(
        { error: `Failed to fetch image: ${res.status}` },
        { status: 502 }
      );
    }

    const contentType = res.headers.get("content-type") || "image/png";
    const buffer = Buffer.from(await res.arrayBuffer());
    const base64 = buffer.toString("base64");
    const dataUrl = `data:${contentType};base64,${base64}`;

    console.log("[proxy-image] Proxied:", (buffer.length / 1024).toFixed(0), "KB as", contentType);

    return NextResponse.json({ dataUrl });
  } catch (err) {
    console.error("[proxy-image] Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
