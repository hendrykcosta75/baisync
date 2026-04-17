use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Appointment {
    pub user_id: Uuid,
    pub id: Uuid,
    pub assistant_id: Option<Uuid>,
    pub client_name: String,
    pub client_email: Option<String>,
    pub client_phone: String,
    pub date_time: DateTime<Utc>,
    pub duration_minutes: i32,
    pub appointment_type: Option<String>,
    pub notes: Option<String>,
    pub origin_channel: Option<String>,
    pub status: String,
    pub conversation_id: Option<Uuid>,
    pub is_manual: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub meeting_id: Option<Uuid>,
    pub meeting_code: Option<String>,
    pub meeting_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateAppointmentRequest {
    pub assistant_id: Option<Uuid>,
    pub client_name: String,
    pub client_email: Option<String>,
    pub client_phone: String,
    pub date_time: DateTime<Utc>,
    pub duration_minutes: Option<i32>,
    pub appointment_type: Option<String>,
    pub notes: Option<String>,
    pub origin_channel: Option<String>,
    pub conversation_id: Option<Uuid>,
    pub is_manual: Option<bool>,
    pub meeting_id: Option<Uuid>,
    pub meeting_code: Option<String>,
    pub meeting_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateAppointmentRequest {
    pub status: Option<String>,
    pub date_time: Option<DateTime<Utc>>,
    pub notes: Option<String>,
    pub duration_minutes: Option<i32>,
    pub appointment_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvailabilityConfig {
    pub assistant_id: Uuid,
    pub user_id: Uuid,
    pub timezone: String,
    pub default_duration_minutes: i32,
    pub buffer_minutes: i32,
    pub max_per_day: i32,
    pub blocked_dates: Vec<String>,
    pub schedule_json: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateAvailabilityRequest {
    pub timezone: Option<String>,
    pub default_duration_minutes: Option<i32>,
    pub buffer_minutes: Option<i32>,
    pub max_per_day: Option<i32>,
    pub blocked_dates: Option<Vec<String>>,
    pub schedule: Option<serde_json::Value>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_appointment_request_minimal() {
        let json = r#"{
            "client_name":"John","client_phone":"+5511999",
            "date_time":"2026-05-01T10:00:00Z"
        }"#;
        let req: CreateAppointmentRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.client_name, "John");
        assert_eq!(req.client_phone, "+5511999");
        assert!(req.assistant_id.is_none());
        assert!(req.duration_minutes.is_none());
        assert!(req.is_manual.is_none());
    }

    #[test]
    fn create_appointment_request_full() {
        let ast_id = Uuid::new_v4();
        let json = format!(
            r#"{{
            "assistant_id":"{}","client_name":"Jane","client_email":"jane@test.com",
            "client_phone":"+5511888","date_time":"2026-06-01T14:00:00Z",
            "duration_minutes":60,"appointment_type":"consultation",
            "notes":"First visit","is_manual":true
        }}"#,
            ast_id
        );
        let req: CreateAppointmentRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(req.assistant_id, Some(ast_id));
        assert_eq!(req.client_email, Some("jane@test.com".into()));
        assert_eq!(req.duration_minutes, Some(60));
        assert_eq!(req.is_manual, Some(true));
    }

    #[test]
    fn update_appointment_request_all_optional() {
        let json = r#"{}"#;
        let req: UpdateAppointmentRequest = serde_json::from_str(json).unwrap();
        assert!(req.status.is_none());
        assert!(req.date_time.is_none());
        assert!(req.notes.is_none());
    }

    #[test]
    fn update_appointment_request_with_status() {
        let json = r#"{"status":"cancelled"}"#;
        let req: UpdateAppointmentRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.status.unwrap(), "cancelled");
    }

    #[test]
    fn availability_config_serializes() {
        let config = AvailabilityConfig {
            assistant_id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            timezone: "America/Sao_Paulo".into(),
            default_duration_minutes: 30,
            buffer_minutes: 10,
            max_per_day: 8,
            blocked_dates: vec!["2026-12-25".into()],
            schedule_json: None,
        };
        let json = serde_json::to_value(&config).unwrap();
        assert_eq!(json["timezone"], "America/Sao_Paulo");
        assert_eq!(json["default_duration_minutes"], 30);
        assert_eq!(json["max_per_day"], 8);
        assert_eq!(json["blocked_dates"], serde_json::json!(["2026-12-25"]));
    }

    #[test]
    fn update_availability_partial() {
        let json = r#"{"timezone":"UTC","buffer_minutes":15}"#;
        let req: UpdateAvailabilityRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.timezone.unwrap(), "UTC");
        assert_eq!(req.buffer_minutes, Some(15));
        assert!(req.default_duration_minutes.is_none());
    }
}
