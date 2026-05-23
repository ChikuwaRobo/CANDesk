use std::fmt;
use std::str::FromStr;

use crate::error::{CanrushError, Result};

pub const DEFAULT_SERVER_PORT: u16 = 49_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerEndpoint {
    host: String,
    port: u16,
}

impl ServerEndpoint {
    pub fn local() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: DEFAULT_SERVER_PORT,
        }
    }

    pub fn host(&self) -> &str {
        &self.host
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn http_base_url(&self) -> String {
        format!("http://{}:{}", self.host, self.port)
    }

    pub fn ws_base_url(&self) -> String {
        format!("ws://{}:{}", self.host, self.port)
    }
}

impl FromStr for ServerEndpoint {
    type Err = CanrushError;

    fn from_str(value: &str) -> Result<Self> {
        parse_server_endpoint(value)
    }
}

impl fmt::Display for ServerEndpoint {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}:{}", self.host, self.port)
    }
}

pub fn parse_server_endpoint(value: &str) -> Result<ServerEndpoint> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(CanrushError::InvalidArgument(
            "server endpoint must not be empty".to_string(),
        ));
    }
    if trimmed.eq_ignore_ascii_case("local") {
        return Ok(ServerEndpoint::local());
    }

    let without_scheme = trimmed
        .strip_prefix("http://")
        .or_else(|| trimmed.strip_prefix("ws://"))
        .unwrap_or(trimmed);
    if without_scheme.contains("://") {
        return Err(CanrushError::InvalidArgument(format!(
            "unsupported server endpoint scheme: {value}"
        )));
    }

    let without_path = without_scheme.split('/').next().unwrap_or(without_scheme);
    let (host, port) = without_path.rsplit_once(':').ok_or_else(|| {
        CanrushError::InvalidArgument(format!(
            "server endpoint must include host and port: {value}"
        ))
    })?;
    if host.trim().is_empty() {
        return Err(CanrushError::InvalidArgument(format!(
            "server endpoint host is empty: {value}"
        )));
    }
    let port = port.parse::<u16>().map_err(|_| {
        CanrushError::InvalidArgument(format!("server endpoint port is invalid: {value}"))
    })?;
    Ok(ServerEndpoint {
        host: host.to_string(),
        port,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_local_endpoint() {
        let endpoint = parse_server_endpoint("local").unwrap();
        assert_eq!(endpoint.host(), "127.0.0.1");
        assert_eq!(endpoint.port(), DEFAULT_SERVER_PORT);
        assert_eq!(endpoint.http_base_url(), "http://127.0.0.1:49000");
        assert_eq!(endpoint.ws_base_url(), "ws://127.0.0.1:49000");
    }

    #[test]
    fn parses_host_port_endpoint() {
        let endpoint = parse_server_endpoint("192.168.0.10:49000").unwrap();
        assert_eq!(endpoint.host(), "192.168.0.10");
        assert_eq!(endpoint.port(), 49_000);
    }

    #[test]
    fn parses_scheme_endpoint() {
        let endpoint = parse_server_endpoint("http://canrush.local:49100").unwrap();
        assert_eq!(endpoint.host(), "canrush.local");
        assert_eq!(endpoint.port(), 49_100);

        let endpoint = parse_server_endpoint("ws://canrush.local:49200/api/v1").unwrap();
        assert_eq!(endpoint.host(), "canrush.local");
        assert_eq!(endpoint.port(), 49_200);
    }

    #[test]
    fn rejects_invalid_endpoint() {
        assert!(parse_server_endpoint("").is_err());
        assert!(parse_server_endpoint("example.local").is_err());
        assert!(parse_server_endpoint("ftp://example.local:49000").is_err());
        assert!(parse_server_endpoint(":49000").is_err());
        assert!(parse_server_endpoint("example.local:not-a-port").is_err());
    }
}
