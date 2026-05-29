import React from "react";
import { drawPlotCanvasFromBuffers } from "../lib/plotCanvas";
import type { PlotSeriesBufferMap } from "../lib/plotSeriesBuffer";
import type { PlotSeries } from "../types";

type UsePlotCanvasInput = {
  enabled: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  seriesRef: React.MutableRefObject<PlotSeries[]>;
  buffersRef: React.MutableRefObject<PlotSeriesBufferMap>;
  visibleSeriesIdsRef: React.MutableRefObject<string[]>;
  frameMs: number;
  onDraw?: (elapsedMs: number, rawPointCount: number, drawablePointCount: number, decimationMs: number) => void;
};

export function usePlotCanvas({
  enabled,
  canvasRef,
  seriesRef,
  buffersRef,
  visibleSeriesIdsRef,
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
          const stats = drawPlotCanvasFromBuffers(
            canvas,
            seriesRef.current,
            buffersRef.current,
            visibleSeriesIdsRef.current,
          );
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
  }, [buffersRef, canvasRef, enabled, frameMs, seriesRef, visibleSeriesIdsRef]);
}
