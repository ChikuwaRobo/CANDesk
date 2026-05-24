use std::collections::VecDeque;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use canrush_core::api::{
    BusStatusDto as ServerBusStatusDto, ConnectBusRequest, FrameEventDto, ServerStatusDto,
};
use canrush_core::endpoint::ServerEndpoint;
use canrush_core::model::{CanFrame, Direction, FrameFormat, FrameType, IdFormat};
use canrush_core::server::{FrameRateBucket, LatestFrameState, FRAME_RATE_BUCKET_MS};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use tungstenite::Message;

const SERVER_ENDPOINT: &str = "local";
const SERVER_SESSION: &str = "default";
const GUI_RATE_WINDOW_BUCKETS: u64 = 2;
const SERVER_INFO_REFRESH_INTERVAL: Duration = Duration::from_secs(1);
const SERVER_STARTUP_TIMEOUT: Duration = Duration::from_secs(3);
const SERVER_POLL_INTERVAL: Duration = Duration::from_millis(100);
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

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

#[derive(Debug, Clone, Serialize)]
struct ServerInfoDto {
    endpoint: String,
    connected: bool,
    server_name: String,
    protocol_version: String,
    started_at_unix_ms: String,
    read_only: bool,
    process_state: String,
    owner: String,
    exit_reason: String,
    message: String,
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
    server: ServerInfoDto,
    buses: Vec<BusStatusDto>,
    frames: Vec<LatestFrameDto>,
    event_log: String,
}

struct StreamRuntime {
    stop: Arc<AtomicBool>,
    handle: JoinHandle<()>,
}

impl Drop for StreamRuntime {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        self.handle.thread().unpark();
    }
}

#[derive(Default)]
struct ReceiverInner {
    latest: LatestFrameState,
    stream: Option<StreamRuntime>,
    server_process: Option<ServerProcessRuntime>,
    server_info: Option<ServerInfoDto>,
    server_info_checked_at: Option<Instant>,
    event_log: String,
}

#[derive(Default)]
struct ReceiverState {
    inner: Arc<Mutex<ReceiverInner>>,
}

struct ServerProcessRuntime {
    child: Child,
    started_at: Instant,
    exit_reason: Option<String>,
}

impl Drop for ServerProcessRuntime {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
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
fn disconnect_bus(state: tauri::State<'_, ReceiverState>, bus: String) -> Result<(), String> {
    let path = format!("/api/v1/sessions/{SERVER_SESSION}/buses/{bus}/disconnect");
    let status: ServerBusStatusDto = post_json(&path, &Value::Null)?;
    set_event_log(&state.inner, format!("{} {}", status.bus, status.message))?;
    Ok(())
}

#[tauri::command]
fn disconnect_all(state: tauri::State<'_, ReceiverState>) -> Result<(), String> {
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
fn clear_latest(state: tauri::State<'_, ReceiverState>) -> Result<(), String> {
    let mut inner = state.inner.lock().map_err(|error| error.to_string())?;
    inner.latest = LatestFrameState::default();
    inner.event_log = "latest frame view cleared".to_string();
    Ok(())
}

#[tauri::command]
fn start_local_server(state: tauri::State<'_, ReceiverState>) -> Result<ServerInfoDto, String> {
    if let Ok(status) = get_json::<ServerStatusDto>("/api/v1/status") {
        let info = server_info_from_status(status, "external", "running", "", "existing server");
        update_server_info(&state.inner, info.clone())?;
        set_event_log(&state.inner, "using existing local server".to_string())?;
        return Ok(info);
    }

    let executable = find_server_executable()?;
    let mut command = Command::new(&executable);
    command
        .arg("--listen")
        .arg("127.0.0.1:49000")
        .arg("--server-name")
        .arg("canrush-server-gui")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let child = command
        .spawn()
        .map_err(|error| format!("failed to spawn {}: {error}", executable.display()))?;
    {
        let mut inner = state.inner.lock().map_err(|error| error.to_string())?;
        inner.server_process = Some(ServerProcessRuntime {
            child,
            started_at: Instant::now(),
            exit_reason: None,
        });
        inner.server_info = None;
        inner.server_info_checked_at = None;
        inner.event_log = "local server process started".to_string();
    }

    let deadline = Instant::now() + SERVER_STARTUP_TIMEOUT;
    loop {
        match get_json::<ServerStatusDto>("/api/v1/status") {
            Ok(status) => {
                let info = server_info_from_status(status, "gui", "running", "", "server started");
                update_server_info(&state.inner, info.clone())?;
                return Ok(info);
            }
            Err(status_error) => {
                if let Some(exit_reason) = poll_server_process(&state.inner)? {
                    let info = disconnected_server_info(
                        "gui",
                        "exited",
                        &exit_reason,
                        &format!("server startup failed: {exit_reason}"),
                    );
                    update_server_info(&state.inner, info.clone())?;
                    return Err(info.message);
                }
                if Instant::now() >= deadline {
                    let message = format!("server startup timeout: {status_error}");
                    let info = disconnected_server_info("gui", "starting", "", &message);
                    update_server_info(&state.inner, info.clone())?;
                    return Err(message);
                }
                thread::sleep(SERVER_POLL_INTERVAL);
            }
        }
    }
}

#[tauri::command]
fn latest_snapshot(state: tauri::State<'_, ReceiverState>) -> Result<SnapshotDto, String> {
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

fn ensure_stream_worker(shared: &Arc<Mutex<ReceiverInner>>) -> Result<(), String> {
    let mut inner = shared.lock().map_err(|error| error.to_string())?;
    if inner.stream.is_some() {
        return Ok(());
    }

    let stop = Arc::new(AtomicBool::new(false));
    let worker_stop = Arc::clone(&stop);
    let worker_shared = Arc::clone(shared);
    let handle = thread::spawn(move || run_stream_worker(worker_shared, worker_stop));
    inner.stream = Some(StreamRuntime { stop, handle });
    inner.event_log = "server stream worker started".to_string();
    Ok(())
}

fn run_stream_worker(shared: Arc<Mutex<ReceiverInner>>, stop: Arc<AtomicBool>) {
    let stream_url = match server_endpoint() {
        Ok(endpoint) => format!(
            "{}/api/v1/sessions/{SERVER_SESSION}/stream?kind=gui",
            endpoint.ws_base_url()
        ),
        Err(error) => {
            update_stream_log(&shared, format!("server endpoint error: {error}"));
            return;
        }
    };

    while !stop.load(Ordering::Relaxed) {
        match tungstenite::connect(&stream_url) {
            Ok((mut socket, _response)) => {
                update_stream_log(&shared, "server stream connected".to_string());
                while !stop.load(Ordering::Relaxed) {
                    match socket.read() {
                        Ok(message) => handle_stream_message(&shared, message),
                        Err(error) => {
                            update_stream_log(
                                &shared,
                                format!("server stream disconnected: {error}"),
                            );
                            break;
                        }
                    }
                }
            }
            Err(error) => {
                update_stream_log(&shared, format!("server stream waiting: {error}"));
                thread::park_timeout(Duration::from_millis(500));
            }
        }
    }
}

fn handle_stream_message(shared: &Arc<Mutex<ReceiverInner>>, message: Message) {
    if !message.is_text() {
        return;
    }
    let Ok(text) = message.into_text() else {
        return;
    };
    let Ok(value) = serde_json::from_str::<Value>(&text) else {
        update_stream_log(shared, "server stream JSON parse failed".to_string());
        return;
    };
    match value.get("event").and_then(Value::as_str) {
        Some("hello") => update_stream_log(shared, "server stream hello".to_string()),
        Some("frame") => match serde_json::from_value::<FrameEventDto>(value) {
            Ok(event) => match frame_from_event(event) {
                Ok(frame) => {
                    if let Ok(mut inner) = shared.lock() {
                        inner.latest.ingest(frame);
                    }
                }
                Err(error) => update_stream_log(shared, format!("frame decode failed: {error}")),
            },
            Err(error) => update_stream_log(shared, format!("frame event parse failed: {error}")),
        },
        Some("diagnostic") => update_stream_log(shared, format!("server diagnostic: {text}")),
        Some("closed") => update_stream_log(shared, format!("server stream closed: {text}")),
        Some(_) | None => {}
    }
}

fn frame_from_event(event: FrameEventDto) -> Result<CanFrame, String> {
    let id_format = parse_id_format(&event.id_format)?;
    let frame_format = parse_frame_format(&event.frame_format)?;
    let frame_type = parse_frame_type(&event.frame_type)?;
    let id = parse_can_id(&event.id)?;
    let data = parse_hex_bytes(&event.data_hex)?;
    let flags = event.flags.split(';').map(str::trim).collect::<Vec<_>>();
    Ok(CanFrame {
        bus: event.bus,
        timestamp_host: parse_unix_ns(&event.timestamp_host_unix_ns),
        timestamp_device: None,
        direction: parse_direction(&event.direction)?,
        id,
        id_format,
        frame_format,
        frame_type,
        dlc: event.dlc,
        data_length: event.data_length,
        data,
        bitrate_switch: flags.iter().any(|flag| flag.eq_ignore_ascii_case("brs")),
        error_state_indicator: flags.iter().any(|flag| flag.eq_ignore_ascii_case("esi")),
        adapter: "server".to_string(),
        raw: None,
    })
}

fn parse_direction(value: &str) -> Result<Direction, String> {
    match value {
        "rx" => Ok(Direction::Rx),
        "tx" => Ok(Direction::Tx),
        _ => Err(format!("unknown direction: {value}")),
    }
}

fn parse_id_format(value: &str) -> Result<IdFormat, String> {
    match value {
        "standard" => Ok(IdFormat::Standard),
        "extended" => Ok(IdFormat::Extended),
        _ => Err(format!("unknown id format: {value}")),
    }
}

fn parse_frame_format(value: &str) -> Result<FrameFormat, String> {
    match value {
        "classic" => Ok(FrameFormat::Classic),
        "fd" => Ok(FrameFormat::Fd),
        _ => Err(format!("unknown frame format: {value}")),
    }
}

fn parse_frame_type(value: &str) -> Result<FrameType, String> {
    match value {
        "data" => Ok(FrameType::Data),
        "remote" => Ok(FrameType::Remote),
        "error" => Ok(FrameType::Error),
        _ => Err(format!("unknown frame type: {value}")),
    }
}

fn parse_can_id(value: &str) -> Result<u32, String> {
    u32::from_str_radix(value.trim_start_matches("0x").trim_start_matches("0X"), 16)
        .map_err(|error| format!("invalid CAN ID {value}: {error}"))
}

fn parse_hex_bytes(value: &str) -> Result<Vec<u8>, String> {
    if !value.len().is_multiple_of(2) {
        return Err(format!("hex payload length must be even: {value}"));
    }
    (0..value.len())
        .step_by(2)
        .map(|index| {
            u8::from_str_radix(&value[index..index + 2], 16)
                .map_err(|error| format!("invalid payload byte at {index}: {error}"))
        })
        .collect()
}

fn parse_unix_ns(value: &str) -> SystemTime {
    let Ok(nanos) = value.parse::<u128>() else {
        return SystemTime::now();
    };
    let secs = (nanos / 1_000_000_000).min(u128::from(u64::MAX)) as u64;
    let sub_nanos = (nanos % 1_000_000_000) as u32;
    UNIX_EPOCH + Duration::new(secs, sub_nanos)
}

fn fetch_server_buses() -> Result<Vec<ServerBusStatusDto>, String> {
    get_json(&format!("/api/v1/sessions/{SERVER_SESSION}/buses"))
}

fn refresh_server_info(shared: &Arc<Mutex<ReceiverInner>>) -> Result<ServerInfoDto, String> {
    let owner = current_server_owner(shared)?;
    if let Some(exit_reason) = poll_server_process(shared)? {
        let info = disconnected_server_info(
            &owner,
            "exited",
            &exit_reason,
            &format!("server process stopped: {exit_reason}"),
        );
        update_server_info(shared, info.clone())?;
        return Ok(info);
    }

    {
        let inner = shared.lock().map_err(|error| error.to_string())?;
        if let (Some(info), Some(checked_at)) = (&inner.server_info, inner.server_info_checked_at) {
            if checked_at.elapsed() < SERVER_INFO_REFRESH_INTERVAL {
                return Ok(info.clone());
            }
        }
    }

    let endpoint = server_endpoint()?;
    let endpoint_text = endpoint.to_string();
    let info = match get_json::<ServerStatusDto>("/api/v1/status") {
        Ok(status) => server_info_from_status(status, &owner, "running", "", "connected"),
        Err(error) => disconnected_server_info(&owner, "not-running", "", &error),
    };
    debug_assert_eq!(info.endpoint, endpoint_text);

    update_server_info(shared, info.clone())?;
    Ok(info)
}

fn map_bus_status(status: ServerBusStatusDto) -> BusStatusDto {
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

fn server_info_from_status(
    status: ServerStatusDto,
    owner: &str,
    process_state: &str,
    exit_reason: &str,
    message: &str,
) -> ServerInfoDto {
    ServerInfoDto {
        endpoint: SERVER_ENDPOINT.to_string(),
        connected: true,
        server_name: status.server_name,
        protocol_version: status.protocol_version,
        started_at_unix_ms: status.started_at_unix_ms,
        read_only: status.read_only,
        process_state: process_state.to_string(),
        owner: owner.to_string(),
        exit_reason: exit_reason.to_string(),
        message: message.to_string(),
    }
}

fn disconnected_server_info(
    owner: &str,
    process_state: &str,
    exit_reason: &str,
    message: &str,
) -> ServerInfoDto {
    ServerInfoDto {
        endpoint: SERVER_ENDPOINT.to_string(),
        connected: false,
        server_name: "-".to_string(),
        protocol_version: "-".to_string(),
        started_at_unix_ms: "-".to_string(),
        read_only: false,
        process_state: process_state.to_string(),
        owner: owner.to_string(),
        exit_reason: exit_reason.to_string(),
        message: message.to_string(),
    }
}

fn update_server_info(
    shared: &Arc<Mutex<ReceiverInner>>,
    info: ServerInfoDto,
) -> Result<(), String> {
    let mut inner = shared.lock().map_err(|error| error.to_string())?;
    inner.server_info = Some(info);
    inner.server_info_checked_at = Some(Instant::now());
    Ok(())
}

fn current_server_owner(shared: &Arc<Mutex<ReceiverInner>>) -> Result<String, String> {
    let inner = shared.lock().map_err(|error| error.to_string())?;
    Ok(if inner.server_process.is_some() {
        "gui".to_string()
    } else {
        "external".to_string()
    })
}

fn poll_server_process(shared: &Arc<Mutex<ReceiverInner>>) -> Result<Option<String>, String> {
    let mut inner = shared.lock().map_err(|error| error.to_string())?;
    let Some(runtime) = inner.server_process.as_mut() else {
        return Ok(None);
    };
    if let Some(exit_reason) = &runtime.exit_reason {
        return Ok(Some(exit_reason.clone()));
    }
    match runtime
        .child
        .try_wait()
        .map_err(|error| error.to_string())?
    {
        Some(status) => {
            let elapsed_ms = runtime.started_at.elapsed().as_millis();
            let reason = match status.code() {
                Some(code) => format!("exit-code={code}; elapsed_ms={elapsed_ms}"),
                None => format!("terminated-by-signal; elapsed_ms={elapsed_ms}"),
            };
            runtime.exit_reason = Some(reason.clone());
            Ok(Some(reason))
        }
        None => Ok(None),
    }
}

fn find_server_executable() -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("CANRUSH_SERVER_PATH") {
        let candidate = PathBuf::from(path);
        if candidate.exists() {
            return Ok(candidate);
        }
        return Err(format!(
            "CANRUSH_SERVER_PATH does not exist: {}",
            candidate.display()
        ));
    }

    let executable_name = if cfg!(windows) {
        "canrush-server.exe"
    } else {
        "canrush-server"
    };
    let mut candidates = Vec::new();
    if let Ok(current) = std::env::current_exe() {
        if let Some(dir) = current.parent() {
            candidates.push(dir.join(executable_name));
        }
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(format!("../../../target/debug/{executable_name}")),
    );
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(format!("../../../target/release/{executable_name}")),
    );

    candidates
        .into_iter()
        .find(|candidate| candidate.exists())
        .ok_or_else(|| format!("canrush-server executable not found: {executable_name}"))
}

fn server_endpoint() -> Result<ServerEndpoint, String> {
    SERVER_ENDPOINT
        .parse::<ServerEndpoint>()
        .map_err(|error| error.to_string())
}

fn get_json<T>(path: &str) -> Result<T, String>
where
    T: DeserializeOwned,
{
    let endpoint = server_endpoint()?;
    let response = reqwest::blocking::get(format!("{}{}", endpoint.http_base_url(), path))
        .map_err(|error| error.to_string())?;
    parse_response(response)
}

fn post_json<T, B>(path: &str, body: &B) -> Result<T, String>
where
    T: DeserializeOwned,
    B: Serialize + ?Sized,
{
    let endpoint = server_endpoint()?;
    let client = reqwest::blocking::Client::new();
    let response = client
        .post(format!("{}{}", endpoint.http_base_url(), path))
        .json(body)
        .send()
        .map_err(|error| error.to_string())?;
    parse_response(response)
}

fn parse_response<T>(response: reqwest::blocking::Response) -> Result<T, String>
where
    T: DeserializeOwned,
{
    let status = response.status();
    let text = response.text().map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format!("server returned {status}: {text}"));
    }
    serde_json::from_str(&text).map_err(|error| format!("invalid server response: {error}"))
}

fn set_event_log(shared: &Arc<Mutex<ReceiverInner>>, message: String) -> Result<(), String> {
    let mut inner = shared.lock().map_err(|error| error.to_string())?;
    inner.event_log = message;
    Ok(())
}

fn update_stream_log(shared: &Arc<Mutex<ReceiverInner>>, message: String) {
    if let Ok(mut inner) = shared.lock() {
        inner.event_log = message;
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

fn format_bucket_rate_hz(buckets: &VecDeque<FrameRateBucket>) -> String {
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
            list_serial_ports,
            connect_bus,
            disconnect_bus,
            disconnect_all,
            clear_latest,
            start_local_server,
            latest_snapshot,
        ])
        .run(tauri::generate_context!())
    {
        eprintln!("failed to run CANRush desktop app: {error}");
        std::process::exit(1);
    }
}
