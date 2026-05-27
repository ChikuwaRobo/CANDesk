import React from "react";
import { drawPlotCanvas } from "../lib/plotCanvas";
import type { PlotPointDto, PlotSeries } from "../types";

type UsePlotCanvasInput = {
  enabled: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  seriesRef: React.MutableRefObject<PlotSeries[]>;
  pointsRef: React.MutableRefObject<PlotPointDto[]>;
  frameMs: number;
};

export function usePlotCanvas({
  enabled,
  canvasRef,
  seriesRef,
  pointsRef,
  frameMs,
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
          drawPlotCanvas(canvas, seriesRef.current, pointsRef.current);
        }
        lastDrawAt = timestamp;
      }
      animationFrame = window.requestAnimationFrame(draw);
    };
    animationFrame = window.requestAnimationFrame(draw);

    return () => window.cancelAnimationFrame(animationFrame);
  }, [canvasRef, enabled, frameMs, pointsRef, seriesRef]);
}
