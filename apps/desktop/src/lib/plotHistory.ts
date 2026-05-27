import type { PlotPointDto, SignalSampleDto } from "../types";

export const maxRealtimeSamples = 10000;
export const maxRealtimePlotPoints = 20000;
export const plotVisibleWindowSeconds = 10;

export function signalSampleKey(sample: SignalSampleDto) {
  return `${sample.signal_id}-${sample.source_sequence}-${sample.timestamp_host}`;
}

export function plotPointKey(point: PlotPointDto) {
  return `${point.panel_id}-${point.series_id}-${point.source_sequence}-${point.timestamp_host}`;
}

export function resetSeenSampleKeys(samples: SignalSampleDto[], seen: Set<string>) {
  seen.clear();
  for (const sample of samples) {
    seen.add(signalSampleKey(sample));
  }
}

export function resetSeenPlotPointKeys(points: PlotPointDto[], seen: Set<string>) {
  seen.clear();
  for (const point of points) {
    seen.add(plotPointKey(point));
  }
}

export function appendUniqueSamples(
  current: SignalSampleDto[],
  incoming: SignalSampleDto[],
  seen: Set<string>,
  maxSamples = maxRealtimeSamples,
) {
  const unique = incoming.filter((sample) => {
    const key = signalSampleKey(sample);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  if (unique.length === 0) {
    return current;
  }
  const next = [...current, ...unique].slice(-maxSamples);
  resetSeenSampleKeys(next, seen);
  return next;
}

export function appendUniquePlotPoints(
  current: PlotPointDto[],
  incoming: PlotPointDto[],
  seen: Set<string>,
  maxPoints = maxRealtimePlotPoints,
) {
  const unique = incoming.filter((point) => {
    const key = plotPointKey(point);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  if (unique.length === 0) {
    return current;
  }
  const next = [...current, ...unique].slice(-maxPoints);
  resetSeenPlotPointKeys(next, seen);
  return next;
}

export function filterRecentPlotPoints(points: PlotPointDto[], windowSeconds: number) {
  if (points.length === 0) {
    return points;
  }
  const latestTimestamp = Math.max(
    ...points.map((point) => Number.parseFloat(point.timestamp_host)).filter(Number.isFinite),
  );
  if (!Number.isFinite(latestTimestamp)) {
    return points;
  }
  const cutoff = latestTimestamp - windowSeconds;
  return points.filter((point) => {
    const timestamp = Number.parseFloat(point.timestamp_host);
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  });
}
