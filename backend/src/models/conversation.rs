use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub assistant_id: Uuid,
    pub user_id: Uuid,
    pub id: Uuid,
    pub contact_number: String,
    pub contact_name: Option<String>,
    pub contact_avatar_url: Option<String>,
    pub channel: String,
    pub started_at: DateTime<Utc>,
    pub last_message_at: DateTime<Utc>,
    pub summary: Option<String>,
    pub ai_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub conversation_id: Uuid,
    pub id: Uuid,
    pub role: String,
    pub content: Option<String>,
    pub media_url: Option<String>,
    pub media_type: Option<String>,
    pub media_base64: Option<String>,
    /// Plain text extracted from office documents (XLSX/DOCX) whose bytes no
    /// LLM provider accepts inline. Reinjected into LlmMessage.content at
    /// call time without touching `content` (which drives the UI).
    pub media_extracted_text: Option<String>,
    pub tokens_used: Option<i32>,
    pub sub_agent_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}
