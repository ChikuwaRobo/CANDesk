use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::model::CanFrame;

pub const API_PROTOCOL_VERSION: &str = "canrush.v1";
pub const DEFAULT_SESSION_ID: &str = "default";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServerStatusDto {
    pub protocol_version: String,
    pub server_name: String,
    pub started_at_unix_ms: String,
    pub read_only: bool,
}

impl ServerStatusDto {
    pub fn new(server_name: impl Into<String>, started_at: SystemTime, read_only: bool) -> Self {
        Self {
            protocol_version: API_PROTOCOL_VERSION.to_string(),
            server_name: server_name.into(),
            started_at_unix_ms: system_time_unix_ms_string(started_at),
            read_only,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServerIdentityDto {
    pub server_name: String,
    pub protocol_version: String,
    pub auth_required: bool,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BusStatusDto {
    pub bus: String,
    pub adapter: String,
    pub status: String,
    pub frames: u64,
    pub errors: u64,
    pub port: Option<String>,
    pub bitrate: Option<String>,
    pub data_bitrate: Option<String>,
    pub listen_only: bool,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConnectBusRequest {
    pub adapter: String,
    pub port: Option<String>,
    pub baud: Option<u32>,
    pub bitrate: Option<String>,
    pub data_bitrate: Option<String>,
    pub listen_only: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServerDiagnosticsDto {
    pub diagnostics: Vec<DiagnosticEventDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StreamHelloDto {
    pub event: String,
    pub protocol_version: String,
    pub server_name: String,
    pub session_id: String,
    pub queue_capacity: usize,
}

impl StreamHelloDto {
    pub fn new(
        server_name: impl Into<String>,
        session_id: impl Into<String>,
        queue_capacity: usize,
    ) -> Self {
        Self {
            event: "hello".to_string(),
            protocol_version: API_PROTOCOL_VERSION.to_string(),
            server_name: server_name.into(),
            session_id: session_id.into(),
            queue_capacity,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FrameEventDto {
    pub event: String,
    pub sequence: u64,
    pub timestamp_host_unix_ns: String,
    pub bus: String,
    pub direction: String,
    pub id: String,
    pub id_format: String,
    pub frame_format: String,
    pub frame_type: String,
    pub dlc: u8,
    pub data_length: usize,
    pub flags: String,
    pub data_hex: String,
}

impl FrameEventDto {
    pub fn from_frame(sequence: u64, frame: &CanFrame) -> Self {
        Self {
            event: "frame".to_string(),
            sequence,
            timestamp_host_unix_ns: system_time_unix_ns_string(frame.timestamp_host),
            bus: frame.bus.clone(),
            direction: frame.direction.as_str().to_string(),
            id: format!("0x{:X}", frame.id),
            id_format: frame.id_format.as_str().to_string(),
            frame_format: frame.frame_format.as_str().to_string(),
            frame_type: frame.frame_type.as_str().to_string(),
            dlc: frame.dlc,
            data_length: frame.data_length,
            flags: frame.flags_string(),
            data_hex: frame.data_hex(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StatsEventDto {
    pub event: String,
    pub sequence: u64,
    pub bus: String,
    pub rate_hz: f64,
    pub utilization_percent: f64,
    pub saturated_last_1s_ms: f64,
    pub saturated_worst_1s_ms: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiagnosticEventDto {
    pub event: String,
    pub severity: String,
    pub code: String,
    pub message: String,
    pub bus: Option<String>,
    pub dropped_count: u64,
}

impl DiagnosticEventDto {
    pub fn new(
        severity: impl Into<String>,
        code: impl Into<String>,
        message: impl Into<String>,
        bus: Option<String>,
        dropped_count: u64,
    ) -> Self {
        Self {
            event: "diagnostic".to_string(),
            severity: severity.into(),
            code: code.into(),
            message: message.into(),
            bus,
            dropped_count,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClosedEventDto {
    pub event: String,
    pub reason: String,
    pub message: String,
}

pub fn system_time_unix_ns_string(time: SystemTime) -> String {
    match time.duration_since(UNIX_EPOCH) {
        Ok(duration) => {
            let nanos = u128::from(duration.as_secs()) * 1_000_000_000
                + u128::from(duration.subsec_nanos());
            nanos.to_string()
        }
        Err(_) => "0".to_string(),
    }
}

pub fn system_time_unix_ms_string(time: SystemTime) -> String {
    match time.duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis().to_string(),
        Err(_) => "0".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{FrameFormat, FrameType, IdFormat};
    use std::time::Duration;

    #[test]
    fn serializes_hello_event_contract() {
        let hello = StreamHelloDto::new("canrush-test", DEFAULT_SESSION_ID, 8192);
        let json = serde_json::to_string(&hello).unwrap();
        assert_eq!(
            json,
            r#"{"event":"hello","protocol_version":"canrush.v1","server_name":"canrush-test","session_id":"default","queue_capacity":8192}"#
        );
    }

    #[test]
    fn serializes_frame_event_contract() {
        let mut frame = CanFrame::new_rx(
            "CAN0",
            "fake",
            0x123,
            IdFormat::Standard,
            FrameFormat::Classic,
            FrameType::Data,
            2,
            vec![0x00, 0xFF],
        )
        .unwrap();
        frame.timestamp_host = UNIX_EPOCH + Duration::from_nanos(1_700_000_000_123_456_700);

        let event = FrameEventDto::from_frame(42, &frame);
        let json = serde_json::to_string(&event).unwrap();

        assert_eq!(
            json,
            r#"{"event":"frame","sequence":42,"timestamp_host_unix_ns":"1700000000123456700","bus":"CAN0","direction":"rx","id":"0x123","id_format":"standard","frame_format":"classic","frame_type":"data","dlc":2,"data_length":2,"flags":"","data_hex":"00FF"}"#
        );
    }

    #[test]
    fn serializes_diagnostic_event_contract() {
        let diagnostic = DiagnosticEventDto::new(
            "warn",
            "queue-overflow",
            "subscriber queue overflow",
            None,
            3,
        );
        let json = serde_json::to_string(&diagnostic).unwrap();
        assert_eq!(
            json,
            r#"{"event":"diagnostic","severity":"warn","code":"queue-overflow","message":"subscriber queue overflow","bus":null,"dropped_count":3}"#
        );
    }
}
