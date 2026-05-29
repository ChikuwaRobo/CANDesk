import type { PlotPointDto, PlotSeries } from "../types";
import { filterRecentPlotPoints, plotVisibleWindowSeconds } from "./plotHistory";

export const maxCanvasPointsPerSeries = 400;

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

export type PlotCanvasStats = {
  rawPoints: number;
  drawablePoints: number;
  decimationMs: number;
};

export const plotMarkerThresholdPerSeries = 240;

type PreparedPlotData = {
  pointsBySeries: Map<string, PlotPointDto[]>;
  bounds: PlotCanvasBounds | null;
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
  let hasPoints = false;
  let maxTime = Number.NEGATIVE_INFINITY;
  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;
  for (const seriesPoints of pointsBySeries.values()) {
    for (const point of seriesPoints) {
      const timestamp = Number.parseFloat(point.timestamp_host);
      if (!Number.isFinite(timestamp) || !Number.isFinite(point.value)) {
        continue;
      }
      hasPoints = true;
      if (timestamp > maxTime) {
        maxTime = timestamp;
      }
      if (point.value < minValue) {
        minValue = point.value;
      }
      if (point.value > maxValue) {
        maxValue = point.value;
      }
    }
  }
  if (!hasPoints) {
    return null;
  }
  const minTime = maxTime - windowSeconds;

  return {
    minTime,
    maxTime,
    minValue,
    maxValue,
    timeRange: Math.max(0.001, maxTime - minTime),
    valueRange: Math.max(0.001, maxValue - minValue),
  };
}

function preparePlotData(
  points: PlotPointDto[],
  windowSeconds = plotVisibleWindowSeconds,
): PreparedPlotData {
  let latestTimestamp = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const timestamp = Number.parseFloat(point.timestamp_host);
    if (Number.isFinite(timestamp) && timestamp > latestTimestamp) {
      latestTimestamp = timestamp;
    }
  }
  if (!Number.isFinite(latestTimestamp)) {
    return { pointsBySeries: new Map(), bounds: null };
  }

  const cutoff = latestTimestamp - windowSeconds;
  const pointsBySeries = new Map<string, PlotPointDto[]>();
  let hasPoints = false;
  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const timestamp = Number.parseFloat(point.timestamp_host);
    if (!Number.isFinite(timestamp) || timestamp < cutoff || !Number.isFinite(point.value)) {
      continue;
    }
    hasPoints = true;
    if (point.value < minValue) {
      minValue = point.value;
    }
    if (point.value > maxValue) {
      maxValue = point.value;
    }
    const seriesPoints = pointsBySeries.get(point.series_id);
    if (seriesPoints) {
      seriesPoints.push(point);
    } else {
      pointsBySeries.set(point.series_id, [point]);
    }
  }
  if (!hasPoints) {
    return { pointsBySeries, bounds: null };
  }
  const bounds = {
    minTime: cutoff,
    maxTime: latestTimestamp,
    minValue,
    maxValue,
    timeRange: Math.max(0.001, windowSeconds),
    valueRange: Math.max(0.001, maxValue - minValue),
  };
  return { pointsBySeries, bounds };
}

export function projectPlotPoints(
  points: PlotPointDto[],
  bounds: PlotCanvasBounds,
  area: PlotCanvasArea,
): PlotCanvasPoint[] {
  const projected: PlotCanvasPoint[] = [];
  for (let index = 0; index < points.length; index += 1) {
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

export function decimatePointsByPixelMinMax(
  points: PlotPointDto[],
  bounds: PlotCanvasBounds,
  area: PlotCanvasArea,
): PlotPointDto[] {
  if (points.length <= area.width) {
    return points;
  }
  const bucketCount = Math.max(
    1,
    Math.min(Math.floor(area.width) + 1, Math.floor(maxCanvasPointsPerSeries / 2)),
  );
  const minPoints = new Array<PlotPointDto | undefined>(bucketCount);
  const maxPoints = new Array<PlotPointDto | undefined>(bucketCount);
  for (const point of points) {
    const timestamp = Number.parseFloat(point.timestamp_host);
    if (!Number.isFinite(timestamp)) {
      continue;
    }
    const bucket = Math.max(
      0,
      Math.min(bucketCount - 1, Math.floor(((timestamp - bounds.minTime) / bounds.timeRange) * bucketCount)),
    );
    const minPoint = minPoints[bucket];
    if (!minPoint || point.value < minPoint.value) {
      minPoints[bucket] = point;
    }
    const maxPoint = maxPoints[bucket];
    if (!maxPoint || point.value > maxPoint.value) {
      maxPoints[bucket] = point;
    }
  }

  const decimated: PlotPointDto[] = [];
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const minPoint = minPoints[bucket];
    const maxPoint = maxPoints[bucket];
    if (!minPoint || !maxPoint) {
      continue;
    }
    if (minPoint === maxPoint) {
      decimated.push(minPoint);
    } else if (Number.parseFloat(minPoint.timestamp_host) <= Number.parseFloat(maxPoint.timestamp_host)) {
      decimated.push(minPoint, maxPoint);
    } else {
      decimated.push(maxPoint, minPoint);
    }
  }
  return decimated;
}

export function drawPlotCanvas(
  canvas: HTMLCanvasElement,
  seriesList: PlotSeries[],
  points: PlotPointDto[],
): PlotCanvasStats {
  const emptyStats = { rawPoints: 0, drawablePoints: 0, decimationMs: 0 };
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
    return emptyStats;
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

  const { pointsBySeries, bounds } = preparePlotData(points);
  if (!bounds) {
    return emptyStats;
  }

  context.lineWidth = 2;
  context.lineJoin = "round";
  context.lineCap = "round";
  const decimationStartedAt = performance.now();
  const decimatedBySeries = new Map<string, PlotPointDto[]>();
  let rawPoints = 0;
  let drawablePoints = 0;
  for (const series of seriesList) {
    const seriesPoints = pointsBySeries.get(series.id) ?? [];
    rawPoints += seriesPoints.length;
    if (seriesPoints.length === 0) {
      continue;
    }
    const decimatedPoints = decimatePointsByPixelMinMax(seriesPoints, bounds, area);
    drawablePoints += decimatedPoints.length;
    decimatedBySeries.set(series.id, decimatedPoints);
  }
  const decimationMs = performance.now() - decimationStartedAt;

  for (const series of seriesList) {
    const seriesPoints = decimatedBySeries.get(series.id) ?? [];
    if (seriesPoints.length === 0) {
      continue;
    }
    context.strokeStyle = series.color;
    context.beginPath();
    let moved = false;
    const projectedPoints = projectPlotPoints(seriesPoints, bounds, area);
    for (const point of projectedPoints) {
      if (!moved) {
        context.moveTo(point.x, point.y);
        moved = true;
      } else {
        context.lineTo(point.x, point.y);
      }
    }
    context.stroke();
    if (projectedPoints.length <= plotMarkerThresholdPerSeries) {
      context.fillStyle = series.color;
      for (const point of projectedPoints) {
        context.beginPath();
        context.arc(point.x, point.y, 3, 0, Math.PI * 2);
        context.fill();
      }
    }
  }
  return { rawPoints, drawablePoints, decimationMs };
}
