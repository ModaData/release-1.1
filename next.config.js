/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      crypto: false,
    };

    // Completely exclude onnxruntime-web from all bundles.
    // We load it from CDN via <script> tag and use window.ort at runtime.
    config.externals = config.externals || [];
    if (isServer) {
      config.externals.push("onnxruntime-web");
    } else {
      // For client bundles, replace any `import("onnxruntime-web")` with
      // a reference to the global `ort` loaded from CDN.
      config.externals.push({
        "onnxruntime-web": "ort",
      });
    }

    return config;
  },
  experimental: {
    serverComponentsExternalPackages: ["onnxruntime-web"],
  },
};

module.exports = nextConfig;
