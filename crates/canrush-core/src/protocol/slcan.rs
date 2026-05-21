use crate::error::{CanrushError, Result};
use crate::model::{data_length_from_dlc, CanFrame, FrameFormat, FrameType, IdFormat};

pub const ADAPTER_NAME: &str = "slcan";

pub fn parse_line(line: &str, bus: &str) -> Result<CanFrame> {
    parse_classic_line(line, bus, ADAPTER_NAME)
}

pub(crate) fn parse_classic_line(line: &str, bus: &str, adapter: &str) -> Result<CanFrame> {
    let raw = line.trim_end_matches('\r');
    let mut chars = raw.chars();
    let header = chars
        .next()
        .ok_or_else(|| CanrushError::InvalidFrame("empty line".to_string()))?;
    let body = chars.as_str();

    let (id_format, frame_type, id_digits) = match header {
        't' => (IdFormat::Standard, FrameType::Data, 3),
        'T' => (IdFormat::Extended, FrameType::Data, 8),
        'r' => (IdFormat::Standard, FrameType::Remote, 3),
        'R' => (IdFormat::Extended, FrameType::Remote, 8),
        _ => {
            return Err(CanrushError::InvalidFrame(format!(
                "unsupported slcan frame header: {header}"
            )));
        }
    };

    if body.len() < id_digits + 1 {
        return Err(CanrushError::InvalidFrame(format!("line too short: {raw}")));
    }

    let id = parse_hex_u32(&body[..id_digits])?;
    let dlc = parse_hex_u8(&body[id_digits..id_digits + 1])?;
    let data_len = data_length_from_dlc(FrameFormat::Classic, dlc)?;
    let base_len = id_digits
        + 1
        + if frame_type == FrameType::Data {
            data_len * 2
        } else {
            0
        };
    let timestamp_device = match body.len() {
        len if len == base_len => None,
        len if len == base_len + 4 => Some(parse_hex_u32(&body[base_len..])?),
        _ => {
            return Err(CanrushError::InvalidFrame(format!(
                "line length does not match DLC: {raw}"
            )));
        }
    };

    let data = if frame_type == FrameType::Data {
        parse_data_bytes(&body[id_digits + 1..id_digits + 1 + data_len * 2])?
    } else {
        Vec::new()
    };

    let mut frame = CanFrame::new_rx(
        bus,
        adapter,
        id,
        id_format,
        FrameFormat::Classic,
        frame_type,
        dlc,
        data,
    )?;
    frame.timestamp_device = timestamp_device;
    frame.raw = Some(raw.to_string());
    Ok(frame)
}

pub fn frame_to_line(frame: &CanFrame) -> Result<String> {
    if frame.frame_format != FrameFormat::Classic {
        return Err(CanrushError::InvalidFrame(
            "standard slcan cannot encode CAN FD frames".to_string(),
        ));
    }

    let header = match (frame.id_format, frame.frame_type) {
        (IdFormat::Standard, FrameType::Data) => 't',
        (IdFormat::Extended, FrameType::Data) => 'T',
        (IdFormat::Standard, FrameType::Remote) => 'r',
        (IdFormat::Extended, FrameType::Remote) => 'R',
        (_, FrameType::Error) => {
            return Err(CanrushError::InvalidFrame(
                "error frames cannot be sent through slcan".to_string(),
            ));
        }
    };

    let id = match frame.id_format {
        IdFormat::Standard => format!("{:03X}", frame.id),
        IdFormat::Extended => format!("{:08X}", frame.id),
    };
    let data = if frame.frame_type == FrameType::Data {
        frame.data_hex()
    } else {
        String::new()
    };
    Ok(format!("{header}{id}{:X}{data}\r", frame.dlc))
}

pub(crate) fn parse_data_bytes(text: &str) -> Result<Vec<u8>> {
    if !text.len().is_multiple_of(2) {
        return Err(CanrushError::InvalidFrame(format!(
            "hex data must have even length: {text}"
        )));
    }
    text.as_bytes()
        .chunks(2)
        .map(|chunk| {
            let part = std::str::from_utf8(chunk)
                .map_err(|_| CanrushError::InvalidFrame("data is not UTF-8".to_string()))?;
            parse_hex_u8(part)
        })
        .collect()
}

pub(crate) fn parse_hex_u8(text: &str) -> Result<u8> {
    u8::from_str_radix(text, 16)
        .map_err(|_| CanrushError::InvalidFrame(format!("invalid hex byte: {text}")))
}

pub(crate) fn parse_hex_u32(text: &str) -> Result<u32> {
    u32::from_str_radix(text, 16)
        .map_err(|_| CanrushError::InvalidFrame(format!("invalid hex integer: {text}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Direction, FrameType};

    #[test]
    fn parses_standard_data_frame() {
        let frame = parse_line("t10021133\r", "CAN0").unwrap();
        assert_eq!(frame.bus, "CAN0");
        assert_eq!(frame.direction, Direction::Rx);
        assert_eq!(frame.id, 0x100);
        assert_eq!(frame.dlc, 2);
        assert_eq!(frame.data, vec![0x11, 0x33]);
    }

    #[test]
    fn parses_extended_data_frame() {
        let frame = parse_line("T0000010021133\r", "CAN0").unwrap();
        assert_eq!(frame.id_format, IdFormat::Extended);
        assert_eq!(frame.id, 0x100);
    }

    #[test]
    fn parses_remote_frame() {
        let frame = parse_line("r1002\r", "CAN0").unwrap();
        assert_eq!(frame.frame_type, FrameType::Remote);
        assert!(frame.data.is_empty());
    }

    #[test]
    fn parses_timestamp_suffix() {
        let frame = parse_line("t100211334D67\r", "CAN0").unwrap();
        assert_eq!(frame.timestamp_device, Some(0x4D67));
    }

    #[test]
    fn rejects_bad_length() {
        assert!(parse_line("t100211\r", "CAN0").is_err());
    }

    #[test]
    fn encodes_classic_frame() {
        let frame = parse_line("t10021133\r", "CAN0").unwrap();
        assert_eq!(frame_to_line(&frame).unwrap(), "t10021133\r");
    }
}
