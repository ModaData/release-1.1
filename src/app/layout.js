import Script from "next/script";
import "./globals.css";

export const metadata = {
  title: "MODA DATA — AI Fashion Design Platform",
  description: "Enterprise-grade AI garment editor: Brand Brief → AI Segmentation → Smart Suggestions → FLUX Inpainting",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body className="bg-[#08080d] text-gray-100 antialiased min-h-screen font-sans">
        {/* Load ONNX Runtime Web from CDN — exposes window.ort */}
        <Script
          src="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.3/dist/ort.min.js"
          strategy="beforeInteractive"
        />
        {children}
      </body>
    </html>
  );
}
