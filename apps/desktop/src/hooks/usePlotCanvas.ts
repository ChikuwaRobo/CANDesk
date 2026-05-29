import React from "react";
import { drawPlotCanvas } from "../lib/plotCanvas";
import type { PlotPointDto, PlotSeries } from "../types";

type UsePlotCanvasInput = {
  enabled: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  seriesRef: React.MutableRefObject<PlotSeries[]>;
  pointsRef: React.MutableRefObject<PlotPointDto[]>;
  frameMs: number;
  onDraw?: (elapsedMs: number, rawPointCount: number, drawablePointCount: number, decimationMs: number) => void;
};

export function usePlotCanvas({
  enabled,
  canvasRef,
  seriesRef,
  pointsRef,
  frameMs,
  onDraw,
}: UsePlotCanvasInput) {
  React.useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let animationFrame = 0;
    let lastDrawAt = 0;
    const draw = (timestamp: number) => {
      if (timestamp - lastDrawAt >= frameMs) {
        const canvas = canvasRef.current;
        if (canvas) {
          const startedAt = performance.now();
          const stats = drawPlotCanvas(canvas, seriesRef.current, pointsRef.current);
          onDraw?.(
            performance.now() - startedAt,
            stats.rawPoints,
            stats.drawablePoints,
            stats.decimationMs,
          );
        }
        lastDrawAt = timestamp;
      }
      animationFrame = window.requestAnimationFrame(draw);
    };
    animationFrame = window.requestAnimationFrame(draw);

    return () => window.cancelAnimationFrame(animationFrame);
  }, [canvasRef, enabled, frameMs, pointsRef, seriesRef]);
}
