#![cfg_attr(test, allow(clippy::unwrap_used))]

use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use canrush_core::adapter::{
    list_serial_devices, FakeAdapter, FrameSource, WeActSerialAdapter, WeActSerialConfig,
};
use canrush_core::api::{FrameEventDto, ServerStatusDto};
use canrush_core::capture::{
    capture_from_source, write_csv_file, CanIdFilter, CaptureOptions, CSV_HEADER,
};
use canrush_core::endpoint::{parse_server_endpoint, ServerEndpoint};
use canrush_core::error::{CanrushError, Result};
use clap::{Parser, Subcommand, ValueEnum};

#[derive(Debug, Parser)]
#[command(name = "canrush")]
#[command(about = "CANRush command line tools")]
struct Cli {
    #[arg(long, global = true)]
    server: Option<String>,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Debug, Subcommand)]
enum Commands {
    Capture(Box<CaptureArgs>),
    Check(Box<CheckArgs>),
    ListPorts,
    Server(Box<ServerArgs>),
}

#[derive(Debug, Parser)]
struct CaptureArgs {
    #[arg(long, value_enum, default_value_t = AdapterKind::Fake)]
    adapter: AdapterKind,

    #[arg(long)]
    port: Option<String>,

    #[arg(long, default_value_t = 1_000_000)]
    baud: u32,

    #[arg(long, default_value = "CAN0")]
    bus: String,

    #[arg(long)]
    all_buses: bool,

    #[arg(long)]
    include_tx: bool,

    #[arg(long = "id")]
    ids: Vec<String>,

    #[arg(long = "id-range")]
    id_ranges: Vec<String>,

    #[arg(long)]
    max_frames: Option<usize>,

    #[arg(long)]
    max_bytes: Option<usize>,

    #[arg(long, default_value = "1s")]
    duration: String,

    #[arg(long)]
    output: PathBuf,

    #[arg(long, default_value = "S4")]
    bitrate: String,

    #[arg(long, default_value = "Y2")]
    data_bitrate: String,

    #[arg(long)]
    listen_only: bool,
}

#[derive(Debug, Parser)]
struct CheckArgs {
    #[arg(long, value_enum, default_value_t = AdapterKind::Fake)]
    adapter: AdapterKind,

    #[arg(long)]
    port: Option<String>,

    #[arg(long, default_value_t = 1_000_000)]
    baud: u32,

    #[arg(long, default_value = "CAN0")]
    bus: String,

    #[arg(long, default_value = "S4")]
    bitrate: String,

    #[arg(long, default_value = "Y2")]
    data_bitrate: String,

    #[arg(long)]
    listen_only: bool,

    #[arg(long, default_value = "500ms")]
    duration: String,

    #[arg(long, default_value_t = 1)]
    min_frames: usize,
}

#[derive(Debug, Parser)]
struct ServerArgs {
    #[command(subcommand)]
    command: ServerCommand,
}

#[derive(Debug, Subcommand)]
enum ServerCommand {
    Status(ServerStatusArgs),
}

#[derive(Debug, Parser)]
struct ServerStatusArgs {
    #[arg(long)]
    server: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
enum AdapterKind {
    Fake,
    Weact,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Capture(args) => {
            if cli.server.is_some() {
                let endpoint = resolve_server_endpoint(None, cli.server.as_deref())?;
                return run_client_capture(*args, &endpoint);
            }
            run_capture(*args)
        }
        Commands::Check(args) => run_check(*args),
        Commands::ListPorts => run_list_ports(),
        Commands::Server(args) => run_server_command(*args, cli.server.as_deref()),
    }
}

fn run_capture(args: CaptureArgs) -> Result<()> {
    let duration = parse_duration(&args.duration)?;
    let id_filters = parse_id_filters(&args.ids, &args.id_ranges)?;
    if args.max_frames == Some(0) {
        return Err(CanrushError::InvalidArgument(
            "--max-frames must be greater than 0".to_string(),
        ));
    }
    if args.max_bytes.is_some() {
        return Err(CanrushError::InvalidArgument(
            "--max-bytes is only supported in Client mode".to_string(),
        ));
    }
    let options = CaptureOptions {
        duration,
        bus: if args.all_buses {
            None
        } else {
            Some(args.bus.clone())
        },
        include_tx: args.include_tx,
        id_filters,
        max_frames: args.max_frames,
    };

    let mut source: Box<dyn FrameSource> = match args.adapter {
        AdapterKind::Fake => Box::new(FakeAdapter::sample()?),
        AdapterKind::Weact => {
            let port_name = args.port.ok_or_else(|| {
                CanrushError::InvalidArgument(
                    "--port is required when --adapter weact is used".to_string(),
                )
            })?;
            Box::new(WeActSerialAdapter::connect(WeActSerialConfig {
                port_name,
                baud_rate: args.baud,
                bus: args.bus,
                nominal_bitrate: args.bitrate,
                data_bitrate: Some(args.data_bitrate),
                listen_only: args.listen_only,
                ..WeActSerialConfig::default()
            })?)
        }
    };

    let result = capture_from_source(&mut *source, &options)?;
    write_csv_file(&args.output, &result.frames)?;
    println!(
        "captured {} frame(s) to {} ({})",
        result.frames.len(),
        args.output.display(),
        result.stop_reason.as_str(),
    );
    Ok(())
}

fn run_client_capture(args: CaptureArgs, endpoint: &ServerEndpoint) -> Result<()> {
    let duration = parse_duration(&args.duration)?;
    if args.adapter != AdapterKind::Fake {
        return Err(CanrushError::InvalidArgument(
            "--adapter is not used in Client mode".to_string(),
        ));
    }
    if args.port.is_some() {
        return Err(CanrushError::InvalidArgument(
            "--port is not used in Client mode".to_string(),
        ));
    }
    if args.max_frames == Some(0) {
        return Err(CanrushError::InvalidArgument(
            "--max-frames must be greater than 0".to_string(),
        ));
    }
    if args.max_bytes == Some(0) {
        return Err(CanrushError::InvalidArgument(
            "--max-bytes must be greater than 0".to_string(),
        ));
    }

    let stream_url = build_capture_stream_url(endpoint, &args);
    let (mut socket, _) = tungstenite::connect(&stream_url).map_err(|error| {
        CanrushError::InvalidArgument(format!("server stream connection failed: {error}"))
    })?;

    let file = File::create(&args.output)?;
    let mut writer = BufWriter::new(file);
    let mut written_bytes = writeln_counted(&mut writer, CSV_HEADER)?;
    let mut frames = 0_usize;
    let mut stop_reason = "stream-closed";
    let deadline = Instant::now() + duration;

    while Instant::now() < deadline {
        let message = match socket.read() {
            Ok(message) => message,
            Err(tungstenite::Error::ConnectionClosed | tungstenite::Error::AlreadyClosed) => {
                stop_reason = "stream-closed";
                break;
            }
            Err(error) => {
                return Err(CanrushError::InvalidArgument(format!(
                    "server stream read failed: {error}"
                )));
            }
        };
        if !message.is_text() {
            continue;
        }
        let text = message.into_text().map_err(|error| {
            CanrushError::InvalidArgument(format!("server stream message is invalid: {error}"))
        })?;
        let value = serde_json::from_str::<serde_json::Value>(&text).map_err(|error| {
            CanrushError::InvalidArgument(format!("server stream JSON is invalid: {error}"))
        })?;
        match value.get("event").and_then(serde_json::Value::as_str) {
            Some("hello") => {}
            Some("frame") => {
                let frame = serde_json::from_value::<FrameEventDto>(value).map_err(|error| {
                    CanrushError::InvalidArgument(format!("frame event is invalid: {error}"))
                })?;
                if !args.include_tx && frame.direction != "rx" {
                    continue;
                }
                let line = frame_event_csv_line(&frame);
                written_bytes += writeln_counted(&mut writer, &line)?;
                frames += 1;
                if args
                    .max_frames
                    .is_some_and(|max_frames| frames >= max_frames)
                {
                    stop_reason = "max-frames-reached";
                    break;
                }
                if args
                    .max_bytes
                    .is_some_and(|max_bytes| written_bytes >= max_bytes)
                {
                    stop_reason = "max-bytes-reached";
                    break;
                }
            }
            Some("diagnostic") => {
                return Err(CanrushError::InvalidArgument(format!(
                    "server diagnostic: {text}"
                )));
            }
            Some("closed") => {
                stop_reason = "stream-closed";
                break;
            }
            _ => {}
        }
    }
    if Instant::now() >= deadline {
        stop_reason = "duration-elapsed";
    }
    writer.flush()?;
    println!(
        "captured {} frame(s) to {} ({})",
        frames,
        args.output.display(),
        stop_reason,
    );
    Ok(())
}

fn build_capture_stream_url(endpoint: &ServerEndpoint, args: &CaptureArgs) -> String {
    let mut query = vec!["kind=capture".to_string()];
    if !args.all_buses {
        query.push(format!("bus={}", args.bus));
    }
    for id in &args.ids {
        query.push(format!("id={id}"));
    }
    for range in &args.id_ranges {
        query.push(format!("id_range={range}"));
    }
    format!(
        "{}/api/v1/sessions/default/stream?{}",
        endpoint.ws_base_url(),
        query.join("&")
    )
}

fn frame_event_csv_line(frame: &FrameEventDto) -> String {
    format!(
        "{},{},{},{},{},{},{},{:X},{},{},{}",
        unix_ns_to_csv_timestamp(&frame.timestamp_host_unix_ns),
        csv_escape(&frame.bus),
        frame.direction,
        frame.id,
        frame.id_format,
        frame.frame_format,
        frame.frame_type,
        frame.dlc,
        frame.data_length,
        csv_escape(&frame.flags),
        frame.data_hex,
    )
}

fn unix_ns_to_csv_timestamp(value: &str) -> String {
    let Ok(nanos) = value.parse::<u128>() else {
        return "0.000".to_string();
    };
    let seconds = nanos / 1_000_000_000;
    let millis = (nanos % 1_000_000_000) / 1_000_000;
    format!("{seconds}.{millis:03}")
}

fn csv_escape(value: &str) -> String {
    if value.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn writeln_counted(writer: &mut impl Write, value: &str) -> Result<usize> {
    writeln!(writer, "{value}")?;
    Ok(value.len() + 1)
}

fn run_check(args: CheckArgs) -> Result<()> {
    if args.min_frames == 0 {
        return Err(CanrushError::InvalidArgument(
            "--min-frames must be greater than 0".to_string(),
        ));
    }

    let duration = parse_duration(&args.duration)?;
    let mut version = None;
    let mut source: Box<dyn FrameSource> = match args.adapter {
        AdapterKind::Fake => Box::new(FakeAdapter::sample()?),
        AdapterKind::Weact => {
            let port_name = args.port.ok_or_else(|| {
                CanrushError::InvalidArgument(
                    "--port is required when --adapter weact is used".to_string(),
                )
            })?;
            let adapter = WeActSerialAdapter::connect(WeActSerialConfig {
                port_name,
                baud_rate: args.baud,
                bus: args.bus.clone(),
                nominal_bitrate: args.bitrate,
                data_bitrate: Some(args.data_bitrate),
                listen_only: args.listen_only,
                ..WeActSerialConfig::default()
            })?;
            version = adapter.version().map(ToOwned::to_owned);
            Box::new(adapter)
        }
    };

    let options = CaptureOptions {
        duration,
        bus: Some(args.bus.clone()),
        include_tx: false,
        id_filters: Vec::new(),
        max_frames: Some(args.min_frames),
    };
    let result = capture_from_source(&mut *source, &options)?;
    let ok = result.frames.len() >= args.min_frames;
    println!("adapter={}", adapter_name(args.adapter));
    println!("bus={}", args.bus);
    println!("version={}", version.as_deref().unwrap_or("-"));
    println!("frames={}", result.frames.len());
    println!("stop_reason={}", result.stop_reason.as_str());
    println!("status={}", if ok { "ok" } else { "no-frames" });

    if ok {
        Ok(())
    } else {
        Err(CanrushError::InvalidFrame(format!(
            "received {} frame(s), expected at least {}",
            result.frames.len(),
            args.min_frames
        )))
    }
}

fn run_list_ports() -> Result<()> {
    for device in list_serial_devices()? {
        println!("{}\t{}", device.port_name, device.port_type);
    }
    Ok(())
}

fn run_server_command(args: ServerArgs, global_server: Option<&str>) -> Result<()> {
    match args.command {
        ServerCommand::Status(args) => {
            let endpoint = resolve_server_endpoint(args.server.as_deref(), global_server)?;
            let status = fetch_server_status(&endpoint)?;
            println!("endpoint={endpoint}");
            println!("protocol_version={}", status.protocol_version);
            println!("server_name={}", status.server_name);
            println!("started_at_unix_ms={}", status.started_at_unix_ms);
            println!("read_only={}", status.read_only);
            println!("status=ok");
            Ok(())
        }
    }
}

fn resolve_server_endpoint(
    command_server: Option<&str>,
    global_server: Option<&str>,
) -> Result<ServerEndpoint> {
    let endpoint = command_server
        .or(global_server)
        .map(ToOwned::to_owned)
        .or_else(|| std::env::var("CANRUSH_SERVER").ok())
        .unwrap_or_else(|| "local".to_string());
    parse_server_endpoint(&endpoint)
}

fn fetch_server_status(endpoint: &ServerEndpoint) -> Result<ServerStatusDto> {
    let url = format!("{}/api/v1/status", endpoint.http_base_url());
    let response = reqwest::blocking::get(&url)
        .map_err(|error| CanrushError::InvalidArgument(format!("server unreachable: {error}")))?;
    let response = response.error_for_status().map_err(|error| {
        CanrushError::InvalidArgument(format!("server status request failed: {error}"))
    })?;
    response
        .json::<ServerStatusDto>()
        .map_err(|error| CanrushError::InvalidArgument(format!("invalid server status: {error}")))
}

fn adapter_name(adapter: AdapterKind) -> &'static str {
    match adapter {
        AdapterKind::Fake => "fake",
        AdapterKind::Weact => "weact",
    }
}

fn parse_duration(value: &str) -> Result<Duration> {
    if let Some(milliseconds) = value.strip_suffix("ms") {
        let milliseconds = milliseconds.parse::<u64>().map_err(|_| {
            CanrushError::InvalidArgument(format!("invalid duration milliseconds: {value}"))
        })?;
        return Ok(Duration::from_millis(milliseconds));
    }
    if let Some(seconds) = value.strip_suffix('s') {
        let seconds = seconds.parse::<u64>().map_err(|_| {
            CanrushError::InvalidArgument(format!("invalid duration seconds: {value}"))
        })?;
        return Ok(Duration::from_secs(seconds));
    }

    let seconds = value
        .parse::<u64>()
        .map_err(|_| CanrushError::InvalidArgument(format!("invalid duration: {value}")))?;
    Ok(Duration::from_secs(seconds))
}

fn parse_id_filters(ids: &[String], ranges: &[String]) -> Result<Vec<CanIdFilter>> {
    let mut filters = Vec::with_capacity(ids.len() + ranges.len());
    for id in ids {
        filters.push(CanIdFilter::Exact(parse_can_id(id)?));
    }
    for range in ranges {
        let (start, end) = range.split_once('-').ok_or_else(|| {
            CanrushError::InvalidArgument(format!("invalid CAN ID range: {range}"))
        })?;
        let start = parse_can_id(start)?;
        let end = parse_can_id(end)?;
        if start > end {
            return Err(CanrushError::InvalidArgument(format!(
                "CAN ID range start must be <= end: {range}"
            )));
        }
        filters.push(CanIdFilter::Range { start, end });
    }
    Ok(filters)
}

fn parse_can_id(value: &str) -> Result<u32> {
    let trimmed = value.trim();
    let hex = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
        .unwrap_or(trimmed);
    u32::from_str_radix(hex, 16)
        .map_err(|_| CanrushError::InvalidArgument(format!("invalid CAN ID: {value}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_duration_suffixes() {
        assert_eq!(parse_duration("2s").unwrap(), Duration::from_secs(2));
        assert_eq!(parse_duration("250ms").unwrap(), Duration::from_millis(250));
        assert_eq!(parse_duration("3").unwrap(), Duration::from_secs(3));
    }

    #[test]
    fn parses_can_id_filters() {
        let filters = parse_id_filters(
            &["0x100".to_string(), "101".to_string()],
            &["0x200-0x20F".to_string()],
        )
        .unwrap();

        assert_eq!(filters.len(), 3);
        assert!(filters.iter().any(|filter| filter.matches(0x100)));
        assert!(filters.iter().any(|filter| filter.matches(0x101)));
        assert!(filters.iter().any(|filter| filter.matches(0x208)));
        assert!(!filters.iter().any(|filter| filter.matches(0x210)));
    }

    #[test]
    fn rejects_reversed_can_id_range() {
        let error = parse_id_filters(&[], &["0x200-0x100".to_string()]).unwrap_err();
        assert!(error.to_string().contains("start must be <= end"));
    }

    #[test]
    fn resolves_server_endpoint_priority() {
        let endpoint = resolve_server_endpoint(Some("192.168.0.10:49000"), Some("local")).unwrap();
        assert_eq!(endpoint.to_string(), "192.168.0.10:49000");

        let endpoint = resolve_server_endpoint(None, Some("local")).unwrap();
        assert_eq!(endpoint.to_string(), "127.0.0.1:49000");
    }

    #[test]
    fn builds_capture_stream_url() {
        let endpoint = parse_server_endpoint("127.0.0.1:49001").unwrap();
        let args = CaptureArgs {
            adapter: AdapterKind::Fake,
            port: None,
            baud: 1_000_000,
            bus: "CAN0".to_string(),
            all_buses: false,
            include_tx: false,
            ids: vec!["100".to_string()],
            id_ranges: vec!["200-20F".to_string()],
            max_frames: Some(10),
            max_bytes: None,
            duration: "1s".to_string(),
            output: PathBuf::from("capture.csv"),
            bitrate: "S4".to_string(),
            data_bitrate: "Y2".to_string(),
            listen_only: false,
        };

        assert_eq!(
            build_capture_stream_url(&endpoint, &args),
            "ws://127.0.0.1:49001/api/v1/sessions/default/stream?kind=capture&bus=CAN0&id=100&id_range=200-20F"
        );
    }

    #[test]
    fn formats_frame_event_as_csv_row() {
        let frame = FrameEventDto {
            event: "frame".to_string(),
            sequence: 1,
            timestamp_host_unix_ns: "1700000000123456700".to_string(),
            bus: "CAN0".to_string(),
            direction: "rx".to_string(),
            id: "0x123".to_string(),
            id_format: "standard".to_string(),
            frame_format: "classic".to_string(),
            frame_type: "data".to_string(),
            dlc: 2,
            data_length: 2,
            flags: String::new(),
            data_hex: "00FF".to_string(),
        };

        assert_eq!(
            frame_event_csv_line(&frame),
            "1700000000.123,CAN0,rx,0x123,standard,classic,data,2,2,,00FF"
        );
    }
}
