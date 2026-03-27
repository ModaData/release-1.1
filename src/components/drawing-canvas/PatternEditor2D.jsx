// File: components/drawing-canvas/PatternEditor2D.jsx
// 2D Fabric.js pattern editor — users drag panel control points,
// edit seam lines, and modify flat sewing patterns visually.
// Changes trigger Blender re-simulation for updated 3D draping.
"use client";

import { useRef, useEffect, useState, useCallback } from "react";

// Color palette for different panels
const PANEL_COLORS = [
  { fill: "rgba(99, 102, 241, 0.15)", stroke: "#6366f1", dot: "#4f46e5" },   // indigo
  { fill: "rgba(236, 72, 153, 0.15)", stroke: "#ec4899", dot: "#db2777" },    // pink
  { fill: "rgba(34, 197, 94, 0.15)", stroke: "#22c55e", dot: "#16a34a" },     // green
  { fill: "rgba(245, 158, 11, 0.15)", stroke: "#f59e0b", dot: "#d97706" },    // amber
  { fill: "rgba(59, 130, 246, 0.15)", stroke: "#3b82f6", dot: "#2563eb" },    // blue
  { fill: "rgba(168, 85, 247, 0.15)", stroke: "#a855f7", dot: "#9333ea" },    // purple
  { fill: "rgba(20, 184, 166, 0.15)", stroke: "#14b8a6", dot: "#0d9488" },    // teal
  { fill: "rgba(239, 68, 68, 0.15)", stroke: "#ef4444", dot: "#dc2626" },     // red
];

// Scale: 1cm = 4px on canvas
const CM_TO_PX = 4;
const CANVAS_PADDING = 60;
const DOT_RADIUS = 5;

export default function PatternEditor2D({
  patternSpec = null,
  onPatternChange = null,
  onResimulate = null,
  className = "",
}) {
  const canvasRef = useRef(null);
  const fabricRef = useRef(null);
  const [selectedPanel, setSelectedPanel] = useState(null);
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [panelInfo, setPanelInfo] = useState([]);
  const [isDirty, setIsDirty] = useState(false);

  // ── Initialize Fabric.js canvas ──
  useEffect(() => {
    if (!canvasRef.current) return;

    // Dynamic import for Fabric.js (SSR-safe)
    import("fabric").then(({ Canvas }) => {
      if (fabricRef.current) {
        fabricRef.current.dispose();
      }

      const canvas = new Canvas(canvasRef.current, {
        backgroundColor: "#fafafa",
        selection: false,
        preserveObjectStacking: true,
      });

      fabricRef.current = canvas;

      // Handle window resize
      const resizeHandler = () => {
        const container = canvasRef.current?.parentElement;
        if (container && canvas) {
          canvas.setDimensions({
            width: container.clientWidth,
            height: container.clientHeight,
          });
          if (patternSpec) drawPattern(patternSpec);
        }
      };

      window.addEventListener("resize", resizeHandler);
      resizeHandler();

      return () => {
        window.removeEventListener("resize", resizeHandler);
      };
    });

    return () => {
      if (fabricRef.current) {
        fabricRef.current.dispose();
        fabricRef.current = null;
      }
    };
  }, []);

  // ── Draw pattern when spec changes ──
  const drawPattern = useCallback((spec) => {
    const canvas = fabricRef.current;
    if (!canvas || !spec?.panels) return;

    // Dynamic import
    import("fabric").then(({ Polygon, Circle, Line, Text, Group }) => {
      canvas.clear();
      canvas.backgroundColor = "#fafafa";

      const panels = spec.panels;
      const canvasWidth = canvas.width;
      const canvasHeight = canvas.height;

      // Calculate layout: arrange panels in a grid
      const cols = Math.ceil(Math.sqrt(panels.length));
      const rows = Math.ceil(panels.length / cols);

      // Find max panel dimensions for spacing
      let maxPanelW = 0, maxPanelH = 0;
      for (const panel of panels) {
        const xs = panel.points.map(p => p[0]);
        const ys = panel.points.map(p => p[1]);
        const w = (Math.max(...xs) - Math.min(...xs)) * CM_TO_PX * zoom;
        const h = (Math.max(...ys) - Math.min(...ys)) * CM_TO_PX * zoom;
        maxPanelW = Math.max(maxPanelW, w);
        maxPanelH = Math.max(maxPanelH, h);
      }

      const cellW = maxPanelW + CANVAS_PADDING * 2;
      const cellH = maxPanelH + CANVAS_PADDING * 2;

      // Calculate origin offsets to center the grid
      const gridW = cols * cellW;
      const gridH = rows * cellH;
      const offsetX = (canvasWidth - gridW) / 2 + cellW / 2;
      const offsetY = (canvasHeight - gridH) / 2 + cellH / 2;

      const infos = [];

      panels.forEach((panel, panelIdx) => {
        const col = panelIdx % cols;
        const row = Math.floor(panelIdx / cols);
        const centerX = offsetX + col * cellW;
        const centerY = offsetY + row * cellH;
        const colors = PANEL_COLORS[panelIdx % PANEL_COLORS.length];

        // Convert panel points to canvas coordinates
        const canvasPoints = panel.points.map(pt => ({
          x: centerX + pt[0] * CM_TO_PX * zoom,
          y: centerY - pt[1] * CM_TO_PX * zoom, // Flip Y (canvas Y is down)
        }));

        // Draw panel polygon
        const polygon = new Polygon(canvasPoints, {
          fill: colors.fill,
          stroke: colors.stroke,
          strokeWidth: 1.5,
          selectable: false,
          evented: false,
          objectCaching: false,
        });
        canvas.add(polygon);

        // Draw seam edges (dashed lines)
        if (panel.seam_edges) {
          for (const [i, j] of panel.seam_edges) {
            if (i < canvasPoints.length && j < canvasPoints.length) {
              const line = new Line(
                [canvasPoints[i].x, canvasPoints[i].y, canvasPoints[j].x, canvasPoints[j].y],
                {
                  stroke: colors.stroke,
                  strokeWidth: 2,
                  strokeDashArray: [6, 3],
                  selectable: false,
                  evented: false,
                }
              );
              canvas.add(line);
            }
          }
        }

        // Draw grain line arrow
        if (panel.grain_line) {
          const grainLen = 30 * zoom;
          const gx = panel.grain_line[0];
          const gy = panel.grain_line[1];
          const grainLine = new Line(
            [centerX, centerY + grainLen/2, centerX + gx * grainLen, centerY - gy * grainLen + grainLen/2],
            {
              stroke: "#999",
              strokeWidth: 1,
              strokeDashArray: [4, 2],
              selectable: false,
              evented: false,
            }
          );
          canvas.add(grainLine);
        }

        // Draw draggable control points
        canvasPoints.forEach((pt, ptIdx) => {
          const dot = new Circle({
            left: pt.x - DOT_RADIUS,
            top: pt.y - DOT_RADIUS,
            radius: DOT_RADIUS,
            fill: colors.dot,
            stroke: "#fff",
            strokeWidth: 1.5,
            selectable: true,
            hasControls: false,
            hasBorders: false,
            originX: "center",
            originY: "center",
            left: pt.x,
            top: pt.y,
            // Custom data for identification
            _panelIdx: panelIdx,
            _pointIdx: ptIdx,
            _panelName: panel.name,
          });

          // Handle drag — update the pattern spec
          dot.on("moving", function () {
            const newX = (this.left - centerX) / (CM_TO_PX * zoom);
            const newY = -(this.top - centerY) / (CM_TO_PX * zoom); // Flip Y back

            // Update the point in the spec
            if (spec.panels[panelIdx] && spec.panels[panelIdx].points[ptIdx]) {
              spec.panels[panelIdx].points[ptIdx] = [
                Math.round(newX * 10) / 10,
                Math.round(newY * 10) / 10,
              ];
              setIsDirty(true);
              setSelectedPoint({ panel: panelIdx, point: ptIdx });

              // Redraw the polygon in place (without full re-render)
              const updatedPoints = spec.panels[panelIdx].points.map(p => ({
                x: centerX + p[0] * CM_TO_PX * zoom,
                y: centerY - p[1] * CM_TO_PX * zoom,
              }));
              polygon.set({ points: updatedPoints });
              canvas.renderAll();
            }
          });

          dot.on("modified", function () {
            onPatternChange?.(spec);
          });

          dot.on("mousedown", function () {
            setSelectedPanel(panelIdx);
            setSelectedPoint({ panel: panelIdx, point: ptIdx });
          });

          canvas.add(dot);
        });

        // Panel label
        const xs = panel.points.map(p => p[0]);
        const ys = panel.points.map(p => p[1]);
        const panelW = Math.round(Math.max(...xs) - Math.min(...xs));
        const panelH = Math.round(Math.max(...ys) - Math.min(...ys));

        const label = new Text(`${panel.name}\n${panelW} x ${panelH} cm`, {
          left: centerX,
          top: centerY + maxPanelH / 2 + 12,
          fontSize: 10,
          fill: "#888",
          fontFamily: "Arial",
          textAlign: "center",
          originX: "center",
          selectable: false,
          evented: false,
        });
        canvas.add(label);

        infos.push({
          name: panel.name,
          width: panelW,
          height: panelH,
          pointCount: panel.points.length,
          color: colors.stroke,
        });
      });

      setPanelInfo(infos);
      canvas.renderAll();
    });
  }, [zoom, onPatternChange]);

  // Redraw when spec changes
  useEffect(() => {
    if (patternSpec && fabricRef.current) {
      drawPattern(patternSpec);
      setIsDirty(false);
    }
  }, [patternSpec, drawPattern]);

  // ── Zoom controls ──
  const handleZoomIn = () => setZoom(z => Math.min(z * 1.2, 4));
  const handleZoomOut = () => setZoom(z => Math.max(z / 1.2, 0.3));
  const handleZoomFit = () => setZoom(1);

  // ── Re-simulate (send updated pattern to Blender) ──
  const handleResimulate = useCallback(() => {
    if (!patternSpec || !isDirty) return;
    setIsDirty(false);
    onResimulate?.(patternSpec);
  }, [patternSpec, isDirty, onResimulate]);

  return (
    <div className={`flex flex-col h-full bg-white ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-white">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-gray-700">2D Patterns</span>
          {patternSpec?.metadata && (
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100">
              {patternSpec.metadata.garment_type} | {patternSpec.panels?.length || 0} panels
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Zoom controls */}
          <button onClick={handleZoomOut} className="w-6 h-6 rounded text-gray-400 hover:bg-gray-100 flex items-center justify-center text-[12px]" title="Zoom out">-</button>
          <span className="text-[9px] text-gray-400 w-8 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={handleZoomIn} className="w-6 h-6 rounded text-gray-400 hover:bg-gray-100 flex items-center justify-center text-[12px]" title="Zoom in">+</button>
          <button onClick={handleZoomFit} className="text-[9px] px-1.5 py-0.5 rounded text-gray-400 hover:bg-gray-100" title="Fit">Fit</button>

          {/* Re-simulate button */}
          {isDirty && (
            <button
              onClick={handleResimulate}
              className="ml-2 text-[9px] px-2.5 py-1 rounded-lg bg-violet-600 text-white font-medium hover:bg-violet-700 transition-colors animate-pulse"
            >
              Re-simulate 3D
            </button>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative overflow-hidden">
        <canvas ref={canvasRef} />

        {/* Panel legend */}
        {panelInfo.length > 0 && (
          <div className="absolute bottom-3 left-3 bg-white/90 backdrop-blur-sm rounded-lg p-2 shadow-sm border border-gray-100">
            <div className="text-[9px] text-gray-400 mb-1 font-semibold">Panels</div>
            {panelInfo.map((info, i) => (
              <div
                key={info.name}
                className={`flex items-center gap-1.5 text-[9px] py-0.5 cursor-pointer rounded px-1 ${
                  selectedPanel === i ? "bg-indigo-50" : "hover:bg-gray-50"
                }`}
                onClick={() => setSelectedPanel(i)}
              >
                <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: info.color }} />
                <span className="text-gray-600">{info.name}</span>
                <span className="text-gray-400">{info.width}x{info.height}cm</span>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!patternSpec && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center max-w-[200px]">
              <div className="w-12 h-12 rounded-2xl bg-violet-50 border border-violet-100 flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
                </svg>
              </div>
              <p className="text-[11px] text-gray-500">
                Use the AI Chat to generate patterns, then edit them here
              </p>
            </div>
          </div>
        )}

        {/* Selected point info */}
        {selectedPoint && patternSpec?.panels?.[selectedPoint.panel] && (
          <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm rounded-lg p-2 shadow-sm border border-gray-100">
            <div className="text-[9px] text-gray-400 mb-1">
              {patternSpec.panels[selectedPoint.panel].name} / Point {selectedPoint.point}
            </div>
            <div className="text-[10px] font-mono text-gray-600">
              x: {patternSpec.panels[selectedPoint.panel].points[selectedPoint.point]?.[0]?.toFixed(1)}cm
              {" "}
              y: {patternSpec.panels[selectedPoint.panel].points[selectedPoint.point]?.[1]?.toFixed(1)}cm
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
