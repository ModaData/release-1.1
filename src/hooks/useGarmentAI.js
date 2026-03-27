// File: hooks/useGarmentAI.js
// State management for the text-to-3D garment AI system
// Manages: conversation history, current garment spec, generation state
"use client";

import { useState, useCallback } from "react";

export function useGarmentAI() {
  const [garmentSpec, setGarmentSpec] = useState(null);
  const [garmentGlbUrl, setGarmentGlbUrl] = useState(null);
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [editMode, setEditMode] = useState("macro"); // "macro" (parametric) | "micro" (brush/sculpt)

  // Called when AI chat generates a new GLB
  const handleGlbGenerated = useCallback((glbUrl, spec) => {
    setGarmentGlbUrl(glbUrl);
    setGarmentSpec(spec);
  }, []);

  // Called when AI chat updates the spec (even without GLB)
  const handleSpecUpdate = useCallback((spec) => {
    setGarmentSpec(spec);
  }, []);

  // Toggle the AI chat panel
  const toggleAiChat = useCallback(() => {
    setAiChatOpen((prev) => !prev);
  }, []);

  // Switch between macro (parametric) and micro (brush) editing modes
  const toggleEditMode = useCallback(() => {
    setEditMode((prev) => (prev === "macro" ? "micro" : "macro"));
  }, []);

  // Reset the entire AI session
  const resetAiSession = useCallback(() => {
    setGarmentSpec(null);
    setGarmentGlbUrl(null);
    setEditMode("macro");
  }, []);

  return {
    // State
    garmentSpec,
    garmentGlbUrl,
    aiChatOpen,
    editMode,

    // Actions
    handleGlbGenerated,
    handleSpecUpdate,
    toggleAiChat,
    toggleEditMode,
    resetAiSession,
    setAiChatOpen,
    setEditMode,
    setGarmentGlbUrl,
  };
}
