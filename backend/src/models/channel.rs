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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mentioned_user_ids: Option<Vec<Uuid>>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelCanvas {
    pub channel_id: Uuid,
    pub id: Uuid,
    pub title: String,
    #[serde(default)]
    pub canvas_data: String,
    pub created_by: Uuid,
    pub updated_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateCanvasRequest {
    pub title: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCanvasRequest {
    pub title: Option<String>,
    pub canvas_data: Option<String>,
}

// Response types

#[allow(dead_code)]
#[derive(Debug, Serialize)]
pub struct ChannelWithUnread {
    #[serde(flatten)]
    pub channel: Channel,
    pub unread_count: i32,
}

#[allow(dead_code)]
#[derive(Debug, Serialize)]
pub struct MessagesPage {
    pub messages: Vec<ChannelMessage>,
    pub next_cursor: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn default_channel_type_is_public() {
        assert_eq!(default_channel_type(), "public");
    }

    #[test]
    fn create_channel_request_deserializes_with_defaults() {
        let json = r#"{"name":"general"}"#;
        let req: CreateChannelRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.name, "general");
        assert_eq!(req.channel_type, "public");
        assert!(req.description.is_none());
    }

    #[test]
    fn create_channel_request_deserializes_with_all_fields() {
        let json = r#"{"name":"secret","description":"Private channel","channel_type":"private"}"#;
        let req: CreateChannelRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.name, "secret");
        assert_eq!(req.channel_type, "private");
        assert_eq!(req.description.unwrap(), "Private channel");
    }

    #[test]
    fn update_channel_request_all_optional() {
        let json = r#"{}"#;
        let req: UpdateChannelRequest = serde_json::from_str(json).unwrap();
        assert!(req.name.is_none());
        assert!(req.description.is_none());
    }

    #[test]
    fn channel_with_unread_flattens_channel_fields() {
        let channel = Channel {
            workspace_id: Uuid::new_v4(),
            id: Uuid::new_v4(),
            name: "test".into(),
            description: None,
            channel_type: "public".into(),
            created_by: Uuid::new_v4(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let with_unread = ChannelWithUnread {
            channel,
            unread_count: 5,
        };
        let json = serde_json::to_value(&with_unread).unwrap();
        assert_eq!(json["name"], "test");
        assert_eq!(json["unread_count"], 5);
        assert_eq!(json["type"], "public"); // serde rename
    }

    #[test]
    fn messages_page_serializes() {
        let page = MessagesPage {
            messages: vec![],
            next_cursor: Some("abc123".into()),
        };
        let json = serde_json::to_value(&page).unwrap();
        assert_eq!(json["messages"], serde_json::json!([]));
        assert_eq!(json["next_cursor"], "abc123");
    }

    #[test]
    fn send_message_request_deserializes() {
        let json = r#"{"content":"Hello world"}"#;
        let req: SendMessageRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.content, "Hello world");
    }

    #[test]
    fn create_dm_request_deserializes() {
        let uid = Uuid::new_v4();
        let json = format!(r#"{{"user_id":"{}"}}"#, uid);
        let req: CreateDmRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(req.user_id, uid);
    }

    #[test]
    fn channel_note_roundtrip() {
        let note = ChannelNote {
            channel_id: Uuid::new_v4(),
            id: Uuid::new_v4(),
            title: "My Note".into(),
            content: "Some content".into(),
            created_by: Uuid::new_v4(),
            updated_by: Uuid::new_v4(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let json = serde_json::to_string(&note).unwrap();
        let deser: ChannelNote = serde_json::from_str(&json).unwrap();
        assert_eq!(deser.title, "My Note");
        assert_eq!(deser.content, "Some content");
    }

    #[test]
    fn canvas_data_defaults_to_empty() {
        // canvas_data has #[serde(default)] so it should default to empty string
        let json = format!(
            r#"{{"channel_id":"{}","id":"{}","title":"Canvas","created_by":"{}","updated_by":"{}","created_at":"2024-01-01T00:00:00Z","updated_at":"2024-01-01T00:00:00Z"}}"#,
            Uuid::new_v4(),
            Uuid::new_v4(),
            Uuid::new_v4(),
            Uuid::new_v4()
        );
        let canvas: ChannelCanvas = serde_json::from_str(&json).unwrap();
        assert_eq!(canvas.canvas_data, "");
        assert_eq!(canvas.title, "Canvas");
    }
}
