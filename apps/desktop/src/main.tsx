import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import {
  Activity,
  Cable,
  CirclePause,
  Database,
  Download,
  FileJson,
  LineChart,
  Plug,
  RefreshCw,
  Search,
  Server,
  SlidersHorizontal,
  Square,
  Unplug,
} from "lucide-react";
import "./styles.css";

type SerialPortInfo = {
  port_name: string;
  port_type: string;
};

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

type BusConfig = {
  bus: "CAN0" | "CAN1";
  port: string;
  bitrate: string;
  dataBitrate: string;
  listenOnly: boolean;
  status: "idle" | "ready" | "connecting" | "connected" | "disconnected" | "error";
  frames: number;
  errors: number;
  rateHz: string;
  utilizationPercent: string;
  saturatedLast1sMs: string;
  saturatedWorst1sMs: string;
};

type LatestFrame = {
  rowKey: string;
  bus: string;
  id: string;
  idFormat: string;
  frameFormat: string;
  frameType: string;
  dlc: number;
  length: number;
  data: string;
  flags: string;
  lastSeen: string;
  rateHz: string;
  count: number;
  raw: string;
  mergedDetails?: FrameDetail[];
};

type FrameDetail = {
  bus: string;
  data: string;
  raw: string;
  lastSeen: string;
  rateHz: string;
  count: number;
};

type BusStatusDto = {
  bus: string;
  status: BusConfig["status"];
  frames: number;
  errors: number;
  rate_hz: string;
  utilization_percent: string;
  saturated_last_1s_ms: string;
  saturated_worst_1s_ms: string;
  message: string;
};

type LatestFrameDto = {
  bus: string;
  id: string;
  id_format: string;
  frame_format: string;
  frame_type: string;
  dlc: number;
  length: number;
  data: string;
  flags: string;
  last_seen: string;
  rate_hz: string;
  count: number;
  raw: string;
};

type ServerInfoDto = {
  endpoint: string;
  connected: boolean;
  server_name: string;
  protocol_version: string;
  started_at_unix_ms: string;
  read_only: boolean;
  process_state: string;
  owner: string;
  exit_reason: string;
  message: string;
};

type SnapshotDto = {
  server: ServerInfoDto;
  buses: BusStatusDto[];
  frames: LatestFrameDto[];
  event_log: string;
};

type SortMode = "id" | "bus" | "recent";
type WorkspaceView = "monitor" | "parser" | "plotter";

type ParserSignal = {
  id: string;
  name: string;
  bus: string;
  canId: string;
  dataType: string;
  byteOffset: number;
  bitOffset: number;
  bitLength: number;
  endian: "little" | "big";
  signed: boolean;
  scale: number;
  offset: number;
  unit: string;
};

type PlotSeries = {
  id: string;
  panelId: string;
  panelTitle: string;
  signalId: string;
  label: string;
  axis: "left" | "right";
  scale: number;
  offset: number;
  unit: string;
  color: string;
};

type ParseConfigDto = {
  version: number;
  name: string;
  description: string;
  signals: ParseSignalDto[];
};

type ParseSignalDto = {
  id: string;
  name: string;
  selector: {
    bus: string | null;
    id: number;
  };
  source: {
    data_type?: string;
    byte_offset: number;
    bit_offset: number;
    bit_length: number;
    endian: "little" | "big";
    signed?: boolean;
  };
  conversion: {
    scale: number;
    offset: number;
    unit?: string;
  };
};

type PlotLayoutDto = {
  version: number;
  name: string;
  description: string;
  panels: PlotPanelDto[];
};

type PlotPanelDto = {
  id: string;
  title: string;
  series: PlotSeriesDto[];
};

type PlotSeriesDto = {
  id: string;
  signal_id: string;
  label: string;
  color: string;
  axis: "left" | "right";
  scale: number;
  offset: number;
  unit_override: string | null;
};

type SignalSampleDto = {
  timestamp_host: string;
  bus: string;
  frame_id: string;
  signal_id: string;
  name: string;
  value: number;
  unit: string;
  quality: string;
  source_sequence: number;
};

type PlotPointDto = {
  timestamp_host: string;
  panel_id: string;
  series_id: string;
  source_signal_id: string;
  name: string;
  value: number;
  unit: string;
  quality: string;
  source_sequence: number;
};

type ParsePlotPreviewDto = {
  samples: SignalSampleDto[];
  points: PlotPointDto[];
};

const dummyIds = [0x103, 0x110, 0x180, 0x201, 0x2a0, 0x305, 0x3f2, 0x420];
const initialServerInfo: ServerInfoDto = {
  endpoint: "127.0.0.1:49000",
  connected: false,
  server_name: "-",
  protocol_version: "-",
  started_at_unix_ms: "-",
  read_only: false,
  process_state: "not-running",
  owner: "external",
  exit_reason: "",
  message: "not checked",
};

const initialBuses: BusConfig[] = [
  {
    bus: "CAN0",
    port: "COM3",
    bitrate: "S8",
    dataBitrate: "Y2",
    listenOnly: true,
    status: "idle",
    frames: 0,
    errors: 0,
    rateHz: "-",
    utilizationPercent: "-",
    saturatedLast1sMs: "-",
    saturatedWorst1sMs: "-",
  },
  {
    bus: "CAN1",
    port: "COM85",
    bitrate: "S8",
    dataBitrate: "Y2",
    listenOnly: true,
    status: "idle",
    frames: 0,
    errors: 0,
    rateHz: "-",
    utilizationPercent: "-",
    saturatedLast1sMs: "-",
    saturatedWorst1sMs: "-",
  },
];

const previewPorts: SerialPortInfo[] = [
  {
    port_name: "COM3",
    port_type: "WeActStudio USB2CANFDV1 preview",
  },
  {
    port_name: "COM85",
    port_type: "WeActStudio USB2CANFDV1 preview",
  },
];

const sampleFrames: LatestFrame[] = [
  {
    rowKey: "CAN0-standard-classic-data-0x103",
    bus: "CAN0",
    id: "0x103",
    idFormat: "standard",
    frameFormat: "classic",
    frameType: "data",
    dlc: 8,
    length: 8,
    data: "00 00 00 00 00 00 00 00",
    flags: "",
    lastSeen: "停止中",
    rateHz: "-",
    count: 0,
    raw: "",
  },
  {
    rowKey: "CAN1-standard-classic-data-0x110",
    bus: "CAN1",
    id: "0x110",
    idFormat: "standard",
    frameFormat: "classic",
    frameType: "data",
    dlc: 8,
    length: 8,
    data: "01 01 C8 00 00 00 00 00",
    flags: "",
    lastSeen: "停止中",
    rateHz: "-",
    count: 0,
    raw: "",
  },
];

const sampleParserSignals: ParserSignal[] = [
  {
    id: "can0_100_u16",
    name: "example_value",
    bus: "CAN0",
    canId: "0x100",
    dataType: "unsigned-int",
    byteOffset: 0,
    bitOffset: 0,
    bitLength: 16,
    endian: "little",
    signed: false,
    scale: 1,
    offset: 0,
    unit: "raw",
  },
  {
    id: "can1_110_temp",
    name: "module_temp",
    bus: "CAN1",
    canId: "0x110",
    dataType: "signed-int",
    byteOffset: 2,
    bitOffset: 0,
    bitLength: 12,
    endian: "little",
    signed: true,
    scale: 0.1,
    offset: -40,
    unit: "degC",
  },
];

const samplePlotSeries: PlotSeries[] = [
  {
    id: "example_value",
    panelId: "main",
    panelTitle: "Main",
    signalId: "can0_100_u16",
    label: "Example value",
    axis: "left",
    scale: 1,
    offset: 0,
    unit: "raw",
    color: "#196B7A",
  },
  {
    id: "module_temp",
    panelId: "main",
    panelTitle: "Main",
    signalId: "can1_110_temp",
    label: "Module temp",
    axis: "right",
    scale: 1,
    offset: 0,
    unit: "degC",
    color: "#9A5A1F",
  },
];

function hasTauriRuntime() {
  return Boolean(window.__TAURI_INTERNALS__);
}

function mapSnapshotFrame(frame: LatestFrameDto): LatestFrame {
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

function formatPayloadHex(data: string) {
  return data.match(/.{1,2}/g)?.join(" ") ?? "";
}

function formatCanId(id: string, idFormat: string) {
  const width = idFormat === "extended" ? 8 : 3;
  const value = Number.parseInt(id.replace(/^0x/i, ""), 16);
  return `0x${value.toString(16).toUpperCase().padStart(width, "0")}`;
}

function parseCanId(id: string) {
  return Number.parseInt(id.replace(/^0x/i, ""), 16);
}

function compareFrames(a: LatestFrame, b: LatestFrame, sortMode: SortMode) {
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

function mergeFramesById(sourceFrames: LatestFrame[]) {
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

function toFrameDetail(frame: LatestFrame): FrameDetail {
  return {
    bus: frame.bus,
    data: frame.data,
    raw: frame.raw,
    lastSeen: frame.lastSeen,
    rateHz: frame.rateHz,
    count: frame.count,
  };
}

function sumNumericStrings(left: string, right: string) {
  const leftValue = numericValue(left);
  const rightValue = numericValue(right);
  if (Number.isNaN(leftValue) && Number.isNaN(rightValue)) {
    return "-";
  }
  return `${((Number.isNaN(leftValue) ? 0 : leftValue) + (Number.isNaN(rightValue) ? 0 : rightValue)).toFixed(1)}`;
}

function numericValue(value: string) {
  return Number.parseFloat(value);
}

function formatServerStartedAt(value: string) {
  const millis = Number.parseInt(value, 10);
  if (!Number.isFinite(millis)) {
    return "-";
  }
  return new Date(millis).toLocaleTimeString();
}

function rateBarWidthPercent(rateHz: string, maxRateHz: number) {
  const value = numericValue(rateHz);
  if (!Number.isFinite(value) || !Number.isFinite(maxRateHz) || maxRateHz <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, (value / maxRateHz) * 100));
}

function sampleSignalValue(signal: ParserSignal, index: number) {
  const raw = 13073 + index * 257;
  return raw * signal.scale + signal.offset;
}

function mapParseConfig(config: ParseConfigDto): ParserSignal[] {
  return config.signals.map((signal) => ({
    id: signal.id,
    name: signal.name,
    bus: signal.selector.bus ?? "ALL",
    canId: formatCanId(`0x${signal.selector.id.toString(16)}`, "standard"),
    dataType:
      signal.source.data_type ?? (signal.source.signed ? "signed-int" : "unsigned-int"),
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

function mapPlotLayout(layout: PlotLayoutDto): PlotSeries[] {
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

function makePlotPolyline(index: number) {
  return Array.from({ length: 16 }, (_, pointIndex) => {
    const x = 20 + pointIndex * 34;
    const wave = Math.sin((pointIndex + index * 2) / 2.6);
    const y = 108 - wave * (24 + index * 10) - pointIndex * (index === 0 ? 1.2 : -0.4);
    return `${x},${Math.max(18, Math.min(142, y))}`;
  }).join(" ");
}

function makePlotPolylineFromPoints(points: PlotPointDto[]) {
  if (points.length === 0) {
    return "";
  }
  const timestamps = points.map((point) => Number.parseFloat(point.timestamp_host));
  const values = points.map((point) => point.value).filter(Number.isFinite);
  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const timeRange = Math.max(0.001, maxTime - minTime);
  const valueRange = Math.max(0.001, maxValue - minValue);
  return points
    .map((point) => {
      const timestamp = Number.parseFloat(point.timestamp_host);
      const x = 20 + ((timestamp - minTime) / timeRange) * 540;
      const y = 150 - ((point.value - minValue) / valueRange) * 128;
      return `${Math.max(20, Math.min(560, x))},${Math.max(18, Math.min(150, y))}`;
    })
    .join(" ");
}

function makeDummyFrame(bus: "CAN0" | "CAN1", id: number, index: number, tick: number): LatestFrame {
  const idText = formatCanId(`0x${id.toString(16)}`, "standard");
  const bytes = Array.from({ length: 8 }, (_, byteIndex) =>
    ((id + tick + byteIndex * 17 + (bus === "CAN1" ? 31 : 0)) & 0xff)
      .toString(16)
      .toUpperCase()
      .padStart(2, "0"),
  );
  const rateHz = ((index + 1) * (bus === "CAN0" ? 12.5 : 9.5) + (tick % 5) * 2).toFixed(1);
  return {
    rowKey: `${bus}-standard-classic-data-${idText}`,
    bus,
    id: idText,
    idFormat: "standard",
    frameFormat: "classic",
    frameType: "data",
    dlc: 8,
    length: 8,
    data: bytes.join(" "),
    flags: "",
    lastSeen: `${Math.floor(Date.now() / 1000)}.${String(Date.now() % 1000).padStart(3, "0")}`,
    rateHz,
    count: tick * (index + 1) * (bus === "CAN0" ? 3 : 2),
    raw: `dummy:${bus}:${idText}:${bytes.join("")}`,
  };
}

function makeDummyFrames(tick: number) {
  return dummyIds.flatMap((id, index) => [
    makeDummyFrame("CAN0", id, index, tick),
    makeDummyFrame("CAN1", id, index, tick),
  ]);
}

function App() {
  const [workspaceView, setWorkspaceView] = React.useState<WorkspaceView>("monitor");
  const [ports, setPorts] = React.useState<SerialPortInfo[]>([]);
  const [buses, setBuses] = React.useState(initialBuses);
  const [frames, setFrames] = React.useState(sampleFrames);
  const [selectedFrameId, setSelectedFrameId] = React.useState(sampleFrames[0].rowKey);
  const [busFilter, setBusFilter] = React.useState("ALL");
  const [query, setQuery] = React.useState("");
  const [sortMode, setSortMode] = React.useState<SortMode>("bus");
  const [mergeBuses, setMergeBuses] = React.useState(false);
  const [debugDummy, setDebugDummy] = React.useState(false);
  const [paused, setPaused] = React.useState(false);
  const [connected, setConnected] = React.useState(false);
  const [serverInfo, setServerInfo] = React.useState(initialServerInfo);
  const [eventLog, setEventLog] = React.useState("server client ready");
  const [parseConfigPath, setParseConfigPath] = React.useState(
    "examples/orion.canrush-parse.json",
  );
  const [plotLayoutPath, setPlotLayoutPath] = React.useState(
    "examples/orion.canrush-layout.json",
  );
  const [parseConfigName, setParseConfigName] = React.useState("example.canrush-parse.json");
  const [plotLayoutName, setPlotLayoutName] = React.useState("example.canrush-layout.json");
  const [parserSignals, setParserSignals] = React.useState(sampleParserSignals);
  const [selectedSignalId, setSelectedSignalId] = React.useState(sampleParserSignals[0].id);
  const [plotSeries, setPlotSeries] = React.useState(samplePlotSeries);
  const [selectedSeriesId, setSelectedSeriesId] = React.useState(samplePlotSeries[0].id);
  const [signalSamples, setSignalSamples] = React.useState<SignalSampleDto[]>([]);
  const [plotPoints, setPlotPoints] = React.useState<PlotPointDto[]>([]);
  const [parsePreviewStatus, setParsePreviewStatus] = React.useState("not run");

  const displayFrames = mergeBuses ? mergeFramesById(frames) : frames;

  const visibleFrames = displayFrames
    .filter((frame) => {
      const busMatches = mergeBuses || busFilter === "ALL" || frame.bus === busFilter;
      const queryMatches = frame.id.toLowerCase().includes(query.toLowerCase());
      return busMatches && queryMatches;
    })
    .sort((a, b) => compareFrames(a, b, sortMode));
  const maxVisibleRateHz = Math.max(
    0,
    ...visibleFrames.map((frame) => numericValue(frame.rateHz)).filter(Number.isFinite),
  );

  const selectedFrame =
    visibleFrames.find((frame) => frame.rowKey === selectedFrameId) ?? visibleFrames[0];
  const selectedSignal =
    parserSignals.find((signal) => signal.id === selectedSignalId) ?? sampleParserSignals[0]!;
  const selectedSeries =
    plotSeries.find((series) => series.id === selectedSeriesId) ?? samplePlotSeries[0]!;
  const selectedPanelTitle = selectedSeries.panelTitle;
  const selectedSignalSamples = signalSamples.filter(
    (sample) => sample.signal_id === selectedSignal.id,
  );
  const selectedSeriesPoints = plotPoints.filter((point) => point.series_id === selectedSeries.id);
  const plotPointsBySeries = new Map<string, PlotPointDto[]>();
  for (const point of plotPoints) {
    const seriesPoints = plotPointsBySeries.get(point.series_id) ?? [];
    seriesPoints.push(point);
    plotPointsBySeries.set(point.series_id, seriesPoints);
  }

  React.useEffect(() => {
    if (visibleFrames.length === 0) {
      return;
    }
    if (!visibleFrames.some((frame) => frame.rowKey === selectedFrameId)) {
      setSelectedFrameId(visibleFrames[0].rowKey);
    }
  }, [selectedFrameId, visibleFrames]);

  async function refreshPorts() {
    try {
      const listed = window.__TAURI_INTERNALS__
        ? await invoke<SerialPortInfo[]>("list_serial_ports")
        : previewPorts;
      setPorts(listed);
      setEventLog(
        hasTauriRuntime()
          ? `${listed.length} serial port(s) detected`
          : "browser preview mode; using sample serial ports",
      );
      setBuses((current) =>
        current.map((bus) => {
          const matched = listed.find((port) => port.port_name === bus.port);
          return { ...bus, status: matched ? "ready" : "idle" };
        }),
      );
    } catch (error) {
      setEventLog(`port refresh failed: ${String(error)}`);
    }
  }

  async function startServer() {
    if (!hasTauriRuntime()) {
      setServerInfo({
        ...initialServerInfo,
        connected: true,
        server_name: "canrush-server-preview",
        protocol_version: "preview",
        process_state: "running",
        owner: "browser-preview",
        message: "browser preview mode; server start is simulated",
      });
      setEventLog("browser preview mode; server start is simulated");
      return;
    }

    try {
      const info = await invoke<ServerInfoDto>("start_local_server");
      setServerInfo(info);
      setEventLog(info.message);
    } catch (error) {
      setServerInfo((current) => ({
        ...current,
        connected: false,
        process_state: current.process_state === "running" ? "unknown" : current.process_state,
        message: String(error),
      }));
      setEventLog(`server start failed: ${String(error)}`);
    }
  }

  async function connectAll() {
    if (!hasTauriRuntime()) {
      setConnected(true);
      setBuses((current) =>
        current.map((bus) => ({
          ...bus,
          status: bus.port ? "connected" : "error",
          frames: bus.port ? bus.frames : 0,
          errors: bus.port ? bus.errors : bus.errors + 1,
          rateHz: bus.port ? "preview" : "-",
          utilizationPercent: bus.port ? "preview" : "-",
          saturatedLast1sMs: "-",
          saturatedWorst1sMs: "-",
        })),
      );
      setFrames((current) =>
        current.map((frame, index) => ({
          ...frame,
          lastSeen: index === 0 ? "now" : "now - 40 ms",
          rateHz: index === 0 ? "4307.5" : "5503.5",
          count: index === 0 ? 8622 : 11007,
        })),
      );
      setEventLog("browser preview mode; connection state is simulated");
      return;
    }

    try {
      for (const bus of buses) {
        if (!bus.port) {
          throw new Error(`${bus.bus} port is not selected`);
        }
        await invoke("connect_bus", {
          config: {
            bus: bus.bus,
            port: bus.port,
            bitrate: bus.bitrate,
            data_bitrate: bus.dataBitrate,
            listen_only: bus.listenOnly,
          },
        });
      }
      setConnected(true);
      setEventLog("all buses connecting");
    } catch (error) {
      setEventLog(`connect failed: ${String(error)}`);
    }
  }

  async function disconnectAll() {
    if (hasTauriRuntime()) {
      try {
        await invoke("disconnect_all");
      } catch (error) {
        setEventLog(`disconnect failed: ${String(error)}`);
        return;
      }
    }
    setConnected(false);
    setBuses((current) =>
      current.map((bus) => ({
        ...bus,
        status: "ready",
        rateHz: "-",
        utilizationPercent: "-",
        saturatedLast1sMs: "-",
        saturatedWorst1sMs: "-",
      })),
    );
    setEventLog("all buses disconnected");
  }

  async function clearView() {
    if (hasTauriRuntime()) {
      try {
        await invoke("clear_latest");
      } catch (error) {
        setEventLog(`clear failed: ${String(error)}`);
        return;
      }
    }
    setFrames([]);
    setEventLog("view cleared");
  }

  async function loadParseConfig() {
    if (!hasTauriRuntime()) {
      const nextSignals = sampleParserSignals;
      setParserSignals(nextSignals);
      setSelectedSignalId(nextSignals[0]?.id ?? "");
      setParseConfigName(parseConfigPath);
      setEventLog("browser preview mode; parse config load is simulated");
      return;
    }

    try {
      const config = await invoke<ParseConfigDto>("load_parse_config", {
        path: parseConfigPath,
      });
      const nextSignals = mapParseConfig(config);
      setParserSignals(nextSignals);
      setSelectedSignalId(nextSignals[0]?.id ?? "");
      setParseConfigName(config.name || parseConfigPath);
      setSignalSamples([]);
      setPlotPoints([]);
      setParsePreviewStatus("config loaded");
      setEventLog(`loaded parse config: ${nextSignals.length} signal(s)`);
    } catch (error) {
      setEventLog(`parse config load failed: ${String(error)}`);
    }
  }

  async function loadPlotLayout() {
    if (!hasTauriRuntime()) {
      const nextSeries = samplePlotSeries;
      setPlotSeries(nextSeries);
      setSelectedSeriesId(nextSeries[0]?.id ?? "");
      setPlotLayoutName(plotLayoutPath);
      setEventLog("browser preview mode; plot layout load is simulated");
      return;
    }

    try {
      const layout = await invoke<PlotLayoutDto>("load_plot_layout", {
        path: plotLayoutPath,
      });
      const nextSeries = mapPlotLayout(layout);
      setPlotSeries(nextSeries);
      setSelectedSeriesId(nextSeries[0]?.id ?? "");
      setPlotLayoutName(layout.name || plotLayoutPath);
      setPlotPoints([]);
      setParsePreviewStatus("layout loaded");
      setEventLog(`loaded plot layout: ${nextSeries.length} series`);
    } catch (error) {
      setEventLog(`plot layout load failed: ${String(error)}`);
    }
  }

  async function refreshParsePlotPreview() {
    if (!hasTauriRuntime()) {
      const previewSamples = parserSignals.map((signal, index) => ({
        timestamp_host: `${index * 0.5}`,
        bus: signal.bus,
        frame_id: signal.canId,
        signal_id: signal.id,
        name: signal.name,
        value: sampleSignalValue(signal, index),
        unit: signal.unit,
        quality: "ok",
        source_sequence: index + 1,
      }));
      setSignalSamples(previewSamples);
      setPlotPoints(
        plotSeries.map((series, index) => ({
          timestamp_host: `${index * 0.5}`,
          panel_id: series.panelId,
          series_id: series.id,
          source_signal_id: series.signalId,
          name: series.label,
          value: previewSamples.find((sample) => sample.signal_id === series.signalId)?.value ?? 0,
          unit: series.unit,
          quality: "ok",
          source_sequence: index + 1,
        })),
      );
      setParsePreviewStatus(`preview: ${previewSamples.length} sample(s)`);
      setEventLog("browser preview mode; parse and plot preview is simulated");
      return;
    }

    try {
      const preview = await invoke<ParsePlotPreviewDto>("parse_plot_preview", {
        parseConfigPath,
        plotLayoutPath,
      });
      setSignalSamples(preview.samples);
      setPlotPoints(preview.points);
      setParsePreviewStatus(
        `${preview.samples.length} sample(s), ${preview.points.length} point(s)`,
      );
      setEventLog(
        `parsed ${preview.samples.length} sample(s), built ${preview.points.length} plot point(s)`,
      );
    } catch (error) {
      setEventLog(`parse/plot preview failed: ${String(error)}`);
    }
  }

  function updateBus(index: number, patch: Partial<BusConfig>) {
    setBuses((current) =>
      current.map((bus, busIndex) => (busIndex === index ? { ...bus, ...patch } : bus)),
    );
  }

  React.useEffect(() => {
    void refreshPorts();
  }, []);

  React.useEffect(() => {
    if (!hasTauriRuntime() || debugDummy) {
      return undefined;
    }

    let inFlight = false;
    const intervalMs = serverInfo.connected ? 33 : 1000;
    const timer = window.setInterval(async () => {
      if (inFlight) {
        return;
      }
      inFlight = true;
      try {
        const snapshot = await invoke<SnapshotDto>("latest_snapshot");
        setServerInfo(snapshot.server);
        setConnected(snapshot.buses.some((entry) => entry.status === "connected"));
        setBuses((current) =>
          current.map((bus) => {
            const status = snapshot.buses.find((entry) => entry.bus === bus.bus);
            if (!status) {
              return bus;
            }
            return {
              ...bus,
              status: status.status,
              frames: status.frames,
              errors: status.errors,
              rateHz: status.rate_hz,
              utilizationPercent: status.utilization_percent,
              saturatedLast1sMs: status.saturated_last_1s_ms,
              saturatedWorst1sMs: status.saturated_worst_1s_ms,
            };
          }),
        );
        if (!paused) {
          const nextFrames = snapshot.frames.map(mapSnapshotFrame);
          setFrames(nextFrames);
        }
        if (snapshot.event_log) {
          setEventLog(snapshot.event_log);
        }
      } catch (error) {
        setEventLog(`snapshot failed: ${String(error)}`);
      } finally {
        inFlight = false;
      }
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [paused, debugDummy, serverInfo.connected]);

  React.useEffect(() => {
    if (!debugDummy) {
      return undefined;
    }

    let tick = 1;
    const timer = window.setInterval(() => {
      const nextFrames = makeDummyFrames(tick);
      setConnected(true);
      setBuses((current) =>
        current.map((bus, index) => ({
          ...bus,
          status: "connected",
          frames: tick * (index === 0 ? 390 : 315),
          errors: 0,
          rateHz: index === 0 ? "3900.0" : "3150.0",
          utilizationPercent: index === 0 ? "58.4" : "47.1",
          saturatedLast1sMs: index === 0 ? "0.0" : "0.0",
          saturatedWorst1sMs: index === 0 ? "8.2" : "3.6",
        })),
      );
      if (!paused) {
        setFrames(nextFrames);
      }
      setEventLog("dummy data mode; adapter input is bypassed");
      tick += 1;
    }, 100);

    return () => window.clearInterval(timer);
  }, [debugDummy, paused]);

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <h1>CANRush</h1>
          <div className="server-summary" aria-label="local server status">
            <span className={`server-dot ${serverInfo.connected ? "online" : "offline"}`} />
            <span>{serverInfo.endpoint}</span>
          <span>{serverInfo.server_name}</span>
          <span>{serverInfo.protocol_version}</span>
          <span>{serverInfo.owner}</span>
          <span>{serverInfo.process_state}</span>
          <span>{serverInfo.read_only ? "read-only" : "admin"}</span>
          <span>started {formatServerStartedAt(serverInfo.started_at_unix_ms)}</span>
          {serverInfo.exit_reason ? <span>{serverInfo.exit_reason}</span> : null}
        </div>
      </div>
      <div className="toolbar" aria-label="main actions">
          <div className="workspace-tabs" role="tablist" aria-label="workspace view">
            {([
              ["monitor", "Monitor", Activity],
              ["parser", "Parser", FileJson],
              ["plotter", "Plotter", LineChart],
            ] as const).map(([value, label, Icon]) => (
              <button
                type="button"
                key={value}
                className={workspaceView === value ? "active" : ""}
                onClick={() => setWorkspaceView(value)}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </div>
          <button type="button" onClick={startServer} title="ローカルサーバー起動">
            <Server size={16} />
            Start Server
          </button>
          <button type="button" onClick={refreshPorts} title="ポート再読み込み">
            <RefreshCw size={16} />
            Refresh
          </button>
          <button type="button" onClick={connectAll} title="全バス接続">
            <Plug size={16} />
            Connect
          </button>
          <button type="button" onClick={disconnectAll} title="全バス切断">
            <Unplug size={16} />
            Disconnect
          </button>
          <button type="button" title="GUIキャプチャは後続実装" disabled>
            <Download size={16} />
            Capture CSV
          </button>
        </div>
      </header>

      {workspaceView === "monitor" ? (
        <>
      <section className="content-grid">
        <aside className="bus-panel" aria-label="bus settings">
          <div className="panel-heading">
            <Cable size={18} />
            <h2>Bus</h2>
          </div>
          {buses.map((bus, index) => (
            <article className="bus-card" key={bus.bus}>
              <div className="bus-card-header">
                <strong>{bus.bus}</strong>
                <span className={`status-pill ${bus.status}`}>{bus.status}</span>
              </div>
              <label>
                Port
                <select
                  value={bus.port}
                  onChange={(event) => updateBus(index, { port: event.target.value })}
                >
                  <option value="">未選択</option>
                  {ports.map((port) => (
                    <option value={port.port_name} key={`${bus.bus}-${port.port_name}`}>
                      {port.port_name}
                    </option>
                  ))}
                  {!ports.some((port) => port.port_name === bus.port) && bus.port ? (
                    <option value={bus.port}>{bus.port}</option>
                  ) : null}
                </select>
              </label>
              <div className="field-row">
                <label>
                  Bitrate
                  <select
                    value={bus.bitrate}
                    onChange={(event) => updateBus(index, { bitrate: event.target.value })}
                  >
                    <option value="S4">125k</option>
                    <option value="S6">500k</option>
                    <option value="S8">1M</option>
                  </select>
                </label>
                <label>
                  Data
                  <select
                    value={bus.dataBitrate}
                    onChange={(event) => updateBus(index, { dataBitrate: event.target.value })}
                  >
                    <option value="Y1">1M</option>
                    <option value="Y2">2M</option>
                    <option value="Y5">5M</option>
                  </select>
                </label>
              </div>
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={bus.listenOnly}
                  onChange={(event) => updateBus(index, { listenOnly: event.target.checked })}
                />
                Listen only
              </label>
              <dl className="bus-stats">
                <div>
                  <dt>Frames</dt>
                  <dd>{bus.frames.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Errors</dt>
                  <dd>{bus.errors.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Hz</dt>
                  <dd>{bus.rateHz}</dd>
                </div>
                <div>
                  <dt>Load</dt>
                  <dd>{bus.utilizationPercent === "-" ? "-" : `${bus.utilizationPercent}%`}</dd>
                </div>
                <div>
                  <dt>Full 1s</dt>
                  <dd>{bus.saturatedLast1sMs === "-" ? "-" : `${bus.saturatedLast1sMs} ms`}</dd>
                </div>
                <div>
                  <dt>Worst</dt>
                  <dd>{bus.saturatedWorst1sMs === "-" ? "-" : `${bus.saturatedWorst1sMs} ms`}</dd>
                </div>
              </dl>
            </article>
          ))}
        </aside>

        <section className="table-panel" aria-label="latest frames">
          <div className="table-tools">
            <div className="segmented" role="group" aria-label="bus filter">
              {["ALL", "CAN0", "CAN1"].map((value) => (
                <button
                  type="button"
                  key={value}
                  className={busFilter === value ? "active" : ""}
                  onClick={() => setBusFilter(value)}
                >
                  {value}
                </button>
              ))}
            </div>
            <label className="checkbox-line table-toggle">
              <input
                type="checkbox"
                checked={mergeBuses}
                onChange={(event) => setMergeBuses(event.target.checked)}
              />
              Merge buses
            </label>
            <label className="checkbox-line table-toggle">
              <input
                type="checkbox"
                checked={debugDummy}
                onChange={(event) => setDebugDummy(event.target.checked)}
              />
              Dummy data
            </label>
            <div className="segmented sort-segmented" role="group" aria-label="sort mode">
              {([
                ["bus", "Bus"],
                ["id", "ID"],
                ["recent", "Recent"],
              ] as Array<[SortMode, string]>).map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={sortMode === value ? "active" : ""}
                  onClick={() => setSortMode(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="search-box">
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="CAN ID"
              />
            </label>
            <button type="button" onClick={() => setPaused((value) => !value)}>
              {paused ? <Activity size={16} /> : <CirclePause size={16} />}
              {paused ? "Resume" : "Pause"}
            </button>
            <button type="button" onClick={clearView}>
              <Square size={16} />
              Clear
            </button>
          </div>

          <div className="frame-table-wrap">
            <table className="frame-table">
              <colgroup>
                <col className="col-bus" />
                <col className="col-id" />
                <col className="col-data" />
                <col className="col-last" />
                <col className="col-rate" />
                <col className="col-count" />
              </colgroup>
              <thead>
                <tr>
                  <th>Bus</th>
                  <th>ID</th>
                  <th>Data</th>
                  <th>Last</th>
                  <th>Hz</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {visibleFrames.map((frame) => {
                  return (
                    <tr
                      key={frame.rowKey}
                      className={selectedFrameId === frame.rowKey ? "selected" : ""}
                      onClick={() => setSelectedFrameId(frame.rowKey)}
                    >
                      <td>{frame.bus}</td>
                      <td>{frame.id}</td>
                      <td className="mono">{frame.data}</td>
                      <td>{frame.lastSeen}</td>
                      <td>
                        <div className="rate-cell">
                          <span>{frame.rateHz}</span>
                          <div className="rate-bar-track" aria-hidden="true">
                            <div
                              className="rate-bar-fill"
                              style={{
                                width: `${rateBarWidthPercent(frame.rateHz, maxVisibleRateHz)}%`,
                              }}
                            />
                          </div>
                        </div>
                      </td>
                      <td>{frame.count.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {visibleFrames.length === 0 ? <p className="empty-table">No frames</p> : null}
          </div>
        </section>
      </section>

      <section className="detail-panel" aria-label="frame detail">
        <div className="panel-heading">
          <Database size={18} />
          <h2>Detail</h2>
        </div>
        {selectedFrame ? (
          <>
            <div className="detail-grid">
              <div>
                <span>Frame</span>
                <strong>
                  {selectedFrame.bus} {selectedFrame.id}
                </strong>
              </div>
              <div>
                <span>Payload</span>
                <strong className="mono">{selectedFrame.data}</strong>
              </div>
              <div>
                <span>Metadata</span>
                <strong>
                  {selectedFrame.frameFormat} / DLC {selectedFrame.dlc} / {selectedFrame.length}{" "}
                  byte
                </strong>
              </div>
              <div>
                <span>Raw line</span>
                <strong className="mono">{selectedFrame.raw || "-"}</strong>
              </div>
            </div>
            {selectedFrame.mergedDetails && selectedFrame.mergedDetails.length > 1 ? (
              <div className="merged-detail-list">
                {selectedFrame.mergedDetails.map((detail) => (
                  <div className="merged-detail-row" key={detail.bus}>
                    <strong>{detail.bus}</strong>
                    <span className="mono">{detail.data || "-"}</span>
                    <span>{detail.rateHz} Hz</span>
                    <span>{detail.count.toLocaleString()}</span>
                    <span className="mono">{detail.raw || "-"}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <p className="empty-detail">Select a frame</p>
        )}
      </section>
        </>
      ) : null}

      {workspaceView === "parser" ? (
        <section className="parser-workspace" aria-label="parser workspace">
          <aside className="workspace-side-panel">
            <div className="panel-heading">
              <FileJson size={18} />
              <h2>Parse Config</h2>
            </div>
            <div className="config-summary">
              <span>{parseConfigName}</span>
              <strong>{parserSignals.length} signals</strong>
            </div>
            <div className="config-metrics">
              <div>
                <span>Parsed</span>
                <strong>{signalSamples.length}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{parsePreviewStatus}</strong>
              </div>
            </div>
            <label className="path-input">
              Config path
              <input
                value={parseConfigPath}
                onChange={(event) => setParseConfigPath(event.target.value)}
              />
            </label>
            <div className="stacked-actions">
              <button type="button" title="パース設定JSONを読み込み" onClick={loadParseConfig}>
                <FileJson size={16} />
                Load
              </button>
              <button type="button" title="現在の受信データをパース" onClick={refreshParsePlotPreview}>
                <RefreshCw size={16} />
                Parse
              </button>
            </div>
            <div className="signal-list">
              {parserSignals.map((signal) => (
                <button
                  type="button"
                  key={signal.id}
                  className={selectedSignalId === signal.id ? "selected" : ""}
                  onClick={() => setSelectedSignalId(signal.id)}
                >
                  <span>{signal.name}</span>
                  <strong>
                    {signal.bus} {signal.canId} / {signal.dataType}
                  </strong>
                </button>
              ))}
            </div>
          </aside>

          <section className="workspace-main-panel">
            <div className="panel-heading">
              <SlidersHorizontal size={18} />
              <h2>Signal Editor</h2>
            </div>
            <div className="workspace-summary">
              <div>
                <span>Selected samples</span>
                <strong>{selectedSignalSamples.length}</strong>
              </div>
              <div>
                <span>Source</span>
                <strong>
                  {selectedSignal.bus} {selectedSignal.canId}
                </strong>
              </div>
              <div>
                <span>Type</span>
                <strong>{selectedSignal.dataType}</strong>
              </div>
            </div>
            <div className="editor-grid">
              <label>
                Signal ID
                <input value={selectedSignal.id} readOnly />
              </label>
              <label>
                Name
                <input value={selectedSignal.name} readOnly />
              </label>
              <label>
                Bus
                <select value={selectedSignal.bus} disabled>
                  <option>{selectedSignal.bus}</option>
                </select>
              </label>
              <label>
                CAN ID
                <input value={selectedSignal.canId} readOnly />
              </label>
              <label>
                Type
                <input value={selectedSignal.dataType} readOnly />
              </label>
              <label>
                Byte
                <input value={selectedSignal.byteOffset} readOnly />
              </label>
              <label>
                Bit
                <input value={selectedSignal.bitOffset} readOnly />
              </label>
              <label>
                Length
                <input value={selectedSignal.bitLength} readOnly />
              </label>
              <label>
                Endian
                <select value={selectedSignal.endian} disabled>
                  <option value="little">little</option>
                  <option value="big">big</option>
                </select>
              </label>
              <label className="checkbox-line editor-checkbox">
                <input type="checkbox" checked={selectedSignal.signed} readOnly />
                Signed
              </label>
              <label>
                Scale
                <input value={selectedSignal.scale} readOnly />
              </label>
              <label>
                Offset
                <input value={selectedSignal.offset} readOnly />
              </label>
              <label>
                Unit
                <input value={selectedSignal.unit} readOnly />
              </label>
            </div>

            <div className="preview-table-wrap">
              <table className="preview-table">
                <thead>
                  <tr>
                    <th>timestamp</th>
                    <th>bus</th>
                    <th>frame</th>
                    <th>signal</th>
                    <th>value</th>
                    <th>unit</th>
                    <th>quality</th>
                  </tr>
                </thead>
                <tbody>
                  {(signalSamples.length > 0
                    ? signalSamples
                    : parserSignals.map((signal, index) => ({
                        timestamp_host: `+${(index * 0.5).toFixed(3)}s`,
                        bus: signal.bus,
                        frame_id: signal.canId,
                        signal_id: signal.id,
                        value: sampleSignalValue(signal, index),
                        unit: signal.unit,
                        quality: "preview",
                      }))
                  ).map((sample, index) => (
                    <tr key={`${sample.signal_id}-${index}`}>
                      <td>{sample.timestamp_host}</td>
                      <td>{sample.bus}</td>
                      <td className="mono">{sample.frame_id}</td>
                      <td>{sample.signal_id}</td>
                      <td className="mono">{sample.value.toFixed(3)}</td>
                      <td>{sample.unit}</td>
                      <td>{sample.quality}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      ) : null}

      {workspaceView === "plotter" ? (
        <section className="plotter-workspace" aria-label="plotter workspace">
          <aside className="workspace-side-panel">
            <div className="panel-heading">
              <LineChart size={18} />
              <h2>Plot Layout</h2>
            </div>
            <div className="config-summary">
              <span>{plotLayoutName}</span>
              <strong>{plotSeries.length} series</strong>
            </div>
            <div className="config-metrics">
              <div>
                <span>Points</span>
                <strong>{plotPoints.length}</strong>
              </div>
              <div>
                <span>Panels</span>
                <strong>{new Set(plotSeries.map((series) => series.panelId)).size}</strong>
              </div>
            </div>
            <label className="path-input">
              Layout path
              <input
                value={plotLayoutPath}
                onChange={(event) => setPlotLayoutPath(event.target.value)}
              />
            </label>
            <div className="stacked-actions">
              <button type="button" title="プロットレイアウトJSONを読み込み" onClick={loadPlotLayout}>
                <FileJson size={16} />
                Load
              </button>
              <button type="button" title="現在の受信データからプロットを生成" onClick={refreshParsePlotPreview}>
                <RefreshCw size={16} />
                Plot
              </button>
            </div>
            <div className="signal-list">
              {plotSeries.map((series) => (
                <button
                  type="button"
                  key={series.id}
                  className={selectedSeriesId === series.id ? "selected" : ""}
                  onClick={() => setSelectedSeriesId(series.id)}
                >
                  <span>{series.label}</span>
                  <strong>
                    {series.panelId} / {series.signalId}
                  </strong>
                </button>
              ))}
            </div>
          </aside>

          <section className="workspace-main-panel">
            <div className="panel-heading">
              <SlidersHorizontal size={18} />
              <h2>Series Editor</h2>
            </div>
            <div className="workspace-summary">
              <div>
                <span>Selected points</span>
                <strong>{selectedSeriesPoints.length}</strong>
              </div>
              <div>
                <span>Panel</span>
                <strong>{selectedSeries.panelTitle}</strong>
              </div>
              <div>
                <span>Signal</span>
                <strong>{selectedSeries.signalId}</strong>
              </div>
            </div>
            <div className="editor-grid plot-editor-grid">
              <label>
                Series ID
                <input value={selectedSeries.id} readOnly />
              </label>
              <label>
                Panel
                <input value={selectedSeries.panelTitle} readOnly />
              </label>
              <label>
                Source signal
                <input value={selectedSeries.signalId} readOnly />
              </label>
              <label>
                Label
                <input value={selectedSeries.label} readOnly />
              </label>
              <label>
                Axis
                <select value={selectedSeries.axis} disabled>
                  <option value="left">left</option>
                  <option value="right">right</option>
                </select>
              </label>
              <label>
                Scale
                <input value={selectedSeries.scale} readOnly />
              </label>
              <label>
                Offset
                <input value={selectedSeries.offset} readOnly />
              </label>
              <label>
                Unit override
                <input value={selectedSeries.unit} readOnly />
              </label>
              <label>
                Color
                <input value={selectedSeries.color} readOnly />
              </label>
            </div>

            <div className="plot-preview">
              <div className="plot-preview-header">
                <strong>{selectedPanelTitle}</strong>
                <span>{plotPoints.length} plot point(s)</span>
              </div>
              <svg viewBox="0 0 580 170" role="img" aria-label="plot preview">
                <line x1="20" y1="150" x2="560" y2="150" />
                <line x1="20" y1="18" x2="20" y2="150" />
                {plotSeries.map((series, index) => {
                  const seriesPoints = plotPointsBySeries.get(series.id) ?? [];
                  const points =
                    seriesPoints.length > 0
                      ? makePlotPolylineFromPoints(seriesPoints)
                      : makePlotPolyline(index);
                  return <polyline key={series.id} points={points} stroke={series.color} />;
                })}
              </svg>
              <div className="plot-legend">
                {plotSeries.map((series) => (
                  <button
                    type="button"
                    key={series.id}
                    className={selectedSeriesId === series.id ? "selected" : ""}
                    onClick={() => setSelectedSeriesId(series.id)}
                  >
                    <span style={{ background: series.color }} />
                    {series.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="preview-table-wrap">
              <table className="preview-table">
                <thead>
                  <tr>
                    <th>timestamp</th>
                    <th>panel</th>
                    <th>series</th>
                    <th>signal</th>
                    <th>value</th>
                    <th>unit</th>
                  </tr>
                </thead>
                <tbody>
                  {plotPoints.map((point, index) => (
                    <tr key={`${point.panel_id}-${point.series_id}-${index}`}>
                      <td>{point.timestamp_host}</td>
                      <td>{point.panel_id}</td>
                      <td>{point.series_id}</td>
                      <td>{point.source_signal_id}</td>
                      <td className="mono">{point.value.toFixed(3)}</td>
                      <td>{point.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {plotPoints.length === 0 ? <p className="empty-table">No plot points</p> : null}
            </div>
          </section>
        </section>
      ) : null}

      <footer className="status-strip">
        <span>{eventLog}</span>
        <span>{paused ? "display paused" : connected ? "receiving" : "display live"}</span>
      </footer>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
