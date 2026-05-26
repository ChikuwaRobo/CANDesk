use std::fs::File;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::Path;
use std::time::{Duration, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::capture::CSV_HEADER;
use crate::error::{CanrushError, Result};
use crate::model::{CanFrame, Direction, FrameFormat, FrameType, IdFormat};

pub const SIGNAL_CSV_HEADER: &str =
    "timestamp_host,bus,frame_id,signal_id,name,value,unit,quality,source_sequence";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ParseConfig {
    pub version: u32,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub signals: Vec<SignalDefinition>,
}

impl ParseConfig {
    pub fn example() -> Self {
        Self {
            version: 1,
            name: "example".to_string(),
            description: "example parse config".to_string(),
            signals: vec![SignalDefinition {
                id: "can0_100_u16".to_string(),
                name: "example_value".to_string(),
                selector: FrameSelector {
                    bus: Some("CAN0".to_string()),
                    id: 0x100,
                    id_format: Some(IdFormatName::Standard),
                    frame_format: Some(FrameFormatName::Classic),
                    frame_type: Some(FrameTypeName::Data),
                },
                source: SignalSource {
                    data_type: SignalDataType::UnsignedInt,
                    byte_offset: 0,
                    bit_offset: 0,
                    bit_length: 16,
                    endian: Endian::Little,
                    signed: false,
                },
                conversion: SignalConversion {
                    scale: 1.0,
                    offset: 0.0,
                    unit: "raw".to_string(),
                },
            }],
        }
    }

    pub fn validate(&self) -> Result<()> {
        if self.version == 0 {
            return Err(CanrushError::InvalidArgument(
                "parse config version must be greater than 0".to_string(),
            ));
        }
        if self.signals.is_empty() {
            return Err(CanrushError::InvalidArgument(
                "parse config must contain at least one signal".to_string(),
            ));
        }
        for signal in &self.signals {
            signal.validate()?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SignalDefinition {
    pub id: String,
    pub name: String,
    pub selector: FrameSelector,
    pub source: SignalSource,
    pub conversion: SignalConversion,
}

impl SignalDefinition {
    fn validate(&self) -> Result<()> {
        if self.id.trim().is_empty() {
            return Err(CanrushError::InvalidArgument(
                "signal id must not be empty".to_string(),
            ));
        }
        if self.name.trim().is_empty() {
            return Err(CanrushError::InvalidArgument(format!(
                "signal name must not be empty: {}",
                self.id
            )));
        }
        self.source.validate(&self.id)?;
        Ok(())
    }
}

impl SignalSource {
    fn validate(&self, signal_id: &str) -> Result<()> {
        match self.effective_data_type() {
            SignalDataType::UnsignedInt | SignalDataType::SignedInt => {
                if self.bit_length == 0 || self.bit_length > 64 {
                    return Err(CanrushError::InvalidArgument(format!(
                        "signal bit_length must be 1..64: {signal_id}"
                    )));
                }
            }
            SignalDataType::Float32 => {
                if self.bit_offset != 0 {
                    return Err(CanrushError::InvalidArgument(format!(
                        "float32 signal bit_offset must be 0: {signal_id}"
                    )));
                }
                if self.bit_length != 32 {
                    return Err(CanrushError::InvalidArgument(format!(
                        "float32 signal bit_length must be 32: {signal_id}"
                    )));
                }
            }
        }
        if self.bit_offset > 7 {
            return Err(CanrushError::InvalidArgument(format!(
                "signal bit_offset must be 0..7: {signal_id}"
            )));
        }
        Ok(())
    }

    fn effective_data_type(&self) -> SignalDataType {
        if self.signed && self.data_type == SignalDataType::UnsignedInt {
            SignalDataType::SignedInt
        } else {
            self.data_type
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FrameSelector {
    pub bus: Option<String>,
    pub id: u32,
    pub id_format: Option<IdFormatName>,
    pub frame_format: Option<FrameFormatName>,
    pub frame_type: Option<FrameTypeName>,
}

impl FrameSelector {
    fn matches(&self, frame: &CanFrame) -> bool {
        self.bus.as_ref().is_none_or(|bus| bus == &frame.bus)
            && self.id == frame.id
            && self
                .id_format
                .is_none_or(|format| format.matches(frame.id_format))
            && self
                .frame_format
                .is_none_or(|format| format.matches(frame.frame_format))
            && self
                .frame_type
                .is_none_or(|frame_type| frame_type.matches(frame.frame_type))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SignalSource {
    #[serde(default)]
    pub data_type: SignalDataType,
    pub byte_offset: usize,
    pub bit_offset: u8,
    pub bit_length: u8,
    pub endian: Endian,
    #[serde(default)]
    pub signed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum SignalDataType {
    #[default]
    UnsignedInt,
    SignedInt,
    Float32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SignalConversion {
    pub scale: f64,
    pub offset: f64,
    #[serde(default)]
    pub unit: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Endian {
    Little,
    Big,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum IdFormatName {
    Standard,
    Extended,
}

impl IdFormatName {
    fn matches(self, value: IdFormat) -> bool {
        matches!(
            (self, value),
            (Self::Standard, IdFormat::Standard) | (Self::Extended, IdFormat::Extended)
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FrameFormatName {
    Classic,
    Fd,
}

impl FrameFormatName {
    fn matches(self, value: FrameFormat) -> bool {
        matches!(
            (self, value),
            (Self::Classic, FrameFormat::Classic) | (Self::Fd, FrameFormat::Fd)
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FrameTypeName {
    Data,
    Remote,
    Error,
}

impl FrameTypeName {
    fn matches(self, value: FrameType) -> bool {
        matches!(
            (self, value),
            (Self::Data, FrameType::Data)
                | (Self::Remote, FrameType::Remote)
                | (Self::Error, FrameType::Error)
        )
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SignalSample {
    pub timestamp_host: String,
    pub bus: String,
    pub frame_id: String,
    pub signal_id: String,
    pub name: String,
    pub value: f64,
    pub unit: String,
    pub quality: SignalQuality,
    pub source_sequence: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SignalQuality {
    Ok,
    Invalid,
    ParseError,
}

impl SignalQuality {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Invalid => "invalid",
            Self::ParseError => "parse-error",
        }
    }
}

pub fn parse_frame(config: &ParseConfig, frame: &CanFrame, sequence: u64) -> Vec<SignalSample> {
    config
        .signals
        .iter()
        .filter(|signal| signal.selector.matches(frame))
        .map(|signal| signal_sample(signal, frame, sequence))
        .collect()
}

pub fn parse_frames(config: &ParseConfig, frames: &[CanFrame]) -> Vec<SignalSample> {
    frames
        .iter()
        .enumerate()
        .flat_map(|(index, frame)| parse_frame(config, frame, index as u64 + 1))
        .collect()
}

pub fn parse_capture_csv_file(
    input: impl AsRef<Path>,
    config: &ParseConfig,
) -> Result<Vec<SignalSample>> {
    let frames = read_capture_csv_file(input)?;
    Ok(parse_frames(config, &frames))
}

pub fn read_capture_csv_file(path: impl AsRef<Path>) -> Result<Vec<CanFrame>> {
    let file = File::open(path)?;
    let mut lines = BufReader::new(file).lines();
    let Some(header) = lines.next().transpose()? else {
        return Ok(Vec::new());
    };
    if header.trim_end_matches('\r') != CSV_HEADER {
        return Err(CanrushError::InvalidArgument(format!(
            "unsupported capture CSV header: {header}"
        )));
    }

    lines
        .enumerate()
        .filter_map(|(index, line)| match line {
            Ok(line) if line.trim().is_empty() => None,
            Ok(line) => Some(parse_capture_csv_line(&line, index + 2)),
            Err(error) => Some(Err(CanrushError::Io(error))),
        })
        .collect()
}

pub fn write_signal_csv_file(path: impl AsRef<Path>, samples: &[SignalSample]) -> Result<()> {
    let file = File::create(path)?;
    let mut writer = BufWriter::new(file);
    write_signal_csv(&mut writer, samples)?;
    writer.flush()?;
    Ok(())
}

pub fn write_signal_csv(writer: &mut impl Write, samples: &[SignalSample]) -> Result<()> {
    writeln!(writer, "{SIGNAL_CSV_HEADER}")?;
    for sample in samples {
        writeln!(
            writer,
            "{},{},{},{},{},{},{},{},{}",
            csv_escape(&sample.timestamp_host),
            csv_escape(&sample.bus),
            csv_escape(&sample.frame_id),
            csv_escape(&sample.signal_id),
            csv_escape(&sample.name),
            format_float(sample.value),
            csv_escape(&sample.unit),
            sample.quality.as_str(),
            sample.source_sequence
        )?;
    }
    Ok(())
}

fn signal_sample(signal: &SignalDefinition, frame: &CanFrame, sequence: u64) -> SignalSample {
    match extract_signal_value(&frame.data, &signal.source) {
        Some(raw) => SignalSample {
            timestamp_host: format_timestamp(frame),
            bus: frame.bus.clone(),
            frame_id: format!("0x{:X}", frame.id),
            signal_id: signal.id.clone(),
            name: signal.name.clone(),
            value: raw * signal.conversion.scale + signal.conversion.offset,
            unit: signal.conversion.unit.clone(),
            quality: SignalQuality::Ok,
            source_sequence: sequence,
        },
        None => SignalSample {
            timestamp_host: format_timestamp(frame),
            bus: frame.bus.clone(),
            frame_id: format!("0x{:X}", frame.id),
            signal_id: signal.id.clone(),
            name: signal.name.clone(),
            value: f64::NAN,
            unit: signal.conversion.unit.clone(),
            quality: SignalQuality::ParseError,
            source_sequence: sequence,
        },
    }
}

fn extract_signal_value(data: &[u8], source: &SignalSource) -> Option<f64> {
    match source.effective_data_type() {
        SignalDataType::UnsignedInt => extract_signal_raw(data, source).map(|raw| raw as f64),
        SignalDataType::SignedInt => {
            extract_signal_raw(data, source).map(|raw| sign_extend(raw, source.bit_length) as f64)
        }
        SignalDataType::Float32 => extract_float32(data, source),
    }
}

fn extract_signal_raw(data: &[u8], source: &SignalSource) -> Option<u64> {
    let start_bit = source.byte_offset.checked_mul(8)? + usize::from(source.bit_offset);
    let bit_length = usize::from(source.bit_length);
    if start_bit + bit_length > data.len() * 8 {
        return None;
    }
    match source.endian {
        Endian::Little => extract_little_endian(data, start_bit, bit_length),
        Endian::Big => extract_big_endian(data, start_bit, bit_length),
    }
}

fn extract_float32(data: &[u8], source: &SignalSource) -> Option<f64> {
    let end = source.byte_offset.checked_add(4)?;
    let bytes = data.get(source.byte_offset..end)?;
    let mut array = [0_u8; 4];
    array.copy_from_slice(bytes);
    let value = match source.endian {
        Endian::Little => f32::from_le_bytes(array),
        Endian::Big => f32::from_be_bytes(array),
    };
    Some(f64::from(value))
}

fn extract_little_endian(data: &[u8], start_bit: usize, bit_length: usize) -> Option<u64> {
    let mut value = 0_u64;
    for output_bit in 0..bit_length {
        let source_bit = start_bit + output_bit;
        let byte = data.get(source_bit / 8)?;
        let bit = (byte >> (source_bit % 8)) & 1;
        value |= u64::from(bit) << output_bit;
    }
    Some(value)
}

fn extract_big_endian(data: &[u8], start_bit: usize, bit_length: usize) -> Option<u64> {
    let mut value = 0_u64;
    for output_bit in 0..bit_length {
        let source_bit = start_bit + output_bit;
        let byte = data.get(source_bit / 8)?;
        let bit = (byte >> (7 - (source_bit % 8))) & 1;
        value = (value << 1) | u64::from(bit);
    }
    Some(value)
}

fn sign_extend(value: u64, bit_length: u8) -> i64 {
    if bit_length == 64 {
        return value as i64;
    }
    let sign_bit = 1_u64 << (bit_length - 1);
    if value & sign_bit == 0 {
        value as i64
    } else {
        let mask = !((1_u64 << bit_length) - 1);
        (value | mask) as i64
    }
}

fn parse_capture_csv_line(line: &str, line_number: usize) -> Result<CanFrame> {
    let columns = split_csv_line(line);
    if columns.len() != 11 {
        return Err(CanrushError::InvalidArgument(format!(
            "capture CSV line {line_number} has {} column(s), expected 11",
            columns.len()
        )));
    }
    let timestamp_host = parse_csv_timestamp(&columns[0])?;
    let direction = parse_direction(&columns[2])?;
    let id = parse_can_id(&columns[3])?;
    let id_format = parse_id_format(&columns[4])?;
    let frame_format = parse_frame_format(&columns[5])?;
    let frame_type = parse_frame_type(&columns[6])?;
    let dlc = u8::from_str_radix(&columns[7], 16)
        .map_err(|_| CanrushError::InvalidArgument(format!("invalid DLC at line {line_number}")))?;
    let data_length = columns[8].parse::<usize>().map_err(|_| {
        CanrushError::InvalidArgument(format!("invalid data length at line {line_number}"))
    })?;
    let data = parse_hex_bytes(&columns[10])?;
    let flags = columns[9]
        .split(';')
        .map(str::trim)
        .filter(|flag| !flag.is_empty())
        .collect::<Vec<_>>();

    Ok(CanFrame {
        bus: columns[1].clone(),
        timestamp_host,
        timestamp_device: None,
        direction,
        id,
        id_format,
        frame_format,
        frame_type,
        dlc,
        data_length,
        data,
        bitrate_switch: flags.iter().any(|flag| flag.eq_ignore_ascii_case("brs")),
        error_state_indicator: flags.iter().any(|flag| flag.eq_ignore_ascii_case("esi")),
        adapter: "capture-csv".to_string(),
        raw: Some(line.to_string()),
    })
}

fn split_csv_line(line: &str) -> Vec<String> {
    let mut columns = Vec::new();
    let mut current = String::new();
    let mut chars = line.chars().peekable();
    let mut quoted = false;
    while let Some(ch) = chars.next() {
        match ch {
            '"' if quoted && chars.peek() == Some(&'"') => {
                current.push('"');
                let _ = chars.next();
            }
            '"' => quoted = !quoted,
            ',' if !quoted => {
                columns.push(current);
                current = String::new();
            }
            _ => current.push(ch),
        }
    }
    columns.push(current);
    columns
}

fn parse_csv_timestamp(value: &str) -> Result<std::time::SystemTime> {
    let (seconds, millis) = value.split_once('.').unwrap_or((value, "0"));
    let seconds = seconds
        .parse::<u64>()
        .map_err(|_| CanrushError::InvalidArgument(format!("invalid timestamp: {value}")))?;
    let millis = millis
        .chars()
        .take(3)
        .collect::<String>()
        .parse::<u64>()
        .map_err(|_| CanrushError::InvalidArgument(format!("invalid timestamp: {value}")))?;
    Ok(UNIX_EPOCH + Duration::from_secs(seconds) + Duration::from_millis(millis))
}

fn parse_direction(value: &str) -> Result<Direction> {
    match value {
        "rx" => Ok(Direction::Rx),
        "tx" => Ok(Direction::Tx),
        _ => Err(CanrushError::InvalidArgument(format!(
            "invalid direction: {value}"
        ))),
    }
}

fn parse_can_id(value: &str) -> Result<u32> {
    let hex = value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
        .unwrap_or(value);
    u32::from_str_radix(hex, 16)
        .map_err(|_| CanrushError::InvalidArgument(format!("invalid CAN ID: {value}")))
}

fn parse_id_format(value: &str) -> Result<IdFormat> {
    match value {
        "standard" => Ok(IdFormat::Standard),
        "extended" => Ok(IdFormat::Extended),
        _ => Err(CanrushError::InvalidArgument(format!(
            "invalid ID format: {value}"
        ))),
    }
}

fn parse_frame_format(value: &str) -> Result<FrameFormat> {
    match value {
        "classic" => Ok(FrameFormat::Classic),
        "fd" => Ok(FrameFormat::Fd),
        _ => Err(CanrushError::InvalidArgument(format!(
            "invalid frame format: {value}"
        ))),
    }
}

fn parse_frame_type(value: &str) -> Result<FrameType> {
    match value {
        "data" => Ok(FrameType::Data),
        "remote" => Ok(FrameType::Remote),
        "error" => Ok(FrameType::Error),
        _ => Err(CanrushError::InvalidArgument(format!(
            "invalid frame type: {value}"
        ))),
    }
}

fn parse_hex_bytes(value: &str) -> Result<Vec<u8>> {
    if !value.len().is_multiple_of(2) {
        return Err(CanrushError::InvalidArgument(format!(
            "hex payload length must be even: {value}"
        )));
    }
    (0..value.len())
        .step_by(2)
        .map(|index| {
            u8::from_str_radix(&value[index..index + 2], 16).map_err(|error| {
                CanrushError::InvalidArgument(format!("invalid payload byte at {index}: {error}"))
            })
        })
        .collect()
}

fn format_timestamp(frame: &CanFrame) -> String {
    match frame.timestamp_host.duration_since(UNIX_EPOCH) {
        Ok(duration) => format!("{}.{:03}", duration.as_secs(), duration.subsec_millis()),
        Err(_) => "0.000".to_string(),
    }
}

fn format_float(value: f64) -> String {
    if value.is_nan() {
        "NaN".to_string()
    } else {
        format!("{value:.6}")
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_string()
    }
}

fn csv_escape(value: &str) -> String {
    if value.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::write_csv;
    use crate::model::{FrameFormat, FrameType, IdFormat};

    #[test]
    fn parses_little_endian_signal_from_frame() {
        let frame = CanFrame::new_rx(
            "CAN0",
            "fake",
            0x100,
            IdFormat::Standard,
            FrameFormat::Classic,
            FrameType::Data,
            2,
            vec![0x34, 0x12],
        )
        .unwrap();
        let config = ParseConfig::example();

        let samples = parse_frame(&config, &frame, 7);

        assert_eq!(samples.len(), 1);
        assert_eq!(samples[0].signal_id, "can0_100_u16");
        assert_eq!(samples[0].value, 0x1234 as f64);
        assert_eq!(samples[0].quality, SignalQuality::Ok);
        assert_eq!(samples[0].source_sequence, 7);
    }

    #[test]
    fn applies_signed_scale_and_offset() {
        let frame = CanFrame::new_rx(
            "CAN0",
            "fake",
            0x101,
            IdFormat::Standard,
            FrameFormat::Classic,
            FrameType::Data,
            1,
            vec![0xFE],
        )
        .unwrap();
        let config = ParseConfig {
            version: 1,
            name: "signed".to_string(),
            description: String::new(),
            signals: vec![SignalDefinition {
                id: "signed_i8".to_string(),
                name: "signed_i8".to_string(),
                selector: FrameSelector {
                    bus: Some("CAN0".to_string()),
                    id: 0x101,
                    id_format: None,
                    frame_format: None,
                    frame_type: None,
                },
                source: SignalSource {
                    data_type: SignalDataType::UnsignedInt,
                    byte_offset: 0,
                    bit_offset: 0,
                    bit_length: 8,
                    endian: Endian::Little,
                    signed: true,
                },
                conversion: SignalConversion {
                    scale: 0.5,
                    offset: 1.0,
                    unit: "V".to_string(),
                },
            }],
        };

        let samples = parse_frame(&config, &frame, 1);

        assert_eq!(samples[0].value, 0.0);
        assert_eq!(samples[0].unit, "V");
    }

    #[test]
    fn parses_float32_little_endian_signal() {
        let frame = CanFrame::new_rx(
            "CAN0",
            "fake",
            0x200,
            IdFormat::Standard,
            FrameFormat::Classic,
            FrameType::Data,
            8,
            [1.5_f32.to_le_bytes(), (-2.25_f32).to_le_bytes()].concat(),
        )
        .unwrap();
        let config = ParseConfig {
            version: 1,
            name: "float32".to_string(),
            description: String::new(),
            signals: vec![
                SignalDefinition {
                    id: "motor_rps".to_string(),
                    name: "motor_rps".to_string(),
                    selector: FrameSelector {
                        bus: Some("CAN0".to_string()),
                        id: 0x200,
                        id_format: None,
                        frame_format: None,
                        frame_type: None,
                    },
                    source: SignalSource {
                        data_type: SignalDataType::Float32,
                        byte_offset: 0,
                        bit_offset: 0,
                        bit_length: 32,
                        endian: Endian::Little,
                        signed: false,
                    },
                    conversion: SignalConversion {
                        scale: 1.0,
                        offset: 0.0,
                        unit: "rps".to_string(),
                    },
                },
                SignalDefinition {
                    id: "motor_angle".to_string(),
                    name: "motor_angle".to_string(),
                    selector: FrameSelector {
                        bus: Some("CAN0".to_string()),
                        id: 0x200,
                        id_format: None,
                        frame_format: None,
                        frame_type: None,
                    },
                    source: SignalSource {
                        data_type: SignalDataType::Float32,
                        byte_offset: 4,
                        bit_offset: 0,
                        bit_length: 32,
                        endian: Endian::Little,
                        signed: false,
                    },
                    conversion: SignalConversion {
                        scale: -1.0,
                        offset: 0.0,
                        unit: "rad".to_string(),
                    },
                },
            ],
        };

        let samples = parse_frame(&config, &frame, 1);

        assert_eq!(samples.len(), 2);
        assert_eq!(samples[0].value, 1.5);
        assert_eq!(samples[1].value, 2.25);
    }

    #[test]
    fn parses_capture_csv_into_signal_csv() {
        let frame = CanFrame::new_rx(
            "CAN0",
            "fake",
            0x100,
            IdFormat::Standard,
            FrameFormat::Classic,
            FrameType::Data,
            2,
            vec![0x34, 0x12],
        )
        .unwrap();
        let mut capture = Vec::new();
        write_csv(&mut capture, &[frame]).unwrap();
        let capture = String::from_utf8(capture).unwrap();
        let lines = capture.lines().collect::<Vec<_>>();
        let parsed = parse_capture_csv_line(lines[1], 2).unwrap();

        let samples = parse_frames(&ParseConfig::example(), &[parsed]);
        let mut output = Vec::new();
        write_signal_csv(&mut output, &samples).unwrap();
        let output = String::from_utf8(output).unwrap();

        assert!(output.contains(SIGNAL_CSV_HEADER));
        assert!(output.contains("can0_100_u16"));
        assert!(output.contains(",4660,"));
    }

    #[test]
    fn reports_parse_error_for_short_payload() {
        let frame = CanFrame::new_rx(
            "CAN0",
            "fake",
            0x100,
            IdFormat::Standard,
            FrameFormat::Classic,
            FrameType::Data,
            1,
            vec![0x34],
        )
        .unwrap();
        let samples = parse_frame(&ParseConfig::example(), &frame, 1);

        assert_eq!(samples[0].quality, SignalQuality::ParseError);
        assert!(samples[0].value.is_nan());
    }
}
