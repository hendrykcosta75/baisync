use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Assistant {
    pub user_id: Uuid,
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub llm_provider: String,
    pub model: String,
    pub temperature: f32,
    pub max_tokens: i32,
    pub system_prompt: Option<String>,
    pub is_team_lead: bool,
    pub parent_assistant_id: Option<Uuid>,
    pub share_token: Option<String>,
    pub share_permissions: Option<Vec<String>>,
    pub config_split_messages: bool,
    pub config_typing_indicator: bool,
    pub config_rate_limit_per_day: Option<i32>,
    pub config_max_message_length: Option<i32>,
    pub config_rate_limit_message: Option<String>,
    pub config_max_length_message: Option<String>,
    pub config_interpret_documents: bool,
    pub config_unsupported_media_message: Option<String>,
    pub config_audio_provider: Option<String>,
    pub config_audio_mode: Option<String>,
    pub config_audio_transcribe: bool,
    pub config_audio_fallback_to_text: bool,
    pub config_audio_transcription_failure_message: Option<String>,
    pub config_audio_voice_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateAssistantRequest {
    pub name: String,
    pub description: Option<String>,
    pub llm_provider: String,
    pub model: String,
    pub temperature: Option<f32>,
    pub max_tokens: Option<i32>,
    pub system_prompt: Option<String>,
    pub is_team_lead: Option<bool>,
    pub parent_assistant_id: Option<Uuid>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationSettingsPayload {
    pub split_on_double_newline: Option<bool>,
    pub typing_indicator: Option<bool>,
    pub rate_limit_per_day: Option<i32>,
    pub max_message_length: Option<i32>,
    pub interpret_documents: Option<bool>,
    pub rate_limit_message: Option<String>,
    pub max_length_message: Option<String>,
    pub unsupported_media_message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSettingsPayload {
    pub provider: Option<String>,
    pub mode: Option<String>,
    pub transcribe: Option<bool>,
    pub fallback_to_text: Option<bool>,
    pub transcription_failure_message: Option<String>,
    pub voice_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateAssistantRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub llm_provider: Option<String>,
    pub model: Option<String>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<i32>,
    pub system_prompt: Option<String>,
    pub is_team_lead: Option<bool>,
    pub parent_assistant_id: Option<Uuid>,
    #[serde(alias = "integrationSettings")]
    pub integration_settings: Option<IntegrationSettingsPayload>,
    #[serde(alias = "audioSettings")]
    pub audio_settings: Option<AudioSettingsPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantFile {
    pub assistant_id: Uuid,
    pub user_id: Uuid,
    pub id: Uuid,
    pub name: String,
    pub size: i32,
    pub mime_type: String,
    pub content_text: Option<String>,
    pub uploaded_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantTool {
    pub assistant_id: Uuid,
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub endpoint: String,
    pub method: String,
    pub schema_json: Option<String>,
    pub headers_json: Option<String>,
    pub is_enabled: bool,
    pub tool_type: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateToolRequest {
    pub name: String,
    pub description: Option<String>,
    pub endpoint: Option<String>,
    pub method: Option<String>,
    pub schema_json: Option<String>,
    pub headers_json: Option<String>,
    pub is_enabled: Option<bool>,
    pub tool_type: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateToolRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub endpoint: Option<String>,
    pub method: Option<String>,
    pub schema_json: Option<String>,
    pub headers_json: Option<String>,
    pub is_enabled: Option<bool>,
    pub tool_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallLog {
    pub assistant_id: Uuid,
    pub tool_id: Uuid,
    pub id: Uuid,
    pub tool_name: String,
    pub arguments: Option<String>,
    pub status_code: Option<i32>,
    pub response_body: Option<String>,
    pub error: Option<String>,
    pub duration_ms: i32,
    pub called_at: DateTime<Utc>,
}
