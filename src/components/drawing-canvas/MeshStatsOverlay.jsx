// File: components/drawing-canvas/MeshStatsOverlay.jsx
// Triangle/vertex/object count HUD for retopology view mode
"use client";

export default function MeshStatsOverlay({ meshStats }) {
  if (!meshStats) return null;

  return (
    <div className="absolute bottom-4 left-4 z-20 px-3 py-2.5 rounded-xl bg-black/70 backdrop-blur-sm border border-white/10 text-white space-y-1">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
        Mesh Statistics
      </div>
      <div className="flex items-center gap-2 text-[11px] font-mono">
        <svg className="w-3 h-3 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l7.5-7.5 7.5 7.5m-15 6l7.5-7.5 7.5 7.5" />
        </svg>
        <span className="text-gray-300">Tris:</span>
        <span className="text-white font-semibold">{meshStats.triangles.toLocaleString()}</span>
      </div>
      <div className="flex items-center gap-2 text-[11px] font-mono">
        <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-gray-300">Verts:</span>
        <span className="text-white font-semibold">{meshStats.vertices.toLocaleString()}</span>
      </div>
      <div className="flex items-center gap-2 text-[11px] font-mono">
        <svg className="w-3 h-3 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
        </svg>
        <span className="text-gray-300">Objects:</span>
        <span className="text-white font-semibold">{meshStats.objects}</span>
      </div>
    </div>
  );
}
