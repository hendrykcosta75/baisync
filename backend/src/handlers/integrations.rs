use axum::extract::{Extension, Path, Query};
use axum::Json;
use reqwest::Client;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::config::Config;
use crate::db::DbSession;
use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::models::integration::{
    AssistantIntegration, CreateIntegrationRequest, UpdateIntegrationRequest,
};
use crate::services::assistant as assistant_service;
use crate::services::connection_state::ConnectionStateStore;

use crate::handlers::assistants::ShareTokenQuery;

pub async fn messaging_config(
    Extension(config): Extension<Config>,
) -> Result<Json<Value>, AppError> {
    let baileys_available = !config.baileys_url.is_empty();

    Ok(Json(json!({
        "providers": {
            "baileys": { "available": baileys_available },
            "meta_official": { "available": true }
        }
    })))
}

pub async fn list(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(assistant_id): Path<Uuid>,
    Query(query): Query<ShareTokenQuery>,
) -> Result<Json<Vec<AssistantIntegration>>, AppError> {
    let owner_id = assistant_service::resolve_assistant_access(
        &db, &auth_user.user_id, &assistant_id, query.share_token.as_deref(), "read",
    ).await?;
    let integrations =
        assistant_service::list_integrations(&db, &assistant_id, &owner_id).await?;
    Ok(Json(integrations))
}

pub async fn create(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(assistant_id): Path<Uuid>,
    Query(query): Query<ShareTokenQuery>,
    Json(req): Json<CreateIntegrationRequest>,
) -> Result<Json<AssistantIntegration>, AppError> {
    let owner_id = assistant_service::resolve_assistant_access(
        &db, &auth_user.user_id, &assistant_id, query.share_token.as_deref(), "admin",
    ).await?;
    let integration =
        assistant_service::create_integration(&db, &assistant_id, &owner_id, req).await?;
    Ok(Json(integration))
}

pub async fn update(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((assistant_id, integration_id)): Path<(Uuid, Uuid)>,
    Query(query): Query<ShareTokenQuery>,
    Json(req): Json<UpdateIntegrationRequest>,
) -> Result<Json<AssistantIntegration>, AppError> {
    let owner_id = assistant_service::resolve_assistant_access(
        &db, &auth_user.user_id, &assistant_id, query.share_token.as_deref(), "admin",
    ).await?;
    let integration = assistant_service::update_integration(
        &db,
        &assistant_id,
        &owner_id,
        &integration_id,
        req,
    )
    .await?;
    Ok(Json(integration))
}

pub async fn delete(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((assistant_id, integration_id)): Path<(Uuid, Uuid)>,
    Query(query): Query<ShareTokenQuery>,
) -> Result<Json<Value>, AppError> {
    let owner_id = assistant_service::resolve_assistant_access(
        &db, &auth_user.user_id, &assistant_id, query.share_token.as_deref(), "admin",
    ).await?;
    assistant_service::delete_integration(
        &db,
        &assistant_id,
        &owner_id,
        &integration_id,
    )
    .await?;
    Ok(Json(json!({"message": "Integration deleted"})))
}

pub async fn connect(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Extension(config): Extension<Config>,
    Path((assistant_id, integration_id)): Path<(Uuid, Uuid)>,
    Query(query): Query<ShareTokenQuery>,
) -> Result<Json<Value>, AppError> {
    let owner_id = assistant_service::resolve_assistant_access(
        &db, &auth_user.user_id, &assistant_id, query.share_token.as_deref(), "admin",
    ).await?;
    let integration =
        get_integration(&db, &assistant_id, &owner_id, &integration_id).await?;

    let phone = integration
        .config_phone_number
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::BadRequest("No phone number configured for this integration".into()))?;

    match integration.provider.as_str() {
        "baileys" => {
            let client = Client::new();
            let phone_clean = phone.replace('+', "");
            let webhook_url = format!("http://backend:3001/api/webhooks/baileys/{phone_clean}");
            let url = format!("{}/connections/{}", config.baileys_url, phone);
            let resp = client
                .post(&url)
                .header("x-api-key", &config.baileys_api_key)
                .json(&json!({
                    "webhookUrl": webhook_url,
                    "webhookVerifyToken": config.baileys_api_key
                }))
                .send()
                .await
                .map_err(|e| AppError::InternalError(format!("Baileys connect failed: {e}")))?;

            if !resp.status().is_success() {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                return Err(AppError::InternalError(format!(
                    "Baileys connect returned {status}: {body}"
                )));
            }

            assistant_service::update_integration(
                &db, &assistant_id, &owner_id, &integration_id,
                UpdateIntegrationRequest {
                    status: Some("connecting".into()),
                    channel: None, provider: None, config_token: None, config_phone_number: None,
                    config_chatwoot_url: None, config_rate_limit_per_day: None, config_max_message_length: None,
                    config_audio_response_mode: None, config_interpret_documents: None, config_split_messages: None,
                    config_webhook_verify_token: None,
                },
            ).await?;

            Ok(Json(json!({"status": "connecting", "message": "Waiting for QR code via webhook"})))
        }
        "meta_official" => {
            // Meta Official: validate access token by calling the Graph API
            let access_token = integration.config_token.as_deref().unwrap_or_default();
            if access_token.is_empty() {
                return Err(AppError::BadRequest("Access Token not configured".into()));
            }

            let client = Client::new();
            let url = format!("https://graph.facebook.com/v21.0/{phone}/phone_numbers");
            let resp = client.get(&url).bearer_auth(access_token).send().await
                .map_err(|e| AppError::InternalError(format!("Meta API call failed: {e}")))?;

            let new_status = if resp.status().is_success() { "connected" } else { "disconnected" };

            assistant_service::update_integration(
                &db, &assistant_id, &owner_id, &integration_id,
                UpdateIntegrationRequest {
                    status: Some(new_status.into()),
                    channel: None, provider: None, config_token: None, config_phone_number: None,
                    config_chatwoot_url: None, config_rate_limit_per_day: None, config_max_message_length: None,
                    config_audio_response_mode: None, config_interpret_documents: None, config_split_messages: None,
                    config_webhook_verify_token: None,
                },
            ).await?;

            if new_status == "connected" {
                Ok(Json(json!({"status": "connected", "message": "Meta Official WhatsApp connected. Configure the webhook URL in Meta Dashboard to: /api/webhooks/meta"})))
            } else {
                Err(AppError::BadRequest("Access Token is invalid or Phone Number ID is incorrect. Check your Meta Dashboard credentials.".into()))
            }
        }
        _ => Err(AppError::BadRequest(format!("Unknown provider: {}", integration.provider))),
    }
}

pub async fn status(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Extension(conn_store): Extension<ConnectionStateStore>,
    Path((assistant_id, integration_id)): Path<(Uuid, Uuid)>,
    Query(query): Query<ShareTokenQuery>,
) -> Result<Json<Value>, AppError> {
    let owner_id = assistant_service::resolve_assistant_access(
        &db, &auth_user.user_id, &assistant_id, query.share_token.as_deref(), "read",
    ).await?;
    let integration =
        get_integration(&db, &assistant_id, &owner_id, &integration_id).await?;

    let phone = integration
        .config_phone_number
        .clone()
        .ok_or_else(|| AppError::BadRequest("No phone number configured".into()))?;

    match integration.provider.as_str() {
        "baileys" => {
            let state = conn_store.get(&phone);
            let data = if let Some(s) = state {
                json!({ "status": s.status, "qr": s.qr_data_url })
            } else {
                json!({ "status": integration.status })
            };

            let is_connected = data["status"].as_str() == Some("connected");
            if is_connected && integration.status != "connected" {
                assistant_service::update_integration(
                    &db, &assistant_id, &owner_id, &integration_id,
                    UpdateIntegrationRequest {
                        status: Some("connected".into()),
                        channel: None, provider: None, config_token: None, config_phone_number: None,
                        config_chatwoot_url: None, config_rate_limit_per_day: None, config_max_message_length: None,
                        config_audio_response_mode: None, config_interpret_documents: None, config_split_messages: None,
                        config_webhook_verify_token: None,
                    },
                ).await?;
            }

            Ok(Json(data))
        }
        _ => Ok(Json(json!({ "status": integration.status }))),
    }
}

pub async fn disconnect(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Extension(config): Extension<Config>,
    Extension(conn_store): Extension<ConnectionStateStore>,
    Path((assistant_id, integration_id)): Path<(Uuid, Uuid)>,
    Query(query): Query<ShareTokenQuery>,
) -> Result<Json<Value>, AppError> {
    let owner_id = assistant_service::resolve_assistant_access(
        &db, &auth_user.user_id, &assistant_id, query.share_token.as_deref(), "admin",
    ).await?;
    let integration =
        get_integration(&db, &assistant_id, &owner_id, &integration_id).await?;

    let phone = integration.config_phone_number.clone().unwrap_or_default();

    // Provider-specific cleanup
    if integration.provider == "baileys" && !phone.is_empty() {
        let client = Client::new();
        let url = format!("{}/connections/{}", config.baileys_url, phone);
        let _ = client.delete(&url).header("x-api-key", &config.baileys_api_key).send().await;
        conn_store.remove(&phone);
    }

    // Delete the integration row entirely — no reason to keep disconnected integrations
    assistant_service::delete_integration(&db, &assistant_id, &owner_id, &integration_id).await?;

    Ok(Json(json!({"message": "Disconnected successfully"})))
}

async fn get_integration(
    db: &DbSession,
    assistant_id: &Uuid,
    user_id: &Uuid,
    integration_id: &Uuid,
) -> Result<AssistantIntegration, AppError> {
    let integrations = assistant_service::list_integrations(db, assistant_id, user_id).await?;
    integrations
        .into_iter()
        .find(|i| i.id == *integration_id)
        .ok_or_else(|| AppError::NotFound("Integration not found".into()))
}
