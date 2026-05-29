import { invoke } from "@tauri-apps/api/core";
import type {
  CanRushClient,
  ConnectBusInput,
  ParsePlotCaptureFileInput,
  ParsePlotLiveInput,
  ParsePlotPreviewInput,
} from "./types";
import type {
  ParseConfigDto,
  ParsePlotLiveDto,
  ParsePlotPreviewDto,
  PlotLayoutDto,
  SerialPortInfo,
  ServerInfoDto,
  SnapshotDto,
} from "../types";

export const desktopClient: CanRushClient = {
  isPreview: false,

  listSerialPorts() {
    return invoke<SerialPortInfo[]>("list_serial_ports");
  },

  startLocalServer() {
    return invoke<ServerInfoDto>("start_local_server");
  },

  async connectBus(config: ConnectBusInput) {
    await invoke("connect_bus", {
      config: {
        bus: config.bus,
        port: config.port,
        bitrate: config.bitrate,
        data_bitrate: config.dataBitrate,
        listen_only: config.listenOnly,
      },
    });
  },

  async disconnectAll() {
    await invoke("disconnect_all");
  },

  async clearLatest() {
    await invoke("clear_latest");
  },

  loadParseConfig(path: string) {
    return invoke<ParseConfigDto>("load_parse_config", { path });
  },

  loadPlotLayout(path: string) {
    return invoke<PlotLayoutDto>("load_plot_layout", { path });
  },

  parsePlotPreview(input: ParsePlotPreviewInput) {
    return invoke<ParsePlotPreviewDto>("parse_plot_preview", {
      parseConfigPath: input.parseConfigPath,
      plotLayoutPath: input.plotLayoutPath,
    });
  },

  parsePlotPreviewLive() {
    return invoke<ParsePlotPreviewDto>("parse_plot_preview_live");
  },

  parsePlotLiveSince(input: ParsePlotLiveInput) {
    return invoke<ParsePlotLiveDto>("parse_plot_live_since", {
      request: {
        since_sequence: input.sinceSequence,
        selected_series_ids: input.selectedSeriesIds,
      },
    });
  },

  parsePlotCaptureFile(input: ParsePlotCaptureFileInput) {
    return invoke<ParsePlotPreviewDto>("parse_plot_capture_file", {
      parseConfigPath: input.parseConfigPath,
      plotLayoutPath: input.plotLayoutPath,
      capturePath: input.capturePath,
    });
  },

  latestSnapshot() {
    return invoke<SnapshotDto>("latest_snapshot");
  },
};
