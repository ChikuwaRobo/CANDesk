use std::net::SocketAddr;
use std::time::SystemTime;

use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use canrush_core::api::ServerStatusDto;
use clap::Parser;

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
        .with_state(state)
}

async fn status(State(state): State<AppState>) -> Json<ServerStatusDto> {
    Json(server_status(&state))
}

fn server_status(state: &AppState) -> ServerStatusDto {
    ServerStatusDto::new(&state.server_name, state.started_at, state.read_only)
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
}
