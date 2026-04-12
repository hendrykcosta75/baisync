use axum::extract::{Extension, Query};
use axum::Json;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};

use crate::db::DbSession;
use crate::errors::AppError;
use crate::handlers::assistants::OwnerResolveQuery;
use crate::middleware::auth::AuthUser;
use crate::services::assistant as assistant_service;
use crate::services::encryption::EncryptionService;

#[derive(Debug, Serialize)]
pub struct VoiceItem {
    pub voice_id: String,
    pub name: String,
    pub category: Option<String>,
    pub description: Option<String>,
    pub preview_url: Option<String>,
    pub labels: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct VoicesResponse {
    pub voices: Vec<VoiceItem>,
}

#[derive(Debug, Deserialize)]
pub struct PreviewRequest {
    pub voice_id: String,
    pub text: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PreviewResponse {
    pub audio_base64: String,
    pub content_type: String,
}

pub async fn list_voices(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Extension(encryption): Extension<EncryptionService>,
    Query(query): Query<OwnerResolveQuery>,
) -> Result<Json<VoicesResponse>, AppError> {
    let user_id = assistant_service::resolve_api_key_user(
        &db, &auth_user.workspace_id, query.assistant_id.as_ref(), query.share_token.as_deref(),
    ).await?;
    let api_key = crate::services::workspace::get_decrypted_api_key(&db, &encryption, &user_id, "elevenlabs").await?;

    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.elevenlabs.io/v2/voices")
        .query(&[("page_size", "100")])
        .header("xi-api-key", &api_key)
        .send()
        .await
        .map_err(|e| AppError::InternalError(format!("ElevenLabs request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::InternalError(format!(
            "ElevenLabs API error {status}: {body}"
        )));
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::InternalError(format!("Failed to parse ElevenLabs response: {e}")))?;

    let voices = data["voices"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|v| VoiceItem {
            voice_id: v["voice_id"].as_str().unwrap_or("").to_string(),
            name: v["name"].as_str().unwrap_or("").to_string(),
            category: v["category"].as_str().map(|s| s.to_string()),
            description: v["description"].as_str().map(|s| s.to_string()),
            preview_url: v["preview_url"].as_str().map(|s| s.to_string()),
            labels: Some(v["labels"].clone()),
        })
        .filter(|v| !v.voice_id.is_empty())
        .collect();

    Ok(Json(VoicesResponse { voices }))
}

pub async fn preview_voice(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Extension(encryption): Extension<EncryptionService>,
    Query(query): Query<OwnerResolveQuery>,
    Json(body): Json<PreviewRequest>,
) -> Result<Json<PreviewResponse>, AppError> {
    let user_id = assistant_service::resolve_api_key_user(
        &db, &auth_user.workspace_id, query.assistant_id.as_ref(), query.share_token.as_deref(),
    ).await?;
    let api_key = crate::services::workspace::get_decrypted_api_key(&db, &encryption, &user_id, "elevenlabs").await?;

    let text = body
        .text
        .unwrap_or_else(|| "Olá! Eu sou seu assistente virtual. Como posso te ajudar hoje?".into());

    let client = reqwest::Client::new();
    let url = format!(
        "https://api.elevenlabs.io/v1/text-to-speech/{}",
        body.voice_id
    );

    let resp = client
        .post(&url)
        .header("xi-api-key", &api_key)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "text": text,
            "model_id": "eleven_multilingual_v2",
            "output_format": "mp3_44100_128"
        }))
        .send()
        .await
        .map_err(|e| AppError::InternalError(format!("ElevenLabs TTS request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let err_body = resp.text().await.unwrap_or_default();
        return Err(AppError::InternalError(format!(
            "ElevenLabs TTS error {status}: {err_body}"
        )));
    }

    let audio_bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::InternalError(format!("Failed to read audio bytes: {e}")))?;

    let audio_base64 = BASE64.encode(&audio_bytes);

    Ok(Json(PreviewResponse {
        audio_base64,
        content_type: "audio/mpeg".into(),
    }))
}
