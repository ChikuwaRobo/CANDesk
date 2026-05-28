use std::process::Child;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread::JoinHandle;
use std::time::Instant;

use canrush_core::parser::ParseConfig;
use canrush_core::plot::PlotLayout;
use canrush_core::server::LatestFrameState;

use crate::dto::ServerInfoDto;

pub(crate) struct StreamRuntime {
    pub(crate) stop: Arc<AtomicBool>,
    pub(crate) handle: JoinHandle<()>,
}

impl Drop for StreamRuntime {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        self.handle.thread().unpark();
    }
}

#[derive(Default)]
pub(crate) struct ReceiverInner {
    pub(crate) latest: LatestFrameState,
    pub(crate) stream: Option<StreamRuntime>,
    pub(crate) server_process: Option<ServerProcessRuntime>,
    pub(crate) server_info: Option<ServerInfoDto>,
    pub(crate) server_info_checked_at: Option<Instant>,
    pub(crate) parse_config: Option<ParseConfig>,
    pub(crate) plot_layout: Option<PlotLayout>,
    pub(crate) event_log: String,
}

#[derive(Default)]
pub(crate) struct ReceiverState {
    pub(crate) inner: Arc<Mutex<ReceiverInner>>,
}

pub(crate) struct ServerProcessRuntime {
    pub(crate) child: Child,
    pub(crate) started_at: Instant,
    pub(crate) exit_reason: Option<String>,
}

impl Drop for ServerProcessRuntime {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}
