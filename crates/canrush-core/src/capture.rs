use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::adapter::FrameSource;
use crate::error::Result;
use crate::model::{CanFrame, Direction};

#[derive(Debug, Clone)]
pub struct CaptureOptions {
    pub duration: Duration,
    pub bus: Option<String>,
    pub include_tx: bool,
}

impl CaptureOptions {
    pub fn accepts(&self, frame: &CanFrame) -> bool {
        let bus_matches = self.bus.as_ref().is_none_or(|bus| frame.bus == *bus);
        let direction_matches = self.include_tx || frame.direction == Direction::Rx;
        bus_matches && direction_matches
    }
}

#[derive(Debug, Default, Clone)]
pub struct CaptureResult {
    pub frames: Vec<CanFrame>,
}

pub fn capture_from_source(
    source: &mut dyn FrameSource,
    options: &CaptureOptions,
) -> Result<CaptureResult> {
    let deadline = Instant::now() + options.duration;
    let mut frames = Vec::new();

    while Instant::now() < deadline {
        match source.next_frame()? {
            Some(frame) if options.accepts(&frame) => frames.push(frame),
            Some(_) => {}
            None => break,
        }
    }

    Ok(CaptureResult { frames })
}

pub fn write_csv_file(path: impl AsRef<Path>, frames: &[CanFrame]) -> Result<()> {
    let file = File::create(path)?;
    let mut writer = BufWriter::new(file);
    write_csv(&mut writer, frames)?;
    writer.flush()?;
    Ok(())
}

pub fn write_csv(writer: &mut impl Write, frames: &[CanFrame]) -> Result<()> {
    writeln!(
        writer,
        "timestamp_host,bus,direction,id,id_format,frame_format,frame_type,dlc,data_length,flags,data_hex"
    )?;
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

    #[test]
    fn captures_fake_frames_to_csv() {
        let mut adapter = FakeAdapter::sample().unwrap();
        let options = CaptureOptions {
            duration: Duration::from_secs(1),
            bus: None,
            include_tx: false,
        };
        let result = capture_from_source(&mut adapter, &options).unwrap();
        assert_eq!(result.frames.len(), 3);

        let mut output = Vec::new();
        write_csv(&mut output, &result.frames).unwrap();
        let csv = String::from_utf8(output).unwrap();
        assert!(csv.contains("timestamp_host,bus,direction"));
        assert!(csv.contains("0x100"));
        assert!(csv.contains("1133"));
    }
}
