use axum::extract::{Extension, Query};
use axum::Json;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};

use crate::db::DbSession;
use crate::errors::AppError;
use crate::handlers::assistants::OwnerResolveQuery;
use crate::middleware::auth::AuthUser;
use crate::services::assistant as assistant_service;
use crate::services::auth as auth_service;
use crate::services::encryption::EncryptionService;

#[derive(Debug, Serialize)]
pub struct VoiceItem {
    pub voice_id: String,
    pub name: String,
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

static OPENAI_VOICES: &[(&str, &str)] = &[
    ("alloy", "Alloy"),
    ("echo", "Echo"),
    ("fable", "Fable"),
    ("onyx", "Onyx"),
    ("nova", "Nova"),
    ("shimmer", "Shimmer"),
    ("coral", "Coral"),
];

pub async fn list_voices(
    Extension(_db): Extension<DbSession>,
    Extension(_auth_user): Extension<AuthUser>,
    Extension(_encryption): Extension<EncryptionService>,
) -> Result<Json<VoicesResponse>, AppError> {
    let voices = OPENAI_VOICES
        .iter()
        .map(|(id, name)| VoiceItem {
            voice_id: id.to_string(),
            name: name.to_string(),
        })
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
        &db, &auth_user.user_id, query.assistant_id.as_ref(), query.share_token.as_deref(),
    ).await?;
    let user = auth_service::get_user_by_id(&db, &user_id).await?;
    let encrypted_key = user
        .api_key_openai
        .ok_or_else(|| AppError::BadRequest("OpenAI API key not configured".into()))?;
    let api_key = encryption.decrypt(&encrypted_key)?;

    let text = body
        .text
        .unwrap_or_else(|| "Olá! Eu sou seu assistente virtual. Como posso te ajudar hoje?".into());

    let audio_bytes =
        crate::services::openai_audio::text_to_speech(&api_key, &body.voice_id, &text).await?;

    let audio_base64 = BASE64.encode(&audio_bytes);

    Ok(Json(PreviewResponse {
        audio_base64,
        content_type: "audio/mpeg".into(),
    }))
}
