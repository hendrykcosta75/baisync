use axum::extract::{Extension, Path, Query};
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use axum::Json;
use base64::Engine as _;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::Sha256;
use subtle::ConstantTimeEq;
use uuid::Uuid;

use crate::config::Config;
use crate::db::DbSession;
use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::models::integration::UpdateIntegrationRequest;
use crate::services::assistant as assistant_service;
use crate::services::connection_state::{ConnectionState, ConnectionStateStore};
use crate::services::encryption::EncryptionService;
use crate::services::messaging::{self, IncomingWebhook, PlaygroundResponse, SummaryResponse};
use crate::services::webhook_dedup;
use crate::services::{email, notification};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationResponse {
    pub id: String,
    pub contact_name: String,
    pub profile_picture_url: Option<String>,
    pub channel: String,
    pub last_message: String,
    pub last_message_at: String,
    pub message_count: i64,
    pub total_tokens: i64,
    pub ai_enabled: bool,
    pub messages: Vec<MessageResponse>,
}

#[derive(Deserialize)]
pub struct ConversationListQuery {
    pub share_token: Option<String>,
    pub limit: Option<i32>,
    pub cursor: Option<String>,
    pub search: Option<String>,
}

#[derive(Serialize)]
pub struct MessageResponse {
    pub id: String,
    pub content: String,
    pub sender: String,
    pub timestamp: String,
    pub tokens_used: Option<i32>,
    /// MIME type of the attached media, if any (e.g. "image/jpeg", "application/pdf").
    pub media_type: Option<String>,
    /// True when raw media bytes are available via the media endpoint.
    pub has_media: bool,
}

// --- Baileys v3 webhook ---
// Baileys sends: { event: "connection.update" | "messages.upsert" | ..., data: {...}, webhookVerifyToken: "..." }

pub async fn webhook_baileys(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(encryption): Extension<EncryptionService>,
    Extension(event_bus): Extension<crate::services::events::EventBus>,
    Extension(conn_store): Extension<ConnectionStateStore>,
    Path(phone_from_path): Path<String>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, AppError> {
    let event = payload["event"].as_str().unwrap_or("");
    let phone = format!("+{phone_from_path}");

    // Validate webhookVerifyToken against BAILEYS_API_KEY (shared secret between backend and Baileys service).
    // Constant-time comparison: ct_eq on slices of different lengths returns 0, so length mismatch is safe.
    let webhook_token = payload["webhookVerifyToken"].as_str().unwrap_or("");
    if !config.baileys_api_key.is_empty()
        && webhook_token
            .as_bytes()
            .ct_eq(config.baileys_api_key.as_bytes())
            .unwrap_u8()
            != 1
    {
        tracing::warn!("Baileys webhook token mismatch for {phone}");
        return Err(AppError::Unauthorized(
            "Invalid webhook verify token".into(),
        ));
    }

    // connection.update events (QR codes, status changes) are allowed without a registered integration
    // because the integration may not exist yet during the initial pairing flow.
    let phone_integration = messaging::find_integration_by_phone(&db, &encryption, &phone)
        .await
        .ok();
    if phone_integration.is_none() && event != "connection.update" {
        tracing::warn!("Baileys webhook received for unknown phone: {phone} event={event}");
        return Err(AppError::NotFound(
            "No integration found for this phone number".into(),
        ));
    }

    match event {
        "connection.update" => {
            let data = &payload["data"];
            let connection = data["connection"].as_str().unwrap_or("unknown");
            let qr_data_url = data["qrDataUrl"].as_str().map(|s| s.to_string());

            tracing::info!(
                "Baileys connection.update: phone={phone} status={connection} has_qr={}",
                qr_data_url.is_some()
            );

            conn_store.set(
                &phone,
                ConnectionState {
                    status: connection.to_string(),
                    qr_data_url,
                },
            );

            if connection == "open" {
                conn_store.set(
                    &phone,
                    ConnectionState {
                        status: "connected".to_string(),
                        qr_data_url: None,
                    },
                );
                // Persist connected state to DB immediately
                update_baileys_status(&db, &encryption, &config, &phone, "connected").await;
            } else if connection == "close" {
                // Check if this is a permanent logout (status 401) vs temporary disconnect
                let is_logged_out = data["lastDisconnect"]["error"]["output"]["statusCode"]
                    .as_i64()
                    .map_or(false, |code| code == 401);

                if is_logged_out {
                    // Permanent: user removed device from WhatsApp
                    conn_store.remove(&phone);
                    update_baileys_status(&db, &encryption, &config, &phone, "disconnected").await;
                } else {
                    // Temporary: Baileys will auto-reconnect, don't mark as disconnected.
                    // The health check will mark as disconnected after sustained failures.
                    tracing::info!(
                        "Baileys connection closed temporarily for {phone}, waiting for reconnect"
                    );
                    conn_store.set(
                        &phone,
                        ConnectionState {
                            status: "reconnecting".to_string(),
                            qr_data_url: None,
                        },
                    );
                }
            }

            Ok(Json(serde_json::json!({"status": "ok"})))
        }
        "messages.upsert" => {
            let data = &payload["data"];
            let messages = data["messages"].as_array();

            if let Some(msgs) = messages {
                for msg in msgs {
                    let from_me = msg["key"]["fromMe"].as_bool().unwrap_or(false);
                    if from_me {
                        continue;
                    }

                    // I2 — shadow dedup (per-message)
                    let event_id = msg["key"]["id"].as_str().unwrap_or("").to_string();
                    match webhook_dedup::check_and_mark(&db, "baileys", &event_id).await {
                        Ok(webhook_dedup::DedupResult::Applied) => {}
                        Ok(webhook_dedup::DedupResult::Duplicate) => {
                            // Only reached in Mode::Block (T1.4); skip this message.
                            continue;
                        }
                        Err(e) => {
                            tracing::warn!(error = %e, "dedup check failed, continuing");
                        }
                    }

                    // Prefer remoteJidAlt (real phone) over remoteJid (may be a LID)
                    let remote_jid = msg["key"]["remoteJidAlt"]
                        .as_str()
                        .or_else(|| msg["key"]["remoteJid"].as_str())
                        .unwrap_or("");
                    // Extract phone from JID: 5511999999999@s.whatsapp.net → +5511999999999
                    let phone = remote_jid
                        .split('@')
                        .next()
                        .map(|p| format!("+{p}"))
                        .unwrap_or_default();

                    let text_content = msg["message"]["conversation"]
                        .as_str()
                        .or_else(|| msg["message"]["extendedTextMessage"]["text"].as_str());

                    let audio_msg = &msg["message"]["audioMessage"];
                    let is_audio = !audio_msg.is_null();

                    // Detect media messages (images, documents, videos, stickers)
                    let image_msg = &msg["message"]["imageMessage"];
                    let document_msg = &msg["message"]["documentMessage"];
                    let video_msg = &msg["message"]["videoMessage"];
                    let sticker_msg = &msg["message"]["stickerMessage"];
                    let is_media = !image_msg.is_null()
                        || !document_msg.is_null()
                        || !video_msg.is_null()
                        || !sticker_msg.is_null();

                    if phone.is_empty() {
                        continue;
                    }

                    // Skip if neither text, audio, nor media
                    if text_content.is_none() && !is_audio && !is_media {
                        continue;
                    }

                    // Helper closure to download media from Baileys
                    let download_baileys_media = |msg_id: &str| {
                        let msg_id = msg_id.to_string();
                        let url = format!("{}/media/{}", config.baileys_url, msg_id);
                        let api_key = config.baileys_api_key.clone();
                        async move {
                            if msg_id.is_empty() {
                                return None;
                            }
                            let resp = reqwest::Client::new()
                                .get(&url)
                                .header("x-api-key", &api_key)
                                .send()
                                .await;
                            match resp {
                                Ok(r) if r.status().is_success() => {
                                    r.bytes().await.ok().map(|b| {
                                        base64::engine::general_purpose::STANDARD.encode(&b)
                                    })
                                }
                                Ok(r) => {
                                    tracing::warn!("Baileys media download failed: {}", r.status());
                                    None
                                }
                                Err(e) => {
                                    tracing::warn!("Baileys media download error: {e}");
                                    None
                                }
                            }
                        }
                    };

                    // For audio: try to get pre-fetched base64 from extra.media,
                    // then fall back to downloading from the Baileys media endpoint.
                    let (message, media_base64, media_type) = if is_audio {
                        let mime = audio_msg["mimetype"]
                            .as_str()
                            .unwrap_or("audio/ogg")
                            .split(';')
                            .next()
                            .unwrap_or("audio/ogg")
                            .to_string();

                        // extra.media is set by fazer-ai/baileys-api when includeMedia is enabled
                        let pre_fetched_b64 = payload["extra"]["media"]["audio"]
                            .as_str()
                            .map(|s| s.to_string());

                        let b64 = if let Some(b64) = pre_fetched_b64 {
                            Some(b64)
                        } else {
                            let msg_id = msg["key"]["id"].as_str().unwrap_or("");
                            download_baileys_media(msg_id).await
                        };

                        ("".to_string(), b64, Some(mime))
                    } else if is_media {
                        // Determine which media message type and extract mime + caption
                        let (media_node, caption, default_mime) = if !image_msg.is_null() {
                            (
                                image_msg,
                                image_msg["caption"].as_str().unwrap_or(""),
                                "image/jpeg",
                            )
                        } else if !document_msg.is_null() {
                            let fname = document_msg["fileName"].as_str().unwrap_or("document");
                            (document_msg, fname, "application/pdf")
                        } else if !video_msg.is_null() {
                            (
                                video_msg,
                                video_msg["caption"].as_str().unwrap_or(""),
                                "video/mp4",
                            )
                        } else {
                            (sticker_msg, "", "image/webp")
                        };

                        let mime = media_node["mimetype"]
                            .as_str()
                            .unwrap_or(default_mime)
                            .split(';')
                            .next()
                            .unwrap_or(default_mime)
                            .to_string();

                        // Try pre-fetched media, fall back to download
                        let pre_fetched_b64 = payload["extra"]["media"]["document"]
                            .as_str()
                            .or_else(|| payload["extra"]["media"]["image"].as_str())
                            .map(|s| s.to_string());

                        let b64 = if let Some(b64) = pre_fetched_b64 {
                            Some(b64)
                        } else {
                            let msg_id = msg["key"]["id"].as_str().unwrap_or("");
                            download_baileys_media(msg_id).await
                        };

                        (caption.to_string(), b64, Some(mime))
                    } else {
                        (text_content.unwrap_or("").to_string(), None, None)
                    };

                    if message.is_empty() && media_base64.is_none() {
                        continue;
                    }

                    let push_name = msg["pushName"]
                        .as_str()
                        .filter(|s| !s.is_empty())
                        .map(|s| s.to_string());

                    let webhook = IncomingWebhook {
                        phone: phone.clone(),
                        connection_phone: format!("+{phone_from_path}"),
                        message,
                        media_url: None,
                        media_type,
                        media_base64,
                        message_id: None,
                        contact_name: push_name,
                    };

                    match messaging::process_incoming_message(
                        &db,
                        &config,
                        &encryption,
                        &event_bus,
                        webhook,
                    )
                    .await
                    {
                        Ok(_) => tracing::info!("Processed Baileys message from {phone}"),
                        Err(e) => {
                            tracing::error!("Failed to process Baileys message from {phone}: {e}")
                        }
                    }
                }
            }

            Ok(Json(serde_json::json!({"status": "ok"})))
        }
        _ => {
            tracing::debug!("Ignoring Baileys event: {event}");
            Ok(Json(serde_json::json!({"status": "ok"})))
        }
    }
}

/// Updates the DB status for the integration matching this phone number.
/// When transitioning to "disconnected", also creates an in-app notification and sends an email.
async fn update_baileys_status(
    db: &DbSession,
    encryption: &EncryptionService,
    config: &Config,
    phone: &str,
    new_status: &str,
) {
    let integration = match messaging::find_integration_by_phone(db, encryption, phone).await {
        Ok(i) => i,
        Err(_) => return,
    };

    if integration.status == new_status {
        return;
    }

    if let Err(e) = assistant_service::update_integration(
        db,
        encryption,
        &integration.assistant_id,
        &integration.user_id,
        &integration.id,
        UpdateIntegrationRequest {
            status: Some(new_status.into()),
            channel: None,
            provider: None,
            config_token: None,
            config_phone_number: None,
            config_chatwoot_url: None,
            config_rate_limit_per_day: None,
            config_max_message_length: None,
            config_audio_response_mode: None,
            config_interpret_documents: None,
            config_split_messages: None,
            config_webhook_verify_token: None,
        },
    )
    .await
    {
        tracing::error!("Failed to update Baileys integration status to {new_status}: {e}");
        return;
    }

    tracing::info!(
        "Integration {} status updated to {new_status} (phone={phone})",
        integration.id
    );

    if new_status != "disconnected" {
        return;
    }

    // Fetch assistant name for the notification message
    let assistant_name = {
        let r = db
            .query_unpaged(
                "SELECT name FROM inertial_eclipse.assistants WHERE user_id = ? AND id = ?",
                (&integration.user_id, &integration.assistant_id),
            )
            .await
            .ok()
            .and_then(|res| res.into_rows_result().ok())
            .and_then(|rows| rows.single_row::<(String,)>().ok())
            .map(|(n,)| n);
        r.unwrap_or_else(|| "seu assistente".to_string())
    };

    let channel_label = match integration.channel.as_str() {
        "whatsapp" => "WhatsApp",
        "telegram" => "Telegram",
        other => other,
    };
    let provider_label = match integration.provider.as_str() {
        "baileys" => "Baileys",
        "meta_official" => "API Oficial Meta",
        "telegram" => "Telegram",
        other => other,
    };

    let title = format!("Conexão perdida — {assistant_name}");
    let message = format!(
        "A integração {channel_label} via {provider_label} perdeu a conexão. Acesse o painel para reconectar."
    );

    if let Err(e) = notification::create_notification(
        db,
        &integration.user_id,
        Some(&integration.assistant_id),
        Some(&integration.id),
        "connection_lost",
        &title,
        &message,
    )
    .await
    {
        tracing::warn!("Failed to create disconnection notification: {e}");
    }

    let user_email = db
        .query_unpaged(
            "SELECT email FROM inertial_eclipse.users WHERE id = ?",
            (&integration.user_id,),
        )
        .await
        .ok()
        .and_then(|res| res.into_rows_result().ok())
        .and_then(|rows| rows.single_row::<(String,)>().ok())
        .map(|(e,)| e);

    if let Some(user_email) = user_email {
        if let Err(e) = email::send_connection_lost_email(
            config,
            &user_email,
            &assistant_name,
            channel_label,
            provider_label,
        )
        .await
        {
            tracing::warn!("Failed to send connection lost email to {user_email}: {e}");
        }
    }
}

// --- Meta Official WhatsApp webhook ---

#[derive(Debug, Deserialize)]
pub struct MetaVerifyQuery {
    #[serde(rename = "hub.mode")]
    pub hub_mode: Option<String>,
    #[serde(rename = "hub.verify_token")]
    pub hub_verify_token: Option<String>,
    #[serde(rename = "hub.challenge")]
    pub hub_challenge: Option<String>,
}

/// GET /api/webhooks/meta — Meta webhook verification (challenge-response)
///
/// TODO S0: `config_webhook_verify_token` is now encrypted on write. The
/// `WHERE config_webhook_verify_token = ?` equality lookup below will only
/// match LEGACY plaintext rows once the backfill migration has run. After the
/// backfill this query will need to either:
///   1. Iterate all integrations and try each decrypted verify token
///      (expensive but constant time ~= N integrations), or
///   2. Add a fingerprint column (deterministic HMAC) for lookup.
/// Until that redesign ships, Meta webhook verification breaks for any
/// integration re-saved after the encryption code went live. The underlying
/// POST signature check (`X-Hub-Signature-256` via `META_APP_SECRET`) is the
/// real security boundary — this verify_token is defense-in-depth only.
pub async fn webhook_meta_verify(
    Extension(db): Extension<DbSession>,
    Query(query): Query<MetaVerifyQuery>,
) -> Result<impl IntoResponse, AppError> {
    let mode = query.hub_mode.as_deref().unwrap_or("");
    let token = query.hub_verify_token.as_deref().unwrap_or("");
    let challenge = query.hub_challenge.as_deref().unwrap_or("");

    if mode != "subscribe" || token.is_empty() {
        return Err(AppError::Unauthorized(
            "Invalid verification request".into(),
        ));
    }

    // Look up integration by the verify token directly (avoids full table scan)
    let result = db
        .query_unpaged(
            "SELECT config_webhook_verify_token FROM inertial_eclipse.assistant_integrations WHERE config_webhook_verify_token = ? ALLOW FILTERING",
            (token,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let found = result
        .into_rows_result()?
        .maybe_first_row::<(Option<String>,)>()?
        .is_some();

    if !found {
        return Err(AppError::Unauthorized("Verify token mismatch".into()));
    }

    Ok(challenge.to_string())
}

/// POST /api/webhooks/meta — Receive messages from Meta WhatsApp Cloud API
pub async fn webhook_meta(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(encryption): Extension<EncryptionService>,
    Extension(event_bus): Extension<crate::services::events::EventBus>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<Json<Value>, AppError> {
    // Validate X-Hub-Signature-256. META_APP_SECRET MUST be configured — a silent
    // bypass would let anyone post fake webhooks.
    if config.meta_app_secret.is_empty() {
        return Err(AppError::InternalError(
            "META_APP_SECRET not configured".into(),
        ));
    }

    let signature = headers
        .get("x-hub-signature-256")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let expected = {
        let mut mac = Hmac::<Sha256>::new_from_slice(config.meta_app_secret.as_bytes())
            .map_err(|_| AppError::InternalError("HMAC init failed".into()))?;
        mac.update(&body);
        let result = mac.finalize();
        format!("sha256={}", hex::encode(result.into_bytes()))
    };

    // Constant-time comparison to avoid timing side-channel.
    if signature
        .as_bytes()
        .ct_eq(expected.as_bytes())
        .unwrap_u8()
        != 1
    {
        tracing::warn!("Meta webhook signature mismatch");
        return Err(AppError::Unauthorized("Invalid webhook signature".into()));
    }

    let payload: Value = serde_json::from_slice(&body)
        .map_err(|e| AppError::BadRequest(format!("Invalid JSON: {e}")))?;

    let entries = payload["entry"].as_array();

    if let Some(entries) = entries {
        for entry in entries {
            let changes = entry["changes"].as_array();
            if let Some(changes) = changes {
                for change in changes {
                    let value = &change["value"];
                    let phone_number_id =
                        value["metadata"]["phone_number_id"].as_str().unwrap_or("");

                    // Extract contact name from the contacts array in the webhook payload
                    let meta_contact_name = value["contacts"]
                        .as_array()
                        .and_then(|c| c.first())
                        .and_then(|c| c["profile"]["name"].as_str())
                        .filter(|s| !s.is_empty())
                        .map(|s| s.to_string());

                    let messages = value["messages"].as_array();
                    if let Some(msgs) = messages {
                        for msg in msgs {
                            let from = msg["from"].as_str().unwrap_or("");
                            let msg_id = msg["id"].as_str().map(|s| s.to_string());
                            let msg_type = msg["type"].as_str().unwrap_or("");

                            // I2 — shadow dedup (per-message)
                            let event_id = msg_id.clone().unwrap_or_default();
                            match webhook_dedup::check_and_mark(&db, "meta", &event_id).await {
                                Ok(webhook_dedup::DedupResult::Applied) => {}
                                Ok(webhook_dedup::DedupResult::Duplicate) => {
                                    // Only reached in Mode::Block (T1.4); skip this message.
                                    continue;
                                }
                                Err(e) => {
                                    tracing::warn!(error = %e, "dedup check failed, continuing");
                                }
                            }

                            let (message, media_url, media_type) = match msg_type {
                                "text" => (
                                    msg["text"]["body"].as_str().unwrap_or("").to_string(),
                                    None,
                                    None,
                                ),
                                "audio" => {
                                    let media_id =
                                        msg["audio"]["id"].as_str().unwrap_or("").to_string();
                                    let mime = msg["audio"]["mime_type"]
                                        .as_str()
                                        .unwrap_or("audio/ogg")
                                        .to_string();
                                    ("".to_string(), Some(media_id), Some(mime))
                                }
                                "image" => {
                                    let media_id =
                                        msg["image"]["id"].as_str().unwrap_or("").to_string();
                                    let mime = msg["image"]["mime_type"]
                                        .as_str()
                                        .unwrap_or("image/jpeg")
                                        .to_string();
                                    let caption =
                                        msg["image"]["caption"].as_str().unwrap_or("").to_string();
                                    (caption, Some(media_id), Some(mime))
                                }
                                "document" => {
                                    let media_id =
                                        msg["document"]["id"].as_str().unwrap_or("").to_string();
                                    let mime = msg["document"]["mime_type"]
                                        .as_str()
                                        .unwrap_or("application/pdf")
                                        .to_string();
                                    let filename =
                                        msg["document"]["filename"].as_str().unwrap_or("document");
                                    (format!("[{filename}]"), Some(media_id), Some(mime))
                                }
                                "video" => {
                                    let media_id =
                                        msg["video"]["id"].as_str().unwrap_or("").to_string();
                                    let mime = msg["video"]["mime_type"]
                                        .as_str()
                                        .unwrap_or("video/mp4")
                                        .to_string();
                                    let caption =
                                        msg["video"]["caption"].as_str().unwrap_or("").to_string();
                                    (caption, Some(media_id), Some(mime))
                                }
                                "sticker" => {
                                    let media_id =
                                        msg["sticker"]["id"].as_str().unwrap_or("").to_string();
                                    let mime = msg["sticker"]["mime_type"]
                                        .as_str()
                                        .unwrap_or("image/webp")
                                        .to_string();
                                    ("".to_string(), Some(media_id), Some(mime))
                                }
                                _ => {
                                    tracing::debug!("Ignoring Meta message type: {msg_type}");
                                    continue;
                                }
                            };

                            if message.is_empty()
                                && media_url
                                    .as_ref()
                                    .map(|s: &String| s.is_empty())
                                    .unwrap_or(true)
                                && media_type.is_none()
                            {
                                continue;
                            }
                            if from.is_empty() || phone_number_id.is_empty() {
                                continue;
                            }

                            let webhook = IncomingWebhook {
                                phone: format!("+{from}"),
                                connection_phone: phone_number_id.to_string(),
                                message,
                                media_url,
                                media_type,
                                media_base64: None,
                                message_id: msg_id,
                                contact_name: meta_contact_name.clone(),
                            };

                            match messaging::process_incoming_message(
                                &db,
                                &config,
                                &encryption,
                                &event_bus,
                                webhook,
                            )
                            .await
                            {
                                Ok(_) => tracing::info!("Processed Meta message from +{from}"),
                                Err(e) => tracing::error!(
                                    "Failed to process Meta message from +{from}: {e}"
                                ),
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(Json(serde_json::json!({"status": "ok"})))
}

/// POST /api/webhooks/telegram/{token} — Receive updates from Telegram Bot API
pub async fn webhook_telegram(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(encryption): Extension<EncryptionService>,
    Extension(event_bus): Extension<crate::services::events::EventBus>,
    Path(token): Path<String>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, AppError> {
    let message = &payload["message"];
    if message.is_null() {
        return Ok(Json(serde_json::json!({"status": "ok"})));
    }

    let chat_id = match message["chat"]["id"].as_i64() {
        Some(id) => id.to_string(),
        None => return Ok(Json(serde_json::json!({"status": "ok"}))),
    };

    // I2 — shadow dedup. Telegram message_id is unique per chat only, so we
    // combine chat_id + message_id to ensure global uniqueness.
    let tg_msg_id = message["message_id"].as_i64().unwrap_or(0);
    let event_id = if tg_msg_id != 0 {
        format!("{chat_id}:{tg_msg_id}")
    } else {
        String::new()
    };
    match webhook_dedup::check_and_mark(&db, "telegram", &event_id).await {
        Ok(webhook_dedup::DedupResult::Applied) => {}
        Ok(webhook_dedup::DedupResult::Duplicate) => {
            // Only reached in Mode::Block (T1.4).
            return Ok(Json(serde_json::json!({"status": "ok"})));
        }
        Err(e) => {
            tracing::warn!(error = %e, "dedup check failed, continuing");
        }
    }

    // Extract contact name from Telegram message
    let tg_first = message["from"]["first_name"].as_str().unwrap_or("");
    let tg_last = message["from"]["last_name"].as_str().unwrap_or("");
    let tg_contact_name = match (tg_first.is_empty(), tg_last.is_empty()) {
        (false, false) => Some(format!("{tg_first} {tg_last}")),
        (false, true) => Some(tg_first.to_string()),
        _ => message["from"]["username"]
            .as_str()
            .map(|u| format!("@{u}")),
    };

    let text = message["text"].as_str().unwrap_or("");
    let caption = message["caption"].as_str().unwrap_or("");
    let voice = &message["voice"];
    let audio = &message["audio"];
    let photo = &message["photo"];
    let document = &message["document"];
    let video = &message["video"];

    // Accept text, voice note, audio file, or media (photo, document, video)
    let has_audio = !voice.is_null() || !audio.is_null();
    let has_media = !photo.is_null() || !document.is_null() || !video.is_null();
    if text.is_empty() && !has_audio && !has_media {
        return Ok(Json(serde_json::json!({"status": "ok"})));
    }

    // Helper to download a file from Telegram by file_id
    let download_telegram_file = |file_id: &str, token: &str| {
        let file_id = file_id.to_string();
        let token = token.to_string();
        async move {
            if file_id.is_empty() {
                return None;
            }
            let client = reqwest::Client::new();
            let file_url = format!("https://api.telegram.org/bot{token}/getFile");
            let file_path = async {
                let r = client
                    .post(&file_url)
                    .json(&serde_json::json!({ "file_id": file_id }))
                    .send()
                    .await
                    .ok()?;
                let v: serde_json::Value = r.json().await.ok()?;
                v["result"]["file_path"].as_str().map(|s| s.to_string())
            }
            .await;

            if let Some(path) = file_path {
                let download_url = format!("https://api.telegram.org/file/bot{token}/{path}");
                let resp = client.get(&download_url).send().await.ok();
                if let Some(r) = resp {
                    if r.status().is_success() {
                        return r
                            .bytes()
                            .await
                            .ok()
                            .map(|b| base64::engine::general_purpose::STANDARD.encode(&b));
                    }
                }
            }
            None
        }
    };

    let (msg_text, media_base64, media_type) = if has_audio {
        let (file_id, mime) = if !voice.is_null() {
            (voice["file_id"].as_str().unwrap_or(""), "audio/ogg")
        } else {
            (audio["file_id"].as_str().unwrap_or(""), "audio/mpeg")
        };

        let b64 = download_telegram_file(file_id, &token).await;
        ("".to_string(), b64, Some(mime.to_string()))
    } else if has_media {
        let (file_id, mime) = if !photo.is_null() {
            // Photos come as an array; last element is highest resolution
            let photos = photo.as_array();
            let best = photos.and_then(|arr| arr.last());
            let fid = best.and_then(|p| p["file_id"].as_str()).unwrap_or("");
            (fid, "image/jpeg")
        } else if !document.is_null() {
            let fid = document["file_id"].as_str().unwrap_or("");
            let mime = document["mime_type"]
                .as_str()
                .unwrap_or("application/octet-stream");
            (fid, mime)
        } else {
            let fid = video["file_id"].as_str().unwrap_or("");
            let mime = video["mime_type"].as_str().unwrap_or("video/mp4");
            (fid, mime)
        };

        let b64 = download_telegram_file(file_id, &token).await;
        (caption.to_string(), b64, Some(mime.to_string()))
    } else {
        (text.to_string(), None, None)
    };

    if msg_text.is_empty() && media_base64.is_none() {
        return Ok(Json(serde_json::json!({"status": "ok"})));
    }

    let webhook = messaging::IncomingWebhook {
        phone: chat_id.clone(),
        connection_phone: token.clone(),
        message: msg_text,
        media_url: None,
        media_type,
        media_base64,
        message_id: None,
        contact_name: tg_contact_name,
    };

    match messaging::process_incoming_message(&db, &config, &encryption, &event_bus, webhook).await
    {
        Ok(_) => tracing::info!("Processed Telegram message from chat {chat_id}"),
        Err(e) => tracing::error!("Failed to process Telegram message from chat {chat_id}: {e}"),
    }

    Ok(Json(serde_json::json!({"status": "ok"})))
}

// --- Playground chat ---

#[derive(Debug, Deserialize)]
pub struct ChatRequest {
    pub message: String,
}

pub async fn playground_chat(
    Extension(db): Extension<DbSession>,
    Extension(encryption): Extension<EncryptionService>,
    Extension(config): Extension<Config>,
    Extension(auth_user): Extension<AuthUser>,
    Path(assistant_id): Path<Uuid>,
    Query(query): Query<crate::handlers::assistants::ShareTokenQuery>,
    Json(req): Json<ChatRequest>,
) -> Result<Json<PlaygroundResponse>, AppError> {
    let response = messaging::playground_chat(
        &db,
        &encryption,
        &config,
        &auth_user.workspace_id,
        &assistant_id,
        query.share_token.as_deref(),
        &req.message,
    )
    .await?;
    Ok(Json(response))
}

// --- Conversations ---

pub async fn list_conversations(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(encryption): Extension<EncryptionService>,
    Extension(auth_user): Extension<AuthUser>,
    Path(assistant_id): Path<Uuid>,
    Query(query): Query<ConversationListQuery>,
) -> Result<Json<crate::models::pagination::PaginatedResponse<ConversationResponse>>, AppError> {
    let owner_id = assistant_service::resolve_assistant_access(
        &db,
        &auth_user.workspace_id,
        &assistant_id,
        query.share_token.as_deref(),
        "read",
    )
    .await?;
    let limit = query.limit.unwrap_or(30).min(100).max(1);
    let paginated = messaging::list_conversations(
        &db,
        &assistant_id,
        &owner_id,
        limit,
        query.cursor.as_deref(),
        query.search.as_deref(),
    )
    .await?;

    let mut responses = Vec::new();
    let mut backfill_targets: Vec<(Uuid, String)> = Vec::new();
    for conv in &paginated.items {
        let messages = messaging::get_recent_messages(&db, &conv.id, 1)
            .await
            .unwrap_or_default();
        let message_count = messaging::count_messages(&db, &conv.id).await.unwrap_or(0);
        let total_tokens = messaging::sum_tokens(&db, &conv.id).await.unwrap_or(0);
        let last_message = messages
            .first()
            .and_then(|m| m.content.clone())
            .unwrap_or_default();

        if conv.contact_avatar_url.is_none()
            && (conv.channel == "baileys" || conv.channel == "whatsapp")
            && !conv.contact_number.is_empty()
        {
            backfill_targets.push((conv.id, conv.contact_number.clone()));
        }

        responses.push(ConversationResponse {
            id: conv.id.to_string(),
            contact_name: conv
                .contact_name
                .clone()
                .unwrap_or_else(|| conv.contact_number.clone()),
            profile_picture_url: conv.contact_avatar_url.clone(),
            channel: conv.channel.clone(),
            last_message,
            last_message_at: conv.last_message_at.to_rfc3339(),
            message_count,
            total_tokens,
            ai_enabled: conv.ai_enabled,
            messages: vec![],
        });
    }

    // Fire-and-forget: backfill missing WhatsApp profile pictures for future loads.
    if !backfill_targets.is_empty() {
        let db_bg = db.clone();
        let config_bg = config.clone();
        let encryption_bg = encryption.clone();
        let owner_id_bg = owner_id;
        let assistant_id_bg = assistant_id;
        tokio::spawn(async move {
            let Ok(result) = db_bg.query_unpaged(
                "SELECT config_phone_number FROM inertial_eclipse.assistant_integrations WHERE assistant_id = ? AND user_id = ? ALLOW FILTERING",
                (&assistant_id_bg, &owner_id_bg),
            ).await else { return };
            let Ok(rows) = result.into_rows_result() else { return };
            let mut connection_phone: Option<String> = None;
            for row in rows.rows::<(Option<String>,)>().into_iter().flatten().flatten() {
                // Phone may be plaintext (legacy) or ciphertext (post-S0
                // backfill). Decrypt with passthrough so the Baileys API call
                // below hits the real number either way.
                let decrypted = encryption_bg.try_decrypt_opt(row.0);
                if let Some(phone) = decrypted.filter(|s| !s.is_empty()) {
                    connection_phone = Some(phone);
                    break;
                }
            }
            let Some(connection_phone) = connection_phone else { return };
            for (conv_id, contact_number) in backfill_targets {
                if let Some(url) = messaging::fetch_baileys_profile_picture(
                    &config_bg,
                    &connection_phone,
                    &contact_number,
                )
                .await
                {
                    let _ = db_bg.query_unpaged(
                        "UPDATE inertial_eclipse.conversations SET contact_avatar_url = ? WHERE assistant_id = ? AND user_id = ? AND id = ?",
                        (&url, &assistant_id_bg, &owner_id_bg, &conv_id),
                    ).await;
                }
            }
        });
    }

    Ok(Json(crate::models::pagination::PaginatedResponse {
        items: responses,
        cursor: paginated.cursor,
    }))
}

#[derive(Deserialize)]
pub struct MessageListQuery {
    pub share_token: Option<String>,
    pub limit: Option<i32>,
    pub cursor: Option<String>,
}

pub async fn list_messages(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((assistant_id, conversation_id)): Path<(Uuid, Uuid)>,
    Query(query): Query<MessageListQuery>,
) -> Result<Json<crate::models::pagination::PaginatedResponse<MessageResponse>>, AppError> {
    let owner_id = assistant_service::resolve_assistant_access(
        &db,
        &auth_user.workspace_id,
        &assistant_id,
        query.share_token.as_deref(),
        "read",
    )
    .await?;
    // Validate conversation belongs to this assistant+user before returning messages
    messaging::get_conversation(&db, &assistant_id, &owner_id, &conversation_id).await?;
    let limit = query.limit.unwrap_or(50).min(200).max(1);
    let paginated =
        messaging::get_messages_paged(&db, &conversation_id, limit, query.cursor.as_deref())
            .await?;
    let responses: Vec<MessageResponse> = paginated
        .items
        .into_iter()
        .map(|m| {
            let has_media = m
                .media_base64
                .as_deref()
                .map(|s| !s.is_empty())
                .unwrap_or(false);
            MessageResponse {
                id: m.id.to_string(),
                content: m.content.unwrap_or_default(),
                sender: m.role,
                timestamp: m.created_at.to_rfc3339(),
                tokens_used: m.tokens_used,
                media_type: m.media_type,
                has_media,
            }
        })
        .collect();
    Ok(Json(crate::models::pagination::PaginatedResponse {
        items: responses,
        cursor: paginated.cursor,
    }))
}

// --- Delete conversation ---

pub async fn delete_conversation(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((assistant_id, conversation_id)): Path<(Uuid, Uuid)>,
    Query(query): Query<crate::handlers::assistants::ShareTokenQuery>,
) -> Result<Json<Value>, AppError> {
    let owner_id = assistant_service::resolve_assistant_access(
        &db,
        &auth_user.workspace_id,
        &assistant_id,
        query.share_token.as_deref(),
        "write",
    )
    .await?;
    messaging::delete_conversation(&db, &assistant_id, &owner_id, &conversation_id).await?;
    Ok(Json(serde_json::json!({"message": "Conversation deleted"})))
}

// --- Send direct message in conversation ---

#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    pub message: String,
}

pub async fn send_message(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(encryption): Extension<EncryptionService>,
    Extension(auth_user): Extension<AuthUser>,
    Path((assistant_id, conversation_id)): Path<(Uuid, Uuid)>,
    Query(query): Query<crate::handlers::assistants::ShareTokenQuery>,
    Json(req): Json<SendMessageRequest>,
) -> Result<Json<MessageResponse>, AppError> {
    let owner_id = assistant_service::resolve_assistant_access(
        &db,
        &auth_user.workspace_id,
        &assistant_id,
        query.share_token.as_deref(),
        "write",
    )
    .await?;
    let response = messaging::send_direct_message(
        &db,
        &config,
        &encryption,
        &owner_id,
        &assistant_id,
        &conversation_id,
        &req.message,
    )
    .await?;
    let has_media = response
        .media_base64
        .as_deref()
        .map(|s| !s.is_empty())
        .unwrap_or(false);
    Ok(Json(MessageResponse {
        id: response.id.to_string(),
        content: response.content.unwrap_or_default(),
        sender: response.role,
        timestamp: response.created_at.to_rfc3339(),
        tokens_used: response.tokens_used,
        media_type: response.media_type,
        has_media,
    }))
}

// --- Toggle AI enabled/disabled for a conversation ---

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToggleAiRequest {
    pub ai_enabled: bool,
}

pub async fn toggle_ai(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((assistant_id, conversation_id)): Path<(Uuid, Uuid)>,
    Query(query): Query<crate::handlers::assistants::ShareTokenQuery>,
    Json(req): Json<ToggleAiRequest>,
) -> Result<Json<Value>, AppError> {
    let owner_id = assistant_service::resolve_assistant_access(
        &db,
        &auth_user.workspace_id,
        &assistant_id,
        query.share_token.as_deref(),
        "write",
    )
    .await?;
    messaging::toggle_ai_enabled(
        &db,
        &assistant_id,
        &owner_id,
        &conversation_id,
        req.ai_enabled,
    )
    .await?;
    Ok(Json(serde_json::json!({"aiEnabled": req.ai_enabled})))
}

// --- Conversation Summary ---

#[derive(Debug, Deserialize)]
pub struct SummarizeRequest {
    pub provider: String,
    pub model: String,
}

pub async fn summarize_conversation(
    Extension(db): Extension<DbSession>,
    Extension(encryption): Extension<EncryptionService>,
    Extension(auth_user): Extension<AuthUser>,
    Path((assistant_id, conversation_id)): Path<(Uuid, Uuid)>,
    Query(query): Query<crate::handlers::assistants::ShareTokenQuery>,
    Json(req): Json<SummarizeRequest>,
) -> Result<Json<SummaryResponse>, AppError> {
    let owner_id = assistant_service::resolve_assistant_access(
        &db,
        &auth_user.workspace_id,
        &assistant_id,
        query.share_token.as_deref(),
        "read",
    )
    .await?;
    let response = messaging::summarize_conversation(
        &db,
        &encryption,
        &owner_id,
        &assistant_id,
        &conversation_id,
        &req.provider,
        &req.model,
    )
    .await?;
    Ok(Json(response))
}

// --- GET /api/assistants/{aid}/conversations/{cid}/messages/{mid}/media ---
// Serve the raw bytes of a message's attached media (image / pdf / video).

#[derive(Deserialize)]
pub struct MediaFetchQuery {
    pub share_token: Option<String>,
}

pub async fn get_message_media(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((assistant_id, conversation_id, message_id)): Path<(Uuid, Uuid, Uuid)>,
    Query(query): Query<MediaFetchQuery>,
) -> Result<impl IntoResponse, AppError> {
    let owner_id = assistant_service::resolve_assistant_access(
        &db,
        &auth_user.workspace_id,
        &assistant_id,
        query.share_token.as_deref(),
        "read",
    )
    .await?;
    messaging::get_conversation(&db, &assistant_id, &owner_id, &conversation_id).await?;

    let msg = messaging::get_message(&db, &conversation_id, &message_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Message not found".into()))?;

    let b64 = msg
        .media_base64
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::NotFound("Message has no media".into()))?;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| AppError::InternalError(format!("Invalid media base64: {e}")))?;

    let mime = msg
        .media_type
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or("application/octet-stream")
        .to_string();

    let mut headers = HeaderMap::new();
    if let Ok(v) = mime.parse() {
        headers.insert(axum::http::header::CONTENT_TYPE, v);
    }
    if let Ok(v) = "private, max-age=3600".parse() {
        headers.insert(axum::http::header::CACHE_CONTROL, v);
    }

    Ok((headers, bytes))
}
