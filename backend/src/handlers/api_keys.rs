use axum::extract::Extension;
use axum::Json;
use scylla::frame::value::CqlTimestamp;
use serde::{Deserialize, Serialize};
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
        stripe_configured: user.api_key_stripe.is_some(),
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
    // Log which fields are being sent (without values for security)
    let has_mp = body.get("mercadopago").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false);
    let has_stripe = body.get("stripe").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false);
    let has_stripe_pk = body.get("stripe_public_key").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false);
    let has_mp_pk = body.get("mp_public_key").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false);
    tracing::info!(has_mp = %has_mp, has_stripe = %has_stripe, has_stripe_pk = %has_stripe_pk, has_mp_pk = %has_mp_pk, "API keys update called");

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
    let stripe_raw = source["stripe"].as_str().map(|s| s.to_string());

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

    let stripe = match &stripe_raw {
        Some(key) if !key.is_empty() => Some(encryption.encrypt(key)?),
        Some(_) => None,
        None => user.api_key_stripe,
    };

    // Public keys (plain text, not encrypted — they're designed to be public)
    let stripe_public_key_raw = source["stripe_public_key"].as_str().map(|s| s.to_string());
    let mp_public_key_raw = source["mp_public_key"].as_str().map(|s| s.to_string());

    // Fetch current public keys (separate query to avoid tuple limit)
    let current_pks = db.query_unpaged(
        "SELECT stripe_public_key, mp_public_key FROM inertial_eclipse.users WHERE id = ?",
        (&auth_user.user_id,),
    ).await.ok().and_then(|r| r.maybe_first_row_typed::<(Option<String>, Option<String>)>().ok().flatten());
    let (cur_stripe_pk, cur_mp_pk) = current_pks.unwrap_or((None, None));

    let stripe_pk: Option<String> = match &stripe_public_key_raw {
        Some(key) if !key.is_empty() => Some(key.clone()),
        Some(_) => None,
        None => cur_stripe_pk,
    };
    let mp_pk: Option<String> = match &mp_public_key_raw {
        Some(key) if !key.is_empty() => Some(key.clone()),
        Some(_) => None,
        None => cur_mp_pk,
    };

    db.query_unpaged(
        "UPDATE inertial_eclipse.users SET api_key_openai = ?, api_key_claude = ?, api_key_gemini = ?, api_key_elevenlabs = ?, api_key_mercadopago = ?, api_key_stripe = ?, updated_at = ? WHERE id = ?",
        (&openai, &claude, &gemini, &elevenlabs, &mercadopago, &stripe, now, &auth_user.user_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Update public keys separately (to stay within tuple limit)
    db.query_unpaged(
        "UPDATE inertial_eclipse.users SET stripe_public_key = ?, mp_public_key = ? WHERE id = ?",
        (&stripe_pk, &mp_pk, &auth_user.user_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(Json(ApiKeysResponse {
        openai_configured: openai.is_some(),
        claude_configured: claude.is_some(),
        gemini_configured: gemini.is_some(),
        elevenlabs_configured: elevenlabs.is_some(),
        mercadopago_configured: mercadopago.is_some(),
        stripe_configured: stripe.is_some(),
    }))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StripePixCheckResponse {
    pub pix_enabled: bool,
    pub message: String,
}

/// Check if the user's Stripe account has PIX payment method enabled.
/// Creates a minimal PaymentIntent with pix, then cancels it immediately.
/// This works with restricted keys that have payment_intents write permission.
pub async fn check_stripe_pix(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Extension(encryption): Extension<EncryptionService>,
) -> Result<Json<StripePixCheckResponse>, AppError> {
    let token = crate::services::pix::get_user_stripe_token(&db, &encryption, &auth_user.user_id).await?
        .ok_or_else(|| AppError::BadRequest("Chave Stripe não configurada".into()))?;

    let client = reqwest::Client::new();

    // Try creating a PaymentIntent with pix (minimum 100 centavos = R$1.00)
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
    let body: serde_json::Value = resp.json().await
        .map_err(|e| AppError::InternalError(format!("Falha ao parsear resposta Stripe: {e}")))?;

    if !status.is_success() {
        let msg = body.pointer("/error/message")
            .and_then(|v| v.as_str())
            .unwrap_or("Erro desconhecido");

        // Check if the error is specifically about pix not being enabled
        let msg_lower = msg.to_lowercase();
        if msg_lower.contains("pix") && (msg_lower.contains("invalid") || msg_lower.contains("not activated") || msg_lower.contains("not enabled")) {
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

    // PaymentIntent created successfully → PIX is enabled. Cancel it immediately.
    if let Some(pi_id) = body.get("id").and_then(|v| v.as_str()) {
        let _ = client
            .post(format!("https://api.stripe.com/v1/payment_intents/{}/cancel", pi_id))
            .basic_auth(&token, None::<&str>)
            .send()
            .await;
    }

    Ok(Json(StripePixCheckResponse {
        pix_enabled: true,
        message: "PIX está ativado na sua conta Stripe.".to_string(),
    }))
}
