// File: components/drawing-canvas/GarmentAIChat.jsx
// Conversational text-to-3D garment generation panel
// Users type prompts → GPT-4 parses → Blender generates → 3D viewer displays
"use client";

import { useState, useRef, useEffect, useCallback } from "react";

// ── Stage badges ──
const STAGES = {
  idle: { label: "Ready", color: "bg-gray-100 text-gray-500" },
  understanding: { label: "Understanding", color: "bg-blue-100 text-blue-600" },
  generating: { label: "Generating 3D", color: "bg-violet-100 text-violet-600" },
  refining: { label: "Refining", color: "bg-amber-100 text-amber-600" },
  done: { label: "Done", color: "bg-green-100 text-green-600" },
  error: { label: "Error", color: "bg-red-100 text-red-500" },
};

// ── Garment type icons (simple emoji fallbacks) ──
const TYPE_ICONS = {
  blazer: "\uD83E\uDDE5", jacket: "\uD83E\uDDE5", coat: "\uD83E\uDDE5",
  shirt: "\uD83D\uDC54", blouse: "\uD83D\uDC5A", tshirt: "\uD83D\uDC55",
  dress: "\uD83D\uDC57", pants: "\uD83D\uDC56", shorts: "\uD83E\uDE73",
  skirt: "\uD83E\uDE74", hoodie: "\uD83E\uDDE5", sweater: "\uD83E\uDDE3",
  vest: "\uD83E\uDDE5", jumpsuit: "\uD83E\uDE72",
};

export default function GarmentAIChat({ onGlbGenerated, onSpecUpdate, isCollapsed = false }) {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Describe any garment and I'll create a 3D model. Try: \"Navy wool double-breasted blazer with peak lapels\"",
    },
  ]);
  const [input, setInput] = useState("");
  const [stage, setStage] = useState("idle");
  const [currentSpec, setCurrentSpec] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const addMessage = useCallback((role, content, extra = {}) => {
    setMessages((prev) => [...prev, { role, content, ...extra }]);
  }, []);

  const handleSubmit = useCallback(async (e) => {
    e?.preventDefault();
    const prompt = input.trim();
    if (!prompt || isLoading) return;

    setInput("");
    addMessage("user", prompt);
    setIsLoading(true);

    try {
      // Stage 1: Understanding
      setStage("understanding");
      addMessage("assistant", "Analyzing your description...", { isStatus: true });

      const res = await fetch("/api/garment-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          currentParams: currentSpec?.params || null,
          currentSpec: currentSpec,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(errData.error || `API error (${res.status})`);
      }

      const data = await res.json();
      const { spec, params, glbUrl, message, stitches } = data;

      // Store both spec and params for future edits
      setCurrentSpec({ ...spec, params });
      onSpecUpdate?.(spec);

      // Stage 2: Show parsed spec
      setStage("generating");

      // Remove the "Analyzing..." status message
      setMessages((prev) => prev.filter((m) => !m.isStatus));

      // Add spec summary message
      const meta = spec.metadata || {};
      const panels = data.panels || spec.panels || [];
      const stitchCount = (stitches || spec.stitches || []).length;
      const icon = TYPE_ICONS[meta.garment_type] || "\uD83E\uDDE5";
      const specSummary = [
        `${icon} **${meta.name || meta.garment_type || "Garment"}**`,
        `Fabric: ${meta.fabric_type || "cotton"} | Color: ${meta.color || "#333"}`,
        meta.fit ? `Fit: ${meta.fit} | Size: ${meta.size || "M"}` : null,
        panels.length > 0
          ? `Panels: ${panels.map(p => `${p.name} (${p.width || p.width_cm || "?"}x${p.height || p.height_cm || "?"}cm)`).join(", ")}`
          : null,
        stitchCount > 0 ? `Seams: ${stitchCount} construction stitches` : null,
      ].filter(Boolean).join("\n");

      addMessage("assistant", specSummary, { spec: meta });

      // Stage 3: Blender-MCP — generate 3D via bpy code
      if (glbUrl) {
        // Sewing pipeline returned a GLB directly
        setStage("done");
        onGlbGenerated?.(glbUrl, spec);
        addMessage("assistant", `3D model generated! Describe changes like "make sleeves shorter" or "change to red silk".`);
      } else {
        // Try Blender-MCP: GPT-4 → bpy code → Blender → GLB
        addMessage("assistant", "Generating 3D model in Blender...", { isStatus: true });
        try {
          const mcpRes = await fetch("/api/blender-mcp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt,
              previousCode: currentSpec?.blenderCode || null,
            }),
          });

          const mcpData = await mcpRes.json();
          setMessages((prev) => prev.filter((m) => !m.isStatus));

          if (mcpData.glbUrl) {
            setStage("done");
            setCurrentSpec((prev) => ({ ...prev, blenderCode: mcpData.code }));
            onGlbGenerated?.(mcpData.glbUrl, spec);
            addMessage("assistant", `3D garment created in Blender! You can describe changes to refine it.`);
          } else {
            setStage("done");
            const errorHint = mcpData.error?.includes("404") || mcpData.error?.includes("fetch")
              ? "Start the RunPod pod to enable 3D generation."
              : mcpData.error || "Blender execution failed.";
            addMessage("assistant", `2D patterns ready (${panels.length} panels). ${errorHint}`);
          }
        } catch (mcpErr) {
          setMessages((prev) => prev.filter((m) => !m.isStatus));
          setStage("done");
          addMessage("assistant", `2D patterns created (${panels.length} panels). Start the RunPod pod for 3D generation.`);
        }
      }
    } catch (err) {
      setStage("error");
      setMessages((prev) => prev.filter((m) => !m.isStatus));
      addMessage("assistant", `Error: ${err.message}`, { isError: true });
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, currentSpec, addMessage, onGlbGenerated, onSpecUpdate]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleQuickAction = (prompt) => {
    setInput(prompt);
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  };

  if (isCollapsed) return null;

  const stageInfo = STAGES[stage] || STAGES.idle;

  return (
    <div className="flex flex-col h-full bg-white border-l border-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          </div>
          <span className="text-[12px] font-semibold text-gray-800">AI Garment Studio</span>
        </div>
        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${stageInfo.color}`}>
          {stageInfo.label}
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2 text-[11px] leading-relaxed ${
                msg.role === "user"
                  ? "bg-indigo-600 text-white"
                  : msg.isError
                  ? "bg-red-50 text-red-600 border border-red-100"
                  : msg.isStatus
                  ? "bg-gray-50 text-gray-400 italic"
                  : "bg-gray-50 text-gray-700"
              }`}
            >
              {msg.content.split("\n").map((line, j) => (
                <div key={j}>
                  {line.startsWith("**") && line.endsWith("**")
                    ? <span className="font-bold">{line.replace(/\*\*/g, "")}</span>
                    : line.includes("**")
                    ? line.split("**").map((part, k) =>
                        k % 2 === 1
                          ? <span key={k} className="font-bold">{part}</span>
                          : <span key={k}>{part}</span>
                      )
                    : line
                  }
                </div>
              ))}

              {/* Spec color swatch */}
              {msg.spec && (
                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-200">
                  <div
                    className="w-5 h-5 rounded-md border border-gray-200"
                    style={{ backgroundColor: msg.spec.color_hex }}
                  />
                  <span className="text-[9px] text-gray-400">
                    {msg.spec.color_hex} | {msg.spec.size_label || "M"}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick actions (shown when no spec yet) */}
      {!currentSpec && messages.length <= 2 && (
        <div className="px-3 pb-2 flex flex-wrap gap-1.5">
          {[
            "Classic navy blazer",
            "Silk evening dress",
            "Oversized denim jacket",
            "Slim-fit white shirt",
          ].map((q) => (
            <button
              key={q}
              onClick={() => handleQuickAction(q)}
              className="text-[9px] px-2 py-1 rounded-full bg-violet-50 text-violet-600 hover:bg-violet-100 transition-colors border border-violet-100"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Refinement suggestions (shown after generation) */}
      {currentSpec && stage === "done" && (
        <div className="px-3 pb-2 flex flex-wrap gap-1.5">
          {[
            "Make sleeves shorter",
            "Change to red silk",
            "Add patch pockets",
            "Make it oversized",
          ].map((q) => (
            <button
              key={q}
              onClick={() => handleQuickAction(q)}
              className="text-[9px] px-2 py-1 rounded-full bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors border border-amber-100"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="px-3 pb-3">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={currentSpec ? "Describe a change..." : "Describe a garment..."}
            rows={1}
            className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-[11px] text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-300"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            {isLoading ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
