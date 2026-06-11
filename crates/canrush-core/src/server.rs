use std::collections::HashMap;
use std::collections::VecDeque;
use std::sync::mpsc::{Receiver, SyncSender, TrySendError};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::capture::CanIdFilter;
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
    next_sequence: u64,
    subscribers: Vec<FrameSubscriber>,
}

impl FrameHub {
    pub fn publish(&mut self, frame: CanFrame) {
        let event = SequencedFrame {
            sequence: self.next_sequence,
            frame: frame.clone(),
        };
        self.next_sequence += 1;
        self.publish_to_subscribers(&event);
        self.latest.ingest(frame.clone());
        self.frames.push(frame);
    }

    pub fn frames(&self) -> &[CanFrame] {
        &self.frames
    }

    pub fn latest(&self) -> &LatestFrameState {
        &self.latest
    }

    pub fn subscribe(&mut self, options: SubscribeOptions) -> FrameSubscription {
        let (sender, receiver) = std::sync::mpsc::sync_channel(options.queue_capacity);
        let id = self.subscribers.len() as u64 + 1;
        self.subscribers.push(FrameSubscriber {
            id,
            options,
            sender,
            dropped_count: 0,
            disconnected: false,
        });
        FrameSubscription { id, receiver }
    }

    pub fn unsubscribe(&mut self, id: u64) -> Option<SubscriberStats> {
        self.subscribers
            .iter()
            .position(|subscriber| subscriber.id == id)
            .map(|index| {
                let subscriber = self.subscribers.remove(index);
                SubscriberStats {
                    id: subscriber.id,
                    dropped_count: subscriber.dropped_count,
                }
            })
    }

    pub fn subscriber_stats(&self, id: u64) -> Option<SubscriberStats> {
        self.subscribers
            .iter()
            .find(|subscriber| subscriber.id == id)
            .map(|subscriber| SubscriberStats {
                id: subscriber.id,
                dropped_count: subscriber.dropped_count,
            })
    }

    fn publish_to_subscribers(&mut self, event: &SequencedFrame) {
        for subscriber in &mut self.subscribers {
            if subscriber.disconnected || !subscriber.options.accepts(&event.frame) {
                continue;
            }
            match subscriber.sender.try_send(event.clone()) {
                Ok(()) => {}
                Err(TrySendError::Full(_)) => subscriber.dropped_count += 1,
                Err(TrySendError::Disconnected(_)) => subscriber.disconnected = true,
            }
        }
        self.subscribers
            .retain(|subscriber| !subscriber.disconnected);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SequencedFrame {
    pub sequence: u64,
    pub frame: CanFrame,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubscriberKind {
    Gui,
    Capture,
    Plot,
}

#[derive(Debug, Clone)]
pub struct SubscribeOptions {
    pub kind: SubscriberKind,
    pub queue_capacity: usize,
    pub bus: Option<String>,
    pub id_filters: Vec<CanIdFilter>,
}

impl SubscribeOptions {
    pub fn gui() -> Self {
        Self {
            kind: SubscriberKind::Gui,
            queue_capacity: 16_384,
            bus: None,
            id_filters: Vec::new(),
        }
    }

    pub fn capture() -> Self {
        Self {
            kind: SubscriberKind::Capture,
            queue_capacity: 8192,
            bus: None,
            id_filters: Vec::new(),
        }
    }

    pub fn plot() -> Self {
        Self {
            kind: SubscriberKind::Plot,
            queue_capacity: 2048,
            bus: None,
            id_filters: Vec::new(),
        }
    }

    pub fn accepts(&self, frame: &CanFrame) -> bool {
        let bus_matches = self.bus.as_ref().is_none_or(|bus| frame.bus == *bus);
        let id_matches = self.id_filters.is_empty()
            || self
                .id_filters
                .iter()
                .any(|filter| filter.matches(frame.id));
        bus_matches && id_matches
    }
}

#[derive(Debug, Clone)]
struct FrameSubscriber {
    id: u64,
    options: SubscribeOptions,
    sender: SyncSender<SequencedFrame>,
    dropped_count: u64,
    disconnected: bool,
}

#[derive(Debug)]
pub struct FrameSubscription {
    id: u64,
    receiver: Receiver<SequencedFrame>,
}

impl FrameSubscription {
    pub fn id(&self) -> u64 {
        self.id
    }

    pub fn try_recv(&self) -> Option<SequencedFrame> {
        self.receiver.try_recv().ok()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SubscriberStats {
    pub id: u64,
    pub dropped_count: u64,
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

    #[test]
    fn subscriber_receives_matching_frames() {
        let mut hub = FrameHub::default();
        let subscription = hub.subscribe(SubscribeOptions {
            kind: SubscriberKind::Capture,
            queue_capacity: 4,
            bus: Some("CAN0".to_string()),
            id_filters: vec![CanIdFilter::Exact(0x100)],
        });

        hub.publish(slcan::parse_line("t100111\r", "CAN0").unwrap());
        hub.publish(slcan::parse_line("t101122\r", "CAN0").unwrap());
        hub.publish(slcan::parse_line("t100133\r", "CAN1").unwrap());

        let event = subscription.try_recv().unwrap();
        assert_eq!(event.sequence, 0);
        assert_eq!(event.frame.id, 0x100);
        assert!(subscription.try_recv().is_none());
    }

    #[test]
    fn subscriber_overflow_is_counted_without_blocking() {
        let mut hub = FrameHub::default();
        let subscription = hub.subscribe(SubscribeOptions {
            kind: SubscriberKind::Gui,
            queue_capacity: 1,
            bus: None,
            id_filters: Vec::new(),
        });

        hub.publish(slcan::parse_line("t100111\r", "CAN0").unwrap());
        hub.publish(slcan::parse_line("t101122\r", "CAN0").unwrap());
        hub.publish(slcan::parse_line("t102133\r", "CAN0").unwrap());

        assert_eq!(
            hub.subscriber_stats(subscription.id())
                .unwrap()
                .dropped_count,
            2
        );
        assert_eq!(hub.frames().len(), 3);
        assert_eq!(subscription.try_recv().unwrap().frame.id, 0x100);
    }

    #[test]
    fn unsubscribe_returns_drop_count() {
        let mut hub = FrameHub::default();
        let subscription = hub.subscribe(SubscribeOptions {
            kind: SubscriberKind::Gui,
            queue_capacity: 1,
            bus: None,
            id_filters: Vec::new(),
        });
        hub.publish(slcan::parse_line("t100111\r", "CAN0").unwrap());
        hub.publish(slcan::parse_line("t101122\r", "CAN0").unwrap());

        let stats = hub.unsubscribe(subscription.id()).unwrap();
        assert_eq!(stats.id, subscription.id());
        assert_eq!(stats.dropped_count, 1);
        assert!(hub.subscriber_stats(subscription.id()).is_none());
    }
}
