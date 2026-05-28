use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use canrush_core::api::ServerStatusDto;

use crate::dto::ServerInfoDto;
use crate::server_client::get_json;
use crate::state::{ReceiverInner, ServerProcessRuntime};
use crate::{
    set_event_log, SERVER_ENDPOINT, SERVER_INFO_REFRESH_INTERVAL, SERVER_POLL_INTERVAL,
    SERVER_STARTUP_TIMEOUT,
};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub(crate) fn start_local_server_for_state(
    shared: &Arc<Mutex<ReceiverInner>>,
) -> Result<ServerInfoDto, String> {
    if let Ok(status) = get_json::<ServerStatusDto>("/api/v1/status") {
        let info = server_info_from_status(status, "external", "running", "", "existing server");
        update_server_info(shared, info.clone())?;
        set_event_log(shared, "using existing local server".to_string())?;
        return Ok(info);
    }

    let executable = find_server_executable()?;
    let mut command = Command::new(&executable);
    command
        .arg("--listen")
        .arg("127.0.0.1:49000")
        .arg("--server-name")
        .arg("canrush-server-gui")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let child = command
        .spawn()
        .map_err(|error| format!("failed to spawn {}: {error}", executable.display()))?;
    {
        let mut inner = shared.lock().map_err(|error| error.to_string())?;
        inner.server_process = Some(ServerProcessRuntime {
            child,
            started_at: Instant::now(),
            exit_reason: None,
        });
        inner.server_info = None;
        inner.server_info_checked_at = None;
        inner.event_log = "local server process started".to_string();
    }

    let deadline = Instant::now() + SERVER_STARTUP_TIMEOUT;
    loop {
        match get_json::<ServerStatusDto>("/api/v1/status") {
            Ok(status) => {
                let info = server_info_from_status(status, "gui", "running", "", "server started");
                update_server_info(shared, info.clone())?;
                return Ok(info);
            }
            Err(status_error) => {
                if let Some(exit_reason) = poll_server_process(shared)? {
                    let info = disconnected_server_info(
                        "gui",
                        "exited",
                        &exit_reason,
                        &format!("server startup failed: {exit_reason}"),
                    );
                    update_server_info(shared, info.clone())?;
                    return Err(info.message);
                }
                if Instant::now() >= deadline {
                    let message = format!("server startup timeout: {status_error}");
                    let info = disconnected_server_info("gui", "starting", "", &message);
                    update_server_info(shared, info.clone())?;
                    return Err(message);
                }
                thread::sleep(SERVER_POLL_INTERVAL);
            }
        }
    }
}

pub(crate) fn refresh_server_info(
    shared: &Arc<Mutex<ReceiverInner>>,
) -> Result<ServerInfoDto, String> {
    let owner = current_server_owner(shared)?;
    if let Some(exit_reason) = poll_server_process(shared)? {
        let info = disconnected_server_info(
            &owner,
            "exited",
            &exit_reason,
            &format!("server process stopped: {exit_reason}"),
        );
        update_server_info(shared, info.clone())?;
        return Ok(info);
    }

    {
        let inner = shared.lock().map_err(|error| error.to_string())?;
        if let (Some(info), Some(checked_at)) = (&inner.server_info, inner.server_info_checked_at) {
            if checked_at.elapsed() < SERVER_INFO_REFRESH_INTERVAL {
                return Ok(info.clone());
            }
        }
    }

    let info = match get_json::<ServerStatusDto>("/api/v1/status") {
        Ok(status) => server_info_from_status(status, &owner, "running", "", "connected"),
        Err(error) => disconnected_server_info(&owner, "not-running", "", &error),
    };

    update_server_info(shared, info.clone())?;
    Ok(info)
}

fn server_info_from_status(
    status: ServerStatusDto,
    owner: &str,
    process_state: &str,
    exit_reason: &str,
    message: &str,
) -> ServerInfoDto {
    ServerInfoDto {
        endpoint: SERVER_ENDPOINT.to_string(),
        connected: true,
        server_name: status.server_name,
        protocol_version: status.protocol_version,
        started_at_unix_ms: status.started_at_unix_ms,
        read_only: status.read_only,
        process_state: process_state.to_string(),
        owner: owner.to_string(),
        exit_reason: exit_reason.to_string(),
        message: message.to_string(),
    }
}

fn disconnected_server_info(
    owner: &str,
    process_state: &str,
    exit_reason: &str,
    message: &str,
) -> ServerInfoDto {
    ServerInfoDto {
        endpoint: SERVER_ENDPOINT.to_string(),
        connected: false,
        server_name: "-".to_string(),
        protocol_version: "-".to_string(),
        started_at_unix_ms: "-".to_string(),
        read_only: false,
        process_state: process_state.to_string(),
        owner: owner.to_string(),
        exit_reason: exit_reason.to_string(),
        message: message.to_string(),
    }
}

fn update_server_info(
    shared: &Arc<Mutex<ReceiverInner>>,
    info: ServerInfoDto,
) -> Result<(), String> {
    let mut inner = shared.lock().map_err(|error| error.to_string())?;
    inner.server_info = Some(info);
    inner.server_info_checked_at = Some(Instant::now());
    Ok(())
}

fn current_server_owner(shared: &Arc<Mutex<ReceiverInner>>) -> Result<String, String> {
    let inner = shared.lock().map_err(|error| error.to_string())?;
    Ok(if inner.server_process.is_some() {
        "gui".to_string()
    } else {
        "external".to_string()
    })
}

fn poll_server_process(shared: &Arc<Mutex<ReceiverInner>>) -> Result<Option<String>, String> {
    let mut inner = shared.lock().map_err(|error| error.to_string())?;
    let Some(runtime) = inner.server_process.as_mut() else {
        return Ok(None);
    };
    if let Some(exit_reason) = &runtime.exit_reason {
        return Ok(Some(exit_reason.clone()));
    }
    match runtime
        .child
        .try_wait()
        .map_err(|error| error.to_string())?
    {
        Some(status) => {
            let elapsed_ms = runtime.started_at.elapsed().as_millis();
            let reason = match status.code() {
                Some(code) => format!("exit-code={code}; elapsed_ms={elapsed_ms}"),
                None => format!("terminated-by-signal; elapsed_ms={elapsed_ms}"),
            };
            runtime.exit_reason = Some(reason.clone());
            Ok(Some(reason))
        }
        None => Ok(None),
    }
}

fn find_server_executable() -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("CANRUSH_SERVER_PATH") {
        let candidate = PathBuf::from(path);
        if candidate.exists() {
            return Ok(candidate);
        }
        return Err(format!(
            "CANRUSH_SERVER_PATH does not exist: {}",
            candidate.display()
        ));
    }

    let executable_name = if cfg!(windows) {
        "canrush-server.exe"
    } else {
        "canrush-server"
    };
    let mut candidates = Vec::new();
    if let Ok(current) = std::env::current_exe() {
        if let Some(dir) = current.parent() {
            candidates.push(dir.join(executable_name));
        }
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(format!("../../../target/debug/{executable_name}")),
    );
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(format!("../../../target/release/{executable_name}")),
    );

    candidates
        .into_iter()
        .find(|candidate| candidate.exists())
        .ok_or_else(|| format!("canrush-server executable not found: {executable_name}"))
}

#[cfg(test)]
#[allow(clippy::panic)]
mod tests {
    use super::*;
    use crate::state::ReceiverState;

    #[test]
    fn server_manager_uses_existing_server_or_starts_gui_owned_server() {
        if get_json::<ServerStatusDto>("/api/v1/status").is_ok() {
            let state = ReceiverState::default();
            let info = match start_local_server_for_state(&state.inner) {
                Ok(info) => info,
                Err(error) => panic!("failed to use existing server: {error}"),
            };
            assert!(info.connected);
            assert_eq!(info.owner, "external");
            assert_eq!(info.process_state, "running");
            return;
        }

        let executable = match find_server_executable() {
            Ok(executable) => executable,
            Err(error) => panic!("server executable not found: {error}"),
        };
        let mut external = match Command::new(&executable)
            .arg("--listen")
            .arg("127.0.0.1:49000")
            .arg("--server-name")
            .arg("canrush-server-existing-test")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(child) => child,
            Err(error) => panic!("failed to start external server: {error}"),
        };
        wait_for_server_status();

        let external_state = ReceiverState::default();
        let external_info = match start_local_server_for_state(&external_state.inner) {
            Ok(info) => info,
            Err(error) => panic!("failed to bind to external server: {error}"),
        };
        assert!(external_info.connected);
        assert_eq!(external_info.owner, "external");
        assert_eq!(external_info.process_state, "running");
        assert_eq!(external_info.server_name, "canrush-server-existing-test");

        if let Err(error) = external.kill() {
            panic!("failed to kill external server: {error}");
        }
        if let Err(error) = external.wait() {
            panic!("failed to wait external server: {error}");
        }
        wait_for_server_shutdown();

        let gui_state = ReceiverState::default();
        let gui_info = match start_local_server_for_state(&gui_state.inner) {
            Ok(info) => info,
            Err(error) => panic!("failed to start gui-owned server: {error}"),
        };
        assert!(gui_info.connected);
        assert_eq!(gui_info.owner, "gui");
        assert_eq!(gui_info.process_state, "running");
        assert_eq!(gui_info.server_name, "canrush-server-gui");

        let stopped = match poll_server_process(&gui_state.inner) {
            Ok(stopped) => stopped,
            Err(error) => panic!("failed to poll gui-owned server: {error}"),
        };
        assert!(stopped.is_none());
    }

    fn wait_for_server_status() {
        let deadline = Instant::now() + SERVER_STARTUP_TIMEOUT;
        loop {
            if get_json::<ServerStatusDto>("/api/v1/status").is_ok() {
                return;
            }
            assert!(Instant::now() < deadline, "server did not start");
            thread::sleep(SERVER_POLL_INTERVAL);
        }
    }

    fn wait_for_server_shutdown() {
        let deadline = Instant::now() + SERVER_STARTUP_TIMEOUT;
        loop {
            if get_json::<ServerStatusDto>("/api/v1/status").is_err() {
                return;
            }
            assert!(Instant::now() < deadline, "server did not stop");
            thread::sleep(SERVER_POLL_INTERVAL);
        }
    }
}
