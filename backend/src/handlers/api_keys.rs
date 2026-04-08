use axum::extract::Extension;
use axum::Json;
use scylla::frame::value::CqlTimestamp;
use serde_json::Value;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::models::user::ApiKeysResponse;
use crate::services::auth as auth_service;
use crate::services::encryption::EncryptionService;

pub async fn get_keys(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<ApiKeysResponse>, AppError> {
    let user = auth_service::get_user_by_id(&db, &auth_user.user_id).await?;
    Ok(Json(ApiKeysResponse {
        openai_configured: user.api_key_openai.is_some(),
        claude_configured: user.api_key_claude.is_some(),
        gemini_configured: user.api_key_gemini.is_some(),
        elevenlabs_configured: user.api_key_elevenlabs.is_some(),
        mercadopago_configured: user.api_key_mercadopago.is_some(),
    }))
}

/// Accepts both formats:
/// - `{ openai: "...", claude: "...", gemini: "..." }` (new frontend)
/// - `{ keys: { openai: "...", claude: "...", gemini: "..." } }` (old frontend)
pub async fn update_keys(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Extension(encryption): Extension<EncryptionService>,
    Json(body): Json<Value>,
) -> Result<Json<ApiKeysResponse>, AppError> {
    // Support both { keys: { ... } } and flat { openai, ... }
    let source = if body.get("keys").is_some() && body["keys"].is_object() {
        &body["keys"]
    } else {
        &body
    };

    let openai_raw = source["openai"].as_str().map(|s| s.to_string());
    let claude_raw = source["claude"].as_str().map(|s| s.to_string());
    let gemini_raw = source["gemini"].as_str().map(|s| s.to_string());
    let elevenlabs_raw = source["elevenlabs"].as_str().map(|s| s.to_string());
    let mercadopago_raw = source["mercadopago"].as_str().map(|s| s.to_string());

    let user = auth_service::get_user_by_id(&db, &auth_user.user_id).await?;
    let now = CqlTimestamp(chrono::Utc::now().timestamp_millis());

    let openai = match &openai_raw {
        Some(key) if !key.is_empty() => Some(encryption.encrypt(key)?),
        Some(_) => None, // empty string = clear
        None => user.api_key_openai,
    };

    let claude = match &claude_raw {
        Some(key) if !key.is_empty() => Some(encryption.encrypt(key)?),
        Some(_) => None,
        None => user.api_key_claude,
    };

    let gemini = match &gemini_raw {
        Some(key) if !key.is_empty() => Some(encryption.encrypt(key)?),
        Some(_) => None,
        None => user.api_key_gemini,
    };

    let elevenlabs = match &elevenlabs_raw {
        Some(key) if !key.is_empty() => Some(encryption.encrypt(key)?),
        Some(_) => None,
        None => user.api_key_elevenlabs,
    };

    let mercadopago = match &mercadopago_raw {
        Some(key) if !key.is_empty() => Some(encryption.encrypt(key)?),
        Some(_) => None,
        None => user.api_key_mercadopago,
    };

    db.query_unpaged(
        "UPDATE inertial_eclipse.users SET api_key_openai = ?, api_key_claude = ?, api_key_gemini = ?, api_key_elevenlabs = ?, api_key_mercadopago = ?, updated_at = ? WHERE id = ?",
        (&openai, &claude, &gemini, &elevenlabs, &mercadopago, now, &auth_user.user_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(Json(ApiKeysResponse {
        openai_configured: openai.is_some(),
        claude_configured: claude.is_some(),
        gemini_configured: gemini.is_some(),
        elevenlabs_configured: elevenlabs.is_some(),
        mercadopago_configured: mercadopago.is_some(),
    }))
}
