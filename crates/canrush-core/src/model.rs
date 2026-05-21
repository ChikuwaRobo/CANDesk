use std::fmt;
use std::time::SystemTime;

use crate::error::{CanrushError, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Direction {
    Rx,
    Tx,
}

impl Direction {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Rx => "rx",
            Self::Tx => "tx",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum IdFormat {
    Standard,
    Extended,
}

impl IdFormat {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Standard => "standard",
            Self::Extended => "extended",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FrameFormat {
    Classic,
    Fd,
}

impl FrameFormat {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Classic => "classic",
            Self::Fd => "fd",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FrameType {
    Data,
    Remote,
    Error,
}

impl FrameType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Data => "data",
            Self::Remote => "remote",
            Self::Error => "error",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CanFrame {
    pub bus: String,
    pub timestamp_host: SystemTime,
    pub timestamp_device: Option<u32>,
    pub direction: Direction,
    pub id: u32,
    pub id_format: IdFormat,
    pub frame_format: FrameFormat,
    pub frame_type: FrameType,
    pub dlc: u8,
    pub data_length: usize,
    pub data: Vec<u8>,
    pub bitrate_switch: bool,
    pub error_state_indicator: bool,
    pub adapter: String,
    pub raw: Option<String>,
}

impl CanFrame {
    #[allow(clippy::too_many_arguments)]
    pub fn new_rx(
        bus: impl Into<String>,
        adapter: impl Into<String>,
        id: u32,
        id_format: IdFormat,
        frame_format: FrameFormat,
        frame_type: FrameType,
        dlc: u8,
        data: Vec<u8>,
    ) -> Result<Self> {
        validate_id(id, id_format)?;
        let expected_len = data_length_from_dlc(frame_format, dlc)?;
        if frame_type == FrameType::Data && data.len() != expected_len {
            return Err(CanrushError::InvalidFrame(format!(
                "DLC {dlc:X} expects {expected_len} bytes but got {}",
                data.len()
            )));
        }
        if frame_type == FrameType::Remote && !data.is_empty() {
            return Err(CanrushError::InvalidFrame(
                "remote frame must not have data bytes".to_string(),
            ));
        }

        Ok(Self {
            bus: bus.into(),
            timestamp_host: SystemTime::now(),
            timestamp_device: None,
            direction: Direction::Rx,
            id,
            id_format,
            frame_format,
            frame_type,
            dlc,
            data_length: expected_len,
            data,
            bitrate_switch: false,
            error_state_indicator: false,
            adapter: adapter.into(),
            raw: None,
        })
    }

    pub fn key(&self) -> FrameKey {
        FrameKey {
            bus: self.bus.clone(),
            frame_format: self.frame_format,
            id_format: self.id_format,
            id: self.id,
            frame_type: self.frame_type,
        }
    }

    pub fn data_hex(&self) -> String {
        self.data
            .iter()
            .map(|byte| format!("{byte:02X}"))
            .collect::<Vec<_>>()
            .join("")
    }

    pub fn flags_string(&self) -> String {
        let mut flags = Vec::new();
        if self.bitrate_switch {
            flags.push("brs");
        }
        if self.error_state_indicator {
            flags.push("esi");
        }
        flags.join(";")
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct FrameKey {
    pub bus: String,
    pub frame_format: FrameFormat,
    pub id_format: IdFormat,
    pub id: u32,
    pub frame_type: FrameType,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BusCapability {
    pub adapter: String,
    pub display_name: String,
    pub supports_classic_can: bool,
    pub supports_can_fd: bool,
    pub supports_bitrate_switch: bool,
    pub supports_listen_only: bool,
    pub supports_tx: bool,
    pub supports_periodic_tx: bool,
    pub supports_hardware_timestamp: bool,
    pub max_data_length: usize,
    pub supported_bitrates: Vec<String>,
    pub supported_data_bitrates: Vec<String>,
}

pub fn data_length_from_dlc(frame_format: FrameFormat, dlc: u8) -> Result<usize> {
    match frame_format {
        FrameFormat::Classic => {
            if dlc <= 8 {
                Ok(usize::from(dlc))
            } else {
                Err(CanrushError::InvalidFrame(format!(
                    "classical CAN DLC must be 0..8: {dlc:X}"
                )))
            }
        }
        FrameFormat::Fd => match dlc {
            0..=8 => Ok(usize::from(dlc)),
            9 => Ok(12),
            10 => Ok(16),
            11 => Ok(20),
            12 => Ok(24),
            13 => Ok(32),
            14 => Ok(48),
            15 => Ok(64),
            _ => Err(CanrushError::InvalidFrame(format!(
                "CAN FD DLC must be 0..F: {dlc:X}"
            ))),
        },
    }
}

pub fn dlc_from_data_length(frame_format: FrameFormat, data_length: usize) -> Result<u8> {
    match frame_format {
        FrameFormat::Classic => {
            if data_length <= 8 {
                Ok(data_length as u8)
            } else {
                Err(CanrushError::InvalidFrame(format!(
                    "classical CAN data length must be 0..8: {data_length}"
                )))
            }
        }
        FrameFormat::Fd => match data_length {
            0..=8 => Ok(data_length as u8),
            12 => Ok(9),
            16 => Ok(10),
            20 => Ok(11),
            24 => Ok(12),
            32 => Ok(13),
            48 => Ok(14),
            64 => Ok(15),
            _ => Err(CanrushError::InvalidFrame(format!(
                "unsupported CAN FD data length: {data_length}"
            ))),
        },
    }
}

pub fn validate_id(id: u32, id_format: IdFormat) -> Result<()> {
    let max = match id_format {
        IdFormat::Standard => 0x7FF,
        IdFormat::Extended => 0x1FFF_FFFF,
    };
    if id <= max {
        Ok(())
    } else {
        Err(CanrushError::InvalidFrame(format!(
            "{} CAN ID out of range: 0x{id:X}",
            id_format
        )))
    }
}

impl fmt::Display for IdFormat {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fd_dlc_maps_to_data_length() {
        let cases = [
            (0, 0),
            (8, 8),
            (9, 12),
            (10, 16),
            (11, 20),
            (12, 24),
            (13, 32),
            (14, 48),
            (15, 64),
        ];
        for (dlc, length) in cases {
            assert_eq!(data_length_from_dlc(FrameFormat::Fd, dlc).unwrap(), length);
        }
    }

    #[test]
    fn fd_data_length_maps_to_dlc() {
        assert_eq!(dlc_from_data_length(FrameFormat::Fd, 64).unwrap(), 15);
        assert!(dlc_from_data_length(FrameFormat::Fd, 10).is_err());
    }
}
