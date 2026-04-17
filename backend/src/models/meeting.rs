use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Meeting {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub code: String,
    pub title: String,
    pub host_user_id: Uuid,
    pub created_by: Uuid,
    pub participant_mode: String,
    pub status: String,
    pub livekit_room_name: String,
    pub scheduled_start: Option<DateTime<Utc>>,
    pub started_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
    pub link_uses_remaining: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub share_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingParticipant {
    pub meeting_id: Uuid,
    pub participant_id: Uuid,
    pub user_id: Option<Uuid>,
    pub display_name: String,
    pub role: String,
    pub join_status: String,
    pub joined_at: Option<DateTime<Utc>>,
    pub left_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingMessage {
    pub id: Uuid,
    pub meeting_id: Uuid,
    pub participant_id: Uuid,
    pub display_name: String,
    pub body: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateMeetingRequest {
    pub title: Option<String>,
    pub participant_mode: Option<String>,
    pub scheduled_start: Option<DateTime<Utc>>,
    pub link_expiry: Option<String>,
    pub start_now: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct CreateMeetingResponse {
    pub meeting: Meeting,
    pub token: String,
    pub livekit_url: String,
}

#[derive(Debug, Serialize)]
pub struct JoinMeetingResponse {
    pub token: String,
    pub livekit_url: String,
    pub room: String,
    pub participant_id: Uuid,
    pub is_host: bool,
}

#[derive(Debug, Deserialize)]
pub struct GuestJoinRequest {
    pub display_name: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum GuestJoinResponse {
    Approved {
        token: String,
        livekit_url: String,
        room: String,
        participant_id: Uuid,
    },
    Pending {
        participant_id: Uuid,
    },
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum GuestStatusResponse {
    Pending,
    Approved {
        token: String,
        livekit_url: String,
        room: String,
    },
    Denied,
}

#[derive(Debug, Serialize)]
pub struct PublicMeetingInfo {
    pub code: String,
    pub title: String,
    pub host_name: Option<String>,
    pub participant_mode: String,
    pub status: String,
    pub knocking_required: bool,
}

#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    pub body: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_request_minimal() {
        let json = r#"{}"#;
        let req: CreateMeetingRequest = serde_json::from_str(json).unwrap();
        assert!(req.title.is_none());
        assert!(req.scheduled_start.is_none());
        assert!(req.start_now.is_none());
    }

    #[test]
    fn create_request_full() {
        let json = r#"{"title":"Weekly","participant_mode":"workspace","link_expiry":"7d","start_now":true}"#;
        let req: CreateMeetingRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.title.unwrap(), "Weekly");
        assert_eq!(req.participant_mode.unwrap(), "workspace");
        assert_eq!(req.link_expiry.unwrap(), "7d");
        assert_eq!(req.start_now.unwrap(), true);
    }

    #[test]
    fn guest_join_request_parses() {
        let json = r#"{"display_name":"Maria"}"#;
        let req: GuestJoinRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.display_name, "Maria");
    }

    #[test]
    fn guest_join_response_approved_shape() {
        let resp = GuestJoinResponse::Approved {
            token: "t".into(),
            livekit_url: "ws://x".into(),
            room: "r".into(),
            participant_id: Uuid::new_v4(),
        };
        let v = serde_json::to_value(resp).unwrap();
        assert_eq!(v["status"], "approved");
        assert_eq!(v["token"], "t");
    }

    #[test]
    fn guest_join_response_pending_shape() {
        let resp = GuestJoinResponse::Pending {
            participant_id: Uuid::new_v4(),
        };
        let v = serde_json::to_value(resp).unwrap();
        assert_eq!(v["status"], "pending");
        assert!(v["participant_id"].is_string());
    }
}
