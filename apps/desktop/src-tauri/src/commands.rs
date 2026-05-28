use canrush_core::api::{BusStatusDto as ServerBusStatusDto, ConnectBusRequest};
use canrush_core::server::LatestFrameState;
use serde_json::Value;

use crate::dto::{ConnectBusConfig, LatestFrameDto, SerialPortDto, ServerInfoDto, SnapshotDto};
use crate::server_client::post_json;
use crate::state::ReceiverState;
use crate::stream::ensure_stream_worker;
use crate::{
    fetch_server_buses, format_bucket_rate_hz, format_system_time, map_bus_status,
    refresh_server_info, set_event_log, start_local_server_for_state, SERVER_SESSION,
};

#[tauri::command]
pub(crate) fn list_serial_ports() -> Result<Vec<SerialPortDto>, String> {
    canrush_core::adapter::list_serial_devices()
        .map(|devices| {
            devices
                .into_iter()
                .map(|device| SerialPortDto {
                    port_name: device.port_name,
                    port_type: device.port_type,
                })
                .collect()
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn connect_bus(
    state: tauri::State<'_, ReceiverState>,
    config: ConnectBusConfig,
) -> Result<(), String> {
    if config.bus.trim().is_empty() {
        return Err("bus is required".to_string());
    }
    if config.port.trim().is_empty() {
        return Err(format!("{} port is required", config.bus));
    }

    ensure_stream_worker(&state.inner)?;

    let request = ConnectBusRequest {
        adapter: "weact".to_string(),
        port: Some(config.port),
        baud: None,
        bitrate: Some(config.bitrate),
        data_bitrate: Some(config.data_bitrate),
        listen_only: config.listen_only,
    };
    let path = format!(
        "/api/v1/sessions/{SERVER_SESSION}/buses/{}/connect",
        config.bus
    );
    let status: ServerBusStatusDto = post_json(&path, &request)?;

    set_event_log(&state.inner, format!("{} {}", status.bus, status.message))?;
    Ok(())
}

#[tauri::command]
pub(crate) fn disconnect_bus(
    state: tauri::State<'_, ReceiverState>,
    bus: String,
) -> Result<(), String> {
    let path = format!("/api/v1/sessions/{SERVER_SESSION}/buses/{bus}/disconnect");
    let status: ServerBusStatusDto = post_json(&path, &Value::Null)?;
    set_event_log(&state.inner, format!("{} {}", status.bus, status.message))?;
    Ok(())
}

#[tauri::command]
pub(crate) fn disconnect_all(state: tauri::State<'_, ReceiverState>) -> Result<(), String> {
    let buses = fetch_server_buses()?;
    for bus in buses {
        if bus.status == "connected" || bus.status == "connecting" {
            let path = format!(
                "/api/v1/sessions/{SERVER_SESSION}/buses/{}/disconnect",
                bus.bus
            );
            let _: ServerBusStatusDto = post_json(&path, &Value::Null)?;
        }
    }
    set_event_log(&state.inner, "all buses disconnected".to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn clear_latest(state: tauri::State<'_, ReceiverState>) -> Result<(), String> {
    let mut inner = state.inner.lock().map_err(|error| error.to_string())?;
    inner.latest = LatestFrameState::default();
    inner.event_log = "latest frame view cleared".to_string();
    Ok(())
}

#[tauri::command]
pub(crate) fn start_local_server(
    state: tauri::State<'_, ReceiverState>,
) -> Result<ServerInfoDto, String> {
    start_local_server_for_state(&state.inner)
}

#[tauri::command]
pub(crate) fn latest_snapshot(
    state: tauri::State<'_, ReceiverState>,
) -> Result<SnapshotDto, String> {
    ensure_stream_worker(&state.inner)?;

    let server = refresh_server_info(&state.inner)?;
    let server_buses = fetch_server_buses().unwrap_or_else(|error| {
        let _ = set_event_log(&state.inner, format!("server snapshot failed: {error}"));
        Vec::new()
    });

    let inner = state.inner.lock().map_err(|error| error.to_string())?;
    let mut buses = server_buses
        .into_iter()
        .map(map_bus_status)
        .collect::<Vec<_>>();
    buses.sort_by(|a, b| a.bus.cmp(&b.bus));

    let mut frames = inner
        .latest
        .values()
        .map(|latest| {
            let frame = &latest.frame;
            LatestFrameDto {
                bus: frame.bus.clone(),
                id: format!("0x{:X}", frame.id),
                id_format: frame.id_format.as_str().to_string(),
                frame_format: frame.frame_format.as_str().to_string(),
                frame_type: frame.frame_type.as_str().to_string(),
                dlc: frame.dlc,
                length: frame.data_length,
                data: frame.data_hex(),
                flags: frame.flags_string(),
                last_seen: format_system_time(frame.timestamp_host),
                rate_hz: format_bucket_rate_hz(&latest.rate_buckets),
                count: latest.receive_count,
                raw: frame.raw.clone().unwrap_or_default(),
            }
        })
        .collect::<Vec<_>>();
    frames.sort_by(|a, b| a.bus.cmp(&b.bus).then_with(|| a.id.cmp(&b.id)));

    Ok(SnapshotDto {
        server,
        buses,
        frames,
        event_log: inner.event_log.clone(),
    })
}
