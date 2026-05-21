use std::fmt;
use std::io;

pub type Result<T> = std::result::Result<T, CanrushError>;

#[derive(Debug)]
pub enum CanrushError {
    InvalidFrame(String),
    InvalidArgument(String),
    Io(io::Error),
    Serial(serialport::Error),
}

impl fmt::Display for CanrushError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidFrame(message) => write!(f, "invalid CAN frame: {message}"),
            Self::InvalidArgument(message) => write!(f, "invalid argument: {message}"),
            Self::Io(error) => write!(f, "I/O error: {error}"),
            Self::Serial(error) => write!(f, "serial error: {error}"),
        }
    }
}

impl std::error::Error for CanrushError {}

impl From<io::Error> for CanrushError {
    fn from(value: io::Error) -> Self {
        Self::Io(value)
    }
}

impl From<serialport::Error> for CanrushError {
    fn from(value: serialport::Error) -> Self {
        Self::Serial(value)
    }
}
