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
use crate::services::gemini_audio::GEMINI_VOICES;

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

pub async fn list_voices(
    Extension(_db): Extension<DbSession>,
    Extension(_auth_user): Extension<AuthUser>,
    Extension(_encryption): Extension<EncryptionService>,
) -> Result<Json<VoicesResponse>, AppError> {
    let voices = GEMINI_VOICES
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
        &db,
        &auth_user.workspace_id,
        query.assistant_id.as_ref(),
        query.share_token.as_deref(),
    )
    .await?;
    let api_key =
        crate::services::workspace::get_decrypted_api_key(&db, &encryption, &user_id, "gemini")
            .await?;

    let text = body
        .text
        .unwrap_or_else(|| "Olá! Eu sou seu assistente virtual. Como posso te ajudar hoje?".into());

    let audio_bytes =
        crate::services::gemini_audio::text_to_speech(&api_key, &body.voice_id, &text).await?;

    Ok(Json(PreviewResponse {
        audio_base64: BASE64.encode(&audio_bytes),
        content_type: "audio/wav".into(),
    }))
}
