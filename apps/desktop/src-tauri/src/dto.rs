use canrush_core::parser::SignalSample;
use canrush_core::plot::PlotPoint;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub(crate) struct SerialPortDto {
    pub(crate) port_name: String,
    pub(crate) port_type: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ConnectBusConfig {
    pub(crate) bus: String,
    pub(crate) port: String,
    pub(crate) bitrate: String,
    pub(crate) data_bitrate: String,
    pub(crate) listen_only: bool,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct ServerInfoDto {
    pub(crate) endpoint: String,
    pub(crate) connected: bool,
    pub(crate) server_name: String,
    pub(crate) protocol_version: String,
    pub(crate) started_at_unix_ms: String,
    pub(crate) read_only: bool,
    pub(crate) process_state: String,
    pub(crate) owner: String,
    pub(crate) exit_reason: String,
    pub(crate) message: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct BusStatusDto {
    pub(crate) bus: String,
    pub(crate) status: String,
    pub(crate) frames: u64,
    pub(crate) errors: u64,
    pub(crate) rate_hz: String,
    pub(crate) utilization_percent: String,
    pub(crate) saturated_last_1s_ms: String,
    pub(crate) saturated_worst_1s_ms: String,
    pub(crate) message: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct LatestFrameDto {
    pub(crate) bus: String,
    pub(crate) id: String,
    pub(crate) id_format: String,
    pub(crate) frame_format: String,
    pub(crate) frame_type: String,
    pub(crate) dlc: u8,
    pub(crate) length: usize,
    pub(crate) data: String,
    pub(crate) flags: String,
    pub(crate) last_seen: String,
    pub(crate) rate_hz: String,
    pub(crate) count: u64,
    pub(crate) raw: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct SnapshotDto {
    pub(crate) server: ServerInfoDto,
    pub(crate) buses: Vec<BusStatusDto>,
    pub(crate) frames: Vec<LatestFrameDto>,
    pub(crate) event_log: String,
    pub(crate) stream_dropped_count: u64,
}

#[derive(Debug, Serialize)]
pub(crate) struct ParsePlotPreviewDto {
    pub(crate) samples: Vec<SignalSample>,
    pub(crate) points: Vec<PlotPoint>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ParsePlotLiveRequestDto {
    pub(crate) since_sequence: Option<u64>,
    pub(crate) selected_series_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct ParsePlotLiveDto {
    pub(crate) samples: Vec<SignalSample>,
    pub(crate) points: Vec<PlotPoint>,
    pub(crate) next_sequence: u64,
    pub(crate) dropped_frames: u64,
    pub(crate) metrics: ParsePlotLiveMetricsDto,
}

#[derive(Debug, Serialize)]
pub(crate) struct ParsePlotLiveMetricsDto {
    pub(crate) total_ms: f64,
    pub(crate) lock_ms: f64,
    pub(crate) select_layout_ms: f64,
    pub(crate) parse_ms: f64,
    pub(crate) build_points_ms: f64,
    pub(crate) frames: usize,
}
