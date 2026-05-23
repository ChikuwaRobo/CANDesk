#![cfg_attr(test, allow(clippy::unwrap_used))]

use std::net::SocketAddr;
use std::time::SystemTime;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use canrush_core::adapter::{FakeAdapter, FrameSource};
use canrush_core::api::{FrameEventDto, ServerStatusDto, StreamHelloDto, DEFAULT_SESSION_ID};
use canrush_core::capture::CanIdFilter;
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
}

fn app(state: AppState) -> Router {
    Router::new()
        .route("/api/v1/status", get(status))
        .route("/api/v1/sessions/default/stream", get(stream))
        .with_state(state)
}

async fn status(State(state): State<AppState>) -> Json<ServerStatusDto> {
    Json(server_status(&state))
}

fn server_status(state: &AppState) -> ServerStatusDto {
    ServerStatusDto::new(&state.server_name, state.started_at, state.read_only)
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
    let queue_capacity = match query.kind.as_deref() {
        Some("gui") => 256,
        Some("plot") => 2048,
        _ => 8192,
    };
    let hello = StreamHelloDto::new(&state.server_name, DEFAULT_SESSION_ID, queue_capacity);
    if send_json(&mut socket, &hello).await.is_err() {
        return;
    }

    let id_filters = match parse_stream_id_filters(&query.ids, &query.id_ranges) {
        Ok(filters) => filters,
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

    let mut adapter = match FakeAdapter::sample() {
        Ok(adapter) => adapter,
        Err(error) => {
            let diagnostic = canrush_core::api::DiagnosticEventDto::new(
                "error",
                "fake-adapter",
                error.to_string(),
                query.bus,
                0,
            );
            let _ = send_json(&mut socket, &diagnostic).await;
            return;
        }
    };

    let mut sequence = 0_u64;
    loop {
        match adapter.next_frame() {
            Ok(Some(frame)) => {
                let bus_matches = query.bus.as_ref().is_none_or(|bus| frame.bus == *bus);
                let id_matches = id_filters.is_empty()
                    || id_filters.iter().any(|filter| filter.matches(frame.id));
                if bus_matches && id_matches {
                    let event = FrameEventDto::from_frame(sequence, &frame);
                    if send_json(&mut socket, &event).await.is_err() {
                        return;
                    }
                    sequence += 1;
                }
            }
            Ok(None) => break,
            Err(error) => {
                let diagnostic = canrush_core::api::DiagnosticEventDto::new(
                    "error",
                    "stream-source",
                    error.to_string(),
                    query.bus,
                    0,
                );
                let _ = send_json(&mut socket, &diagnostic).await;
                return;
            }
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
    };
    let listener = tokio::net::TcpListener::bind(cli.listen).await?;
    println!("canrush-server listening on http://{}", cli.listen);
    axum::serve(listener, app(state))
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use canrush_core::api::API_PROTOCOL_VERSION;
    use std::time::{Duration, UNIX_EPOCH};

    #[test]
    fn builds_status_dto() {
        let state = AppState {
            server_name: "test-server".to_string(),
            started_at: UNIX_EPOCH + Duration::from_millis(1234),
            read_only: true,
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
}
