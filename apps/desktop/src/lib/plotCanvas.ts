import type { PlotPointDto, PlotSeries } from "../types";
import { filterRecentPlotPoints, plotVisibleWindowSeconds } from "./plotHistory";

export const maxCanvasPointsPerSeries = 1600;

export type PlotCanvasArea = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type PlotCanvasBounds = {
  minTime: number;
  maxTime: number;
  minValue: number;
  maxValue: number;
  timeRange: number;
  valueRange: number;
};

export type PlotCanvasPoint = {
  x: number;
  y: number;
  point: PlotPointDto;
};

export function groupDrawablePointsBySeries(
  points: PlotPointDto[],
  windowSeconds = plotVisibleWindowSeconds,
) {
  const visiblePoints = filterRecentPlotPoints(points, windowSeconds);
  const pointsBySeries = new Map<string, PlotPointDto[]>();
  for (const point of visiblePoints) {
    const timestamp = Number.parseFloat(point.timestamp_host);
    if (!Number.isFinite(timestamp) || !Number.isFinite(point.value)) {
      continue;
    }
    const seriesPoints = pointsBySeries.get(point.series_id) ?? [];
    seriesPoints.push(point);
    pointsBySeries.set(point.series_id, seriesPoints);
  }
  return pointsBySeries;
}

export function calculatePlotBounds(
  pointsBySeries: Map<string, PlotPointDto[]>,
  windowSeconds = plotVisibleWindowSeconds,
): PlotCanvasBounds | null {
  const drawablePoints = Array.from(pointsBySeries.values()).flat();
  if (drawablePoints.length === 0) {
    return null;
  }

  const maxTime = Math.max(
    ...drawablePoints.map((point) => Number.parseFloat(point.timestamp_host)),
  );
  const minTime = maxTime - windowSeconds;
  const minValue = Math.min(...drawablePoints.map((point) => point.value));
  const maxValue = Math.max(...drawablePoints.map((point) => point.value));

  return {
    minTime,
    maxTime,
    minValue,
    maxValue,
    timeRange: Math.max(0.001, maxTime - minTime),
    valueRange: Math.max(0.001, maxValue - minValue),
  };
}

export function projectPlotPoints(
  points: PlotPointDto[],
  bounds: PlotCanvasBounds,
  area: PlotCanvasArea,
  maxPoints = maxCanvasPointsPerSeries,
): PlotCanvasPoint[] {
  const stride = Math.max(1, Math.ceil(points.length / maxPoints));
  const projected: PlotCanvasPoint[] = [];
  for (let index = 0; index < points.length; index += stride) {
    const point = points[index];
    const timestamp = Number.parseFloat(point.timestamp_host);
    projected.push({
      point,
      x: area.left + ((timestamp - bounds.minTime) / bounds.timeRange) * area.width,
      y:
        area.top +
        area.height -
        ((point.value - bounds.minValue) / bounds.valueRange) * area.height,
    });
  }
  return projected;
}

export function drawPlotCanvas(
  canvas: HTMLCanvasElement,
  seriesList: PlotSeries[],
  points: PlotPointDto[],
) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  const pixelWidth = Math.floor(width * dpr);
  const pixelHeight = Math.floor(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#f4f7f8";
  context.fillRect(0, 0, width, height);

  const left = 34;
  const right = 12;
  const top = 14;
  const bottom = 24;
  const area = {
    left,
    top,
    width: Math.max(1, width - left - right),
    height: Math.max(1, height - top - bottom),
  };

  context.strokeStyle = "#d4dee1";
  context.lineWidth = 1;
  context.beginPath();
  for (let index = 0; index <= 4; index += 1) {
    const y = top + (area.height * index) / 4;
    context.moveTo(left, y);
    context.lineTo(left + area.width, y);
  }
  context.stroke();

  context.strokeStyle = "#9ca9ae";
  context.beginPath();
  context.moveTo(left, top);
  context.lineTo(left, top + area.height);
  context.lineTo(left + area.width, top + area.height);
  context.stroke();

  const pointsBySeries = groupDrawablePointsBySeries(points);
  const bounds = calculatePlotBounds(pointsBySeries);
  if (!bounds) {
    return;
  }

  context.lineWidth = 2;
  context.lineJoin = "round";
  context.lineCap = "round";
  for (const series of seriesList) {
    const seriesPoints = pointsBySeries.get(series.id) ?? [];
    if (seriesPoints.length === 0) {
      continue;
    }
    context.strokeStyle = series.color;
    context.beginPath();
    let moved = false;
    for (const point of projectPlotPoints(seriesPoints, bounds, area)) {
      if (!moved) {
        context.moveTo(point.x, point.y);
        moved = true;
      } else {
        context.lineTo(point.x, point.y);
      }
    }
    context.stroke();
  }
}
