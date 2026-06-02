use std::sync::{Arc, Mutex};
use std::time::Instant;

use canrush_core::parser::{parse_capture_csv_file, parse_frame, ParseConfig};
use canrush_core::plot::{build_plot_points, PlotLayout};

use crate::dto::{
    ParsePlotLiveDto, ParsePlotLiveMetricsDto, ParsePlotLiveRequestDto, ParsePlotPreviewDto,
};
use crate::path::{read_json_file, resolve_existing_path};
use crate::{ReceiverInner, ReceiverState};

#[tauri::command]
pub(crate) fn load_parse_config(
    state: tauri::State<'_, ReceiverState>,
    path: String,
) -> Result<ParseConfig, String> {
    let config = read_json_file::<ParseConfig>(&path)?;
    config.validate().map_err(|error| error.to_string())?;
    let mut inner = state.inner.lock().map_err(|error| error.to_string())?;
    inner.parse_config = Some(config.clone());
    Ok(config)
}

#[tauri::command]
pub(crate) fn load_plot_layout(
    state: tauri::State<'_, ReceiverState>,
    path: String,
) -> Result<PlotLayout, String> {
    let layout = read_json_file::<PlotLayout>(&path)?;
    layout.validate().map_err(|error| error.to_string())?;
    let mut inner = state.inner.lock().map_err(|error| error.to_string())?;
    inner.plot_layout = Some(layout.clone());
    Ok(layout)
}

#[tauri::command]
pub(crate) fn parse_plot_preview(
    state: tauri::State<'_, ReceiverState>,
    parse_config_path: String,
    plot_layout_path: String,
) -> Result<ParsePlotPreviewDto, String> {
    parse_plot_preview_for_state(&state.inner, &parse_config_path, &plot_layout_path)
}

#[tauri::command]
pub(crate) fn parse_plot_preview_live(
    state: tauri::State<'_, ReceiverState>,
) -> Result<ParsePlotPreviewDto, String> {
    parse_plot_preview_live_for_state(&state.inner)
}

#[tauri::command]
pub(crate) fn parse_plot_live_since(
    state: tauri::State<'_, ReceiverState>,
    request: ParsePlotLiveRequestDto,
) -> Result<ParsePlotLiveDto, String> {
    parse_plot_live_since_for_state(&state.inner, request)
}

#[tauri::command]
pub(crate) fn parse_plot_capture_file(
    parse_config_path: String,
    plot_layout_path: String,
    capture_path: String,
) -> Result<ParsePlotPreviewDto, String> {
    parse_plot_capture_file_from_paths(&parse_config_path, &plot_layout_path, &capture_path)
}

pub(crate) fn parse_plot_capture_file_from_paths(
    parse_config_path: &str,
    plot_layout_path: &str,
    capture_path: &str,
) -> Result<ParsePlotPreviewDto, String> {
    let config = read_json_file::<ParseConfig>(parse_config_path)?;
    config.validate().map_err(|error| error.to_string())?;
    let layout = read_json_file::<PlotLayout>(plot_layout_path)?;
    layout.validate().map_err(|error| error.to_string())?;
    let capture_path = resolve_existing_path(capture_path)?;
    let samples = parse_capture_csv_file(&capture_path, &config).map_err(|error| {
        format!(
            "failed to parse capture CSV {}: {error}",
            capture_path.display()
        )
    })?;
    let points = build_plot_points(&layout, &samples);
    Ok(ParsePlotPreviewDto { samples, points })
}

pub(crate) fn parse_plot_preview_for_state(
    shared: &Arc<Mutex<ReceiverInner>>,
    parse_config_path: &str,
    plot_layout_path: &str,
) -> Result<ParsePlotPreviewDto, String> {
    let config = read_json_file::<ParseConfig>(parse_config_path)?;
    config.validate().map_err(|error| error.to_string())?;
    let layout = read_json_file::<PlotLayout>(plot_layout_path)?;
    layout.validate().map_err(|error| error.to_string())?;
    parse_plot_preview_from_config_for_state(shared, &config, &layout)
}

pub(crate) fn parse_plot_preview_live_for_state(
    shared: &Arc<Mutex<ReceiverInner>>,
) -> Result<ParsePlotPreviewDto, String> {
    let (config, layout) = {
        let inner = shared.lock().map_err(|error| error.to_string())?;
        let config = inner
            .parse_config
            .clone()
            .ok_or_else(|| "parse config is not loaded".to_string())?;
        let layout = inner
            .plot_layout
            .clone()
            .ok_or_else(|| "plot layout is not loaded".to_string())?;
        (config, layout)
    };
    parse_plot_preview_from_config_for_state(shared, &config, &layout)
}

pub(crate) fn parse_plot_live_since_for_state(
    shared: &Arc<Mutex<ReceiverInner>>,
    request: ParsePlotLiveRequestDto,
) -> Result<ParsePlotLiveDto, String> {
    let total_started_at = Instant::now();
    let lock_started_at = Instant::now();
    let (config, layout, frames, next_sequence, oldest_sequence) = {
        let inner = shared.lock().map_err(|error| error.to_string())?;
        let config = inner
            .parse_config
            .clone()
            .ok_or_else(|| "parse config is not loaded".to_string())?;
        let layout = inner
            .plot_layout
            .clone()
            .ok_or_else(|| "plot layout is not loaded".to_string())?;
        let (frames, next_sequence, oldest_sequence) =
            inner.plot_history.since_with_oldest(request.since_sequence);
        (config, layout, frames, next_sequence, oldest_sequence)
    };
    let lock_ms = lock_started_at.elapsed().as_secs_f64() * 1000.0;
    let select_layout_started_at = Instant::now();
    let selected_layout = select_plot_layout(&layout, &request.selected_series_ids);
    let selected_signal_ids = selected_layout
        .panels
        .iter()
        .flat_map(|panel| panel.series.iter().map(|series| series.signal_id.as_str()))
        .collect::<std::collections::HashSet<_>>();
    let select_layout_ms = select_layout_started_at.elapsed().as_secs_f64() * 1000.0;
    let parse_started_at = Instant::now();
    let samples = frames
        .iter()
        .flat_map(|entry| parse_frame(&config, &entry.frame, entry.sequence))
        .filter(|sample| selected_signal_ids.contains(sample.signal_id.as_str()))
        .collect::<Vec<_>>();
    let parse_ms = parse_started_at.elapsed().as_secs_f64() * 1000.0;
    let build_points_started_at = Instant::now();
    let points = build_plot_points(&selected_layout, &samples);
    let build_points_ms = build_points_started_at.elapsed().as_secs_f64() * 1000.0;
    let dropped_frames = request
        .since_sequence
        .filter(|since| oldest_sequence > 0 && *since + 1 < oldest_sequence)
        .map(|since| oldest_sequence.saturating_sub(since + 1))
        .unwrap_or(0);
    Ok(ParsePlotLiveDto {
        samples,
        points,
        next_sequence,
        dropped_frames,
        metrics: ParsePlotLiveMetricsDto {
            total_ms: total_started_at.elapsed().as_secs_f64() * 1000.0,
            lock_ms,
            select_layout_ms,
            parse_ms,
            build_points_ms,
            frames: frames.len(),
        },
    })
}

fn select_plot_layout(layout: &PlotLayout, selected_series_ids: &[String]) -> PlotLayout {
    if selected_series_ids.is_empty() {
        return PlotLayout {
            version: layout.version,
            name: layout.name.clone(),
            description: layout.description.clone(),
            panels: Vec::new(),
        };
    }
    let selected = selected_series_ids
        .iter()
        .map(String::as_str)
        .collect::<std::collections::HashSet<_>>();
    PlotLayout {
        version: layout.version,
        name: layout.name.clone(),
        description: layout.description.clone(),
        panels: layout
            .panels
            .iter()
            .filter_map(|panel| {
                let series = panel
                    .series
                    .iter()
                    .filter(|series| selected.contains(series.id.as_str()))
                    .cloned()
                    .collect::<Vec<_>>();
                if series.is_empty() {
                    None
                } else {
                    Some(canrush_core::plot::PlotPanel {
                        id: panel.id.clone(),
                        title: panel.title.clone(),
                        series,
                    })
                }
            })
            .collect(),
    }
}

fn parse_plot_preview_from_config_for_state(
    shared: &Arc<Mutex<ReceiverInner>>,
    config: &ParseConfig,
    layout: &PlotLayout,
) -> Result<ParsePlotPreviewDto, String> {
    let frames = {
        let inner = shared.lock().map_err(|error| error.to_string())?;
        inner
            .latest
            .values()
            .map(|latest| {
                let frame = latest.frame.clone();
                let sequence = latest.receive_count;
                (frame, sequence)
            })
            .collect::<Vec<_>>()
    };
    let samples = frames
        .iter()
        .flat_map(|(frame, sequence)| parse_frame(config, frame, *sequence))
        .collect::<Vec<_>>();
    let points = build_plot_points(layout, &samples);
    Ok(ParsePlotPreviewDto { samples, points })
}

#[cfg(test)]
#[allow(clippy::panic)]
mod tests {
    use canrush_core::model::{CanFrame, FrameFormat, FrameType, IdFormat};

    use super::*;
    use crate::ReceiverState;

    #[test]
    fn parse_plot_preview_uses_loaded_config_and_latest_frames() {
        let state = state_with_orion_frame();

        let preview = match parse_plot_preview_for_state(
            &state.inner,
            "examples/orion.canrush-parse.json",
            "examples/orion.canrush-layout.json",
        ) {
            Ok(preview) => preview,
            Err(error) => panic!("failed to build parse/plot preview: {error}"),
        };

        assert_eq!(preview.samples.len(), 2);
        assert_eq!(preview.points.len(), 2);
        assert_eq!(preview.samples[0].signal_id, "orion_motor0_rps");
        assert_eq!(preview.samples[0].value, 1.5);
        assert_eq!(preview.samples[1].signal_id, "orion_motor0_angle_rad");
        assert_eq!(preview.samples[1].value, 2.25);
    }

    #[test]
    fn parse_plot_preview_live_uses_cached_config() {
        let state = state_with_orion_frame();
        {
            let mut inner = match state.inner.lock() {
                Ok(inner) => inner,
                Err(error) => panic!("failed to lock receiver state: {error}"),
            };
            inner.parse_config = Some(
                match read_json_file::<ParseConfig>("examples/orion.canrush-parse.json") {
                    Ok(config) => config,
                    Err(error) => panic!("failed to load parse config: {error}"),
                },
            );
            inner.plot_layout = Some(
                match read_json_file::<PlotLayout>("examples/orion.canrush-layout.json") {
                    Ok(layout) => layout,
                    Err(error) => panic!("failed to load plot layout: {error}"),
                },
            );
        }

        let preview = match parse_plot_preview_live_for_state(&state.inner) {
            Ok(preview) => preview,
            Err(error) => panic!("failed to build live preview: {error}"),
        };

        assert_eq!(preview.samples.len(), 2);
        assert_eq!(preview.points.len(), 2);
    }

    #[test]
    fn parse_plot_live_since_uses_history_cursor_and_selected_series() {
        let state = state_with_orion_frame();
        {
            let mut inner = match state.inner.lock() {
                Ok(inner) => inner,
                Err(error) => panic!("failed to lock receiver state: {error}"),
            };
            inner.parse_config = Some(
                match read_json_file::<ParseConfig>("examples/orion.canrush-parse.json") {
                    Ok(config) => config,
                    Err(error) => panic!("failed to load parse config: {error}"),
                },
            );
            inner.plot_layout = Some(
                match read_json_file::<PlotLayout>("examples/orion.canrush-layout.json") {
                    Ok(layout) => layout,
                    Err(error) => panic!("failed to load plot layout: {error}"),
                },
            );
        }

        let preview = match parse_plot_live_since_for_state(
            &state.inner,
            ParsePlotLiveRequestDto {
                since_sequence: None,
                selected_series_ids: vec!["motor0_rps".to_string()],
            },
        ) {
            Ok(preview) => preview,
            Err(error) => panic!("failed to build live plot history: {error}"),
        };

        assert_eq!(preview.samples.len(), 1);
        assert_eq!(preview.points.len(), 1);
        assert_eq!(preview.points[0].series_id, "motor0_rps");
        assert_eq!(preview.next_sequence, 1);
        assert_eq!(preview.metrics.frames, 1);

        let empty = match parse_plot_live_since_for_state(
            &state.inner,
            ParsePlotLiveRequestDto {
                since_sequence: Some(preview.next_sequence),
                selected_series_ids: vec!["motor0_rps".to_string()],
            },
        ) {
            Ok(preview) => preview,
            Err(error) => panic!("failed to build live plot history: {error}"),
        };

        assert!(empty.points.is_empty());
        assert_eq!(empty.next_sequence, preview.next_sequence);
    }

    #[test]
    fn parse_plot_live_since_plots_all_non_mouse_orion_series_at_high_rate() {
        let state = state_with_orion_high_rate_history(64);
        load_orion_parse_and_layout(&state);

        let preview = match parse_plot_live_since_for_state(
            &state.inner,
            ParsePlotLiveRequestDto {
                since_sequence: None,
                selected_series_ids: vec![
                    "motor0_rps".to_string(),
                    "motor0_angle_rad".to_string(),
                    "battery_voltage".to_string(),
                    "current0".to_string(),
                ],
            },
        ) {
            Ok(preview) => preview,
            Err(error) => panic!("failed to build high-rate live plot history: {error}"),
        };

        let series_ids = preview
            .points
            .iter()
            .map(|point| point.series_id.as_str())
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(preview.metrics.frames, 64 * 3);
        assert_eq!(preview.samples.len(), 64 * 4);
        assert_eq!(preview.points.len(), 64 * 4);
        assert!(series_ids.contains("motor0_rps"));
        assert!(series_ids.contains("motor0_angle_rad"));
        assert!(series_ids.contains("battery_voltage"));
        assert!(series_ids.contains("current0"));
        assert!(!series_ids.contains("mouse_raw_x"));
        assert!(!series_ids.contains("mouse_raw_y"));
    }

    #[test]
    fn parse_plot_capture_file_uses_loaded_config_and_sample_capture() {
        let preview = match parse_plot_capture_file_from_paths(
            "examples/orion.canrush-parse.json",
            "examples/orion.canrush-layout.json",
            "examples/orion-sample-capture.csv",
        ) {
            Ok(preview) => preview,
            Err(error) => panic!("failed to parse sample capture: {error}"),
        };

        assert_eq!(preview.samples.len(), 12);
        assert_eq!(preview.points.len(), 6);
        assert!(preview
            .samples
            .iter()
            .any(|sample| sample.signal_id == "orion_motor0_rps" && sample.value == 1.5));
        assert!(preview
            .points
            .iter()
            .any(|point| point.series_id == "motor0_angle_rad" && point.value == 2.25));
    }

    fn state_with_orion_frame() -> ReceiverState {
        let state = ReceiverState::default();
        {
            let mut inner = match state.inner.lock() {
                Ok(inner) => inner,
                Err(error) => panic!("failed to lock receiver state: {error}"),
            };
            let frame = match CanFrame::new_rx(
                "CAN0",
                "test",
                0x200,
                IdFormat::Standard,
                FrameFormat::Classic,
                FrameType::Data,
                8,
                [1.5_f32.to_le_bytes(), (-2.25_f32).to_le_bytes()].concat(),
            ) {
                Ok(frame) => frame,
                Err(error) => panic!("failed to build test frame: {error}"),
            };
            inner.latest.ingest(frame.clone());
            inner.plot_history.push(frame);
        }
        state
    }

    fn state_with_orion_high_rate_history(cycles: u32) -> ReceiverState {
        let state = ReceiverState::default();
        {
            let mut inner = match state.inner.lock() {
                Ok(inner) => inner,
                Err(error) => panic!("failed to lock receiver state: {error}"),
            };
            for index in 0..cycles {
                let motor = match CanFrame::new_rx(
                    "CAN0",
                    "test",
                    0x200,
                    IdFormat::Standard,
                    FrameFormat::Classic,
                    FrameType::Data,
                    8,
                    [
                        (100.0 + index as f32).to_le_bytes(),
                        (0.5 + index as f32).to_le_bytes(),
                    ]
                    .concat(),
                ) {
                    Ok(frame) => frame,
                    Err(error) => panic!("failed to build motor frame: {error}"),
                };
                let power = match CanFrame::new_rx(
                    "CAN0",
                    "test",
                    0x215,
                    IdFormat::Standard,
                    FrameFormat::Classic,
                    FrameType::Data,
                    8,
                    [(24.0 + index as f32).to_le_bytes(), [0_u8; 4]].concat(),
                ) {
                    Ok(frame) => frame,
                    Err(error) => panic!("failed to build power frame: {error}"),
                };
                let current = match CanFrame::new_rx(
                    "CAN0",
                    "test",
                    0x230,
                    IdFormat::Standard,
                    FrameFormat::Classic,
                    FrameType::Data,
                    8,
                    [(5.0 + index as f32).to_le_bytes(), [0_u8; 4]].concat(),
                ) {
                    Ok(frame) => frame,
                    Err(error) => panic!("failed to build current frame: {error}"),
                };
                for frame in [motor, power, current] {
                    inner.latest.ingest(frame.clone());
                    inner.plot_history.push(frame);
                }
            }
        }
        state
    }

    fn load_orion_parse_and_layout(state: &ReceiverState) {
        let mut inner = match state.inner.lock() {
            Ok(inner) => inner,
            Err(error) => panic!("failed to lock receiver state: {error}"),
        };
        inner.parse_config = Some(
            match read_json_file::<ParseConfig>("examples/orion.canrush-parse.json") {
                Ok(config) => config,
                Err(error) => panic!("failed to load parse config: {error}"),
            },
        );
        inner.plot_layout = Some(
            match read_json_file::<PlotLayout>("examples/orion.canrush-layout.json") {
                Ok(layout) => layout,
                Err(error) => panic!("failed to load plot layout: {error}"),
            },
        );
    }
}
