#![cfg_attr(test, allow(clippy::unwrap_used))]

use std::net::SocketAddr;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    mpsc, Arc, Mutex,
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use canrush_core::adapter::{FakeAdapter, FrameSource, WeActSerialAdapter, WeActSerialConfig};
use canrush_core::api::{
    BusStatusDto, ConnectBusRequest, DiagnosticEventDto, FrameEventDto, ServerDiagnosticsDto,
    ServerStatusDto, StreamHelloDto, DEFAULT_SESSION_ID,
};
use canrush_core::capture::CanIdFilter;
use canrush_core::server::{FrameHub, FrameSubscription, SubscribeOptions};
use clap::Parser;
use serde::Deserialize;

#[derive(Debug, Parser)]
#[command(name = "canrush-server")]
#[command(about = "CANRush headless server")]
struct Cli {
    #[arg(long, default_value = "127.0.0.1:49000")]
    listen: SocketAddr,

    #[arg(long, default_value = "canrush-server")]
    server_name: String,

    #[arg(long)]
    read_only: bool,
}

#[derive(Debug, Clone)]
struct AppState {
    server_name: String,
    started_at: SystemTime,
    read_only: bool,
    hub: Arc<Mutex<FrameHub>>,
    runtime: Arc<Mutex<ServerRuntime>>,
    diagnostics: Arc<Mutex<Vec<DiagnosticEventDto>>>,
}

#[derive(Debug, Default)]
struct ServerRuntime {
    buses: std::collections::HashMap<String, BusRuntime>,
}

#[derive(Debug)]
struct BusRuntime {
    bus: String,
    adapter: String,
    status: String,
    frames: Arc<AtomicU64>,
    errors: Arc<AtomicU64>,
    port: Option<String>,
    bitrate: Option<String>,
    data_bitrate: Option<String>,
    listen_only: bool,
    message: String,
    stop: Arc<AtomicBool>,
    worker_state: Arc<Mutex<WorkerState>>,
    handle: Option<JoinHandle<()>>,
}

#[derive(Debug)]
struct WorkerState {
    status: String,
    message: String,
}

fn app(state: AppState) -> Router {
    Router::new()
        .route("/api/v1/status", get(status))
        .route("/api/v1/sessions/default/buses", get(buses))
        .route(
            "/api/v1/sessions/default/buses/{bus}/connect",
            post(connect_bus),
        )
        .route(
            "/api/v1/sessions/default/buses/{bus}/disconnect",
            post(disconnect_bus),
        )
        .route("/api/v1/sessions/default/diagnostics", get(diagnostics))
        .route("/api/v1/sessions/default/stream", get(stream))
        .with_state(state)
}

async fn status(State(state): State<AppState>) -> Json<ServerStatusDto> {
    Json(server_status(&state))
}

fn server_status(state: &AppState) -> ServerStatusDto {
    ServerStatusDto::new(&state.server_name, state.started_at, state.read_only)
}

async fn buses(State(state): State<AppState>) -> Result<Json<Vec<BusStatusDto>>, StatusCode> {
    let runtime = state
        .runtime
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(
        runtime.buses.values().map(BusRuntime::status_dto).collect(),
    ))
}

async fn diagnostics(
    State(state): State<AppState>,
) -> Result<Json<ServerDiagnosticsDto>, StatusCode> {
    let diagnostics = state
        .diagnostics
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(ServerDiagnosticsDto {
        diagnostics: diagnostics.clone(),
    }))
}

async fn connect_bus(
    State(state): State<AppState>,
    Path(bus): Path<String>,
    Json(request): Json<ConnectBusRequest>,
) -> Result<Json<BusStatusDto>, (StatusCode, String)> {
    let status = connect_bus_runtime(&state, bus, request)?;
    Ok(Json(status))
}

async fn disconnect_bus(
    State(state): State<AppState>,
    Path(bus): Path<String>,
) -> Result<Json<BusStatusDto>, (StatusCode, String)> {
    let status = disconnect_bus_runtime(&state, &bus)?;
    Ok(Json(status))
}

fn connect_bus_runtime(
    state: &AppState,
    bus: String,
    request: ConnectBusRequest,
) -> Result<BusStatusDto, (StatusCode, String)> {
    if bus.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "bus is required".to_string()));
    }
    let _ = disconnect_bus_runtime(state, &bus);

    let adapter = request.adapter.to_ascii_lowercase();
    let frames = Arc::new(AtomicU64::new(0));
    let errors = Arc::new(AtomicU64::new(0));
    let stop = Arc::new(AtomicBool::new(false));
    let worker_state = Arc::new(Mutex::new(WorkerState {
        status: "connected".to_string(),
        message: "receiving".to_string(),
    }));
    let worker = WorkerContext {
        hub: Arc::clone(&state.hub),
        diagnostics: Arc::clone(&state.diagnostics),
        bus: bus.clone(),
        frames: Arc::clone(&frames),
        errors: Arc::clone(&errors),
        stop: Arc::clone(&stop),
        worker_state: Arc::clone(&worker_state),
    };
    let handle = match adapter.as_str() {
        "fake" => spawn_fake_bus_worker(worker).map_err(|message| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to start fake worker: {message}"),
            )
        })?,
        "weact" => spawn_weact_bus_worker(worker, &request).map_err(|message| {
            (
                StatusCode::BAD_REQUEST,
                format!("failed to start weact worker: {message}"),
            )
        })?,
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("unsupported adapter: {}", request.adapter),
            ))
        }
    };

    let runtime = BusRuntime {
        bus: bus.clone(),
        adapter,
        status: "connected".to_string(),
        frames,
        errors,
        port: request.port,
        bitrate: request.bitrate,
        data_bitrate: request.data_bitrate,
        listen_only: request.listen_only,
        message: "connected".to_string(),
        stop,
        worker_state,
        handle: Some(handle),
    };
    let status = runtime.status_dto();
    let mut server = state.runtime.lock().map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime lock failed".to_string(),
        )
    })?;
    server.buses.insert(bus, runtime);
    push_diagnostic(
        &state.diagnostics,
        DiagnosticEventDto::new(
            "info",
            "bus-connected",
            "bus connected",
            Some(status.bus.clone()),
            0,
        ),
    );
    Ok(status)
}

fn disconnect_bus_runtime(
    state: &AppState,
    bus: &str,
) -> Result<BusStatusDto, (StatusCode, String)> {
    let runtime = state
        .runtime
        .lock()
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "runtime lock failed".to_string(),
            )
        })?
        .buses
        .remove(bus);
    let Some(mut runtime) = runtime else {
        return Ok(BusStatusDto {
            bus: bus.to_string(),
            adapter: "-".to_string(),
            status: "disconnected".to_string(),
            frames: 0,
            errors: 0,
            port: None,
            bitrate: None,
            data_bitrate: None,
            listen_only: false,
            message: "not connected".to_string(),
        });
    };
    runtime.stop.store(true, Ordering::Relaxed);
    if let Some(handle) = runtime.handle.take() {
        let _ = handle.join();
    }
    runtime.status = "disconnected".to_string();
    runtime.message = "disconnected".to_string();
    push_diagnostic(
        &state.diagnostics,
        DiagnosticEventDto::new(
            "info",
            "bus-disconnected",
            "bus disconnected",
            Some(runtime.bus.clone()),
            0,
        ),
    );
    Ok(runtime.status_dto())
}

impl BusRuntime {
    fn status_dto(&self) -> BusStatusDto {
        let (mut status, mut message) = self
            .worker_state
            .lock()
            .map(|state| (state.status.clone(), state.message.clone()))
            .unwrap_or_else(|_| ("error".to_string(), "worker state lock failed".to_string()));
        if self.status != "disconnected"
            && status == "connected"
            && self.handle.as_ref().is_some_and(JoinHandle::is_finished)
        {
            status = "error".to_string();
            message = "receive worker stopped unexpectedly".to_string();
        }
        BusStatusDto {
            bus: self.bus.clone(),
            adapter: self.adapter.clone(),
            status: if self.status == "disconnected" {
                self.status.clone()
            } else {
                status
            },
            frames: self.frames.load(Ordering::Relaxed),
            errors: self.errors.load(Ordering::Relaxed),
            port: self.port.clone(),
            bitrate: self.bitrate.clone(),
            data_bitrate: self.data_bitrate.clone(),
            listen_only: self.listen_only,
            message: if self.status == "disconnected" {
                self.message.clone()
            } else {
                message
            },
        }
    }
}

#[derive(Debug, Deserialize)]
struct StreamQuery {
    kind: Option<String>,
    bus: Option<String>,
    #[serde(default, rename = "id")]
    ids: Vec<String>,
    #[serde(default, rename = "id_range")]
    id_ranges: Vec<String>,
}

async fn stream(
    State(state): State<AppState>,
    Query(query): Query<StreamQuery>,
    websocket: WebSocketUpgrade,
) -> axum::response::Response {
    websocket.on_upgrade(move |socket| handle_stream(socket, state, query))
}

async fn handle_stream(mut socket: WebSocket, state: AppState, query: StreamQuery) {
    let options = match subscribe_options_from_query(&query) {
        Ok(options) => options,
        Err(message) => {
            let diagnostic = canrush_core::api::DiagnosticEventDto::new(
                "error",
                "invalid-filter",
                message,
                query.bus,
                0,
            );
            let _ = send_json(&mut socket, &diagnostic).await;
            return;
        }
    };
    let queue_capacity = options.queue_capacity;
    let hello = StreamHelloDto::new(&state.server_name, DEFAULT_SESSION_ID, queue_capacity);
    if send_json(&mut socket, &hello).await.is_err() {
        return;
    }

    let subscription = match subscribe_to_hub(&state.hub, options) {
        Ok(subscription) => subscription,
        Err(message) => {
            let diagnostic = canrush_core::api::DiagnosticEventDto::new(
                "error", "hub-lock", message, query.bus, 0,
            );
            let _ = send_json(&mut socket, &diagnostic).await;
            return;
        }
    };
    let subscription_id = subscription.id();
    let mut reported_dropped_count = 0;

    loop {
        let dropped_count = state
            .hub
            .lock()
            .ok()
            .and_then(|hub| hub.subscriber_stats(subscription_id))
            .map(|stats| stats.dropped_count)
            .unwrap_or(reported_dropped_count);
        if dropped_count > reported_dropped_count {
            let diagnostic = DiagnosticEventDto::new(
                "error",
                "subscriber-queue-overflow",
                "subscriber queue overflow; frames were dropped",
                query.bus.clone(),
                dropped_count,
            );
            push_diagnostic(&state.diagnostics, diagnostic.clone());
            if send_json(&mut socket, &diagnostic).await.is_err() {
                break;
            }
            reported_dropped_count = dropped_count;
        }

        let mut sent = 0;
        while let Some(event) = subscription.try_recv() {
            let dto = FrameEventDto::from_frame(event.sequence, &event.frame);
            if send_json(&mut socket, &dto).await.is_err() {
                if let Ok(mut hub) = state.hub.lock() {
                    let _ = hub.unsubscribe(subscription_id);
                }
                return;
            }
            sent += 1;
            if sent >= queue_capacity {
                break;
            }
        }
        if sent == 0 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    if let Ok(mut hub) = state.hub.lock() {
        let _ = hub.unsubscribe(subscription_id);
    }
}

fn subscribe_to_hub(
    hub: &Arc<Mutex<FrameHub>>,
    options: SubscribeOptions,
) -> Result<FrameSubscription, String> {
    let mut hub = hub.lock().map_err(|error| error.to_string())?;
    Ok(hub.subscribe(options))
}

fn subscribe_options_from_query(query: &StreamQuery) -> Result<SubscribeOptions, String> {
    let id_filters = parse_stream_id_filters(&query.ids, &query.id_ranges)?;
    let mut options = match query.kind.as_deref() {
        Some("gui") => SubscribeOptions::gui(),
        Some("plot") => SubscribeOptions::plot(),
        _ => SubscribeOptions::capture(),
    };
    options.bus = query.bus.clone();
    options.id_filters = id_filters;
    Ok(options)
}

#[derive(Clone)]
struct WorkerContext {
    hub: Arc<Mutex<FrameHub>>,
    diagnostics: Arc<Mutex<Vec<DiagnosticEventDto>>>,
    bus: String,
    frames: Arc<AtomicU64>,
    errors: Arc<AtomicU64>,
    stop: Arc<AtomicBool>,
    worker_state: Arc<Mutex<WorkerState>>,
}

fn spawn_fake_bus_worker(context: WorkerContext) -> Result<JoinHandle<()>, String> {
    let frames = collect_fake_frames()?;
    Ok(thread::spawn(move || {
        while !context.stop.load(Ordering::Relaxed) {
            for frame in &frames {
                if context.stop.load(Ordering::Relaxed) {
                    break;
                }
                let mut frame = frame.clone();
                frame.bus = context.bus.clone();
                frame.timestamp_host = SystemTime::now();
                if let Ok(mut hub) = context.hub.lock() {
                    hub.publish(frame);
                    context.frames.fetch_add(1, Ordering::Relaxed);
                } else {
                    context.errors.fetch_add(1, Ordering::Relaxed);
                    set_worker_error(&context.worker_state, "frame hub lock failed");
                    push_diagnostic(
                        &context.diagnostics,
                        DiagnosticEventDto::new(
                            "error",
                            "hub-lock",
                            "failed to lock frame hub",
                            Some(context.bus.clone()),
                            0,
                        ),
                    );
                    return;
                }
                thread::sleep(Duration::from_millis(20));
            }
        }
    }))
}

fn spawn_weact_bus_worker(
    context: WorkerContext,
    request: &ConnectBusRequest,
) -> Result<JoinHandle<()>, String> {
    let port_name = request
        .port
        .clone()
        .ok_or_else(|| "port is required for weact adapter".to_string())?;
    let config = WeActSerialConfig {
        port_name,
        baud_rate: request.baud.unwrap_or(1_000_000),
        bus: context.bus.clone(),
        nominal_bitrate: request.bitrate.clone().unwrap_or_else(|| "S4".to_string()),
        data_bitrate: request
            .data_bitrate
            .clone()
            .or_else(|| Some("Y2".to_string())),
        listen_only: request.listen_only,
        timeout: Duration::from_millis(200),
    };
    let (startup_sender, startup_receiver) = mpsc::sync_channel(1);
    let handle = thread::spawn(move || {
        let mut adapter = match WeActSerialAdapter::connect(config) {
            Ok(adapter) => {
                let _ = startup_sender.send(Ok(()));
                adapter
            }
            Err(error) => {
                let message = error.to_string();
                let _ = startup_sender.send(Err(message.clone()));
                context.errors.fetch_add(1, Ordering::Relaxed);
                push_diagnostic(
                    &context.diagnostics,
                    DiagnosticEventDto::new(
                        "error",
                        "weact-connect",
                        message,
                        Some(context.bus.clone()),
                        0,
                    ),
                );
                return;
            }
        };
        while !context.stop.load(Ordering::Relaxed) {
            match adapter.next_frame() {
                Ok(Some(mut frame)) => {
                    frame.timestamp_host = SystemTime::now();
                    if let Ok(mut hub) = context.hub.lock() {
                        hub.publish(frame);
                        context.frames.fetch_add(1, Ordering::Relaxed);
                    } else {
                        context.errors.fetch_add(1, Ordering::Relaxed);
                        push_diagnostic(
                            &context.diagnostics,
                            DiagnosticEventDto::new(
                                "error",
                                "hub-lock",
                                "failed to lock frame hub",
                                Some(context.bus.clone()),
                                0,
                            ),
                        );
                    }
                }
                Ok(None) => {}
                Err(_) => {
                    context.errors.fetch_add(1, Ordering::Relaxed);
                    set_worker_error(&context.worker_state, "weact receive error");
                    push_diagnostic(
                        &context.diagnostics,
                        DiagnosticEventDto::new(
                            "error",
                            "weact-receive",
                            "weact receive error",
                            Some(context.bus.clone()),
                            0,
                        ),
                    );
                    break;
                }
            }
        }
    });
    match startup_receiver.recv_timeout(Duration::from_secs(3)) {
        Ok(Ok(())) => Ok(handle),
        Ok(Err(message)) => {
            let _ = handle.join();
            Err(message)
        }
        Err(error) => {
            let _ = handle.join();
            Err(format!("timeout waiting for weact startup: {error}"))
        }
    }
}

fn set_worker_error(worker_state: &Arc<Mutex<WorkerState>>, message: impl Into<String>) {
    if let Ok(mut state) = worker_state.lock() {
        state.status = "error".to_string();
        state.message = message.into();
    }
}

fn push_diagnostic(
    diagnostics: &Arc<Mutex<Vec<DiagnosticEventDto>>>,
    diagnostic: DiagnosticEventDto,
) {
    if let Ok(mut diagnostics) = diagnostics.lock() {
        diagnostics.push(diagnostic);
    }
}

fn collect_fake_frames() -> Result<Vec<canrush_core::model::CanFrame>, String> {
    let mut adapter = FakeAdapter::sample().map_err(|error| error.to_string())?;
    let mut frames = Vec::new();
    loop {
        match adapter.next_frame() {
            Ok(Some(frame)) => frames.push(frame),
            Ok(None) => return Ok(frames),
            Err(error) => return Err(error.to_string()),
        }
    }
}

async fn send_json<T: serde::Serialize>(
    socket: &mut WebSocket,
    value: &T,
) -> Result<(), axum::Error> {
    let payload = serde_json::to_string(value).map_err(|error| {
        axum::Error::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error))
    })?;
    socket.send(Message::Text(payload.into())).await
}

fn parse_stream_id_filters(ids: &[String], ranges: &[String]) -> Result<Vec<CanIdFilter>, String> {
    let mut filters = Vec::with_capacity(ids.len() + ranges.len());
    for id in ids {
        filters.push(CanIdFilter::Exact(parse_can_id(id)?));
    }
    for range in ranges {
        let (start, end) = range
            .split_once('-')
            .ok_or_else(|| format!("invalid CAN ID range: {range}"))?;
        let start = parse_can_id(start)?;
        let end = parse_can_id(end)?;
        if start > end {
            return Err(format!("CAN ID range start must be <= end: {range}"));
        }
        filters.push(CanIdFilter::Range { start, end });
    }
    Ok(filters)
}

fn parse_can_id(value: &str) -> Result<u32, String> {
    let trimmed = value.trim();
    let hex = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
        .unwrap_or(trimmed);
    u32::from_str_radix(hex, 16).map_err(|_| format!("invalid CAN ID: {value}"))
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    let state = AppState {
        server_name: cli.server_name,
        started_at: SystemTime::now(),
        read_only: cli.read_only,
        hub: Arc::new(Mutex::new(FrameHub::default())),
        runtime: Arc::new(Mutex::new(ServerRuntime::default())),
        diagnostics: Arc::new(Mutex::new(Vec::new())),
    };
    let listener = tokio::net::TcpListener::bind(cli.listen).await?;
    println!("canrush-server listening on http://{}", cli.listen);
    axum::serve(listener, app(state.clone()))
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    stop_all_workers(&state);
    Ok(())
}

fn stop_all_workers(state: &AppState) {
    let runtimes = state
        .runtime
        .lock()
        .ok()
        .map(|mut runtime| {
            runtime
                .buses
                .drain()
                .map(|(_, bus)| bus)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    for mut runtime in runtimes {
        runtime.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = runtime.handle.take() {
            let _ = handle.join();
        }
    }
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use canrush_core::api::API_PROTOCOL_VERSION;
    use canrush_core::server::SubscriberKind;
    use std::time::{Duration, UNIX_EPOCH};

    #[test]
    fn builds_status_dto() {
        let state = AppState {
            server_name: "test-server".to_string(),
            started_at: UNIX_EPOCH + Duration::from_millis(1234),
            read_only: true,
            hub: Arc::new(Mutex::new(FrameHub::default())),
            runtime: Arc::new(Mutex::new(ServerRuntime::default())),
            diagnostics: Arc::new(Mutex::new(Vec::new())),
        };

        let status = server_status(&state);

        assert_eq!(status.protocol_version, API_PROTOCOL_VERSION);
        assert_eq!(status.server_name, "test-server");
        assert_eq!(status.started_at_unix_ms, "1234");
        assert!(status.read_only);
    }

    #[test]
    fn parses_stream_filters() {
        let filters =
            parse_stream_id_filters(&["100".to_string()], &["0x200-0x20F".to_string()]).unwrap();

        assert_eq!(filters.len(), 2);
        assert!(filters.iter().any(|filter| filter.matches(0x100)));
        assert!(filters.iter().any(|filter| filter.matches(0x208)));
        assert!(!filters.iter().any(|filter| filter.matches(0x210)));
    }

    #[test]
    fn builds_subscribe_options_from_query() {
        let query = StreamQuery {
            kind: Some("gui".to_string()),
            bus: Some("CAN0".to_string()),
            ids: vec!["100".to_string()],
            id_ranges: Vec::new(),
        };

        let options = subscribe_options_from_query(&query).unwrap();

        assert_eq!(options.kind, SubscriberKind::Gui);
        assert_eq!(options.queue_capacity, 16_384);
        assert_eq!(options.bus.as_deref(), Some("CAN0"));
        assert!(options
            .id_filters
            .iter()
            .any(|filter| filter.matches(0x100)));
    }

    #[test]
    fn collect_fake_frames_for_worker() {
        let frames = collect_fake_frames().unwrap();
        assert_eq!(frames.len(), 3);
        assert!(frames.iter().any(|frame| frame.id == 0x100));
    }
}
