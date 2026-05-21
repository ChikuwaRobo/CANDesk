use std::io::{Read, Write};
use std::time::{Duration, Instant};

use crate::error::{CanrushError, Result};
use crate::model::{BusCapability, CanFrame};
use crate::protocol::{slcan, weact};

pub trait FrameSource {
    fn next_frame(&mut self) -> Result<Option<CanFrame>>;
}

#[derive(Debug, Clone)]
pub struct FakeAdapter {
    frames: Vec<CanFrame>,
    index: usize,
}

impl FakeAdapter {
    pub fn new(frames: Vec<CanFrame>) -> Self {
        Self { frames, index: 0 }
    }

    pub fn sample() -> Result<Self> {
        let mut classic = slcan::parse_line("t10021133\r", "CAN0")?;
        classic.raw = Some("fake:t10021133".to_string());
        let mut fd = weact::parse_line("b10121144\r", "CAN0")?;
        fd.raw = Some("fake:b10121144".to_string());
        let mut other_bus = slcan::parse_line("T000001002AABB\r", "CAN1")?;
        other_bus.raw = Some("fake:T000001002AABB".to_string());
        Ok(Self::new(vec![classic, fd, other_bus]))
    }
}

impl FrameSource for FakeAdapter {
    fn next_frame(&mut self) -> Result<Option<CanFrame>> {
        let frame = self.frames.get(self.index).cloned();
        if frame.is_some() {
            self.index += 1;
        }
        Ok(frame)
    }
}

#[derive(Debug, Clone)]
pub struct SerialDeviceInfo {
    pub port_name: String,
    pub port_type: String,
}

pub fn list_serial_devices() -> Result<Vec<SerialDeviceInfo>> {
    let ports = serialport::available_ports()?;
    Ok(ports
        .into_iter()
        .map(|port| SerialDeviceInfo {
            port_name: port.port_name,
            port_type: format!("{:?}", port.port_type),
        })
        .collect())
}

#[derive(Debug, Clone)]
pub struct WeActSerialConfig {
    pub port_name: String,
    pub baud_rate: u32,
    pub bus: String,
    pub nominal_bitrate: String,
    pub data_bitrate: Option<String>,
    pub listen_only: bool,
    pub timeout: Duration,
}

impl Default for WeActSerialConfig {
    fn default() -> Self {
        Self {
            port_name: String::new(),
            baud_rate: 1_000_000,
            bus: "CAN0".to_string(),
            nominal_bitrate: "S4".to_string(),
            data_bitrate: Some("Y2".to_string()),
            listen_only: false,
            timeout: Duration::from_millis(200),
        }
    }
}

pub struct WeActSerialAdapter {
    port: Box<dyn serialport::SerialPort>,
    bus: String,
    buffer: Vec<u8>,
}

impl WeActSerialAdapter {
    pub fn connect(config: WeActSerialConfig) -> Result<Self> {
        validate_command_code(&config.nominal_bitrate, 'S')?;
        if let Some(data_bitrate) = &config.data_bitrate {
            validate_command_code(data_bitrate, 'Y')?;
        }

        let mut port = serialport::new(&config.port_name, config.baud_rate)
            .timeout(config.timeout)
            .open()?;

        send_command(&mut *port, "C\r", config.timeout, true)?;
        send_command(&mut *port, "H0\r", config.timeout, false)?;
        send_command(
            &mut *port,
            if config.listen_only { "M1\r" } else { "M0\r" },
            config.timeout,
            false,
        )?;
        send_command(&mut *port, "A0\r", config.timeout, false)?;
        send_command(
            &mut *port,
            &format!("{}\r", config.nominal_bitrate),
            config.timeout,
            false,
        )?;
        if let Some(data_bitrate) = &config.data_bitrate {
            send_command(
                &mut *port,
                &format!("{data_bitrate}\r"),
                config.timeout,
                false,
            )?;
        }
        send_command(&mut *port, "O\r", config.timeout, false)?;

        Ok(Self {
            port,
            bus: config.bus,
            buffer: Vec::new(),
        })
    }

    pub fn capability() -> BusCapability {
        BusCapability {
            adapter: weact::ADAPTER_NAME.to_string(),
            display_name: "WeActStudio USB2CANFDV1".to_string(),
            supports_classic_can: true,
            supports_can_fd: true,
            supports_bitrate_switch: true,
            supports_listen_only: true,
            supports_tx: true,
            supports_periodic_tx: true,
            supports_hardware_timestamp: false,
            max_data_length: 64,
            supported_bitrates: ["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"]
                .iter()
                .map(|value| (*value).to_string())
                .collect(),
            supported_data_bitrates: ["Y1", "Y2", "Y3", "Y4", "Y5"]
                .iter()
                .map(|value| (*value).to_string())
                .collect(),
        }
    }
}

impl FrameSource for WeActSerialAdapter {
    fn next_frame(&mut self) -> Result<Option<CanFrame>> {
        loop {
            if let Some(frame) = try_take_frame(&mut self.buffer, &self.bus)? {
                return Ok(Some(frame));
            }

            let mut chunk = [0_u8; 256];
            match self.port.read(&mut chunk) {
                Ok(0) => return Ok(None),
                Ok(n) => self.buffer.extend_from_slice(&chunk[..n]),
                Err(error) if error.kind() == std::io::ErrorKind::TimedOut => return Ok(None),
                Err(error) => return Err(error.into()),
            }
        }
    }
}

impl Drop for WeActSerialAdapter {
    fn drop(&mut self) {
        let _ = self.port.write_all(b"C\r");
        let _ = self.port.flush();
    }
}

fn try_take_frame(buffer: &mut Vec<u8>, bus: &str) -> Result<Option<CanFrame>> {
    if let Some(bel_pos) = buffer.iter().position(|byte| *byte == 0x07) {
        buffer.drain(..=bel_pos);
        return Err(CanrushError::InvalidFrame(
            "device returned BEL while reading".to_string(),
        ));
    }

    let Some(cr_pos) = buffer.iter().position(|byte| *byte == b'\r') else {
        return Ok(None);
    };
    let line_bytes: Vec<u8> = buffer.drain(..=cr_pos).collect();
    let line = String::from_utf8(line_bytes)
        .map_err(|_| CanrushError::InvalidFrame("serial line is not UTF-8".to_string()))?;
    if line == "\r" {
        return Ok(None);
    }
    weact::parse_line(&line, bus).map(Some)
}

fn send_command(
    port: &mut dyn serialport::SerialPort,
    command: &str,
    timeout: Duration,
    allow_error: bool,
) -> Result<()> {
    port.write_all(command.as_bytes())?;
    port.flush()?;

    let deadline = Instant::now() + timeout;
    let mut byte = [0_u8; 1];
    while Instant::now() < deadline {
        match port.read(&mut byte) {
            Ok(0) => {}
            Ok(_) if byte[0] == b'\r' => return Ok(()),
            Ok(_) if byte[0] == 0x07 && allow_error => return Ok(()),
            Ok(_) if byte[0] == 0x07 => {
                return Err(CanrushError::InvalidFrame(format!(
                    "device rejected command {}",
                    command.trim_end()
                )));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::TimedOut => {}
            Err(error) => return Err(error.into()),
        }
    }

    Err(CanrushError::InvalidFrame(format!(
        "timeout waiting for command response: {}",
        command.trim_end()
    )))
}

fn validate_command_code(value: &str, expected_header: char) -> Result<()> {
    let mut chars = value.chars();
    if chars.next() != Some(expected_header) || value.len() < 2 {
        return Err(CanrushError::InvalidArgument(format!(
            "command must start with {expected_header}: {value}"
        )));
    }
    if !chars.all(|ch| ch.is_ascii_hexdigit()) {
        return Err(CanrushError::InvalidArgument(format!(
            "command contains non-hex characters: {value}"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fake_adapter_yields_sample_frames() {
        let mut adapter = FakeAdapter::sample().unwrap();
        assert!(adapter.next_frame().unwrap().is_some());
        assert!(adapter.next_frame().unwrap().is_some());
        assert!(adapter.next_frame().unwrap().is_some());
        assert!(adapter.next_frame().unwrap().is_none());
    }
}
