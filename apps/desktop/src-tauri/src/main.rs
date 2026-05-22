use std::collections::{HashMap, VecDeque};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use canrush_core::adapter::{FrameSource, WeActSerialAdapter, WeActSerialConfig};
use canrush_core::model::{CanFrame, FrameFormat, IdFormat};
use canrush_core::server::{
    FrameRateBucket, LatestFrameState, FRAME_RATE_BUCKET_MS, FRAME_RATE_WINDOW_BUCKETS,
};
use serde::{Deserialize, Serialize};

const LOAD_BUCKET_MS: f64 = 100.0;
const LOAD_BUCKETS_1S: u64 = 10;
const LOAD_BUCKETS_5S: u64 = 50;

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
    rate_hz: String,
    utilization_percent: String,
    saturated_last_1s_ms: String,
    saturated_worst_1s_ms: String,
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
    bitrate_bps: u32,
    started_at: Option<Instant>,
    load_buckets: VecDeque<LoadBucket>,
    rate_buckets: VecDeque<FrameRateBucket>,
    worst_saturated_1s_ms: f64,
    message: String,
}

#[derive(Debug, Clone)]
struct LoadBucket {
    index: u64,
    occupied_ms: f64,
}

impl BusStats {
    fn connected(bitrate_bps: u32) -> Self {
        Self {
            status: "connected".to_string(),
            frames: 0,
            errors: 0,
            bitrate_bps,
            started_at: Some(Instant::now()),
            load_buckets: VecDeque::new(),
            rate_buckets: VecDeque::new(),
            worst_saturated_1s_ms: 0.0,
            message: "connected".to_string(),
        }
    }

    fn utilization_percent(&self) -> String {
        let Some(started_at) = self.started_at else {
            return "-".to_string();
        };
        if self.bitrate_bps == 0 {
            return "-".to_string();
        }
        let current_bucket = current_bucket_index(started_at);
        let occupied_ms =
            sum_recent_occupied_ms(&self.load_buckets, current_bucket, LOAD_BUCKETS_5S);
        let window_ms = LOAD_BUCKET_MS * LOAD_BUCKETS_5S as f64;
        format!("{:.1}", occupied_ms / window_ms * 100.0)
    }

    fn saturated_last_1s_ms(&self) -> String {
        let Some(started_at) = self.started_at else {
            return "-".to_string();
        };
        let current_bucket = current_bucket_index(started_at);
        format!(
            "{:.1}",
            sum_recent_saturated_ms(&self.load_buckets, current_bucket, LOAD_BUCKETS_1S)
        )
    }

    fn saturated_worst_1s_ms(&self) -> String {
        if self.started_at.is_none() {
            return "-".to_string();
        }
        format!("{:.1}", self.worst_saturated_1s_ms)
    }

    fn rate_hz(&self) -> String {
        if self.started_at.is_none() {
            return "-".to_string();
        }
        format_completed_window_rate_hz(&self.rate_buckets)
    }

    fn add_occupied_ms(&mut self, occupied_ms: f64) {
        let Some(started_at) = self.started_at else {
            return;
        };
        let current_bucket = current_bucket_index(started_at);
        match self.load_buckets.back_mut() {
            Some(bucket) if bucket.index == current_bucket => {
                bucket.occupied_ms += occupied_ms;
            }
            _ => self.load_buckets.push_back(LoadBucket {
                index: current_bucket,
                occupied_ms,
            }),
        }

        while self
            .load_buckets
            .front()
            .is_some_and(|bucket| bucket.index + LOAD_BUCKETS_5S < current_bucket)
        {
            self.load_buckets.pop_front();
        }

        self.worst_saturated_1s_ms = self.worst_saturated_1s_ms.max(sum_recent_saturated_ms(
            &self.load_buckets,
            current_bucket,
            LOAD_BUCKETS_1S,
        ));
    }

    fn add_frame_rate_sample(&mut self, timestamp: SystemTime) {
        let Some(index) = frame_rate_bucket_index(timestamp) else {
            return;
        };
        match self.rate_buckets.back_mut() {
            Some(bucket) if bucket.index == index => bucket.count += 1,
            _ => self
                .rate_buckets
                .push_back(FrameRateBucket { index, count: 1 }),
        }
        while self
            .rate_buckets
            .front()
            .is_some_and(|bucket| bucket.index + FRAME_RATE_WINDOW_BUCKETS < index)
        {
            self.rate_buckets.pop_front();
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
    let bitrate_bps = nominal_bitrate_bps(&config.bitrate)?;
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
                bitrate_bps,
                started_at: None,
                load_buckets: VecDeque::new(),
                rate_buckets: VecDeque::new(),
                worst_saturated_1s_ms: 0.0,
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

        update_bus_connected(&shared, &worker_bus, bitrate_bps);
        while !worker_stop.load(Ordering::Relaxed) {
            match adapter.next_frame() {
                Ok(Some(frame)) => {
                    let occupied_ms = estimate_occupied_ms(&frame, bitrate_bps);
                    let timestamp_host = frame.timestamp_host;
                    if let Ok(mut inner) = shared.lock() {
                        inner.latest.ingest(frame);
                        let stats = inner
                            .buses
                            .entry(worker_bus.clone())
                            .or_insert_with(|| BusStats::connected(bitrate_bps));
                        stats.status = "connected".to_string();
                        stats.frames += 1;
                        stats.add_occupied_ms(occupied_ms);
                        stats.add_frame_rate_sample(timestamp_host);
                        stats.message = "receiving".to_string();
                    }
                }
                Ok(None) => {}
                Err(error) => {
                    if let Ok(mut inner) = shared.lock() {
                        let stats = inner
                            .buses
                            .entry(worker_bus.clone())
                            .or_insert_with(|| BusStats::connected(bitrate_bps));
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
            bitrate_bps: 0,
            started_at: None,
            load_buckets: VecDeque::new(),
            rate_buckets: VecDeque::new(),
            worst_saturated_1s_ms: 0.0,
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
        stats.started_at = None;
        stats.load_buckets.clear();
        stats.rate_buckets.clear();
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
        stats.load_buckets.clear();
        stats.rate_buckets.clear();
        stats.worst_saturated_1s_ms = 0.0;
        if stats.status == "connected" {
            stats.started_at = Some(Instant::now());
        }
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
            rate_hz: stats.rate_hz(),
            utilization_percent: stats.utilization_percent(),
            saturated_last_1s_ms: stats.saturated_last_1s_ms(),
            saturated_worst_1s_ms: stats.saturated_worst_1s_ms(),
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
                rate_hz: format_bucket_rate_hz(latest),
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

fn update_bus_connected(shared: &Arc<Mutex<ReceiverInner>>, bus: &str, bitrate_bps: u32) {
    if let Ok(mut inner) = shared.lock() {
        inner
            .buses
            .insert(bus.to_string(), BusStats::connected(bitrate_bps));
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

fn nominal_bitrate_bps(code: &str) -> Result<u32, String> {
    match code {
        "S0" => Ok(10_000),
        "S1" => Ok(20_000),
        "S2" => Ok(50_000),
        "S3" => Ok(100_000),
        "S4" => Ok(125_000),
        "S5" => Ok(250_000),
        "S6" => Ok(500_000),
        "S7" => Ok(800_000),
        "S8" => Ok(1_000_000),
        value => Err(format!("unsupported nominal bitrate: {value}")),
    }
}

fn frame_rate_bucket_index(timestamp: SystemTime) -> Option<u64> {
    timestamp
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| (duration.as_millis() as u64) / FRAME_RATE_BUCKET_MS)
}

fn format_completed_window_rate_hz(buckets: &VecDeque<FrameRateBucket>) -> String {
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
                && bucket.index + FRAME_RATE_WINDOW_BUCKETS >= current_bucket
        })
        .map(|bucket| bucket.count)
        .sum::<u64>();
    let window_seconds = (FRAME_RATE_BUCKET_MS * FRAME_RATE_WINDOW_BUCKETS) as f64 / 1000.0;
    format!("{:.1}", count as f64 / window_seconds)
}

fn current_bucket_index(started_at: Instant) -> u64 {
    (started_at.elapsed().as_millis() as u64) / LOAD_BUCKET_MS as u64
}

fn sum_recent_occupied_ms(
    buckets: &VecDeque<LoadBucket>,
    current_bucket: u64,
    bucket_count: u64,
) -> f64 {
    buckets
        .iter()
        .filter(|bucket| bucket.index + bucket_count > current_bucket)
        .map(|bucket| bucket.occupied_ms)
        .sum()
}

fn sum_recent_saturated_ms(
    buckets: &VecDeque<LoadBucket>,
    current_bucket: u64,
    bucket_count: u64,
) -> f64 {
    buckets
        .iter()
        .filter(|bucket| bucket.index + bucket_count > current_bucket)
        .map(|bucket| (bucket.occupied_ms - LOAD_BUCKET_MS).max(0.0))
        .sum()
}

fn estimate_occupied_ms(frame: &CanFrame, bitrate_bps: u32) -> f64 {
    if bitrate_bps == 0 {
        return 0.0;
    }
    estimate_wire_bits(frame) as f64 / f64::from(bitrate_bps) * 1000.0
}

fn estimate_wire_bits(frame: &CanFrame) -> u64 {
    let base_bits = match (frame.frame_format, frame.id_format) {
        (FrameFormat::Classic, IdFormat::Standard) => 47_u64,
        (FrameFormat::Classic, IdFormat::Extended) => 67_u64,
        (FrameFormat::Fd, IdFormat::Standard) => 61_u64,
        (FrameFormat::Fd, IdFormat::Extended) => 81_u64,
    };
    let data_bits = (frame.data_length as u64) * 8;
    base_bits + data_bits
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

fn format_bucket_rate_hz(latest: &canrush_core::server::LatestFrame) -> String {
    format_completed_window_rate_hz(&latest.rate_buckets)
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
