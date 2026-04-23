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

/// Check if a user has at least one active SSE subscriber on the global bus.
/// Returns `false` if the bus is not initialized.
pub async fn is_online(user_id: &Uuid) -> bool {
    if let Some(bus) = GLOBAL_BUS.get() {
        bus.is_online(user_id).await
    } else {
        false
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

    /// Returns true if the user has at least one live receiver subscribed.
    pub async fn is_online(&self, user_id: &Uuid) -> bool {
        let channels = self.channels.read().await;
        channels
            .get(user_id)
            .map(|s| s.receiver_count() > 0)
            .unwrap_or(false)
    }

    /// Cleanup channels with no active receivers (call periodically or on disconnect).
    #[allow(dead_code)]
    pub async fn cleanup(&self, user_id: &Uuid) {
        let mut channels = self.channels.write().await;
        if let Some(sender) = channels.get(user_id) {
            if sender.receiver_count() == 0 {
                channels.remove(user_id);
            }
        }
    }
}
