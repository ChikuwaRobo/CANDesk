import type { PlotPointDto, PlotSeries } from "../types";
import { plotVisibleWindowSeconds } from "./plotHistory";

export const plotAggregationRateHz = 60;
export const plotAggregationIntervalSeconds = 1 / plotAggregationRateHz;
export const plotSeriesBufferCapacity = plotAggregationRateHz * 60;

export type BufferedPlotPoint = Pick<PlotPointDto, "timestamp_host" | "value" | "unit">;

export type PlotSeriesBuffer = {
  seriesId: string;
  capacity: number;
  bucketIds: Float64Array;
  bucketStarts: Float64Array;
  minValues: Float32Array;
  maxValues: Float32Array;
  avgValues: Float32Array;
  sumValues: Float64Array;
  counts: Uint32Array;
  length: number;
  writeIndex: number;
  latestPoint?: BufferedPlotPoint;
};

export type PlotSeriesBufferMap = Map<string, PlotSeriesBuffer>;

export function plotBucketId(timestamp: number) {
  return Math.floor(timestamp * plotAggregationRateHz);
}

export function plotBucketStart(bucketId: number) {
  return bucketId * plotAggregationIntervalSeconds;
}

export function createPlotSeriesBuffer(seriesId: string, capacity = plotSeriesBufferCapacity): PlotSeriesBuffer {
  return {
    seriesId,
    capacity,
    bucketIds: new Float64Array(capacity),
    bucketStarts: new Float64Array(capacity),
    minValues: new Float32Array(capacity),
    maxValues: new Float32Array(capacity),
    avgValues: new Float32Array(capacity),
    sumValues: new Float64Array(capacity),
    counts: new Uint32Array(capacity),
    length: 0,
    writeIndex: 0,
  };
}

export function createPlotSeriesBuffers(
  seriesList: PlotSeries[],
  capacity = plotSeriesBufferCapacity,
): PlotSeriesBufferMap {
  return new Map(seriesList.map((series) => [series.id, createPlotSeriesBuffer(series.id, capacity)]));
}

export function resetPlotSeriesBuffers(
  buffers: PlotSeriesBufferMap,
  seriesList: PlotSeries[],
  capacity = plotSeriesBufferCapacity,
) {
  buffers.clear();
  for (const series of seriesList) {
    buffers.set(series.id, createPlotSeriesBuffer(series.id, capacity));
  }
}

export function clearPlotSeriesBuffers(buffers: PlotSeriesBufferMap) {
  for (const buffer of buffers.values()) {
    buffer.length = 0;
    buffer.writeIndex = 0;
    buffer.latestPoint = undefined;
  }
}

export function ensurePlotSeriesBuffers(
  buffers: PlotSeriesBufferMap,
  seriesList: PlotSeries[],
  capacity = plotSeriesBufferCapacity,
) {
  const validIds = new Set(seriesList.map((series) => series.id));
  for (const id of Array.from(buffers.keys())) {
    if (!validIds.has(id)) {
      buffers.delete(id);
    }
  }
  for (const series of seriesList) {
    if (!buffers.has(series.id)) {
      buffers.set(series.id, createPlotSeriesBuffer(series.id, capacity));
    }
  }
}

function findBucketIndex(buffer: PlotSeriesBuffer, bucketId: number) {
  if (buffer.length === 0) {
    return -1;
  }
  const latestIndex = (buffer.writeIndex + buffer.capacity - 1) % buffer.capacity;
  if (buffer.bucketIds[latestIndex] === bucketId) {
    return latestIndex;
  }
  const start = buffer.length === buffer.capacity ? buffer.writeIndex : 0;
  for (let offset = 0; offset < buffer.length; offset += 1) {
    const index = (start + offset) % buffer.capacity;
    if (buffer.bucketIds[index] === bucketId) {
      return index;
    }
  }
  return -1;
}

function appendBucket(buffer: PlotSeriesBuffer, bucketId: number, value: number) {
  const index = buffer.writeIndex;
  buffer.bucketIds[index] = bucketId;
  buffer.bucketStarts[index] = plotBucketStart(bucketId);
  buffer.minValues[index] = value;
  buffer.maxValues[index] = value;
  buffer.avgValues[index] = value;
  buffer.sumValues[index] = value;
  buffer.counts[index] = 1;
  buffer.writeIndex = (buffer.writeIndex + 1) % buffer.capacity;
  buffer.length = Math.min(buffer.capacity, buffer.length + 1);
}

function updateBucket(buffer: PlotSeriesBuffer, index: number, value: number) {
  if (value < buffer.minValues[index]) {
    buffer.minValues[index] = value;
  }
  if (value > buffer.maxValues[index]) {
    buffer.maxValues[index] = value;
  }
  buffer.sumValues[index] += value;
  buffer.counts[index] += 1;
  buffer.avgValues[index] = buffer.sumValues[index] / buffer.counts[index];
}

export function appendPlotPointsToBuffers(buffers: PlotSeriesBufferMap, points: PlotPointDto[]) {
  for (const point of points) {
    const buffer = buffers.get(point.series_id);
    const timestamp = Number.parseFloat(point.timestamp_host);
    if (!buffer || !Number.isFinite(timestamp) || !Number.isFinite(point.value)) {
      continue;
    }
    const bucketId = plotBucketId(timestamp);
    const bucketIndex = findBucketIndex(buffer, bucketId);
    if (bucketIndex >= 0) {
      updateBucket(buffer, bucketIndex, point.value);
    } else {
      appendBucket(buffer, bucketId, point.value);
    }
    buffer.latestPoint = {
      timestamp_host: point.timestamp_host,
      value: point.value,
      unit: point.unit,
    };
  }
}

export function forEachPlotBufferBucket(
  buffer: PlotSeriesBuffer,
  visitor: (bucketStart: number, minValue: number, maxValue: number, avgValue: number, count: number) => void,
) {
  const start = buffer.length === buffer.capacity ? buffer.writeIndex : 0;
  for (let offset = 0; offset < buffer.length; offset += 1) {
    const index = (start + offset) % buffer.capacity;
    visitor(
      buffer.bucketStarts[index],
      buffer.minValues[index],
      buffer.maxValues[index],
      buffer.avgValues[index],
      buffer.counts[index],
    );
  }
}

export function getLatestBufferedTimestamp(buffers: PlotSeriesBufferMap, seriesIds: string[]) {
  let latest = Number.NEGATIVE_INFINITY;
  for (const id of seriesIds) {
    const latestTimestamp = buffers.get(id)?.latestPoint?.timestamp_host;
    if (!latestTimestamp) {
      continue;
    }
    const timestamp = Number.parseFloat(latestTimestamp);
    if (Number.isFinite(timestamp) && timestamp > latest) {
      latest = timestamp;
    }
  }
  return latest;
}

export function countBufferedPointsInWindow(
  buffers: PlotSeriesBufferMap,
  seriesIds: string[],
  windowSeconds = plotVisibleWindowSeconds,
) {
  const latestTimestamp = getLatestBufferedTimestamp(buffers, seriesIds);
  if (!Number.isFinite(latestTimestamp)) {
    return 0;
  }
  const cutoff = latestTimestamp - windowSeconds;
  let count = 0;
  for (const id of seriesIds) {
    const buffer = buffers.get(id);
    if (!buffer) {
      continue;
    }
    forEachPlotBufferBucket(buffer, (bucketStart, _minValue, _maxValue, _avgValue, bucketCount) => {
      if (bucketStart >= cutoff) {
        count += bucketCount;
      }
    });
  }
  return count;
}

export function getCurrentPlotValuesFromBuffers(
  buffers: PlotSeriesBufferMap,
  seriesList: PlotSeries[],
  visibleSeriesIds: string[],
) {
  const visibleIds = new Set(visibleSeriesIds);
  return seriesList
    .filter((series) => visibleIds.has(series.id))
    .map((series) => ({
      series,
      latestPoint: buffers.get(series.id)?.latestPoint,
    }));
}
