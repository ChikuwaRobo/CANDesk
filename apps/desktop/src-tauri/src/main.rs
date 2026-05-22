use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use canrush_core::adapter::{FrameSource, WeActSerialAdapter, WeActSerialConfig};
use canrush_core::server::LatestFrameState;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
struct SerialPortDto {
    port_name: String,
    port_type: String,
}

#[derive(Debug, Deserialize)]
struct ConnectBusConfig {
    bus: String,
    port: String,
    bitrate: String,
    data_bitrate: String,
    listen_only: bool,
}

#[derive(Debug, Serialize)]
struct BusStatusDto {
    bus: String,
    status: String,
    frames: u64,
    errors: u64,
    message: String,
}

#[derive(Debug, Serialize)]
struct LatestFrameDto {
    bus: String,
    id: String,
    id_format: String,
    frame_format: String,
    frame_type: String,
    dlc: u8,
    length: usize,
    data: String,
    flags: String,
    last_seen: String,
    rate_hz: String,
    count: u64,
    raw: String,
}

#[derive(Debug, Serialize)]
struct SnapshotDto {
    buses: Vec<BusStatusDto>,
    frames: Vec<LatestFrameDto>,
    event_log: String,
}

struct BusRuntime {
    stop: Arc<AtomicBool>,
    handle: JoinHandle<()>,
}

#[derive(Debug, Default, Clone)]
struct BusStats {
    status: String,
    frames: u64,
    errors: u64,
    message: String,
}

impl BusStats {
    fn connected() -> Self {
        Self {
            status: "connected".to_string(),
            frames: 0,
            errors: 0,
            message: "connected".to_string(),
        }
    }
}

#[derive(Default)]
struct ReceiverInner {
    latest: LatestFrameState,
    buses: HashMap<String, BusStats>,
    workers: HashMap<String, BusRuntime>,
    event_log: String,
}

#[derive(Default)]
struct ReceiverState {
    inner: Arc<Mutex<ReceiverInner>>,
}

#[tauri::command]
fn list_serial_ports() -> Result<Vec<SerialPortDto>, String> {
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
fn connect_bus(
    state: tauri::State<'_, ReceiverState>,
    config: ConnectBusConfig,
) -> Result<(), String> {
    if config.bus.trim().is_empty() {
        return Err("bus is required".to_string());
    }
    if config.port.trim().is_empty() {
        return Err(format!("{} port is required", config.bus));
    }

    stop_bus(&state.inner, &config.bus);

    let bus = config.bus.clone();
    let stop = Arc::new(AtomicBool::new(false));
    let worker_stop = Arc::clone(&stop);
    let shared = Arc::clone(&state.inner);
    let adapter_config = WeActSerialConfig {
        port_name: config.port,
        bus: bus.clone(),
        nominal_bitrate: config.bitrate,
        data_bitrate: Some(config.data_bitrate),
        listen_only: config.listen_only,
        timeout: Duration::from_millis(200),
        ..WeActSerialConfig::default()
    };

    {
        let mut inner = state.inner.lock().map_err(|error| error.to_string())?;
        inner.buses.insert(
            bus.clone(),
            BusStats {
                status: "connecting".to_string(),
                frames: 0,
                errors: 0,
                message: "opening adapter".to_string(),
            },
        );
        inner.event_log = format!("{bus} connecting");
    }

    let worker_bus = bus.clone();
    let handle = thread::spawn(move || {
        let mut adapter = match WeActSerialAdapter::connect(adapter_config) {
            Ok(adapter) => adapter,
            Err(error) => {
                update_bus_error(&shared, &worker_bus, error.to_string());
                return;
            }
        };

        update_bus_connected(&shared, &worker_bus);
        while !worker_stop.load(Ordering::Relaxed) {
            match adapter.next_frame() {
                Ok(Some(frame)) => {
                    if let Ok(mut inner) = shared.lock() {
                        inner.latest.ingest(frame);
                        let stats = inner
                            .buses
                            .entry(worker_bus.clone())
                            .or_insert_with(BusStats::connected);
                        stats.status = "connected".to_string();
                        stats.frames += 1;
                        stats.message = "receiving".to_string();
                    }
                }
                Ok(None) => {}
                Err(error) => {
                    if let Ok(mut inner) = shared.lock() {
                        let stats = inner
                            .buses
                            .entry(worker_bus.clone())
                            .or_insert_with(BusStats::connected);
                        stats.status = "error".to_string();
                        stats.errors += 1;
                        stats.message = error.to_string();
                        inner.event_log = format!("{} receive error: {error}", worker_bus);
                    }
                    break;
                }
            }
        }
    });

    let mut inner = state.inner.lock().map_err(|error| error.to_string())?;
    inner.workers.insert(bus, BusRuntime { stop, handle });
    Ok(())
}

#[tauri::command]
fn disconnect_bus(state: tauri::State<'_, ReceiverState>, bus: String) -> Result<(), String> {
    stop_bus(&state.inner, &bus);
    let mut inner = state.inner.lock().map_err(|error| error.to_string())?;
    inner
        .buses
        .entry(bus.clone())
        .and_modify(|stats| {
            stats.status = "ready".to_string();
            stats.message = "disconnected".to_string();
        })
        .or_insert(BusStats {
            status: "ready".to_string(),
            frames: 0,
            errors: 0,
            message: "disconnected".to_string(),
        });
    inner.event_log = format!("{bus} disconnected");
    Ok(())
}

#[tauri::command]
fn disconnect_all(state: tauri::State<'_, ReceiverState>) -> Result<(), String> {
    let buses = {
        let inner = state.inner.lock().map_err(|error| error.to_string())?;
        inner.workers.keys().cloned().collect::<Vec<_>>()
    };
    for bus in buses {
        stop_bus(&state.inner, &bus);
    }
    let mut inner = state.inner.lock().map_err(|error| error.to_string())?;
    for stats in inner.buses.values_mut() {
        stats.status = "ready".to_string();
        stats.message = "disconnected".to_string();
    }
    inner.event_log = "all buses disconnected".to_string();
    Ok(())
}

#[tauri::command]
fn clear_latest(state: tauri::State<'_, ReceiverState>) -> Result<(), String> {
    let mut inner = state.inner.lock().map_err(|error| error.to_string())?;
    inner.latest = LatestFrameState::default();
    for stats in inner.buses.values_mut() {
        stats.frames = 0;
        stats.errors = 0;
    }
    inner.event_log = "latest frame view cleared".to_string();
    Ok(())
}

#[tauri::command]
fn latest_snapshot(state: tauri::State<'_, ReceiverState>) -> Result<SnapshotDto, String> {
    let inner = state.inner.lock().map_err(|error| error.to_string())?;
    let mut buses = inner
        .buses
        .iter()
        .map(|(bus, stats)| BusStatusDto {
            bus: bus.clone(),
            status: stats.status.clone(),
            frames: stats.frames,
            errors: stats.errors,
            message: stats.message.clone(),
        })
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
                rate_hz: format_rate_hz(latest.previous_timestamp_host, frame.timestamp_host),
                count: latest.receive_count,
                raw: frame.raw.clone().unwrap_or_default(),
            }
        })
        .collect::<Vec<_>>();
    frames.sort_by(|a, b| a.bus.cmp(&b.bus).then_with(|| a.id.cmp(&b.id)));

    Ok(SnapshotDto {
        buses,
        frames,
        event_log: inner.event_log.clone(),
    })
}

fn stop_bus(shared: &Arc<Mutex<ReceiverInner>>, bus: &str) {
    let runtime = shared
        .lock()
        .ok()
        .and_then(|mut inner| inner.workers.remove(bus));
    if let Some(runtime) = runtime {
        runtime.stop.store(true, Ordering::Relaxed);
        let _ = runtime.handle.join();
    }
}

fn update_bus_connected(shared: &Arc<Mutex<ReceiverInner>>, bus: &str) {
    if let Ok(mut inner) = shared.lock() {
        inner.buses.insert(bus.to_string(), BusStats::connected());
        inner.event_log = format!("{bus} connected");
    }
}

fn update_bus_error(shared: &Arc<Mutex<ReceiverInner>>, bus: &str, message: String) {
    if let Ok(mut inner) = shared.lock() {
        let stats = inner.buses.entry(bus.to_string()).or_default();
        stats.status = "error".to_string();
        stats.errors += 1;
        stats.message = message.clone();
        inner.event_log = format!("{bus} connection error: {message}");
    }
}

fn format_system_time(time: SystemTime) -> String {
    match time.duration_since(UNIX_EPOCH) {
        Ok(duration) => {
            let millis = duration.subsec_millis();
            format!("{}.{millis:03}", duration.as_secs())
        }
        Err(_) => "-".to_string(),
    }
}

fn format_rate_hz(previous: Option<SystemTime>, current: SystemTime) -> String {
    let Some(previous) = previous else {
        return "-".to_string();
    };
    match current.duration_since(previous) {
        Ok(duration) if duration.as_secs_f64() > 0.0 => {
            format!("{:.1}", 1.0 / duration.as_secs_f64())
        }
        _ => "-".to_string(),
    }
}

fn main() {
    if let Err(error) = tauri::Builder::default()
        .manage(ReceiverState::default())
        .invoke_handler(tauri::generate_handler![
            list_serial_ports,
            connect_bus,
            disconnect_bus,
            disconnect_all,
            clear_latest,
            latest_snapshot,
        ])
        .run(tauri::generate_context!())
    {
        eprintln!("failed to run CANRush desktop app: {error}");
        std::process::exit(1);
    }
}
