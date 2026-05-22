use std::collections::HashMap;
use std::collections::VecDeque;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::model::{CanFrame, FrameKey};

pub const FRAME_RATE_BUCKET_MS: u64 = 500;
pub const FRAME_RATE_WINDOW_BUCKETS: u64 = 2;

#[derive(Debug, Clone)]
pub struct LatestFrame {
    pub frame: CanFrame,
    pub receive_count: u64,
    pub previous_timestamp_host: Option<SystemTime>,
    pub rate_buckets: VecDeque<FrameRateBucket>,
}

#[derive(Debug, Clone)]
pub struct FrameRateBucket {
    pub index: u64,
    pub count: u64,
}

#[derive(Debug, Default, Clone)]
pub struct LatestFrameState {
    frames: HashMap<FrameKey, LatestFrame>,
}

impl LatestFrameState {
    pub fn ingest(&mut self, frame: CanFrame) {
        let key = frame.key();
        self.frames
            .entry(key)
            .and_modify(|latest| {
                latest.previous_timestamp_host = Some(latest.frame.timestamp_host);
                latest.frame = frame.clone();
                latest.receive_count += 1;
                latest.ingest_rate_bucket(frame.timestamp_host);
            })
            .or_insert_with(|| {
                let mut latest = LatestFrame {
                    frame: frame.clone(),
                    receive_count: 1,
                    previous_timestamp_host: None,
                    rate_buckets: VecDeque::new(),
                };
                latest.ingest_rate_bucket(frame.timestamp_host);
                latest
            });
    }

    pub fn len(&self) -> usize {
        self.frames.len()
    }

    pub fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }

    pub fn values(&self) -> impl Iterator<Item = &LatestFrame> {
        self.frames.values()
    }
}

impl LatestFrame {
    fn ingest_rate_bucket(&mut self, timestamp: SystemTime) {
        let Some(index) = rate_bucket_index(timestamp) else {
            return;
        };
        match self.rate_buckets.back_mut() {
            Some(bucket) if bucket.index == index => bucket.count += 1,
            _ => self
                .rate_buckets
                .push_back(FrameRateBucket { index, count: 1 }),
        }
        while self
            .rate_buckets
            .front()
            .is_some_and(|bucket| bucket.index + FRAME_RATE_WINDOW_BUCKETS < index)
        {
            self.rate_buckets.pop_front();
        }
    }
}

fn rate_bucket_index(timestamp: SystemTime) -> Option<u64> {
    timestamp
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| (duration.as_millis() as u64) / FRAME_RATE_BUCKET_MS)
}

#[derive(Debug, Default, Clone)]
pub struct FrameHub {
    frames: Vec<CanFrame>,
    latest: LatestFrameState,
}

impl FrameHub {
    pub fn publish(&mut self, frame: CanFrame) {
        self.latest.ingest(frame.clone());
        self.frames.push(frame);
    }

    pub fn frames(&self) -> &[CanFrame] {
        &self.frames
    }

    pub fn latest(&self) -> &LatestFrameState {
        &self.latest
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::slcan;

    #[test]
    fn latest_state_groups_by_frame_key() {
        let first = slcan::parse_line("t100111\r", "CAN0").unwrap();
        let second = slcan::parse_line("t100122\r", "CAN0").unwrap();
        let mut state = LatestFrameState::default();
        state.ingest(first);
        state.ingest(second);
        assert_eq!(state.len(), 1);
        let latest = state.values().next().unwrap();
        assert_eq!(latest.receive_count, 2);
        assert_eq!(latest.frame.data_hex(), "22");
    }
}
