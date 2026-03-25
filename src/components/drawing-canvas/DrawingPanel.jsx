"use client";

import { forwardRef, useRef, useImperativeHandle, useCallback } from "react";
import VectorCanvas from "./VectorCanvas";
import DrawingToolbar from "./DrawingToolbar";
import CanvasBackgroundSelector from "./CanvasBackgroundSelector";
import AnnotationLayer from "./AnnotationLayer";
import InterpretationBadge from "./InterpretationBadge";
import CommandInput from "./CommandInput";
import ImageOverlayLayer from "./ImageOverlayLayer";
import { useContinuousRender } from "@/hooks/useContinuousRender";

const DrawingPanel = forwardRef(function DrawingPanel({ onHistoryChange }, ref) {
  const canvasRef = useRef(null);
  const { triggerRender, triggerThrottled, triggerManualRender } = useContinuousRender(canvasRef);

  // Forward undo/redo/clear + triggerManualRender to parent
  useImperativeHandle(ref, () => ({
    undo: () => canvasRef.current?.undo(),
    redo: () => canvasRef.current?.redo(),
    clear: () => canvasRef.current?.clear(),
    triggerManualRender,
  }), [triggerManualRender]);

  const handleStroke = useCallback((type) => {
    if (type === "up") {
      // Immediate render on pen lift
      triggerRender();
    } else if (type === "move") {
      // Throttled render during active drawing
      triggerThrottled();
    }
  }, [triggerRender, triggerThrottled]);

  return (
    <div className="relative w-full h-full bg-white overflow-hidden">
      <CanvasBackgroundSelector />
      <VectorCanvas
        ref={canvasRef}
        onStroke={handleStroke}
        onHistoryChange={onHistoryChange}
      />
      <ImageOverlayLayer />
      <AnnotationLayer />
      <InterpretationBadge />
      <CommandInput canvasRef={canvasRef} />
      <DrawingToolbar />
    </div>
  );
});

export default DrawingPanel;
