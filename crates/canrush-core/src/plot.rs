use std::fs::File;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{CanrushError, Result};
use crate::parser::{SignalQuality, SignalSample, SIGNAL_CSV_HEADER};

pub const PLOT_CSV_HEADER: &str =
    "timestamp_host,panel_id,series_id,source_signal_id,name,value,unit,quality,source_sequence";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlotLayout {
    pub version: u32,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub panels: Vec<PlotPanel>,
}

impl PlotLayout {
    pub fn example() -> Self {
        Self {
            version: 1,
            name: "example layout".to_string(),
            description: "example plot layout".to_string(),
            panels: vec![PlotPanel {
                id: "main".to_string(),
                title: "Main".to_string(),
                series: vec![PlotSeriesConfig {
                    id: "example_value".to_string(),
                    signal_id: "can0_100_u16".to_string(),
                    label: "Example value".to_string(),
                    color: "#196B7A".to_string(),
                    axis: "left".to_string(),
                    scale: 1.0,
                    offset: 0.0,
                    unit_override: None,
                }],
            }],
        }
    }

    pub fn validate(&self) -> Result<()> {
        if self.version == 0 {
            return Err(CanrushError::InvalidArgument(
                "plot layout version must be greater than 0".to_string(),
            ));
        }
        if self.panels.is_empty() {
            return Err(CanrushError::InvalidArgument(
                "plot layout must contain at least one panel".to_string(),
            ));
        }
        for panel in &self.panels {
            if panel.id.trim().is_empty() {
                return Err(CanrushError::InvalidArgument(
                    "plot panel id must not be empty".to_string(),
                ));
            }
            if panel.series.is_empty() {
                return Err(CanrushError::InvalidArgument(format!(
                    "plot panel must contain at least one series: {}",
                    panel.id
                )));
            }
            for series in &panel.series {
                series.validate()?;
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlotPanel {
    pub id: String,
    pub title: String,
    pub series: Vec<PlotSeriesConfig>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlotSeriesConfig {
    pub id: String,
    pub signal_id: String,
    pub label: String,
    pub color: String,
    pub axis: String,
    pub scale: f64,
    pub offset: f64,
    pub unit_override: Option<String>,
}

impl PlotSeriesConfig {
    fn validate(&self) -> Result<()> {
        if self.id.trim().is_empty() {
            return Err(CanrushError::InvalidArgument(
                "plot series id must not be empty".to_string(),
            ));
        }
        if self.signal_id.trim().is_empty() {
            return Err(CanrushError::InvalidArgument(format!(
                "plot series signal_id must not be empty: {}",
                self.id
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlotPoint {
    pub timestamp_host: String,
    pub panel_id: String,
    pub series_id: String,
    pub source_signal_id: String,
    pub name: String,
    pub value: f64,
    pub unit: String,
    pub quality: SignalQuality,
    pub source_sequence: u64,
}

pub fn build_plot_points(layout: &PlotLayout, samples: &[SignalSample]) -> Vec<PlotPoint> {
    let mut points = Vec::new();
    for panel in &layout.panels {
        for series in &panel.series {
            for sample in samples
                .iter()
                .filter(|sample| sample.signal_id == series.signal_id)
            {
                points.push(PlotPoint {
                    timestamp_host: sample.timestamp_host.clone(),
                    panel_id: panel.id.clone(),
                    series_id: series.id.clone(),
                    source_signal_id: sample.signal_id.clone(),
                    name: if series.label.is_empty() {
                        sample.name.clone()
                    } else {
                        series.label.clone()
                    },
                    value: sample.value * series.scale + series.offset,
                    unit: series
                        .unit_override
                        .clone()
                        .unwrap_or_else(|| sample.unit.clone()),
                    quality: sample.quality,
                    source_sequence: sample.source_sequence,
                });
            }
        }
    }
    points
}

pub fn read_signal_csv_file(path: impl AsRef<Path>) -> Result<Vec<SignalSample>> {
    let file = File::open(path)?;
    let mut lines = BufReader::new(file).lines();
    let Some(header) = lines.next().transpose()? else {
        return Ok(Vec::new());
    };
    if header.trim_end_matches('\r') != SIGNAL_CSV_HEADER {
        return Err(CanrushError::InvalidArgument(format!(
            "unsupported signal CSV header: {header}"
        )));
    }

    lines
        .enumerate()
        .filter_map(|(index, line)| match line {
            Ok(line) if line.trim().is_empty() => None,
            Ok(line) => Some(parse_signal_csv_line(&line, index + 2)),
            Err(error) => Some(Err(CanrushError::Io(error))),
        })
        .collect()
}

pub fn write_plot_csv_file(path: impl AsRef<Path>, points: &[PlotPoint]) -> Result<()> {
    let file = File::create(path)?;
    let mut writer = BufWriter::new(file);
    write_plot_csv(&mut writer, points)?;
    writer.flush()?;
    Ok(())
}

pub fn write_plot_csv(writer: &mut impl Write, points: &[PlotPoint]) -> Result<()> {
    writeln!(writer, "{PLOT_CSV_HEADER}")?;
    for point in points {
        writeln!(
            writer,
            "{},{},{},{},{},{},{},{},{}",
            csv_escape(&point.timestamp_host),
            csv_escape(&point.panel_id),
            csv_escape(&point.series_id),
            csv_escape(&point.source_signal_id),
            csv_escape(&point.name),
            format_float(point.value),
            csv_escape(&point.unit),
            point.quality.as_str(),
            point.source_sequence
        )?;
    }
    Ok(())
}

fn parse_signal_csv_line(line: &str, line_number: usize) -> Result<SignalSample> {
    let columns = split_csv_line(line);
    if columns.len() != 9 {
        return Err(CanrushError::InvalidArgument(format!(
            "signal CSV line {line_number} has {} column(s), expected 9",
            columns.len()
        )));
    }
    let value = columns[5].parse::<f64>().map_err(|_| {
        CanrushError::InvalidArgument(format!("invalid signal value at line {line_number}"))
    })?;
    let quality = match columns[7].as_str() {
        "ok" => SignalQuality::Ok,
        "invalid" => SignalQuality::Invalid,
        "parse-error" => SignalQuality::ParseError,
        value => {
            return Err(CanrushError::InvalidArgument(format!(
                "invalid signal quality at line {line_number}: {value}"
            )))
        }
    };
    let source_sequence = columns[8].parse::<u64>().map_err(|_| {
        CanrushError::InvalidArgument(format!("invalid source sequence at line {line_number}"))
    })?;
    Ok(SignalSample {
        timestamp_host: columns[0].clone(),
        bus: columns[1].clone(),
        frame_id: columns[2].clone(),
        signal_id: columns[3].clone(),
        name: columns[4].clone(),
        value,
        unit: columns[6].clone(),
        quality,
        source_sequence,
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

    #[test]
    fn applies_series_scale_and_offset() {
        let layout = PlotLayout::example();
        let samples = vec![SignalSample {
            timestamp_host: "1.000".to_string(),
            bus: "CAN0".to_string(),
            frame_id: "0x100".to_string(),
            signal_id: "can0_100_u16".to_string(),
            name: "example_value".to_string(),
            value: 10.0,
            unit: "raw".to_string(),
            quality: SignalQuality::Ok,
            source_sequence: 1,
        }];

        let points = build_plot_points(&layout, &samples);

        assert_eq!(points.len(), 1);
        assert_eq!(points[0].panel_id, "main");
        assert_eq!(points[0].series_id, "example_value");
        assert_eq!(points[0].value, 10.0);
    }

    #[test]
    fn writes_plot_csv_contract() {
        let points = build_plot_points(
            &PlotLayout::example(),
            &[SignalSample {
                timestamp_host: "1.000".to_string(),
                bus: "CAN0".to_string(),
                frame_id: "0x100".to_string(),
                signal_id: "can0_100_u16".to_string(),
                name: "example_value".to_string(),
                value: 10.0,
                unit: "raw".to_string(),
                quality: SignalQuality::Ok,
                source_sequence: 1,
            }],
        );
        let mut output = Vec::new();
        write_plot_csv(&mut output, &points).unwrap();
        let output = String::from_utf8(output).unwrap();

        assert_eq!(
            output,
            concat!(
                "timestamp_host,panel_id,series_id,source_signal_id,name,value,unit,quality,source_sequence\n",
                "1.000,main,example_value,can0_100_u16,Example value,10,raw,ok,1\n"
            )
        );
    }
}
