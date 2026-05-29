import type {
  BusConfig,
  ParseConfigDto,
  ParsePlotLiveDto,
  ParsePlotPreviewDto,
  PlotLayoutDto,
  SerialPortInfo,
  ServerInfoDto,
  SnapshotDto,
  ParserSignal,
  PlotSeries,
} from "../types";

export type ConnectBusInput = Pick<
  BusConfig,
  "bus" | "port" | "bitrate" | "dataBitrate" | "listenOnly"
>;

export type ParsePlotPreviewInput = {
  parseConfigPath: string;
  plotLayoutPath: string;
};

export type ParsePlotCaptureFileInput = ParsePlotPreviewInput & {
  capturePath: string;
};

export type PreviewParsePlotInput = {
  parserSignals: ParserSignal[];
  plotSeries: PlotSeries[];
};

export type ParsePlotLiveInput = PreviewParsePlotInput & {
  sinceSequence: number | null;
  selectedSeriesIds: string[];
};

export type CanRushClient = {
  isPreview: boolean;
  listSerialPorts(): Promise<SerialPortInfo[]>;
  startLocalServer(): Promise<ServerInfoDto>;
  connectBus(config: ConnectBusInput): Promise<void>;
  disconnectAll(): Promise<void>;
  clearLatest(): Promise<void>;
  loadParseConfig(path: string): Promise<ParseConfigDto>;
  loadPlotLayout(path: string): Promise<PlotLayoutDto>;
  parsePlotPreview(input: ParsePlotPreviewInput & PreviewParsePlotInput): Promise<ParsePlotPreviewDto>;
  parsePlotPreviewLive(input: PreviewParsePlotInput): Promise<ParsePlotPreviewDto>;
  parsePlotLiveSince(input: ParsePlotLiveInput): Promise<ParsePlotLiveDto>;
  parsePlotCaptureFile(input: ParsePlotCaptureFileInput & PreviewParsePlotInput): Promise<ParsePlotPreviewDto>;
  latestSnapshot(): Promise<SnapshotDto>;
};
