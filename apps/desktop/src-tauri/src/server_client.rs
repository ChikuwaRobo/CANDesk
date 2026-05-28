use serde::{de::DeserializeOwned, Serialize};

use canrush_core::endpoint::ServerEndpoint;

use crate::{SERVER_ENDPOINT, SERVER_HTTP_TIMEOUT};

pub(crate) fn server_endpoint() -> Result<ServerEndpoint, String> {
    SERVER_ENDPOINT
        .parse::<ServerEndpoint>()
        .map_err(|error| error.to_string())
}

pub(crate) fn get_json<T>(path: &str) -> Result<T, String>
where
    T: DeserializeOwned,
{
    let endpoint = server_endpoint()?;
    let client = reqwest::blocking::Client::builder()
        .timeout(SERVER_HTTP_TIMEOUT)
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(format!("{}{}", endpoint.http_base_url(), path))
        .send()
        .map_err(|error| error.to_string())?;
    parse_response(response)
}

pub(crate) fn post_json<T, B>(path: &str, body: &B) -> Result<T, String>
where
    T: DeserializeOwned,
    B: Serialize + ?Sized,
{
    let endpoint = server_endpoint()?;
    let client = reqwest::blocking::Client::builder()
        .timeout(SERVER_HTTP_TIMEOUT)
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .post(format!("{}{}", endpoint.http_base_url(), path))
        .json(body)
        .send()
        .map_err(|error| error.to_string())?;
    parse_response(response)
}

fn parse_response<T>(response: reqwest::blocking::Response) -> Result<T, String>
where
    T: DeserializeOwned,
{
    let status = response.status();
    let text = response.text().map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format!("server returned {status}: {text}"));
    }
    serde_json::from_str(&text).map_err(|error| format!("invalid server response: {error}"))
}
