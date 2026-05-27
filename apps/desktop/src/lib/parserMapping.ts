import type { ParseConfigDto, ParserSignal, PlotLayoutDto, PlotSeries } from "../types";
import { formatCanId } from "./frames";

export function sampleSignalValue(signal: ParserSignal, index: number) {
  const raw = 13073 + index * 257;
  return raw * signal.scale + signal.offset;
}

export function mapParseConfig(config: ParseConfigDto): ParserSignal[] {
  return config.signals.map((signal) => ({
    id: signal.id,
    name: signal.name,
    bus: signal.selector.bus ?? "ALL",
    canId: formatCanId(`0x${signal.selector.id.toString(16)}`, "standard"),
    dataType: signal.source.data_type ?? (signal.source.signed ? "signed-int" : "unsigned-int"),
    byteOffset: signal.source.byte_offset,
    bitOffset: signal.source.bit_offset,
    bitLength: signal.source.bit_length,
    endian: signal.source.endian,
    signed: signal.source.data_type === "signed-int" || Boolean(signal.source.signed),
    scale: signal.conversion.scale,
    offset: signal.conversion.offset,
    unit: signal.conversion.unit ?? "",
  }));
}

export function mapPlotLayout(layout: PlotLayoutDto): PlotSeries[] {
  return layout.panels.flatMap((panel) =>
    panel.series.map((series) => ({
      id: series.id,
      panelId: panel.id,
      panelTitle: panel.title,
      signalId: series.signal_id,
      label: series.label,
      axis: series.axis,
      scale: series.scale,
      offset: series.offset,
      unit: series.unit_override ?? "",
      color: series.color,
    })),
  );
}
