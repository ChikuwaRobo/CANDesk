use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::adapter::FrameSource;
use crate::error::Result;
use crate::model::{CanFrame, Direction};

pub const CSV_HEADER: &str =
    "timestamp_host,bus,direction,id,id_format,frame_format,frame_type,dlc,data_length,flags,data_hex";

#[derive(Debug, Clone)]
pub struct CaptureOptions {
    pub duration: Duration,
    pub bus: Option<String>,
    pub include_tx: bool,
    pub id_filters: Vec<CanIdFilter>,
    pub max_frames: Option<usize>,
}

impl CaptureOptions {
    pub fn accepts(&self, frame: &CanFrame) -> bool {
        let bus_matches = self.bus.as_ref().is_none_or(|bus| frame.bus == *bus);
        let direction_matches = self.include_tx || frame.direction == Direction::Rx;
        let id_matches = self.id_filters.is_empty()
            || self
                .id_filters
                .iter()
                .any(|filter| filter.matches(frame.id));
        bus_matches && direction_matches && id_matches
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CanIdFilter {
    Exact(u32),
    Range { start: u32, end: u32 },
}

impl CanIdFilter {
    pub fn matches(self, id: u32) -> bool {
        match self {
            Self::Exact(expected) => id == expected,
            Self::Range { start, end } => (start..=end).contains(&id),
        }
    }
}

#[derive(Debug, Default, Clone)]
pub struct CaptureResult {
    pub frames: Vec<CanFrame>,
    pub stop_reason: CaptureStopReason,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub enum CaptureStopReason {
    #[default]
    SourceEnded,
    DurationElapsed,
    MaxFramesReached,
}

impl CaptureStopReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SourceEnded => "source-ended",
            Self::DurationElapsed => "duration-elapsed",
            Self::MaxFramesReached => "max-frames-reached",
        }
    }
}

pub fn capture_from_source(
    source: &mut dyn FrameSource,
    options: &CaptureOptions,
) -> Result<CaptureResult> {
    let deadline = Instant::now() + options.duration;
    let mut frames = Vec::new();
    let mut stop_reason = CaptureStopReason::DurationElapsed;

    while Instant::now() < deadline {
        match source.next_frame()? {
            Some(frame) if options.accepts(&frame) => {
                frames.push(frame);
                if options
                    .max_frames
                    .is_some_and(|max_frames| frames.len() >= max_frames)
                {
                    stop_reason = CaptureStopReason::MaxFramesReached;
                    break;
                }
            }
            Some(_) => {}
            None => {
                stop_reason = CaptureStopReason::SourceEnded;
                break;
            }
        }
    }

    Ok(CaptureResult {
        frames,
        stop_reason,
    })
}

pub fn write_csv_file(path: impl AsRef<Path>, frames: &[CanFrame]) -> Result<()> {
    let file = File::create(path)?;
    let mut writer = BufWriter::new(file);
    write_csv(&mut writer, frames)?;
    writer.flush()?;
    Ok(())
}

pub fn write_csv(writer: &mut impl Write, frames: &[CanFrame]) -> Result<()> {
    writeln!(writer, "{CSV_HEADER}")?;
    for frame in frames {
        writeln!(
            writer,
            "{},{},{},0x{:X},{},{},{},{:X},{},{},{}",
            format_system_time(frame.timestamp_host),
            csv_escape(&frame.bus),
            frame.direction.as_str(),
            frame.id,
            frame.id_format.as_str(),
            frame.frame_format.as_str(),
            frame.frame_type.as_str(),
            frame.dlc,
            frame.data_length,
            csv_escape(&frame.flags_string()),
            frame.data_hex(),
        )?;
    }
    Ok(())
}

fn format_system_time(time: SystemTime) -> String {
    match time.duration_since(UNIX_EPOCH) {
        Ok(duration) => format!("{}.{:03}", duration.as_secs(), duration.subsec_millis()),
        Err(_) => "0.000".to_string(),
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
    use crate::adapter::FakeAdapter;
    use crate::model::{FrameFormat, FrameType, IdFormat};
    use std::time::{Duration, UNIX_EPOCH};

    #[test]
    fn captures_fake_frames_to_csv() {
        let mut adapter = FakeAdapter::sample().unwrap();
        let options = CaptureOptions {
            duration: Duration::from_secs(1),
            bus: None,
            include_tx: false,
            id_filters: Vec::new(),
            max_frames: None,
        };
        let result = capture_from_source(&mut adapter, &options).unwrap();
        assert_eq!(result.frames.len(), 3);
        assert_eq!(result.stop_reason, CaptureStopReason::SourceEnded);

        let mut output = Vec::new();
        write_csv(&mut output, &result.frames).unwrap();
        let csv = String::from_utf8(output).unwrap();
        assert!(csv.contains("timestamp_host,bus,direction"));
        assert!(csv.contains("0x100"));
        assert!(csv.contains("1133"));
    }

    #[test]
    fn filters_by_id_and_stops_at_max_frames() {
        let mut adapter = FakeAdapter::sample().unwrap();
        let options = CaptureOptions {
            duration: Duration::from_secs(1),
            bus: None,
            include_tx: false,
            id_filters: vec![
                CanIdFilter::Exact(0x101),
                CanIdFilter::Range {
                    start: 0x100,
                    end: 0x100,
                },
            ],
            max_frames: Some(2),
        };

        let result = capture_from_source(&mut adapter, &options).unwrap();

        assert_eq!(result.stop_reason, CaptureStopReason::MaxFramesReached);
        assert_eq!(result.frames.len(), 2);
        assert!(result
            .frames
            .iter()
            .all(|frame| matches!(frame.id, 0x100 | 0x101)));
    }

    #[test]
    fn writes_csv_with_stable_contract() {
        let mut classic = CanFrame::new_rx(
            "CAN0",
            "fake",
            0x123,
            IdFormat::Standard,
            FrameFormat::Classic,
            FrameType::Data,
            8,
            vec![0x00, 0x01, 0x0A, 0x10, 0x7F, 0x80, 0xFE, 0xFF],
        )
        .unwrap();
        classic.timestamp_host = UNIX_EPOCH + Duration::from_millis(1_700_000_000_123);

        let mut fd = CanFrame::new_rx(
            "CAN1",
            "fake",
            0x1ABC_DEF0,
            IdFormat::Extended,
            FrameFormat::Fd,
            FrameType::Data,
            9,
            vec![
                0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x1B,
            ],
        )
        .unwrap();
        fd.timestamp_host = UNIX_EPOCH + Duration::from_millis(1_700_000_000_456);
        fd.bitrate_switch = true;
        fd.error_state_indicator = true;

        let mut output = Vec::new();
        write_csv(&mut output, &[classic, fd]).unwrap();

        let csv = String::from_utf8(output).unwrap();
        let expected = concat!(
            "timestamp_host,bus,direction,id,id_format,frame_format,frame_type,dlc,data_length,flags,data_hex\n",
            "1700000000.123,CAN0,rx,0x123,standard,classic,data,8,8,,00010A107F80FEFF\n",
            "1700000000.456,CAN1,rx,0x1ABCDEF0,extended,fd,data,9,12,brs;esi,101112131415161718191A1B\n",
        );
        assert_eq!(csv, expected);
    }
}
