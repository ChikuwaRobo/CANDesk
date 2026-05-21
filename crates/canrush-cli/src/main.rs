#![cfg_attr(test, allow(clippy::unwrap_used))]

use std::path::PathBuf;
use std::time::Duration;

use canrush_core::adapter::{
    list_serial_devices, FakeAdapter, FrameSource, WeActSerialAdapter, WeActSerialConfig,
};
use canrush_core::capture::{capture_from_source, write_csv_file, CaptureOptions};
use canrush_core::error::{CanrushError, Result};
use clap::{Parser, Subcommand, ValueEnum};

#[derive(Debug, Parser)]
#[command(name = "canrush")]
#[command(about = "CANRush command line tools")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Debug, Subcommand)]
enum Commands {
    Capture(CaptureArgs),
    ListPorts,
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
        Commands::Capture(args) => run_capture(args),
        Commands::ListPorts => run_list_ports(),
    }
}

fn run_capture(args: CaptureArgs) -> Result<()> {
    let duration = parse_duration(&args.duration)?;
    let options = CaptureOptions {
        duration,
        bus: if args.all_buses {
            None
        } else {
            Some(args.bus.clone())
        },
        include_tx: args.include_tx,
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
        "captured {} frame(s) to {}",
        result.frames.len(),
        args.output.display()
    );
    Ok(())
}

fn run_list_ports() -> Result<()> {
    for device in list_serial_devices()? {
        println!("{}\t{}", device.port_name, device.port_type);
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_duration_suffixes() {
        assert_eq!(parse_duration("2s").unwrap(), Duration::from_secs(2));
        assert_eq!(parse_duration("250ms").unwrap(), Duration::from_millis(250));
        assert_eq!(parse_duration("3").unwrap(), Duration::from_secs(3));
    }
}
