use crate::error::{CanrushError, Result};
use crate::model::{data_length_from_dlc, CanFrame, FrameFormat, FrameType, IdFormat};
use crate::protocol::slcan::{
    frame_to_line as classic_frame_to_line, parse_classic_line, parse_data_bytes, parse_hex_u32,
    parse_hex_u8,
};

pub const ADAPTER_NAME: &str = "weact_slcan_fd";

pub fn parse_line(line: &str, bus: &str) -> Result<CanFrame> {
    let raw = line.trim_end_matches('\r');
    match raw.chars().next() {
        Some('t' | 'T' | 'r' | 'R') => parse_classic_line(raw, bus, ADAPTER_NAME),
        Some('d' | 'D' | 'b' | 'B') => parse_fd_line(raw, bus),
        Some(header) => Err(CanrushError::InvalidFrame(format!(
            "unsupported WeAct frame header: {header}"
        ))),
        None => Err(CanrushError::InvalidFrame("empty line".to_string())),
    }
}

fn parse_fd_line(raw: &str, bus: &str) -> Result<CanFrame> {
    let header = raw
        .chars()
        .next()
        .ok_or_else(|| CanrushError::InvalidFrame("empty line".to_string()))?;
    let body = &raw[1..];
    let (id_format, id_digits, bitrate_switch) = match header {
        'd' => (IdFormat::Standard, 3, false),
        'D' => (IdFormat::Extended, 8, false),
        'b' => (IdFormat::Standard, 3, true),
        'B' => (IdFormat::Extended, 8, true),
        _ => unreachable!("header checked by caller"),
    };
    if body.len() < id_digits + 1 {
        return Err(CanrushError::InvalidFrame(format!("line too short: {raw}")));
    }

    let id = parse_hex_u32(&body[..id_digits])?;
    let dlc = parse_hex_u8(&body[id_digits..id_digits + 1])?;
    let data_len = data_length_from_dlc(FrameFormat::Fd, dlc)?;
    let base_len = id_digits + 1 + data_len * 2;
    let timestamp_device = match body.len() {
        len if len == base_len => None,
        len if len == base_len + 4 => Some(parse_hex_u32(&body[base_len..])?),
        _ => {
            return Err(CanrushError::InvalidFrame(format!(
                "line length does not match CAN FD DLC: {raw}"
            )));
        }
    };
    let data = parse_data_bytes(&body[id_digits + 1..id_digits + 1 + data_len * 2])?;
    let mut frame = CanFrame::new_rx(
        bus,
        ADAPTER_NAME,
        id,
        id_format,
        FrameFormat::Fd,
        FrameType::Data,
        dlc,
        data,
    )?;
    frame.bitrate_switch = bitrate_switch;
    frame.timestamp_device = timestamp_device;
    frame.raw = Some(raw.to_string());
    Ok(frame)
}

pub fn frame_to_line(frame: &CanFrame) -> Result<String> {
    match frame.frame_format {
        FrameFormat::Classic => classic_frame_to_line(frame),
        FrameFormat::Fd => {
            if frame.frame_type != FrameType::Data {
                return Err(CanrushError::InvalidFrame(
                    "CAN FD supports data frames only".to_string(),
                ));
            }
            let header = match (frame.id_format, frame.bitrate_switch) {
                (IdFormat::Standard, false) => 'd',
                (IdFormat::Extended, false) => 'D',
                (IdFormat::Standard, true) => 'b',
                (IdFormat::Extended, true) => 'B',
            };
            let id = match frame.id_format {
                IdFormat::Standard => format!("{:03X}", frame.id),
                IdFormat::Extended => format!("{:08X}", frame.id),
            };
            Ok(format!("{header}{id}{:X}{}\r", frame.dlc, frame.data_hex()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::FrameFormat;

    #[test]
    fn parses_fd_without_brs() {
        let frame = parse_line("d1009112233445566778899AABBCC\r", "CAN0").unwrap();
        assert_eq!(frame.frame_format, FrameFormat::Fd);
        assert_eq!(frame.data_length, 12);
        assert!(!frame.bitrate_switch);
    }

    #[test]
    fn parses_fd_with_brs() {
        let frame = parse_line("b10021133\r", "CAN0").unwrap();
        assert_eq!(frame.data, vec![0x11, 0x33]);
        assert!(frame.bitrate_switch);
    }

    #[test]
    fn encodes_fd_with_brs() {
        let frame = parse_line("b10021133\r", "CAN0").unwrap();
        assert_eq!(frame_to_line(&frame).unwrap(), "b10021133\r");
    }
}
