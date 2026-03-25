// File: components/garment-editor/StatusMessages.js — Enterprise toast-style status
"use client";

import { useEffect, useState } from "react";

export function StatusMessages({ error, status }) {
  const [visible, setVisible] = useState(false);
  const [currentMessage, setCurrentMessage] = useState(null);

  useEffect(() => {
    if (error || status) {
      setCurrentMessage(error || status);
      setVisible(true);
    } else {
      setVisible(false);
    }
  }, [error, status]);

  if (!visible || !currentMessage) {
    return <div className="min-h-[20px]" />;
  }

  return (
    <div className="min-h-[20px] animate-fade-in">
      {error ? (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-red-500/[0.06] border border-red-500/15 transition-all">
          <div className="flex-shrink-0 w-4 h-4 rounded-full bg-red-500/15 border border-red-500/20 flex items-center justify-center">
            <svg className="w-2.5 h-2.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <span className="text-[11px] text-red-400 font-medium">{error}</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/[0.02] border border-white/[0.04] transition-all">
          <div className="flex-shrink-0 w-4 h-4 rounded-full bg-indigo-500/15 border border-indigo-500/20 flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
          </div>
          <span className="text-[11px] text-gray-400 font-medium">{status}</span>
        </div>
      )}
    </div>
  );
}
