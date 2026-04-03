use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;

/// In-memory store for WhatsApp connection states (QR codes, status).
/// Keyed by phone number.
#[derive(Debug, Clone)]
pub struct ConnectionStateStore {
    inner: Arc<Mutex<HashMap<String, ConnectionState>>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConnectionState {
    pub status: String,
    pub qr_data_url: Option<String>,
}

impl ConnectionStateStore {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn set(&self, phone: &str, state: ConnectionState) {
        let mut map = self.inner.lock().unwrap();
        map.insert(phone.to_string(), state);
    }

    pub fn get(&self, phone: &str) -> Option<ConnectionState> {
        let map = self.inner.lock().unwrap();
        map.get(phone).cloned()
    }

    pub fn remove(&self, phone: &str) {
        let mut map = self.inner.lock().unwrap();
        map.remove(phone);
    }
}
