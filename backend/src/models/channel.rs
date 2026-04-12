use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Channel {
    pub workspace_id: Uuid,
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    #[serde(rename = "type")]
    pub channel_type: String,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelMember {
    pub channel_id: Uuid,
    pub user_id: Uuid,
    pub workspace_id: Uuid,
    pub role: String,
    pub last_read_at: Option<DateTime<Utc>>,
    pub joined_at: DateTime<Utc>,
    pub user_name: Option<String>,
    pub user_email: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelMessage {
    pub channel_id: Uuid,
    pub id: Uuid,
    pub sender_id: Uuid,
    pub sender_name: String,
    pub content: String,
    pub message_type: String,
    pub edited_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserChannel {
    pub user_id: Uuid,
    pub workspace_id: Uuid,
    pub channel_id: Uuid,
    pub channel_name: String,
    pub channel_type: String,
    pub unread_count: i32,
    pub last_message_at: Option<DateTime<Utc>>,
}

// Request types

#[derive(Debug, Deserialize)]
pub struct CreateChannelRequest {
    pub name: String,
    pub description: Option<String>,
    #[serde(default = "default_channel_type")]
    pub channel_type: String,
}

fn default_channel_type() -> String {
    "public".to_string()
}

#[derive(Debug, Deserialize)]
pub struct UpdateChannelRequest {
    pub name: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct EditMessageRequest {
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateDmRequest {
    pub user_id: Uuid,
}

#[derive(Debug, Deserialize)]
pub struct CreateNoteRequest {
    pub title: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateNoteRequest {
    pub title: Option<String>,
    pub content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelNote {
    pub channel_id: Uuid,
    pub id: Uuid,
    pub title: String,
    pub content: String,
    pub created_by: Uuid,
    pub updated_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// Response types

#[derive(Debug, Serialize)]
pub struct ChannelWithUnread {
    #[serde(flatten)]
    pub channel: Channel,
    pub unread_count: i32,
}

#[derive(Debug, Serialize)]
pub struct MessagesPage {
    pub messages: Vec<ChannelMessage>,
    pub next_cursor: Option<String>,
}
