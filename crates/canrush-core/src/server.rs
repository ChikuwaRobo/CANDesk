use std::collections::HashMap;

use crate::model::{CanFrame, FrameKey};

#[derive(Debug, Clone)]
pub struct LatestFrame {
    pub frame: CanFrame,
    pub receive_count: u64,
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
                latest.frame = frame.clone();
                latest.receive_count += 1;
            })
            .or_insert(LatestFrame {
                frame,
                receive_count: 1,
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
