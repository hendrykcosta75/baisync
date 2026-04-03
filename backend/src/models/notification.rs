use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    pub user_id: Uuid,
    pub id: Uuid,
    pub assistant_id: Option<Uuid>,
    pub integration_id: Option<Uuid>,
    pub notification_type: String,
    pub title: String,
    pub message: String,
    pub is_read: bool,
    pub created_at: DateTime<Utc>,
}
