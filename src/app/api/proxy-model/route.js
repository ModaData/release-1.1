// File: app/api/proxy-model/route.js — Proxies remote 3D model files to avoid CORS issues
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/proxy-model?url=<remote-url>
 *
 * Fetches a remote GLB/model file and streams it back to the client
 * with proper CORS headers. This avoids browser CORS blocks when
 * Three.js tries to load GLB files from external CDNs (e.g. Tencent COS).
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const remoteUrl = searchParams.get("url");

    if (!remoteUrl) {
      return NextResponse.json(
        { error: "Missing 'url' query parameter" },
        { status: 400 }
      );
    }

    // Validate URL is from expected domains
    const allowedDomains = [
      "tencentcos.cn",
      "myqcloud.com",
      "tencentcloudapi.com",
      "cos.ap-singapore",
      "cos.ap-guangzhou",
    ];

    const urlObj = new URL(remoteUrl);
    const isAllowed = allowedDomains.some((domain) =>
      urlObj.hostname.includes(domain)
    );

    if (!isAllowed) {
      return NextResponse.json(
        { error: "URL domain not allowed for proxying" },
        { status: 403 }
      );
    }

    console.log("[proxy-model] Fetching:", remoteUrl.substring(0, 120));

    const res = await fetch(remoteUrl);

    if (!res.ok) {
      console.error("[proxy-model] Remote fetch failed:", res.status);
      return NextResponse.json(
        { error: `Remote server returned ${res.status}` },
        { status: 502 }
      );
    }

    const contentType = res.headers.get("content-type") || "application/octet-stream";
    const buffer = await res.arrayBuffer();

    console.log(`[proxy-model] Proxied ${(buffer.byteLength / 1024 / 1024).toFixed(2)}MB`);

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType.includes("gltf") ? contentType : "model/gltf-binary",
        "Content-Length": buffer.byteLength.toString(),
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    console.error("[proxy-model] Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
