export type SerialPortInfo = {
  port_name: string;
  port_type: string;
};

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export type BusConfig = {
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

export type LatestFrame = {
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

export type FrameDetail = {
  bus: string;
  data: string;
  raw: string;
  lastSeen: string;
  rateHz: string;
  count: number;
};

export type BusStatusDto = {
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

export type LatestFrameDto = {
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

export type ServerInfoDto = {
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

export type SnapshotDto = {
  server: ServerInfoDto;
  buses: BusStatusDto[];
  frames: LatestFrameDto[];
  event_log: string;
};

export type SortMode = "id" | "bus" | "recent";
export type WorkspaceView = "monitor" | "parser" | "plotter";

export type ParserSignal = {
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

export type PlotSeries = {
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

export type ParseConfigDto = {
  version: number;
  name: string;
  description: string;
  signals: ParseSignalDto[];
};

export type ParseSignalDto = {
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

export type PlotLayoutDto = {
  version: number;
  name: string;
  description: string;
  panels: PlotPanelDto[];
};

export type PlotPanelDto = {
  id: string;
  title: string;
  series: PlotSeriesDto[];
};

export type PlotSeriesDto = {
  id: string;
  signal_id: string;
  label: string;
  color: string;
  axis: "left" | "right";
  scale: number;
  offset: number;
  unit_override: string | null;
};

export type SignalSampleDto = {
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

export type PlotPointDto = {
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

export type ParsePlotPreviewDto = {
  samples: SignalSampleDto[];
  points: PlotPointDto[];
};

export type ParsePlotLiveDto = ParsePlotPreviewDto & {
  next_sequence: number;
  dropped_frames: number;
};
