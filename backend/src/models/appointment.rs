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
