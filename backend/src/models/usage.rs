use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageStats {
    pub user_id: Uuid,
    pub assistant_id: Uuid,
    pub period: String,
    pub total_tokens: i64,
    pub total_messages: i64,
    pub total_conversations: i32,
}
