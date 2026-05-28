use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use canrush_core::api::FrameEventDto;
use canrush_core::model::{CanFrame, Direction, FrameFormat, FrameType, IdFormat};
use serde_json::Value;
use tungstenite::Message;

use crate::server_client::server_endpoint;
use crate::state::{ReceiverInner, StreamRuntime};
use crate::SERVER_SESSION;

pub(crate) fn ensure_stream_worker(shared: &Arc<Mutex<ReceiverInner>>) -> Result<(), String> {
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

fn update_stream_log(shared: &Arc<Mutex<ReceiverInner>>, message: String) {
    if let Ok(mut inner) = shared.lock() {
        inner.event_log = message;
    }
}
