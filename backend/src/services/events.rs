use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use tokio::sync::{broadcast, RwLock};
use uuid::Uuid;

const CHANNEL_CAPACITY: usize = 100;

/// Global event bus instance. Initialized once in main.rs via `init_global`.
static GLOBAL_BUS: OnceLock<EventBus> = OnceLock::new();

/// Initialize the global event bus. Call once at startup.
pub fn init_global(bus: EventBus) {
    let _ = GLOBAL_BUS.set(bus);
}

/// Publish an event via the global bus. No-op if not initialized or no subscribers.
pub async fn publish_global(user_id: &Uuid, event: SseEvent) {
    if let Some(bus) = GLOBAL_BUS.get() {
        bus.publish(user_id, event).await;
    }
}

#[derive(Debug, Clone)]
pub struct SseEvent {
    pub event_type: String,
    pub data: String,
}

/// Per-user event bus using broadcast channels.
/// Each user gets a broadcast::Sender when they first subscribe.
/// Multiple SSE connections per user are supported (each gets its own Receiver).
#[derive(Clone)]
pub struct EventBus {
    channels: Arc<RwLock<HashMap<Uuid, broadcast::Sender<SseEvent>>>>,
}

impl EventBus {
    pub fn new() -> Self {
        Self {
            channels: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Subscribe to events for a given user. Returns a broadcast Receiver.
    pub async fn subscribe(&self, user_id: Uuid) -> broadcast::Receiver<SseEvent> {
        let mut channels = self.channels.write().await;
        let sender = channels
            .entry(user_id)
            .or_insert_with(|| broadcast::channel(CHANNEL_CAPACITY).0);
        sender.subscribe()
    }

    /// Publish an event to a specific user. No-op if user has no subscribers.
    pub async fn publish(&self, user_id: &Uuid, event: SseEvent) {
        let channels = self.channels.read().await;
        if let Some(sender) = channels.get(user_id) {
            // Ignore send errors (no receivers connected)
            let _ = sender.send(event);
        }
    }

    /// Cleanup channels with no active receivers (call periodically or on disconnect).
    pub async fn cleanup(&self, user_id: &Uuid) {
        let mut channels = self.channels.write().await;
        if let Some(sender) = channels.get(user_id) {
            if sender.receiver_count() == 0 {
                channels.remove(user_id);
            }
        }
    }
}
