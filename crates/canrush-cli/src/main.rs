#![cfg_attr(test, allow(clippy::unwrap_used))]

use std::path::PathBuf;
use std::time::Duration;

use canrush_core::adapter::{
    list_serial_devices, FakeAdapter, FrameSource, WeActSerialAdapter, WeActSerialConfig,
};
use canrush_core::api::ServerStatusDto;
use canrush_core::capture::{capture_from_source, write_csv_file, CanIdFilter, CaptureOptions};
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

#[derive(Debug, Clone, Copy, ValueEnum)]
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
                return Err(CanrushError::InvalidArgument(
                    "Client mode capture is not implemented yet".to_string(),
                ));
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
}
