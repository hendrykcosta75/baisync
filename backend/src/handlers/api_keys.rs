use axum::extract::Extension;
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::models::workspace::WorkspaceApiKeysResponse;
use crate::services::encryption::EncryptionService;
use crate::services::workspace as ws_service;

pub async fn get_keys(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<WorkspaceApiKeysResponse>, AppError> {
    let resp = ws_service::get_api_keys_status(&db, &auth_user.workspace_id).await?;
    Ok(Json(resp))
}

/// Accepts both formats:
/// - `{ openai: "...", claude: "...", gemini: "..." }` (new frontend)
/// - `{ keys: { openai: "...", claude: "...", gemini: "..." } }` (old frontend)
pub async fn update_keys(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Extension(encryption): Extension<EncryptionService>,
    Json(body): Json<Value>,
) -> Result<Json<WorkspaceApiKeysResponse>, AppError> {
    ws_service::require_editor_role(&db, &auth_user.workspace_id, &auth_user.user_id).await?;
    // Support both { keys: { ... } } and flat { openai, ... }
    let source = if body.get("keys").is_some() && body["keys"].is_object() {
        body["keys"].clone()
    } else {
        body
    };

    let keys =
        ws_service::update_api_keys(&db, &auth_user.workspace_id, &encryption, &source).await?;
    Ok(Json(WorkspaceApiKeysResponse {
        openai_configured: keys.openai_api_key.is_some(),
        claude_configured: keys.claude_api_key.is_some(),
        gemini_configured: keys.gemini_api_key.is_some(),
        elevenlabs_configured: keys.elevenlabs_api_key.is_some(),
        mercadopago_configured: keys.mercadopago_access_token.is_some(),
        stripe_configured: keys.stripe_secret_key.is_some(),
    }))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StripePixCheckResponse {
    pub pix_enabled: bool,
    pub message: String,
}

/// Check if the workspace's Stripe account has PIX payment method enabled.
pub async fn check_stripe_pix(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Extension(encryption): Extension<EncryptionService>,
) -> Result<Json<StripePixCheckResponse>, AppError> {
    let token =
        ws_service::get_decrypted_api_key(&db, &encryption, &auth_user.workspace_id, "stripe")
            .await
            .map_err(|_| AppError::BadRequest("Chave Stripe não configurada".into()))?;

    let client = reqwest::Client::new();

    let resp = client
        .post("https://api.stripe.com/v1/payment_intents")
        .basic_auth(&token, None::<&str>)
        .form(&[
            ("amount", "100"),
            ("currency", "brl"),
            ("payment_method_types[]", "pix"),
        ])
        .send()
        .await
        .map_err(|e| AppError::InternalError(format!("Falha ao conectar com Stripe: {e}")))?;

    let status = resp.status();
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::InternalError(format!("Falha ao parsear resposta Stripe: {e}")))?;

    if !status.is_success() {
        let msg = body
            .pointer("/error/message")
            .and_then(|v| v.as_str())
            .unwrap_or("Erro desconhecido");

        let msg_lower = msg.to_lowercase();
        if msg_lower.contains("pix")
            && (msg_lower.contains("invalid")
                || msg_lower.contains("not activated")
                || msg_lower.contains("not enabled"))
        {
            return Ok(Json(StripePixCheckResponse {
                pix_enabled: false,
                message: "PIX não está ativado na sua conta Stripe. Ative em https://dashboard.stripe.com/settings/payment_methods".to_string(),
            }));
        }

        return Ok(Json(StripePixCheckResponse {
            pix_enabled: false,
            message: format!("Erro Stripe: {msg}"),
        }));
    }

    if let Some(pi_id) = body.get("id").and_then(|v| v.as_str()) {
        let _ = client
            .post(format!(
                "https://api.stripe.com/v1/payment_intents/{}/cancel",
                pi_id
            ))
            .basic_auth(&token, None::<&str>)
            .send()
            .await;
    }

    Ok(Json(StripePixCheckResponse {
        pix_enabled: true,
        message: "PIX está ativado na sua conta Stripe.".to_string(),
    }))
}
