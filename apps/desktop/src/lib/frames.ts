import type { FrameDetail, LatestFrame, LatestFrameDto, SortMode } from "../types";

export function mapSnapshotFrame(frame: LatestFrameDto): LatestFrame {
  const id = formatCanId(frame.id, frame.id_format);
  return {
    rowKey: `${frame.bus}-${frame.id_format}-${frame.frame_format}-${frame.frame_type}-${id}`,
    bus: frame.bus,
    id,
    idFormat: frame.id_format,
    frameFormat: frame.frame_format,
    frameType: frame.frame_type,
    dlc: frame.dlc,
    length: frame.length,
    data: formatPayloadHex(frame.data),
    flags: frame.flags,
    lastSeen: frame.last_seen,
    rateHz: frame.rate_hz,
    count: frame.count,
    raw: frame.raw,
  };
}

export function formatPayloadHex(data: string) {
  return data.match(/.{1,2}/g)?.join(" ") ?? "";
}

export function formatCanId(id: string, idFormat: string) {
  const width = idFormat === "extended" ? 8 : 3;
  const value = Number.parseInt(id.replace(/^0x/i, ""), 16);
  return `0x${value.toString(16).toUpperCase().padStart(width, "0")}`;
}

export function parseCanId(id: string) {
  return Number.parseInt(id.replace(/^0x/i, ""), 16);
}

export function compareFrames(a: LatestFrame, b: LatestFrame, sortMode: SortMode) {
  if (sortMode === "recent") {
    return Number.parseFloat(b.lastSeen) - Number.parseFloat(a.lastSeen);
  }
  if (sortMode === "bus") {
    return (
      a.bus.localeCompare(b.bus) ||
      parseCanId(a.id) - parseCanId(b.id) ||
      a.frameFormat.localeCompare(b.frameFormat)
    );
  }
  return (
    parseCanId(a.id) - parseCanId(b.id) ||
    a.bus.localeCompare(b.bus) ||
    a.frameFormat.localeCompare(b.frameFormat)
  );
}

export function mergeFramesById(sourceFrames: LatestFrame[]) {
  const merged = new Map<string, LatestFrame>();
  for (const frame of sourceFrames) {
    const key = `${frame.idFormat}-${frame.frameFormat}-${frame.frameType}-${frame.id}`;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, {
        ...frame,
        rowKey: `ALL-${key}`,
        bus: "ALL",
        mergedDetails: [toFrameDetail(frame)],
      });
      continue;
    }

    const frameIsNewer = Number.parseFloat(frame.lastSeen) > Number.parseFloat(current.lastSeen);
    merged.set(key, {
      ...(frameIsNewer ? frame : current),
      rowKey: `ALL-${key}`,
      bus: "ALL",
      count: current.count + frame.count,
      rateHz: sumNumericStrings(current.rateHz, frame.rateHz),
      mergedDetails: [...(current.mergedDetails ?? []), toFrameDetail(frame)].sort((a, b) =>
        a.bus.localeCompare(b.bus),
      ),
    });
  }
  return Array.from(merged.values());
}

export function toFrameDetail(frame: LatestFrame): FrameDetail {
  return {
    bus: frame.bus,
    data: frame.data,
    raw: frame.raw,
    lastSeen: frame.lastSeen,
    rateHz: frame.rateHz,
    count: frame.count,
  };
}

export function sumNumericStrings(left: string, right: string) {
  const leftValue = numericValue(left);
  const rightValue = numericValue(right);
  if (Number.isNaN(leftValue) && Number.isNaN(rightValue)) {
    return "-";
  }
  return `${((Number.isNaN(leftValue) ? 0 : leftValue) + (Number.isNaN(rightValue) ? 0 : rightValue)).toFixed(1)}`;
}

export function numericValue(value: string) {
  return Number.parseFloat(value);
}

export function formatServerStartedAt(value: string) {
  const millis = Number.parseInt(value, 10);
  if (!Number.isFinite(millis)) {
    return "-";
  }
  return new Date(millis).toLocaleTimeString();
}

export function rateBarWidthPercent(rateHz: string, maxRateHz: number) {
  const value = numericValue(rateHz);
  if (!Number.isFinite(value) || !Number.isFinite(maxRateHz) || maxRateHz <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, (value / maxRateHz) * 100));
}
