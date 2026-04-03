use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantIntegration {
    pub assistant_id: Uuid,
    pub user_id: Uuid,
    pub id: Uuid,
    pub channel: String,
    pub provider: String,
    pub status: String,
    pub config_token: Option<String>,
    pub config_phone_number: Option<String>,
    pub config_chatwoot_url: Option<String>,
    pub config_rate_limit_per_day: Option<i32>,
    pub config_max_message_length: Option<i32>,
    pub config_audio_response_mode: Option<String>,
    pub config_interpret_documents: Option<bool>,
    pub config_split_messages: Option<bool>,
    pub config_webhook_verify_token: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateIntegrationRequest {
    pub channel: String,
    pub provider: String,
    pub config_token: Option<String>,
    pub config_phone_number: Option<String>,
    pub config_chatwoot_url: Option<String>,
    pub config_rate_limit_per_day: Option<i32>,
    pub config_max_message_length: Option<i32>,
    pub config_audio_response_mode: Option<String>,
    pub config_interpret_documents: Option<bool>,
    pub config_split_messages: Option<bool>,
    pub config_webhook_verify_token: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateIntegrationRequest {
    pub channel: Option<String>,
    pub provider: Option<String>,
    pub status: Option<String>,
    pub config_token: Option<String>,
    pub config_phone_number: Option<String>,
    pub config_chatwoot_url: Option<String>,
    pub config_rate_limit_per_day: Option<i32>,
    pub config_max_message_length: Option<i32>,
    pub config_audio_response_mode: Option<String>,
    pub config_interpret_documents: Option<bool>,
    pub config_split_messages: Option<bool>,
    pub config_webhook_verify_token: Option<String>,
}
