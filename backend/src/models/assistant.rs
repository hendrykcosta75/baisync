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
    // W1.2 thresholds — defaults applied in code: 5 rounds, 30000 ms.
    pub config_max_tool_rounds: Option<i32>,
    pub config_max_duration_ms: Option<i32>,
    // T2.3 — opt-in auto-compaction. Default in code: false.
    // Paid for by the user: the compaction LLM call uses the user's
    // decrypted `workspace_api_keys` entry for the assistant's provider.
    pub config_auto_compact: Option<bool>,
    // W2.1 — opt-in post-turn evaluator. Default in code: false.
    // Paid for by the user: the evaluator LLM call uses the user's
    // decrypted `workspace_api_keys` entry for the assistant's provider.
    pub config_enable_evaluator: Option<bool>,
    // W2.1 — optional override for the evaluator model. `None` falls back
    // to the cheap model for the assistant's provider (see
    // `services::evaluator::cheap_eval_model_for`).
    pub config_evaluator_model: Option<String>,
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
    // W1.2 thresholds (snake_case or camelCase from frontend).
    #[serde(alias = "configMaxToolRounds")]
    pub config_max_tool_rounds: Option<i32>,
    #[serde(alias = "configMaxDurationMs")]
    pub config_max_duration_ms: Option<i32>,
    // T2.3 — opt-in auto-compaction.
    #[serde(alias = "configAutoCompact")]
    pub config_auto_compact: Option<bool>,
    // W2.1 — opt-in post-turn evaluator (PII / impossible promise / system-prompt
    // contradictions). Requires the platform-wide `EVALUATOR_API_KEY` (or
    // `COMPACTION_API_KEY` fallback). A partial PATCH that omits these fields
    // keeps the stored value — only explicit `null`/`false` turns the feature off.
    #[serde(alias = "configEnableEvaluator")]
    pub config_enable_evaluator: Option<bool>,
    #[serde(alias = "configEvaluatorModel")]
    pub config_evaluator_model: Option<String>,
}

#[allow(dead_code)]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_assistant_request_minimal() {
        let json = r#"{"name":"Bot","llm_provider":"openai","model":"gpt-4o"}"#;
        let req: CreateAssistantRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.name, "Bot");
        assert_eq!(req.llm_provider, "openai");
        assert_eq!(req.model, "gpt-4o");
        assert!(req.temperature.is_none());
        assert!(req.max_tokens.is_none());
        assert!(req.system_prompt.is_none());
        assert!(req.is_team_lead.is_none());
    }

    #[test]
    fn create_assistant_request_full() {
        let json = r#"{
            "name":"Bot","llm_provider":"claude","model":"claude-3.5-sonnet",
            "temperature":0.5,"max_tokens":2048,"system_prompt":"You help.",
            "is_team_lead":true
        }"#;
        let req: CreateAssistantRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.temperature, Some(0.5));
        assert_eq!(req.max_tokens, Some(2048));
        assert_eq!(req.is_team_lead, Some(true));
    }

    #[test]
    fn update_assistant_request_all_optional() {
        let json = r#"{}"#;
        let req: UpdateAssistantRequest = serde_json::from_str(json).unwrap();
        assert!(req.name.is_none());
        assert!(req.llm_provider.is_none());
        assert!(req.integration_settings.is_none());
        assert!(req.audio_settings.is_none());
    }

    #[test]
    fn update_assistant_with_integration_settings() {
        let json = r#"{
            "integrationSettings": {
                "splitOnDoubleNewline": true,
                "typingIndicator": false,
                "rateLimitPerDay": 100
            }
        }"#;
        let req: UpdateAssistantRequest = serde_json::from_str(json).unwrap();
        let settings = req.integration_settings.unwrap();
        assert_eq!(settings.split_on_double_newline, Some(true));
        assert_eq!(settings.typing_indicator, Some(false));
        assert_eq!(settings.rate_limit_per_day, Some(100));
    }

    #[test]
    fn update_assistant_with_audio_settings() {
        let json = r#"{
            "audioSettings": {
                "provider": "elevenlabs",
                "mode": "tts",
                "transcribe": true,
                "fallbackToText": false
            }
        }"#;
        let req: UpdateAssistantRequest = serde_json::from_str(json).unwrap();
        let audio = req.audio_settings.unwrap();
        assert_eq!(audio.provider, Some("elevenlabs".into()));
        assert_eq!(audio.mode, Some("tts".into()));
        assert_eq!(audio.transcribe, Some(true));
        assert_eq!(audio.fallback_to_text, Some(false));
    }

    #[test]
    fn create_tool_request_minimal() {
        let json = r#"{"name":"weather"}"#;
        let req: CreateToolRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.name, "weather");
        assert!(req.endpoint.is_none());
        assert!(req.method.is_none());
    }

    #[test]
    fn assistant_tool_serializes() {
        let tool = AssistantTool {
            assistant_id: Uuid::new_v4(),
            id: Uuid::new_v4(),
            name: "search".into(),
            description: Some("Web search".into()),
            endpoint: "https://api.example.com/search".into(),
            method: "GET".into(),
            schema_json: None,
            headers_json: None,
            is_enabled: true,
            tool_type: Some("http".into()),
        };
        let json = serde_json::to_value(&tool).unwrap();
        assert_eq!(json["name"], "search");
        assert_eq!(json["is_enabled"], true);
        assert_eq!(json["tool_type"], "http");
    }
}
