import {
  initialServerInfo,
  previewPorts,
  sampleParserSignals,
  samplePlotSeries,
} from "../fixtures/previewData";
import { sampleSignalValue } from "../lib/parserMapping";
import type {
  CanRushClient,
  ParsePlotLiveInput,
  PreviewParsePlotInput,
} from "./types";
import type {
  ParseConfigDto,
  ParsePlotLiveDto,
  ParsePlotPreviewDto,
  PlotLayoutDto,
  PlotPointDto,
  SignalSampleDto,
} from "../types";

const realtimePreviewIntervalMs = 100;
const previewLiveBatchSize = 64;

function previewParseConfig(name: string): ParseConfigDto {
  return {
    version: 1,
    name,
    description: "browser preview parse config",
    signals: sampleParserSignals.map((signal) => ({
      id: signal.id,
      name: signal.name,
      selector: {
        bus: signal.bus === "ALL" ? null : signal.bus,
        id: Number.parseInt(signal.canId, 16),
      },
      source: {
        data_type: signal.dataType,
        byte_offset: signal.byteOffset,
        bit_offset: signal.bitOffset,
        bit_length: signal.bitLength,
        endian: signal.endian,
        signed: signal.signed,
      },
      conversion: {
        scale: signal.scale,
        offset: signal.offset,
        unit: signal.unit,
      },
    })),
  };
}

function previewPlotLayout(name: string): PlotLayoutDto {
  const panels = new Map<string, PlotLayoutDto["panels"][number]>();
  for (const series of samplePlotSeries) {
    const panel = panels.get(series.panelId) ?? {
      id: series.panelId,
      title: series.panelTitle,
      series: [],
    };
    panel.series.push({
      id: series.id,
      signal_id: series.signalId,
      label: series.label,
      color: series.color,
      axis: series.axis,
      scale: series.scale,
      offset: series.offset,
      unit_override: series.unit || null,
    });
    panels.set(series.panelId, panel);
  }
  return {
    version: 1,
    name,
    description: "browser preview plot layout",
    panels: Array.from(panels.values()),
  };
}

function makePreviewParsePlot(
  input: PreviewParsePlotInput,
  quality: "ok" | "preview",
  timestamp: string,
  sequence: number,
): ParsePlotPreviewDto {
  const samples: SignalSampleDto[] = input.parserSignals.map((signal, index) => {
    const base = sampleSignalValue(signal, index);
    const wave = quality === "ok" ? Math.sin(sequence / 8 + index * 0.7) : 0;
    return {
      timestamp_host: timestamp,
      bus: signal.bus,
      frame_id: signal.canId,
      signal_id: signal.id,
      name: signal.name,
      value: base + wave * Math.max(1, Math.abs(base) * 0.05),
      unit: signal.unit,
      quality,
      source_sequence: sequence + index,
    };
  });
  const points: PlotPointDto[] = input.plotSeries.map((series, index) => ({
    timestamp_host: timestamp,
    panel_id: series.panelId,
    series_id: series.id,
    source_signal_id: series.signalId,
    name: series.label,
    value: samples.find((sample) => sample.signal_id === series.signalId)?.value ?? 0,
    unit: series.unit,
    quality,
    source_sequence: sequence + index,
  }));
  return { samples, points };
}

function makePreviewLiveSince(input: ParsePlotLiveInput): ParsePlotLiveDto {
  const startSequence = input.sinceSequence ?? Math.floor(Date.now() / realtimePreviewIntervalMs);
  const selectedSeries = input.plotSeries.filter((series) =>
    input.selectedSeriesIds.includes(series.id),
  );
  const samples: SignalSampleDto[] = [];
  const points: PlotPointDto[] = [];
  for (let batchIndex = 1; batchIndex <= previewLiveBatchSize; batchIndex += 1) {
    const sequence = startSequence + batchIndex;
    const timestamp = ((Date.now() - (previewLiveBatchSize - batchIndex)) / 1000).toFixed(3);
    for (const series of selectedSeries) {
      const signal = input.parserSignals.find((candidate) => candidate.id === series.signalId);
      if (!signal) {
        continue;
      }
      const signalIndex = input.parserSignals.indexOf(signal);
      const base = sampleSignalValue(signal, signalIndex);
      const value = base + Math.sin(sequence / 5 + signalIndex * 0.6) * Math.max(1, Math.abs(base) * 0.05);
      samples.push({
        timestamp_host: timestamp,
        bus: signal.bus,
        frame_id: signal.canId,
        signal_id: signal.id,
        name: signal.name,
        value,
        unit: signal.unit,
        quality: "ok",
        source_sequence: sequence,
      });
      points.push({
        timestamp_host: timestamp,
        panel_id: series.panelId,
        series_id: series.id,
        source_signal_id: series.signalId,
        name: series.label,
        value,
        unit: series.unit,
        quality: "ok",
        source_sequence: sequence,
      });
    }
  }
  return {
    samples,
    points,
    next_sequence: startSequence + previewLiveBatchSize,
    dropped_frames: 0,
    metrics: {
      total_ms: 0,
      lock_ms: 0,
      select_layout_ms: 0,
      parse_ms: 0,
      build_points_ms: 0,
      frames: previewLiveBatchSize,
    },
  };
}

export const previewClient: CanRushClient = {
  isPreview: true,

  async listSerialPorts() {
    return previewPorts;
  },

  async startLocalServer() {
    return {
      ...initialServerInfo,
      connected: true,
      server_name: "canrush-server-preview",
      protocol_version: "preview",
      process_state: "running",
      owner: "browser-preview",
      message: "browser preview mode; server start is simulated",
    };
  },

  async connectBus() {},

  async disconnectAll() {},

  async clearLatest() {},

  async loadParseConfig(path: string) {
    return previewParseConfig(path);
  },

  async loadPlotLayout(path: string) {
    return previewPlotLayout(path);
  },

  async parsePlotPreview(input: PreviewParsePlotInput) {
    const timestamp = (Date.now() / 1000).toFixed(3);
    const sequence = Math.floor(Date.now() / realtimePreviewIntervalMs);
    return makePreviewParsePlot(input, "ok", timestamp, sequence);
  },

  async parsePlotPreviewLive(input: PreviewParsePlotInput) {
    const timestamp = (Date.now() / 1000).toFixed(3);
    const sequence = Math.floor(Date.now() / realtimePreviewIntervalMs);
    return makePreviewParsePlot(input, "ok", timestamp, sequence);
  },

  async parsePlotLiveSince(input: ParsePlotLiveInput) {
    return makePreviewLiveSince(input);
  },

  async parsePlotCaptureFile(input: PreviewParsePlotInput) {
    const preview = makePreviewParsePlot(input, "preview", "0", 1);
    return {
      samples: preview.samples.map((sample, index) => ({
        ...sample,
        timestamp_host: `${index * 0.5}`,
        source_sequence: index + 1,
      })),
      points: preview.points.map((point, index) => ({
        ...point,
        timestamp_host: `${index * 0.5}`,
        source_sequence: index + 1,
      })),
    };
  },

  async latestSnapshot() {
    return {
      server: initialServerInfo,
      buses: [],
      frames: [],
      event_log: "browser preview mode; snapshot is simulated",
    };
  },
};
