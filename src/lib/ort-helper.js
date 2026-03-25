// File: lib/ort-helper.js
// Helper to access ONNX Runtime Web (loaded from CDN via <script> tag in layout).
// Falls back to dynamic import if available.

/**
 * Get the ort module. Prefers window.ort (CDN-loaded), falls back to import.
 */
export function getOrt() {
  if (typeof window !== "undefined" && window.ort) {
    // Ensure WASM files are loaded from the same CDN
    if (!window.ort.env.wasm.wasmPaths) {
      window.ort.env.wasm.wasmPaths =
        "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.3/dist/";
    }
    return window.ort;
  }
  throw new Error(
    "ONNX Runtime Web not loaded. Make sure the CDN script is included in the page."
  );
}
