use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use canrush_core::api::BusStatusDto as ServerBusStatusDto;
use canrush_core::server::{FrameRateBucket, FRAME_RATE_BUCKET_MS};

mod commands;
mod dto;
mod parse_plot;
mod path;
mod server_client;
mod server_process;
mod state;
mod stream;

use dto::BusStatusDto;
use server_client::get_json;
pub(crate) use server_process::{refresh_server_info, start_local_server_for_state};
use state::{ReceiverInner, ReceiverState};

pub(crate) const SERVER_ENDPOINT: &str = "local";
pub(crate) const SERVER_SESSION: &str = "default";
const GUI_RATE_WINDOW_BUCKETS: u64 = 2;
pub(crate) const SERVER_INFO_REFRESH_INTERVAL: Duration = Duration::from_secs(1);
pub(crate) const SERVER_STARTUP_TIMEOUT: Duration = Duration::from_secs(3);
pub(crate) const SERVER_POLL_INTERVAL: Duration = Duration::from_millis(100);
pub(crate) const SERVER_HTTP_TIMEOUT: Duration = Duration::from_millis(500);

pub(crate) fn fetch_server_buses() -> Result<Vec<ServerBusStatusDto>, String> {
    get_json(&format!("/api/v1/sessions/{SERVER_SESSION}/buses"))
}

pub(crate) fn map_bus_status(status: ServerBusStatusDto) -> BusStatusDto {
    BusStatusDto {
        bus: status.bus,
        status: status.status,
        frames: status.frames,
        errors: status.errors,
        rate_hz: "-".to_string(),
        utilization_percent: "-".to_string(),
        saturated_last_1s_ms: "-".to_string(),
        saturated_worst_1s_ms: "-".to_string(),
        message: status.message,
    }
}

pub(crate) fn set_event_log(
    shared: &Arc<Mutex<ReceiverInner>>,
    message: String,
) -> Result<(), String> {
    let mut inner = shared.lock().map_err(|error| error.to_string())?;
    inner.event_log = message;
    Ok(())
}

pub(crate) fn format_system_time(time: SystemTime) -> String {
    match time.duration_since(UNIX_EPOCH) {
        Ok(duration) => {
            let millis = duration.subsec_millis();
            format!("{}.{millis:03}", duration.as_secs())
        }
        Err(_) => "-".to_string(),
    }
}

pub(crate) fn format_bucket_rate_hz(buckets: &VecDeque<FrameRateBucket>) -> String {
    let Some(current_bucket) = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| (duration.as_millis() as u64) / FRAME_RATE_BUCKET_MS)
    else {
        return "-".to_string();
    };
    let count = buckets
        .iter()
        .filter(|bucket| {
            bucket.index < current_bucket
                && bucket.index + GUI_RATE_WINDOW_BUCKETS >= current_bucket
        })
        .map(|bucket| bucket.count)
        .sum::<u64>();
    let window_seconds = (FRAME_RATE_BUCKET_MS * GUI_RATE_WINDOW_BUCKETS) as f64 / 1000.0;
    format!("{:.1}", count as f64 / window_seconds)
}

fn main() {
    if let Err(error) = tauri::Builder::default()
        .manage(ReceiverState::default())
        .invoke_handler(tauri::generate_handler![
            commands::list_serial_ports,
            commands::connect_bus,
            commands::disconnect_bus,
            commands::disconnect_all,
            commands::clear_latest,
            commands::start_local_server,
            commands::latest_snapshot,
            parse_plot::load_parse_config,
            parse_plot::load_plot_layout,
            parse_plot::parse_plot_preview,
            parse_plot::parse_plot_preview_live,
            parse_plot::parse_plot_live_since,
            parse_plot::parse_plot_capture_file,
        ])
        .run(tauri::generate_context!())
    {
        eprintln!("failed to run CANRush desktop app: {error}");
        std::process::exit(1);
    }
}
