import Link from "next/link";

const FEATURES = [
  {
    title: "AI Segmentation",
    desc: "SegFormer B2 + SAM 2 automatically detect and segment garment parts with pixel precision.",
    icon: "scan",
    color: "emerald",
  },
  {
    title: "Smart Suggestions",
    desc: "GPT-4o powered contextual design suggestions based on brand brief and garment analysis.",
    icon: "sparkles",
    color: "purple",
  },
  {
    title: "FLUX Inpainting",
    desc: "Production-grade FLUX.1 Fill Dev inpainting for photorealistic garment modifications.",
    icon: "wand",
    color: "blue",
  },
  {
    title: "Brand Intelligence",
    desc: "Fabric, color palette, and season context drive every AI suggestion and generation.",
    icon: "palette",
    color: "amber",
  },
];

const MODELS = [
  { name: "SegFormer B2", role: "Garment Parsing", color: "emerald" },
  { name: "SAM 2", role: "Segment Anything", color: "blue" },
  { name: "FLUX.1 Fill Dev", role: "Inpainting", color: "purple" },
  { name: "GPT-4o Mini", role: "Suggestions + Detection", color: "amber" },
  { name: "CLIP", role: "Image Analysis", color: "pink" },
];

function FeatureIcon({ type, className }) {
  const icons = {
    scan: (
      <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75H6A2.25 2.25 0 003.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0120.25 6v1.5m0 9V18A2.25 2.25 0 0118 20.25h-1.5m-9 0H6A2.25 2.25 0 013.75 18v-1.5M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
    sparkles: (
      <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
      </svg>
    ),
    wand: (
      <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59" />
      </svg>
    ),
    palette: (
      <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.098 19.902a3.75 3.75 0 005.304 0l6.401-6.402M6.75 21A3.75 3.75 0 013 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 003.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008z" />
      </svg>
    ),
  };
  return icons[type] || null;
}

const COLOR_MAP = {
  emerald: { bg: "bg-emerald-500/10", border: "border-emerald-500/20", text: "text-emerald-400", dot: "bg-emerald-500" },
  purple: { bg: "bg-purple-500/10", border: "border-purple-500/20", text: "text-purple-400", dot: "bg-purple-500" },
  blue: { bg: "bg-blue-500/10", border: "border-blue-500/20", text: "text-blue-400", dot: "bg-blue-500" },
  amber: { bg: "bg-amber-500/10", border: "border-amber-500/20", text: "text-amber-400", dot: "bg-amber-500" },
  pink: { bg: "bg-pink-500/10", border: "border-pink-500/20", text: "text-pink-400", dot: "bg-pink-500" },
  cyan: { bg: "bg-cyan-500/10", border: "border-cyan-500/20", text: "text-cyan-400", dot: "bg-cyan-500" },
};

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#08080d] relative overflow-hidden">
      {/* ── Background Effects ── */}
      <div className="absolute inset-0 opacity-[0.02]" style={{
        backgroundImage: "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
        backgroundSize: "64px 64px"
      }} />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-gradient-to-b from-indigo-500/[0.07] via-purple-500/[0.03] to-transparent rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-gradient-to-tl from-blue-500/[0.04] to-transparent rounded-full blur-3xl pointer-events-none" />

      {/* ── Nav Bar ── */}
      <nav className="relative z-10 flex items-center justify-between px-6 lg:px-12 h-16 border-b border-white/[0.04]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          </div>
          <span className="text-sm font-bold text-white tracking-[0.2em] uppercase">MODA DATA</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-medium text-emerald-400 bg-emerald-500/8 border border-emerald-500/15">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            All Systems Online
          </span>
          <Link
            href="/canvas"
            className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-500/25 hover:from-purple-500/25 hover:to-pink-500/25 transition-all"
          >
            AI Canvas
          </Link>
          <Link
            href="/garment-editor"
            className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-white/[0.06] border border-white/[0.08] hover:bg-white/[0.1] hover:border-white/[0.12] transition-all"
          >
            AI Editor
          </Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative z-10 flex flex-col items-center text-center px-6 pt-20 pb-16 lg:pt-28 lg:pb-20">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.06] mb-8 animate-in fade-in">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
          <span className="text-[11px] font-medium text-gray-400">Enterprise AI Fashion Design Platform</span>
        </div>

        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-white tracking-tight leading-[1.1] max-w-4xl animate-in fade-in" style={{ animationDelay: "0.1s" }}>
          Design garments with
          <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent"> AI precision</span>
        </h1>

        <p className="text-base sm:text-lg text-gray-500 max-w-xl mx-auto mt-6 leading-relaxed animate-in fade-in" style={{ animationDelay: "0.2s" }}>
          Upload a garment. Hover to detect parts. Draw your vision. 
          AI generates photorealistic modifications in seconds.
        </p>

        {/* CTA — Dual entry points */}
        <div className="flex flex-col items-center gap-4 mt-10 animate-in fade-in" style={{ animationDelay: "0.3s" }}>
          <div className="flex items-center gap-3 flex-wrap justify-center">
            <Link
              href="/canvas"
              className="group inline-flex items-center gap-2.5 px-8 py-3.5 rounded-2xl font-semibold text-sm text-white transition-all duration-300
                         bg-gradient-to-r from-purple-500 to-pink-600
                         hover:from-purple-400 hover:to-pink-500
                         shadow-lg shadow-purple-500/25 hover:shadow-2xl hover:shadow-purple-500/30
                         hover:-translate-y-0.5 active:translate-y-0"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
              </svg>
              Sketch with AI Canvas
            </Link>
            <Link
              href="/garment-editor"
              className="group inline-flex items-center gap-2.5 px-8 py-3.5 rounded-2xl font-semibold text-sm text-white transition-all duration-300
                         bg-white/[0.06] border border-white/[0.08]
                         hover:bg-white/[0.1] hover:border-white/[0.12]
                         hover:-translate-y-0.5 active:translate-y-0"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              Edit Uploaded Image
            </Link>
          </div>
          <span className="text-xs text-gray-600">No sign-up required</span>
        </div>

        {/* Model Pills */}
        <div className="flex items-center justify-center gap-2 flex-wrap mt-12 animate-in fade-in" style={{ animationDelay: "0.4s" }}>
          {MODELS.map((m) => {
            const c = COLOR_MAP[m.color];
            return (
              <div key={m.name} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full ${c.bg} border ${c.border}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                <span className={`text-[10px] font-semibold ${c.text}`}>{m.name}</span>
                <span className="text-[9px] text-gray-600">· {m.role}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Features Grid ── */}
      <section className="relative z-10 px-6 lg:px-12 pb-20">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold text-white mb-3">Production-grade AI, zero complexity</h2>
            <p className="text-sm text-gray-500 max-w-lg mx-auto">
              Six AI models working in concert behind a minimal interface. 
              Open it, do your work, keep moving.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {FEATURES.map((f, i) => {
              const c = COLOR_MAP[f.color];
              return (
                <div
                  key={f.title}
                  className="group p-5 rounded-2xl bg-white/[0.02] border border-white/[0.05] hover:border-white/[0.1] hover:bg-white/[0.04] transition-all duration-300 animate-in fade-in"
                  style={{ animationDelay: `${0.1 * i + 0.5}s` }}
                >
                  <div className={`w-10 h-10 rounded-xl ${c.bg} border ${c.border} flex items-center justify-center mb-4 group-hover:scale-105 transition-transform duration-300`}>
                    <FeatureIcon type={f.icon} className={`w-5 h-5 ${c.text}`} />
                  </div>
                  <h3 className="text-sm font-semibold text-white mb-1.5">{f.title}</h3>
                  <p className="text-xs text-gray-500 leading-relaxed">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Workflow Steps ── */}
      <section className="relative z-10 px-6 lg:px-12 pb-24">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold text-white mb-3">Three steps to a new design</h2>
            <p className="text-sm text-gray-500">From upload to AI-generated result in under a minute.</p>
          </div>

          <div className="space-y-4">
            {[
              { num: "01", title: "Upload", desc: "Drop any garment image. AI instantly analyzes fabric, structure, and components.", time: "~2s" },
              { num: "02", title: "Select & Draw", desc: "Hover to detect parts. Click to select. Sketch your modifications with 10 pro drawing tools.", time: "Interactive" },
              { num: "03", title: "Generate", desc: "AI inpaints your changes with FLUX.1 Fill Dev. Photorealistic, brand-aware results.", time: "~30s" },
            ].map((s) => (
              <div
                key={s.num}
                className="flex items-start gap-5 p-5 rounded-2xl bg-white/[0.02] border border-white/[0.05] hover:border-white/[0.08] transition-all group"
              >
                <span className="flex-shrink-0 text-2xl font-bold text-gray-800 group-hover:text-indigo-500/50 transition-colors font-mono">{s.num}</span>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-white mb-1">{s.title}</h3>
                  <p className="text-xs text-gray-500 leading-relaxed">{s.desc}</p>
                </div>
                <span className="flex-shrink-0 text-[10px] font-mono text-gray-600 px-2 py-0.5 rounded bg-white/[0.03] border border-white/[0.05]">{s.time}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="relative z-10 border-t border-white/[0.04] px-6 py-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <span className="text-[10px] font-semibold text-gray-600 tracking-widest uppercase">MODA DATA</span>
          </div>
          <span className="text-[10px] text-gray-700">Enterprise AI Fashion Design Platform · v2.0</span>
        </div>
      </footer>
    </div>
  );
}
