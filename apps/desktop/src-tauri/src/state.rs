use std::collections::VecDeque;
use std::process::Child;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread::JoinHandle;
use std::time::Instant;

use canrush_core::model::CanFrame;
use canrush_core::parser::ParseConfig;
use canrush_core::plot::PlotLayout;
use canrush_core::server::LatestFrameState;

use crate::dto::ServerInfoDto;

pub(crate) const PLOT_FRAME_HISTORY_LIMIT: usize = 120_000;

#[derive(Debug, Clone)]
pub(crate) struct PlotFrameHistoryEntry {
    pub(crate) sequence: u64,
    pub(crate) frame: CanFrame,
}

#[derive(Debug)]
pub(crate) struct PlotFrameHistory {
    next_sequence: u64,
    entries: VecDeque<PlotFrameHistoryEntry>,
    limit: usize,
}

impl Default for PlotFrameHistory {
    fn default() -> Self {
        Self {
            next_sequence: 1,
            entries: VecDeque::with_capacity(PLOT_FRAME_HISTORY_LIMIT.min(4096)),
            limit: PLOT_FRAME_HISTORY_LIMIT,
        }
    }
}

impl PlotFrameHistory {
    pub(crate) fn push(&mut self, frame: CanFrame) {
        let sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.saturating_add(1);
        self.entries
            .push_back(PlotFrameHistoryEntry { sequence, frame });
        while self.entries.len() > self.limit {
            let _ = self.entries.pop_front();
        }
    }

    pub(crate) fn since(&self, since_sequence: Option<u64>) -> (Vec<PlotFrameHistoryEntry>, u64) {
        let since_sequence = since_sequence.unwrap_or(0);
        let entries = self
            .entries
            .iter()
            .filter(|entry| entry.sequence > since_sequence)
            .cloned()
            .collect::<Vec<_>>();
        (entries, self.next_sequence.saturating_sub(1))
    }

    pub(crate) fn clear(&mut self) {
        self.entries.clear();
    }
}

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
    pub(crate) plot_history: PlotFrameHistory,
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
