use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chrono::{DateTime, Utc};
use reqwest::Client;
use scylla::frame::value::{CqlTimestamp, CqlTimeuuid};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::config::Config;
use crate::db::DbSession;
use crate::errors::AppError;
use crate::models::conversation::{Conversation, Message};
use crate::models::integration::AssistantIntegration;
use crate::services::encryption::EncryptionService;
use crate::services::llm::{self, LlmMessage};

#[derive(Debug, Deserialize)]
pub struct IncomingWebhook {
    /// The contact's phone (who sent the message)
    pub phone: String,
    /// The connection's phone (the user's WhatsApp number, from integration config)
    #[serde(default)]
    pub connection_phone: String,
    pub message: String,
    /// For Meta Official: media ID to be fetched via Media API.
    /// For others: unused (media is pre-fetched as `media_base64`).
    pub media_url: Option<String>,
    pub media_type: Option<String>,
    /// Pre-fetched audio as base64 (Baileys, Telegram). When set, used directly for transcription.
    pub media_base64: Option<String>,
    /// The original message ID (used by Meta Official for typing indicator)
    #[serde(default)]
    pub message_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct WebhookResponse {
    pub status: String,
    pub message_id: Option<String>,
}

fn ts_now() -> CqlTimestamp {
    CqlTimestamp(Utc::now().timestamp_millis())
}

type IntegrationRow = (
    Uuid, Uuid, Uuid, String, String, Option<String>, Option<String>, Option<String>,
    Option<String>, Option<i32>, Option<i32>, Option<String>, Option<bool>, Option<bool>,
    Option<String>, DateTime<Utc>,
);

fn row_to_integration(r: IntegrationRow) -> AssistantIntegration {
    AssistantIntegration {
        assistant_id: r.0, user_id: r.1, id: r.2, channel: r.3, provider: r.4,
        status: r.5.unwrap_or_else(|| "active".into()),
        config_token: r.6, config_phone_number: r.7, config_chatwoot_url: r.8,
        config_rate_limit_per_day: r.9, config_max_message_length: r.10,
        config_audio_response_mode: r.11, config_interpret_documents: r.12,
        config_split_messages: r.13, config_webhook_verify_token: r.14,
        created_at: r.15,
    }
}

pub async fn process_incoming_message(
    db: &DbSession,
    config: &Config,
    encryption: &EncryptionService,
    event_bus: &crate::services::events::EventBus,
    webhook: IncomingWebhook,
) -> Result<WebhookResponse, AppError> {
    let lookup_key = if webhook.connection_phone.is_empty() {
        &webhook.phone
    } else {
        &webhook.connection_phone
    };
    // Try phone-number lookup first; fall back to token lookup (Telegram uses bot token as key)
    let integration = match find_integration_by_phone(db, lookup_key).await {
        Ok(i) => i,
        Err(_) => find_integration_by_token(db, lookup_key).await?,
    };
    let user_id = integration.user_id;
    let assistant_id = integration.assistant_id;

    let assistant = match crate::services::assistant::get_assistant(db, &user_id, &assistant_id).await {
        Ok(a) => a,
        Err(_) => {
            // Assistant was deleted but integration remains — clean up orphan
            tracing::warn!("Orphan integration found for deleted assistant {assistant_id}, cleaning up");
            let _ = db.query_unpaged(
                "DELETE FROM inertial_eclipse.assistant_integrations WHERE assistant_id = ? AND user_id = ? AND id = ?",
                (&assistant_id, &user_id, &integration.id),
            ).await;
            return Err(AppError::NotFound("Assistant no longer exists".into()));
        }
    };

    // Check rate limit — use assistant-level config, falling back to integration-level
    let rate_limit = assistant.config_rate_limit_per_day.or(integration.config_rate_limit_per_day);
    if let Some(limit) = rate_limit {
        if is_rate_limited(db, &integration, limit).await? {
            let default_msg = format!("You have reached the daily message limit of {limit}. Please try again tomorrow.");
            let reply = assistant.config_rate_limit_message
                .as_deref()
                .filter(|s| !s.is_empty())
                .unwrap_or(&default_msg);
            send_message_via_provider(config, &integration, &webhook.phone, reply).await?;
            return Ok(WebhookResponse { status: "rate_limited".into(), message_id: None });
        }
    }

    // Check max message length — use assistant-level config, falling back to integration-level
    let max_len = assistant.config_max_message_length.or(integration.config_max_message_length);
    if let Some(max_len) = max_len {
        if webhook.message.len() > max_len as usize {
            let default_msg = format!("Your message exceeds the maximum allowed length of {max_len} characters. Please send a shorter message.");
            let reply = assistant.config_max_length_message
                .as_deref()
                .filter(|s| !s.is_empty())
                .unwrap_or(&default_msg);
            send_message_via_provider(config, &integration, &webhook.phone, reply).await?;
            return Ok(WebhookResponse { status: "message_too_long".into(), message_id: None });
        }
    }

    let conversation =
        get_or_create_conversation(db, &assistant_id, &user_id, &webhook.phone, &integration.channel).await?;

    // Resolve the effective user message (transcribe audio if needed)
    let is_audio = webhook.media_type.as_deref()
        .map(|t| t.starts_with("audio"))
        .unwrap_or(false);

    let effective_message: String = if is_audio && webhook.message.is_empty() {
        if !assistant.config_audio_transcribe {
            // Transcription disabled — skip processing this audio message
            return Ok(WebhookResponse { status: "ok".into(), message_id: Some(conversation.id.to_string()) });
        }

        // Get audio bytes from the appropriate source
        let audio_bytes_opt = resolve_audio_bytes(
            &webhook, &integration, encryption
        ).await;

        match audio_bytes_opt {
            Some(bytes) => {
                let audio_provider = assistant.config_audio_provider.as_deref().unwrap_or("openai");
                let user = crate::services::auth::get_user_by_id(db, &user_id).await?;
                let stt_key_opt = match audio_provider {
                    "elevenlabs" => user.api_key_elevenlabs.as_ref().and_then(|k| encryption.decrypt(k).ok()),
                    _ => user.api_key_openai.as_ref().and_then(|k| encryption.decrypt(k).ok()),
                };
                match stt_key_opt {
                    Some(stt_key) => {
                        let filename = audio_filename_for_mime(webhook.media_type.as_deref().unwrap_or("audio/ogg"));
                        match crate::services::transcription::transcribe_by_provider(audio_provider, &stt_key, bytes, &filename).await {
                            Ok(text) if !text.is_empty() => text,
                            Ok(_) => {
                                let msg = assistant.config_audio_transcription_failure_message
                                    .as_deref()
                                    .filter(|s| !s.is_empty())
                                    .unwrap_or("Não consegui entender o áudio. Pode enviar sua mensagem em texto?");
                                send_message_via_provider(config, &integration, &webhook.phone, msg).await?;
                                return Ok(WebhookResponse { status: "ok".into(), message_id: None });
                            }
                            Err(e) => {
                                tracing::warn!(error = %e, "Audio transcription failed");
                                let msg = assistant.config_audio_transcription_failure_message
                                    .as_deref()
                                    .filter(|s| !s.is_empty())
                                    .unwrap_or("Não consegui entender o áudio. Pode enviar sua mensagem em texto?");
                                send_message_via_provider(config, &integration, &webhook.phone, msg).await?;
                                return Ok(WebhookResponse { status: "ok".into(), message_id: None });
                            }
                        }
                    }
                    None => {
                        tracing::warn!(audio_provider, "STT API key not configured, cannot transcribe audio");
                        return Ok(WebhookResponse { status: "ok".into(), message_id: None });
                    }
                }
            }
            None => {
                tracing::warn!(provider = %integration.provider, "Could not retrieve audio bytes for transcription");
                return Ok(WebhookResponse { status: "ok".into(), message_id: None });
            }
        }
    } else {
        webhook.message.clone()
    };

    // Check for non-audio media (images, documents, videos)
    let is_non_audio_media = webhook.media_type.as_deref()
        .map(|t| !t.starts_with("audio") && !t.is_empty())
        .unwrap_or(false)
        && (webhook.media_base64.is_some() || webhook.media_url.is_some());

    if is_non_audio_media && !assistant.config_interpret_documents {
        // Document interpretation disabled — send error message
        let default_msg = "Formato de mensagem não suportado. Por favor, envie sua mensagem em texto.";
        let reply = assistant.config_unsupported_media_message
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or(default_msg);

        save_message(db, &conversation.id, "user", &effective_message, webhook.media_url.as_deref(), webhook.media_type.as_deref(), None).await?;
        send_message_via_provider(config, &integration, &webhook.phone, reply).await?;
        save_message(db, &conversation.id, "assistant", reply, None, None, None).await?;

        return Ok(WebhookResponse { status: "unsupported_media".into(), message_id: Some(conversation.id.to_string()) });
    }

    // For non-audio media with interpret_documents enabled: check video provider support
    if is_non_audio_media {
        let is_video = webhook.media_type.as_deref()
            .map(|t| t.starts_with("video"))
            .unwrap_or(false);
        if is_video && assistant.llm_provider != "gemini" {
            let reply = "Este assistente não suporta processamento de vídeos.";
            save_message(db, &conversation.id, "user", &effective_message, webhook.media_url.as_deref(), webhook.media_type.as_deref(), None).await?;
            send_message_via_provider(config, &integration, &webhook.phone, reply).await?;
            save_message(db, &conversation.id, "assistant", reply, None, None, None).await?;
            return Ok(WebhookResponse { status: "unsupported_media".into(), message_id: Some(conversation.id.to_string()) });
        }

        // Resolve media bytes if not already available (Meta Official sends media_id)
        let media_b64 = if let Some(ref b64) = webhook.media_base64 {
            Some(b64.clone())
        } else {
            resolve_audio_bytes(&webhook, &integration, encryption).await
                .map(|bytes| base64::engine::general_purpose::STANDARD.encode(&bytes))
        };

        // Check media size limit (10MB)
        if let Some(ref b64) = media_b64 {
            let estimated_size = b64.len() * 3 / 4;
            if estimated_size > 10 * 1024 * 1024 {
                let reply = "O arquivo enviado é muito grande para processamento. Limite: 10MB.";
                save_message(db, &conversation.id, "user", &effective_message, webhook.media_url.as_deref(), webhook.media_type.as_deref(), None).await?;
                send_message_via_provider(config, &integration, &webhook.phone, reply).await?;
                save_message(db, &conversation.id, "assistant", reply, None, None, None).await?;
                return Ok(WebhookResponse { status: "media_too_large".into(), message_id: Some(conversation.id.to_string()) });
            }
        }
    }

    save_message(db, &conversation.id, "user", &effective_message, webhook.media_url.as_deref(), webhook.media_type.as_deref(), None).await?;

    // If AI is disabled for this conversation, save the message but skip LLM response
    if !conversation.ai_enabled {
        let now = ts_now();
        db.query_unpaged(
            "UPDATE inertial_eclipse.conversations SET last_message_at = ? WHERE assistant_id = ? AND user_id = ? AND id = ?",
            (now, &assistant_id, &user_id, &conversation.id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
        return Ok(WebhookResponse { status: "ok".into(), message_id: Some(conversation.id.to_string()) });
    }

    // Show typing indicator while processing and generating the LLM response (if enabled)
    if assistant.config_typing_indicator {
        send_typing_indicator(config, &integration, &webhook.phone, webhook.message_id.as_deref()).await?;
    }

    let history = get_recent_messages(db, &conversation.id, 20).await?;

    let user = crate::services::auth::get_user_by_id(db, &user_id).await?;
    let encrypted_key = match assistant.llm_provider.as_str() {
        "openai" => user.api_key_openai,
        "claude" => user.api_key_claude,
        "gemini" => user.api_key_gemini,
        _ => None,
    }
    .ok_or_else(|| AppError::BadRequest("API key not configured for this provider".into()))?;

    let api_key = encryption.decrypt(&encrypted_key)?;

    // RAG: retrieve relevant context from knowledge base
    let rag_contexts = crate::services::rag::retrieve_context(
        db, encryption, &user_id, &assistant_id, &effective_message, 3,
    ).await.unwrap_or_default();

    let mut llm_messages = Vec::new();
    let conversation_context = format!(
        "\n\n--- Contexto da Conversa ---\nTelefone do Usuário: {}\nCanal: {}\n",
        conversation.contact_number, conversation.channel
    );
    if let Some(system_prompt) = &assistant.system_prompt {
        let mut prompt = system_prompt.clone();
        if !rag_contexts.is_empty() {
            prompt.push_str("\n\n--- Relevant Knowledge Base Context ---\n");
            for ctx in &rag_contexts {
                prompt.push_str(ctx);
                prompt.push_str("\n---\n");
            }
        }
        prompt.push_str(&conversation_context);
        llm_messages.push(LlmMessage { role: "system".into(), content: prompt, media_base64: None, media_mime_type: None });
    } else if !rag_contexts.is_empty() {
        let mut prompt = "Use the following knowledge base context to help answer:\n\n".to_string();
        for ctx in &rag_contexts {
            prompt.push_str(ctx);
            prompt.push_str("\n---\n");
        }
        prompt.push_str(&conversation_context);
        llm_messages.push(LlmMessage { role: "system".into(), content: prompt, media_base64: None, media_mime_type: None });
    } else {
        let prompt = format!("You are a helpful assistant.{}", conversation_context);
        llm_messages.push(LlmMessage { role: "system".into(), content: prompt, media_base64: None, media_mime_type: None });
    }
    for msg in &history {
        llm_messages.push(LlmMessage { role: msg.role.clone(), content: msg.content.clone().unwrap_or_default(), media_base64: None, media_mime_type: None });
    }

    // Attach media to the last user message if this is a media message with interpretation enabled
    if is_non_audio_media && assistant.config_interpret_documents {
        let media_b64 = if let Some(ref b64) = webhook.media_base64 {
            Some(b64.clone())
        } else {
            resolve_audio_bytes(&webhook, &integration, encryption).await
                .map(|bytes| base64::engine::general_purpose::STANDARD.encode(&bytes))
        };

        if let Some(b64) = media_b64 {
            if let Some(last_user) = llm_messages.iter_mut().rev().find(|m| m.role == "user") {
                if last_user.content.is_empty() {
                    last_user.content = "O usuário enviou este arquivo. Analise o conteúdo e responda.".to_string();
                }
                last_user.media_base64 = Some(b64);
                last_user.media_mime_type = webhook.media_type.clone();
            }
        }
    }

    // Load enabled tools
    let tools = crate::services::assistant::list_tools(db, &assistant_id).await?;
    let llm_tools: Vec<llm::LlmTool> = tools
        .iter()
        .filter(|t| t.is_enabled)
        .map(llm::LlmTool::from)
        .collect();

    let tool_ctx = llm::ToolContext {
        db: Some(db),
        assistant_id: Some(assistant_id),
        user_id: Some(user_id),
        conversation_id: Some(conversation.id),
        config: Some(config),
        encryption: Some(encryption),
    };
    let llm_response = llm::call_llm_with_tools_ctx(
        &assistant.llm_provider, &assistant.model, &api_key,
        llm_messages, assistant.temperature, assistant.max_tokens, &llm_tools, &tool_ctx,
    ).await?;

    // Save tool call logs (fire-and-forget, don't block the response)
    for record in &llm_response.tool_call_records {
        if let Some(tid) = &record.tool_id {
            let args_str = serde_json::to_string(&record.arguments).ok();
            if let Err(e) = crate::services::assistant::save_tool_call_log(
                db,
                &assistant_id,
                tid,
                &record.tool_name,
                args_str.as_deref(),
                record.status_code,
                record.response_body.as_deref(),
                record.error.as_deref(),
                record.duration_ms,
            ).await {
                tracing::error!(tool = %record.tool_name, error = %e, "Failed to save tool call log");
            }
        }
    }

    // Post-process built-in tool actions (send_document, notify_human)
    for record in &llm_response.tool_call_records {
        match record.tool_type.as_str() {
            "send_document" => {
                // Look up the tool config to get the configured URL (stored in endpoint)
                let doc_url = record.tool_id.and_then(|tid| {
                    tools.iter().find(|t| t.id == tid).map(|t| t.endpoint.clone())
                });
                if let Some(url) = doc_url {
                    if !url.is_empty() {
                        let caption = record.arguments.get("caption").and_then(|v| v.as_str());
                        let filename: Option<&str> = None;
                        if let Err(e) = send_document_via_provider(
                            config, &integration, &webhook.phone, &url, caption, filename,
                        ).await {
                            tracing::error!(error = %e, url = %url, "Failed to send document via tool");
                        }
                    }
                }
            }
            "notify_human" => {
                let reason = record.arguments.get("reason")
                    .and_then(|v| v.as_str())
                    .unwrap_or("IA solicitou assistência humana");
                if let Err(e) = notify_human_agent(
                    db, config, &user_id, &assistant_id, &assistant.name, reason, &webhook.phone,
                ).await {
                    tracing::error!(error = %e, "Failed to notify human agent");
                }
            }
            "pix_payment" => {
                let action = record.arguments.get("action")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if action == "create_charge" {
                    let amount = record.arguments.get("amount")
                        .and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let desc = record.arguments.get("description")
                        .and_then(|v| v.as_str()).unwrap_or("Cobrança PIX");
                    let customer_name = record.arguments.get("customer_name")
                        .and_then(|v| v.as_str());
                    let customer_cpf = record.arguments.get("customer_cpf")
                        .and_then(|v| v.as_str());

                    // Extract tool config: pix_mode, pix_key, pix_key_type
                    let tool_config = record.tool_id.and_then(|tid| {
                        tools.iter().find(|t| t.id == tid).map(|t| {
                            let headers: serde_json::Value = t.headers_json.as_deref()
                                .and_then(|h| serde_json::from_str(h).ok())
                                .unwrap_or(serde_json::json!({}));
                            let pix_mode = headers.get("pix_mode")
                                .and_then(|v| v.as_str())
                                .unwrap_or("direct")
                                .to_string();
                            let key_type = headers.get("pix_key_type")
                                .and_then(|v| v.as_str())
                                .unwrap_or("random")
                                .to_string();
                            (t.endpoint.clone(), key_type, pix_mode)
                        })
                    });

                    let (pix_key, pix_key_type, pix_mode) = tool_config
                        .unwrap_or_else(|| (String::new(), "random".to_string(), "direct".to_string()));

                    if amount > 0.0 {
                        // For MP/Stripe mode, decrypt user's access token
                        let mp_token = match pix_mode.as_str() {
                            "mercadopago" => {
                                match crate::services::pix::get_user_mp_token(db, encryption, &user_id).await {
                                    Ok(Some(token)) => Some(token),
                                    Ok(None) => {
                                        tracing::error!("User has no Mercado Pago token configured");
                                        None
                                    }
                                    Err(e) => {
                                        tracing::error!(error = %e, "Failed to decrypt MP token");
                                        None
                                    }
                                }
                            }
                            "stripe" => {
                                match crate::services::pix::get_user_stripe_token(db, encryption, &user_id).await {
                                    Ok(Some(token)) => Some(token),
                                    Ok(None) => {
                                        tracing::error!("User has no Stripe key configured");
                                        None
                                    }
                                    Err(e) => {
                                        tracing::error!(error = %e, "Failed to decrypt Stripe key");
                                        None
                                    }
                                }
                            }
                            _ => None,
                        };

                        // Build notification URL for MP webhooks
                        let notification_url = if pix_mode == "mercadopago" && config.app_url.starts_with("https://") {
                            Some(format!("{}/api/webhooks/mercadopago", config.app_url))
                        } else {
                            None
                        };

                        // Skip if provider mode but no token
                        let should_create = (pix_mode != "mercadopago" && pix_mode != "stripe") || mp_token.is_some();

                        if should_create {
                            match crate::services::pix::create_charge(
                                db, &user_id, &assistant_id, Some(&conversation.id),
                                &webhook.phone, amount, desc, &pix_key, &pix_key_type,
                                &integration.channel, &pix_mode,
                                mp_token.as_deref(),
                                customer_name, customer_cpf,
                                notification_url.as_deref(),
                            ).await {
                                Ok(charge) => {
                                    // Save charge info to conversation so the agent remembers it
                                    let charge_memo = format!(
                                        "[Sistema] Cobrança PIX criada com sucesso. charge_id: {} | Valor: R$ {:.2} | Modo: {} | Cliente: {} | Status: pending",
                                        charge.id, charge.amount, charge.pix_mode,
                                        charge.customer_name.as_deref().unwrap_or("--"),
                                    );
                                    let _ = save_message(db, &conversation.id, "system", &charge_memo, None, None, None).await;

                                    // Publish SSE event for new charge
                                    event_bus.publish(&user_id, crate::services::events::SseEvent {
                                        event_type: "pix_charge_created".into(),
                                        data: serde_json::json!({
                                            "chargeId": charge.id.to_string(),
                                            "assistantId": assistant_id.to_string(),
                                            "amount": charge.amount,
                                            "customerName": charge.customer_name,
                                        }).to_string(),
                                    }).await;

                                    // Spawn background poller for MP charges
                                    if pix_mode == "mercadopago" {
                                        if let Some(ref mp_id) = charge.mp_payment_id {
                                            crate::services::pix::spawn_mp_payment_poller(
                                                db.clone(), config.clone(), encryption.clone(),
                                                event_bus.clone(),
                                                user_id, charge.id, assistant_id,
                                                mp_id.clone(),
                                            );
                                        }
                                    }

                                    // Build caption with copia-e-cola for easy copy on mobile
                                    let caption = charge.mp_copia_e_cola.as_deref()
                                        .map(|copia| format!(
                                            "Valor: R$ {:.2}\n\nCopia e cola:\n{}", amount, copia
                                        ))
                                        .unwrap_or_else(|| format!("PIX - R$ {:.2}", amount));

                                    // Send QR code image with copia-e-cola as caption
                                    if let Some(qr_b64) = &charge.mp_qr_code_base64 {
                                        if let Err(e) = send_pix_qr_via_provider(
                                            config, &integration, &webhook.phone, qr_b64, &caption,
                                        ).await {
                                            tracing::error!(error = %e, "Failed to send PIX QR code");
                                        }
                                    } else if let Some(copia) = &charge.mp_copia_e_cola {
                                        let msg = format!(
                                            "Aqui está o código PIX copia e cola:\n\n{}\n\nValor: R$ {:.2}",
                                            copia, amount
                                        );
                                        if let Err(e) = send_message_via_provider(config, &integration, &webhook.phone, &msg).await {
                                            tracing::error!(error = %e, "Failed to send PIX copia-e-cola");
                                        }
                                    }
                                }
                                Err(e) => {
                                    tracing::error!(error = %e, "Failed to create PIX charge via tool");
                                }
                            }
                        }
                    }
                }
                // check_status is handled entirely in execute_tool, no post-processing needed
            }
            "card_payment" => {
                let action = record.arguments.get("action")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if action == "create_charge" {
                    let amount = record.arguments.get("amount")
                        .and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let desc = record.arguments.get("description")
                        .and_then(|v| v.as_str()).unwrap_or("Cobrança por cartão");
                    let customer_name = record.arguments.get("customer_name")
                        .and_then(|v| v.as_str());
                    let customer_cpf = record.arguments.get("customer_cpf")
                        .and_then(|v| v.as_str());
                    let payment_type = record.arguments.get("payment_type")
                        .and_then(|v| v.as_str()).unwrap_or("credit");
                    let installments = record.arguments.get("installments")
                        .and_then(|v| v.as_i64()).unwrap_or(1) as i32;

                    // Extract tool config: card_mode
                    let tool_config = record.tool_id.and_then(|tid| {
                        tools.iter().find(|t| t.id == tid).map(|t| {
                            let headers: serde_json::Value = t.headers_json.as_deref()
                                .and_then(|h| serde_json::from_str(h).ok())
                                .unwrap_or(serde_json::json!({}));
                            let card_mode = headers.get("card_mode")
                                .and_then(|v| v.as_str())
                                .unwrap_or("stripe")
                                .to_string();
                            card_mode
                        })
                    });

                    let card_mode = tool_config.unwrap_or_else(|| "stripe".to_string());

                    if amount > 0.0 {
                        // Decrypt provider token
                        let provider_token = match card_mode.as_str() {
                            "stripe" => {
                                match crate::services::pix::get_user_stripe_token(db, encryption, &user_id).await {
                                    Ok(Some(token)) => Some(token),
                                    Ok(None) => {
                                        tracing::error!("User has no Stripe key configured for card payment");
                                        None
                                    }
                                    Err(e) => {
                                        tracing::error!(error = %e, "Failed to decrypt Stripe key");
                                        None
                                    }
                                }
                            }
                            "mercadopago" => {
                                match crate::services::pix::get_user_mp_token(db, encryption, &user_id).await {
                                    Ok(Some(token)) => Some(token),
                                    Ok(None) => {
                                        tracing::error!("User has no Mercado Pago token configured for card payment");
                                        None
                                    }
                                    Err(e) => {
                                        tracing::error!(error = %e, "Failed to decrypt MP token");
                                        None
                                    }
                                }
                            }
                            _ => None,
                        };

                        // Build notification URL for MP card webhooks
                        let notification_url = if card_mode == "mercadopago" && config.app_url.starts_with("https://") {
                            Some(format!("{}/api/webhooks/mercadopago/card", config.app_url))
                        } else {
                            None
                        };

                        if let Some(token) = provider_token {
                            match crate::services::card_payment::create_charge(
                                db, &user_id, &assistant_id, Some(&conversation.id),
                                &webhook.phone, amount, desc, &card_mode,
                                &token, customer_name, customer_cpf,
                                payment_type, installments,
                                &config.app_url, notification_url.as_deref(),
                            ).await {
                                Ok(charge) => {
                                    // Save charge info to conversation
                                    let parcelas_info = if charge.installments > 1 {
                                        format!("{}x de R$ {:.2}", charge.installments, charge.amount / charge.installments as f64)
                                    } else {
                                        "à vista".to_string()
                                    };
                                    let charge_memo = format!(
                                        "[Sistema] Cobrança por cartão criada. charge_id: {} | Valor: R$ {:.2} | {} {} ({}) | Cliente: {} | Status: pending",
                                        charge.id, charge.amount,
                                        if charge.payment_type == "debit" { "Débito" } else { "Crédito" },
                                        charge.card_mode, parcelas_info,
                                        charge.customer_name.as_deref().unwrap_or("--"),
                                    );
                                    let _ = save_message(db, &conversation.id, "system", &charge_memo, None, None, None).await;

                                    // Publish SSE event
                                    event_bus.publish(&user_id, crate::services::events::SseEvent {
                                        event_type: "card_charge_created".into(),
                                        data: serde_json::json!({
                                            "chargeId": charge.id.to_string(),
                                            "assistantId": assistant_id.to_string(),
                                            "amount": charge.amount,
                                            "customerName": charge.customer_name,
                                        }).to_string(),
                                    }).await;

                                    // Spawn background poller
                                    if let Some(ref session_id) = charge.provider_session_id {
                                        crate::services::card_payment::spawn_card_payment_poller(
                                            db.clone(), config.clone(), encryption.clone(),
                                            event_bus.clone(),
                                            user_id, charge.id, assistant_id,
                                            session_id.clone(), card_mode.clone(),
                                        );
                                    }

                                    // Send own-domain payment link to customer
                                    {
                                        let pay_link = format!("{}/pay/{}", config.app_url, charge.id);
                                        let msg = format!(
                                            "Aqui está o link para pagamento seguro por cartão:\n\n{}\n\nValor: R$ {:.2}\n{}",
                                            pay_link, amount, desc
                                        );
                                        if let Err(e) = send_message_via_provider(config, &integration, &webhook.phone, &msg).await {
                                            tracing::error!(error = %e, "Failed to send card checkout link");
                                        }
                                    }
                                }
                                Err(e) => {
                                    tracing::error!(error = %e, "Failed to create card charge via tool");
                                }
                            }
                        }
                    }
                }
                // check_status is handled entirely in execute_tool, no post-processing needed
            }
            "schedule_appointment" => {
                let action = record.arguments.get("action")
                    .and_then(|v| v.as_str())
                    .unwrap_or("create");

                match action {
                    "create" => {
                        let client_name = record.arguments.get("client_name")
                            .and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let client_email = record.arguments.get("client_email")
                            .and_then(|v| v.as_str()).map(|s| s.to_string());
                        let client_phone = record.arguments.get("client_phone")
                            .and_then(|v| v.as_str()).unwrap_or(&webhook.phone).to_string();
                        let date_time_str = record.arguments.get("date_time")
                            .and_then(|v| v.as_str()).unwrap_or("");
                        let duration = record.arguments.get("duration_minutes")
                            .and_then(|v| v.as_i64()).map(|v| v as i32);
                        let appointment_type = record.arguments.get("appointment_type")
                            .and_then(|v| v.as_str()).map(|s| s.to_string());
                        let notes = record.arguments.get("notes")
                            .and_then(|v| v.as_str()).map(|s| s.to_string());

                        // Parse date_time in assistant's timezone
                        let tz = crate::services::appointment::resolve_assistant_tz(db, &assistant_id).await;
                        let date_time = crate::services::appointment::parse_datetime_in_tz(date_time_str, &tz);

                        match date_time {
                            Some(dt_utc) => {
                                let req = crate::models::appointment::CreateAppointmentRequest {
                                    assistant_id: Some(assistant_id),
                                    client_name,
                                    client_email,
                                    client_phone,
                                    date_time: dt_utc,
                                    duration_minutes: duration,
                                    appointment_type,
                                    notes,
                                    origin_channel: Some(integration.channel.clone()),
                                    conversation_id: Some(conversation.id),
                                    is_manual: Some(false),
                                };
                                match crate::services::appointment::create_appointment(db, &user_id, req).await {
                                    Ok(appointment) => {
                                        if let Err(e) = notify_appointment_event(
                                            db, config, &user_id, &assistant_id, &assistant.name, &appointment, "created",
                                        ).await {
                                            tracing::error!(error = %e, "Failed to notify appointment creation");
                                        }
                                    }
                                    Err(e) => {
                                        tracing::error!(error = %e, "Failed to create appointment via tool");
                                    }
                                }
                            }
                            None => {
                                tracing::error!(date_time = %date_time_str, "Failed to parse appointment date_time from tool");
                            }
                        }
                    }
                    "cancel" => {
                        let appointment_id_str = record.arguments.get("appointment_id")
                            .and_then(|v| v.as_str()).unwrap_or("");
                        if let Ok(appt_id) = Uuid::parse_str(appointment_id_str) {
                            match crate::services::appointment::cancel_appointment(db, &user_id, &appt_id).await {
                                Ok(appointment) => {
                                    if let Err(e) = notify_appointment_event(
                                        db, config, &user_id, &assistant_id, &assistant.name, &appointment, "cancelled",
                                    ).await {
                                        tracing::error!(error = %e, "Failed to notify appointment cancellation");
                                    }
                                }
                                Err(e) => {
                                    tracing::error!(error = %e, "Failed to cancel appointment via tool");
                                }
                            }
                        }
                    }
                    "reschedule" => {
                        let appointment_id_str = record.arguments.get("appointment_id")
                            .and_then(|v| v.as_str()).unwrap_or("");
                        let new_date_time_str = record.arguments.get("date_time")
                            .and_then(|v| v.as_str()).unwrap_or("");
                        let tz_r = crate::services::appointment::resolve_assistant_tz(db, &assistant_id).await;
                        let new_dt = crate::services::appointment::parse_datetime_in_tz(new_date_time_str, &tz_r);

                        if let (Ok(appt_id), Some(dt_utc)) = (Uuid::parse_str(appointment_id_str), new_dt) {
                            let req = crate::models::appointment::UpdateAppointmentRequest {
                                status: Some("rescheduled".into()),
                                date_time: Some(dt_utc),
                                notes: None,
                                duration_minutes: record.arguments.get("duration_minutes")
                                    .and_then(|v| v.as_i64()).map(|v| v as i32),
                                appointment_type: None,
                            };
                            match crate::services::appointment::update_appointment(db, &user_id, &appt_id, req).await {
                                Ok(appointment) => {
                                    if let Err(e) = notify_appointment_event(
                                        db, config, &user_id, &assistant_id, &assistant.name, &appointment, "rescheduled",
                                    ).await {
                                        tracing::error!(error = %e, "Failed to notify appointment reschedule");
                                    }
                                }
                                Err(e) => {
                                    tracing::error!(error = %e, "Failed to reschedule appointment via tool");
                                }
                            }
                        }
                    }
                    _ => {} // check_availability is handled in execute_tool
                }
            }
            _ => {}
        }
    }

    let should_split = integration.config_split_messages.unwrap_or(assistant.config_split_messages);
    let responses = if should_split {
        llm_response.content.split("\n\n").filter(|s| !s.trim().is_empty()).map(|s| s.to_string()).collect()
    } else {
        vec![llm_response.content.clone()]
    };

    // Determine if we should respond with audio
    let audio_mode = assistant.config_audio_mode.as_deref().unwrap_or("disabled");
    let incoming_is_audio = webhook.media_type.as_deref()
        .map(|t| t.starts_with("audio"))
        .unwrap_or(false);
    let wants_audio = match audio_mode {
        "always" => true,
        "audio_to_audio" => incoming_is_audio,
        _ => false,
    };

    let audio_sent = if wants_audio {
        if let Some(voice_id) = &assistant.config_audio_voice_id {
            let full_text = responses.join("\n");
            let audio_provider = assistant.config_audio_provider.as_deref().unwrap_or("elevenlabs");
            match send_responses_as_audio(db, encryption, config, &user_id, audio_provider, voice_id, &integration, &webhook.phone, &full_text).await {
                Ok(_) => true,
                Err(e) => {
                    tracing::warn!(provider = %integration.provider, error = %e, "Audio response failed, falling back to text");
                    false
                }
            }
        } else {
            false
        }
    } else {
        false
    };

    if !audio_sent {
        for response_text in &responses {
            send_message_via_provider(config, &integration, &webhook.phone, response_text).await?;
        }
    }

    save_message(db, &conversation.id, "assistant", &llm_response.content, None, None, Some(llm_response.tokens_used)).await?;

    let now = ts_now();
    db.query_unpaged(
        "UPDATE inertial_eclipse.conversations SET last_message_at = ? WHERE assistant_id = ? AND user_id = ? AND id = ?",
        (now, &assistant_id, &user_id, &conversation.id),
    ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;

    update_usage_stats(db, &user_id, &assistant_id, llm_response.tokens_used).await?;

    // Publish SSE event for conversation update
    event_bus.publish(&user_id, crate::services::events::SseEvent {
        event_type: "conversation_updated".into(),
        data: serde_json::json!({
            "conversationId": conversation.id.to_string(),
            "assistantId": assistant_id.to_string(),
        }).to_string(),
    }).await;

    Ok(WebhookResponse { status: "ok".into(), message_id: Some(conversation.id.to_string()) })
}

pub async fn find_integration_by_phone(db: &DbSession, phone: &str) -> Result<AssistantIntegration, AppError> {
    let result = db
        .query_unpaged(
            "SELECT assistant_id, user_id, id, channel, provider, status, config_token, config_phone_number, config_chatwoot_url, config_rate_limit_per_day, config_max_message_length, config_audio_response_mode, config_interpret_documents, config_split_messages, config_webhook_verify_token, created_at FROM inertial_eclipse.assistant_integrations WHERE config_phone_number = ? ALLOW FILTERING",
            (phone,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Collect ALL integrations with this phone number
    let mut all: Vec<AssistantIntegration> = Vec::new();
    for row in result
        .rows_typed::<IntegrationRow>()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?
    {
        let r = row.map_err(|e| AppError::DatabaseError(e.to_string()))?;
        all.push(row_to_integration(r));
    }

    if all.is_empty() {
        return Err(AppError::NotFound("No integration found for this phone number".into()));
    }

    // Prefer connected integrations whose assistant still exists
    let mut valid: Option<AssistantIntegration> = None;
    let mut orphans: Vec<AssistantIntegration> = Vec::new();

    for integration in all {
        // Skip disconnected integrations
        if integration.status.as_str() == "disconnected" {
            continue;
        }
        // Verify the assistant still exists
        match crate::services::assistant::get_assistant(db, &integration.user_id, &integration.assistant_id).await {
            Ok(_) => {
                if valid.is_none() {
                    valid = Some(integration);
                }
            }
            Err(_) => {
                orphans.push(integration);
            }
        }
    }

    // Clean up orphan integrations in the background
    for orphan in &orphans {
        tracing::warn!(
            "Cleaning up orphan integration {} for deleted assistant {}",
            orphan.id, orphan.assistant_id
        );
        let _ = db.query_unpaged(
            "DELETE FROM inertial_eclipse.assistant_integrations WHERE assistant_id = ? AND user_id = ? AND id = ?",
            (&orphan.assistant_id, &orphan.user_id, &orphan.id),
        ).await;
    }

    valid.ok_or_else(|| AppError::NotFound("No active integration found for this phone number".into()))
}

pub async fn find_integration_by_token(db: &DbSession, token: &str) -> Result<AssistantIntegration, AppError> {
    let result = db
        .query_unpaged(
            "SELECT assistant_id, user_id, id, channel, provider, status, config_token, config_phone_number, config_chatwoot_url, config_rate_limit_per_day, config_max_message_length, config_audio_response_mode, config_interpret_documents, config_split_messages, config_webhook_verify_token, created_at FROM inertial_eclipse.assistant_integrations WHERE config_token = ? ALLOW FILTERING",
            (token,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Collect ALL integrations with this token
    let mut all: Vec<AssistantIntegration> = Vec::new();
    for row in result
        .rows_typed::<IntegrationRow>()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?
    {
        let r = row.map_err(|e| AppError::DatabaseError(e.to_string()))?;
        all.push(row_to_integration(r));
    }

    if all.is_empty() {
        return Err(AppError::NotFound("No integration found for this token".into()));
    }

    // Prefer connected integrations whose assistant still exists
    let mut valid: Option<AssistantIntegration> = None;
    let mut orphans: Vec<AssistantIntegration> = Vec::new();

    for integration in all {
        if integration.status.as_str() == "disconnected" {
            continue;
        }
        match crate::services::assistant::get_assistant(db, &integration.user_id, &integration.assistant_id).await {
            Ok(_) => {
                if valid.is_none() {
                    valid = Some(integration);
                }
            }
            Err(_) => {
                orphans.push(integration);
            }
        }
    }

    // Clean up orphan integrations
    for orphan in &orphans {
        tracing::warn!(
            "Cleaning up orphan integration {} for deleted assistant {}",
            orphan.id, orphan.assistant_id
        );
        let _ = db.query_unpaged(
            "DELETE FROM inertial_eclipse.assistant_integrations WHERE assistant_id = ? AND user_id = ? AND id = ?",
            (&orphan.assistant_id, &orphan.user_id, &orphan.id),
        ).await;
    }

    valid.ok_or_else(|| AppError::NotFound("No active integration found for this token".into()))
}

async fn is_rate_limited(db: &DbSession, integration: &AssistantIntegration, limit: i32) -> Result<bool, AppError> {
    let today = Utc::now().format("%Y-%m-%d").to_string();
    let result = db
        .query_unpaged(
            "SELECT total_messages FROM inertial_eclipse.usage_stats WHERE user_id = ? AND assistant_id = ? AND period = ?",
            (&integration.user_id, &integration.assistant_id, &today as &str),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    if let Some((count,)) = result
        .maybe_first_row_typed::<(i64,)>()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?
    {
        if count >= limit as i64 {
            return Ok(true);
        }
    }
    Ok(false)
}

type ConversationRow = (Uuid, Uuid, Uuid, Option<String>, Option<String>, Option<DateTime<Utc>>, Option<DateTime<Utc>>, Option<String>, Option<bool>);

fn row_to_conversation(r: ConversationRow) -> Conversation {
    let fallback = Utc::now();
    Conversation {
        assistant_id: r.0, user_id: r.1, id: r.2,
        contact_number: r.3.unwrap_or_default(),
        channel: r.4.unwrap_or_default(),
        started_at: r.5.unwrap_or(fallback),
        last_message_at: r.6.unwrap_or(fallback),
        summary: r.7,
        ai_enabled: r.8.unwrap_or(true),
    }
}

async fn get_or_create_conversation(
    db: &DbSession, assistant_id: &Uuid, user_id: &Uuid, contact_number: &str, channel: &str,
) -> Result<Conversation, AppError> {
    let result = db
        .query_unpaged(
            "SELECT assistant_id, user_id, id, contact_number, channel, started_at, last_message_at, summary, ai_enabled FROM inertial_eclipse.conversations WHERE assistant_id = ? AND user_id = ? AND contact_number = ? ALLOW FILTERING",
            (assistant_id, user_id, contact_number),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    if let Some(row) = result
        .maybe_first_row_typed::<ConversationRow>()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?
    {
        return Ok(row_to_conversation(row));
    }

    let id = Uuid::new_v4();
    let now = ts_now();

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.conversations (assistant_id, user_id, id, contact_number, channel, started_at, last_message_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (assistant_id, user_id, &id, contact_number, channel, now, now),
    ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(Conversation {
        assistant_id: *assistant_id, user_id: *user_id, id,
        contact_number: contact_number.to_string(), channel: channel.to_string(),
        started_at: Utc::now(), last_message_at: Utc::now(), summary: None,
        ai_enabled: true,
    })
}

async fn save_message(
    db: &DbSession, conversation_id: &Uuid, role: &str, content: &str,
    media_url: Option<&str>, media_type: Option<&str>, tokens_used: Option<i32>,
) -> Result<(), AppError> {
    let now = ts_now();

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.messages (conversation_id, id, role, content, media_url, media_type, tokens_used, created_at) VALUES (?, now(), ?, ?, ?, ?, ?, ?)",
        (conversation_id, role, content, &media_url, &media_type, &tokens_used, now),
    ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

pub async fn get_recent_messages(db: &DbSession, conversation_id: &Uuid, limit: i32) -> Result<Vec<Message>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT conversation_id, id, role, content, media_url, media_type, tokens_used, sub_agent_id, created_at FROM inertial_eclipse.messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?",
            (conversation_id, limit),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut messages = Vec::new();
    for row in result
        .rows_typed::<(Uuid, CqlTimeuuid, Option<String>, Option<String>, Option<String>, Option<String>, Option<i32>, Option<Uuid>, Option<DateTime<Utc>>)>()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?
    {
        let r = row.map_err(|e| AppError::DatabaseError(e.to_string()))?;
        messages.push(Message {
            conversation_id: r.0, id: r.1.into(),
            role: r.2.unwrap_or_default(), content: r.3,
            media_url: r.4, media_type: r.5, tokens_used: r.6,
            sub_agent_id: r.7, created_at: r.8.unwrap_or_else(Utc::now),
        });
    }

    messages.reverse();
    Ok(messages)
}

pub async fn list_conversations(db: &DbSession, assistant_id: &Uuid, user_id: &Uuid) -> Result<Vec<Conversation>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT assistant_id, user_id, id, contact_number, channel, started_at, last_message_at, summary, ai_enabled FROM inertial_eclipse.conversations WHERE assistant_id = ? AND user_id = ?",
            (assistant_id, user_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut conversations = Vec::new();
    for row in result
        .rows_typed::<ConversationRow>()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?
    {
        let r = row.map_err(|e| AppError::DatabaseError(e.to_string()))?;
        conversations.push(row_to_conversation(r));
    }

    Ok(conversations)
}

pub async fn count_messages(db: &DbSession, conversation_id: &Uuid) -> Result<i64, AppError> {
    let result = db
        .query_unpaged(
            "SELECT count(*) FROM inertial_eclipse.messages WHERE conversation_id = ?",
            (conversation_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let count = result
        .maybe_first_row_typed::<(i64,)>()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?
        .map(|r| r.0)
        .unwrap_or(0);

    Ok(count)
}

pub async fn sum_tokens(db: &DbSession, conversation_id: &Uuid) -> Result<i64, AppError> {
    let result = db
        .query_unpaged(
            "SELECT tokens_used FROM inertial_eclipse.messages WHERE conversation_id = ?",
            (conversation_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut total: i64 = 0;
    for row in result
        .rows_typed::<(Option<i32>,)>()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?
    {
        if let Ok((Some(t),)) = row {
            total += t as i64;
        }
    }
    Ok(total)
}

pub async fn send_direct_message(
    db: &DbSession,
    config: &Config,
    _encryption: &EncryptionService,
    user_id: &Uuid,
    assistant_id: &Uuid,
    conversation_id: &Uuid,
    message_text: &str,
) -> Result<Message, AppError> {
    // Get conversation to find contact and channel
    let conv = get_conversation(db, assistant_id, user_id, conversation_id).await?;

    // Save the manual message as "assistant" role
    save_message(db, conversation_id, "assistant", message_text, None, None, None).await?;

    // Send via messaging provider if it's a real channel (not playground)
    if conv.channel != "playground" {
        match find_integration_for_conversation(db, assistant_id, user_id, &conv.channel).await {
            Ok(integration) => {
                // Backfill empty channel/contact_number from legacy conversations
                if conv.channel.is_empty() || conv.contact_number.is_empty() {
                    let ch = if conv.channel.is_empty() { &integration.channel } else { &conv.channel };
                    let _ = db.query_unpaged(
                        "UPDATE inertial_eclipse.conversations SET channel = ? WHERE assistant_id = ? AND user_id = ? AND id = ?",
                        (ch, assistant_id, user_id, conversation_id),
                    ).await;
                }
                send_message_via_provider(config, &integration, &conv.contact_number, message_text).await?;
            }
            Err(e) => {
                tracing::warn!("No integration found for conversation {conversation_id}, message saved but not sent via provider: {e}");
            }
        }
    }

    // Update last_message_at
    let now = ts_now();
    db.query_unpaged(
        "UPDATE inertial_eclipse.conversations SET last_message_at = ? WHERE assistant_id = ? AND user_id = ? AND id = ?",
        (now, assistant_id, user_id, conversation_id),
    ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Publish SSE event
    crate::services::events::publish_global(user_id, crate::services::events::SseEvent {
        event_type: "conversation_updated".into(),
        data: serde_json::json!({
            "conversationId": conversation_id.to_string(),
            "assistantId": assistant_id.to_string(),
        }).to_string(),
    }).await;

    // Return the saved message
    let messages = get_recent_messages(db, conversation_id, 1).await?;
    messages.into_iter().last().ok_or_else(|| AppError::InternalError("Failed to retrieve saved message".into()))
}

async fn get_conversation(
    db: &DbSession, assistant_id: &Uuid, user_id: &Uuid, conversation_id: &Uuid,
) -> Result<Conversation, AppError> {
    let result = db
        .query_unpaged(
            "SELECT assistant_id, user_id, id, contact_number, channel, started_at, last_message_at, summary, ai_enabled FROM inertial_eclipse.conversations WHERE assistant_id = ? AND user_id = ? AND id = ?",
            (assistant_id, user_id, conversation_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let row = result
        .maybe_first_row_typed::<ConversationRow>()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?
        .ok_or_else(|| AppError::NotFound("Conversation not found".into()))?;

    Ok(row_to_conversation(row))
}

async fn find_integration_for_conversation(
    db: &DbSession, assistant_id: &Uuid, user_id: &Uuid, channel: &str,
) -> Result<crate::models::integration::AssistantIntegration, AppError> {
    let result = db
        .query_unpaged(
            "SELECT assistant_id, user_id, id, channel, provider, status, config_token, config_phone_number, config_chatwoot_url, config_rate_limit_per_day, config_max_message_length, config_audio_response_mode, config_interpret_documents, config_split_messages, config_webhook_verify_token, created_at FROM inertial_eclipse.assistant_integrations WHERE assistant_id = ? AND user_id = ? ALLOW FILTERING",
            (assistant_id, user_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut fallback: Option<AssistantIntegration> = None;
    for row in result
        .rows_typed::<IntegrationRow>()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?
    {
        let r = row.map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let integration = row_to_integration(r);
        if !channel.is_empty() && integration.channel == channel {
            return Ok(integration);
        }
        if fallback.is_none() {
            // Fallback: match by provider (legacy) or use first integration if channel is empty
            if channel.is_empty() || integration.provider == channel {
                fallback = Some(integration);
            }
        }
    }

    fallback.ok_or_else(|| AppError::NotFound(format!("No {channel} integration found for this assistant")))
}

pub async fn playground_chat(
    db: &DbSession,
    encryption: &EncryptionService,
    requesting_user_id: &Uuid,
    assistant_id: &Uuid,
    share_token: Option<&str>,
    user_message: &str,
) -> Result<PlaygroundResponse, AppError> {
    // Resolve assistant — ownership first, then any token fallback
    let assistant = match crate::services::assistant::get_assistant(db, requesting_user_id, assistant_id).await {
        Ok(a) => a,
        Err(_) => {
            let token = share_token
                .ok_or_else(|| AppError::NotFound("Assistant not found".into()))?;
            let (a, _perms) = crate::services::assistant::get_by_any_token(db, token).await?;
            if a.id != *assistant_id {
                return Err(AppError::NotFound("Assistant not found".into()));
            }
            a
        }
    };

    // Always use the OWNER's credentials — never the requesting user's
    let owner_id = assistant.user_id;
    let owner = crate::services::auth::get_user_by_id(db, &owner_id).await?;
    let encrypted_key = match assistant.llm_provider.as_str() {
        "openai" => owner.api_key_openai.clone(),
        "claude" => owner.api_key_claude.clone(),
        "gemini" => owner.api_key_gemini.clone(),
        _ => None,
    }
    .ok_or_else(|| AppError::BadRequest("API key not configured for this provider".into()))?;

    let api_key = encryption.decrypt(&encrypted_key)?;

    // Contact distinguishes who is chatting; DB partition key uses the owner's user_id
    let contact = format!("playground-{requesting_user_id}");
    let conversation =
        get_or_create_conversation(db, assistant_id, &owner_id, &contact, "playground").await?;

    save_message(db, &conversation.id, "user", user_message, None, None, None).await?;

    let history = get_recent_messages(db, &conversation.id, 20).await?;

    // RAG: retrieve relevant context (use owner's files)
    let rag_contexts = crate::services::rag::retrieve_context(
        db, encryption, &owner_id, assistant_id, user_message, 3,
    ).await.unwrap_or_default();

    let mut llm_messages = Vec::new();
    if let Some(system_prompt) = &assistant.system_prompt {
        let mut prompt = system_prompt.clone();
        if !rag_contexts.is_empty() {
            prompt.push_str("\n\n--- Relevant Knowledge Base Context ---\n");
            for ctx in &rag_contexts {
                prompt.push_str(ctx);
                prompt.push_str("\n---\n");
            }
        }
        llm_messages.push(LlmMessage { role: "system".into(), content: prompt, media_base64: None, media_mime_type: None });
    } else if !rag_contexts.is_empty() {
        let mut prompt = "Use the following knowledge base context to help answer:\n\n".to_string();
        for ctx in &rag_contexts {
            prompt.push_str(ctx);
            prompt.push_str("\n---\n");
        }
        llm_messages.push(LlmMessage { role: "system".into(), content: prompt, media_base64: None, media_mime_type: None });
    }
    for msg in &history {
        llm_messages.push(LlmMessage { role: msg.role.clone(), content: msg.content.clone().unwrap_or_default(), media_base64: None, media_mime_type: None });
    }

    // Load enabled tools
    let tools = crate::services::assistant::list_tools(db, assistant_id).await?;
    let llm_tools: Vec<llm::LlmTool> = tools
        .iter()
        .filter(|t| t.is_enabled)
        .map(llm::LlmTool::from)
        .collect();

    let tool_ctx = llm::ToolContext {
        db: Some(db),
        assistant_id: Some(*assistant_id),
        user_id: Some(owner_id),
        conversation_id: None,
        config: None,
        encryption: None,
    };
    let llm_response = llm::call_llm_with_tools_ctx(
        &assistant.llm_provider, &assistant.model, &api_key,
        llm_messages, assistant.temperature, assistant.max_tokens, &llm_tools, &tool_ctx,
    ).await?;

    // Save tool call logs
    for record in &llm_response.tool_call_records {
        if let Some(tid) = &record.tool_id {
            let args_str = serde_json::to_string(&record.arguments).ok();
            if let Err(e) = crate::services::assistant::save_tool_call_log(
                db,
                assistant_id,
                tid,
                &record.tool_name,
                args_str.as_deref(),
                record.status_code,
                record.response_body.as_deref(),
                record.error.as_deref(),
                record.duration_ms,
            ).await {
                tracing::error!(tool = %record.tool_name, error = %e, "Failed to save tool call log");
            }
        }
    }

    save_message(db, &conversation.id, "assistant", &llm_response.content, None, None, Some(llm_response.tokens_used)).await?;

    let now = ts_now();
    db.query_unpaged(
        "UPDATE inertial_eclipse.conversations SET last_message_at = ? WHERE assistant_id = ? AND user_id = ? AND id = ?",
        (now, assistant_id, &owner_id, &conversation.id),
    ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;

    update_usage_stats(db, &owner_id, assistant_id, llm_response.tokens_used).await?;

    let replies = if assistant.config_split_messages {
        llm_response.content.split("\n\n")
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.to_string())
            .collect()
    } else {
        vec![llm_response.content.clone()]
    };

    // Generate audio if configured
    let audio_mode = assistant.config_audio_mode.as_deref().unwrap_or("disabled");
    let audio_base64 = if audio_mode == "always" || audio_mode == "audio_to_audio" {
        if let Some(voice_id) = &assistant.config_audio_voice_id {
            let audio_provider = assistant.config_audio_provider.as_deref().unwrap_or("elevenlabs");
            let tts_key_opt = match audio_provider {
                "openai" => owner.api_key_openai.as_ref().and_then(|k| encryption.decrypt(k).ok()),
                _ => owner.api_key_elevenlabs.as_ref().and_then(|k| encryption.decrypt(k).ok()),
            };
            if let Some(api_key) = tts_key_opt {
                let tts_result = match audio_provider {
                    "openai" => crate::services::openai_audio::text_to_speech(
                        &api_key, voice_id, &llm_response.content
                    ).await,
                    _ => crate::services::elevenlabs::text_to_speech(
                        &api_key, voice_id, &llm_response.content, "mp3_44100_128"
                    ).await,
                };
                match tts_result {
                    Ok(bytes) => Some(BASE64.encode(&bytes)),
                    Err(e) => {
                        tracing::warn!("Playground TTS failed: {e}");
                        None
                    }
                }
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    Ok(PlaygroundResponse {
        reply: llm_response.content,
        replies,
        conversation_id: conversation.id.to_string(),
        tokens_used: llm_response.tokens_used,
        audio_base64,
    })
}

#[derive(Debug, Serialize)]
pub struct PlaygroundResponse {
    pub reply: String,
    pub replies: Vec<String>,
    pub conversation_id: String,
    pub tokens_used: i32,
    /// Base64-encoded MP3 audio, present when the assistant has audio mode enabled
    pub audio_base64: Option<String>,
}

/// Send a "composing" (typing) presence indicator before sending a message.
/// For Meta Official, `incoming_message_id` is required to send typing via the read receipt endpoint.
async fn send_typing_indicator(
    config: &Config, integration: &AssistantIntegration, contact_phone: &str,
    incoming_message_id: Option<&str>,
) -> Result<(), AppError> {
    let client = Client::new();
    let connection_phone = integration.config_phone_number.as_deref().unwrap_or_default();
    match integration.provider.as_str() {
        "baileys" => {
            let jid = format!("{}@s.whatsapp.net", contact_phone.trim_start_matches('+'));
            let url = format!("{}/connections/{}/presence", config.baileys_url, connection_phone);
            let resp = client
                .patch(&url)
                .header("x-api-key", &config.baileys_api_key)
                .json(&json!({
                    "type": "composing",
                    "toJid": jid
                }))
                .send()
                .await;
            match resp {
                Ok(r) if !r.status().is_success() => {
                    tracing::warn!("Baileys presence composing failed: {}", r.status());
                }
                Err(e) => {
                    tracing::warn!("Failed to send typing indicator via baileys: {e}");
                }
                _ => {}
            }
        }
        "meta_official" => {
            if let Some(msg_id) = incoming_message_id {
                let access_token = integration.config_token.as_deref().unwrap_or_default();
                let phone_number_id = connection_phone;
                let url = format!("https://graph.facebook.com/v21.0/{phone_number_id}/messages");
                let resp = client
                    .post(&url)
                    .bearer_auth(access_token)
                    .json(&json!({
                        "messaging_product": "whatsapp",
                        "status": "read",
                        "message_id": msg_id,
                        "typing_indicator": { "type": "text" }
                    }))
                    .send()
                    .await;
                match resp {
                    Ok(r) if !r.status().is_success() => {
                        tracing::warn!("Meta typing indicator failed: {}", r.status());
                    }
                    Err(e) => {
                        tracing::warn!("Failed to send typing indicator via Meta: {e}");
                    }
                    _ => {}
                }
            }
        }
        _ => {}
    }
    Ok(())
}

fn audio_filename_for_mime(mime: &str) -> String {
    if mime.contains("ogg") {
        "audio.ogg".into()
    } else if mime.contains("mp4") || mime.contains("m4a") {
        "audio.mp4".into()
    } else if mime.contains("wav") {
        "audio.wav".into()
    } else if mime.contains("webm") {
        "audio.webm".into()
    } else {
        "audio.mp3".into()
    }
}

/// Resolves audio bytes for transcription from the webhook payload.
/// - Baileys / Telegram: decode from `media_base64`
/// - Meta Official: download via the Graph API media endpoint using the integration's access token
async fn resolve_audio_bytes(
    webhook: &IncomingWebhook,
    integration: &AssistantIntegration,
    encryption: &EncryptionService,
) -> Option<Vec<u8>> {
    // Already have pre-fetched base64 (Baileys, Telegram)
    if let Some(b64) = &webhook.media_base64 {
        return BASE64.decode(b64).ok();
    }

    // Meta Official: media_url holds the media ID
    if integration.provider == "meta_official" {
        if let Some(media_id) = &webhook.media_url {
            let access_token = integration.config_token.as_deref().unwrap_or_default();
            let client = Client::new();

            // Step 1: get the download URL from Graph API
            let meta_url = format!("https://graph.facebook.com/v21.0/{media_id}");
            let url_resp = client
                .get(&meta_url)
                .bearer_auth(access_token)
                .send()
                .await
                .ok()?;
            if !url_resp.status().is_success() {
                tracing::warn!("Meta media URL fetch failed: {}", url_resp.status());
                return None;
            }
            let url_data: serde_json::Value = url_resp.json().await.ok()?;
            let download_url = url_data["url"].as_str()?;

            // Step 2: download the actual audio bytes
            let audio_resp = client
                .get(download_url)
                .bearer_auth(access_token)
                .send()
                .await
                .ok()?;
            if !audio_resp.status().is_success() {
                tracing::warn!("Meta media download failed: {}", audio_resp.status());
                return None;
            }
            return audio_resp.bytes().await.ok().map(|b| b.to_vec());
        }
    }

    None
}

/// Send a reply via the messaging provider.
/// - `integration`: the integration config (contains provider, phone, token, etc.)
/// - `contact_phone`: the phone of the person who sent the message (the recipient of the reply)
/// Public wrapper for sending messages via provider (used by pix notification)
pub async fn send_message_via_provider_public(
    config: &Config, integration: &AssistantIntegration, contact_phone: &str, message: &str,
) -> Result<(), AppError> {
    send_message_via_provider(config, integration, contact_phone, message).await
}

async fn send_message_via_provider(
    config: &Config, integration: &AssistantIntegration, contact_phone: &str, message: &str,
) -> Result<(), AppError> {
    let client = Client::new();
    let connection_phone = integration.config_phone_number.as_deref().unwrap_or_default();
    match integration.provider.as_str() {
        "baileys" => {
            let jid = format!("{}@s.whatsapp.net", contact_phone.trim_start_matches('+'));
            let url = format!("{}/connections/{}/send-message", config.baileys_url, connection_phone);
            let resp = client
                .post(&url)
                .header("x-api-key", &config.baileys_api_key)
                .json(&json!({
                    "jid": jid,
                    "messageContent": { "text": message }
                }))
                .send()
                .await
                .map_err(|e| AppError::InternalError(format!("Failed to send via baileys: {e}")))?;
            if !resp.status().is_success() {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                tracing::error!("Baileys send-message failed: {status} {body}");
                return Err(AppError::InternalError(format!("Baileys send failed: {status}")));
            }
        }
        "meta_official" => {
            let access_token = integration.config_token.as_deref().unwrap_or_default();
            let phone_number_id = connection_phone;
            let url = format!("https://graph.facebook.com/v21.0/{phone_number_id}/messages");
            let resp = client
                .post(&url)
                .bearer_auth(access_token)
                .json(&json!({
                    "messaging_product": "whatsapp",
                    "recipient_type": "individual",
                    "to": contact_phone.trim_start_matches('+'),
                    "type": "text",
                    "text": { "body": message }
                }))
                .send()
                .await
                .map_err(|e| AppError::InternalError(format!("Failed to send via Meta: {e}")))?;
            if !resp.status().is_success() {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                tracing::error!("Meta send-message failed: {status} {body}");
                return Err(AppError::InternalError(format!("Meta send failed: {status}")));
            }
        }
        "telegram" => {
            let token = integration.config_token.as_deref().unwrap_or_default();
            let url = format!("https://api.telegram.org/bot{token}/sendMessage");
            let resp = client
                .post(&url)
                .json(&json!({
                    "chat_id": contact_phone,
                    "text": message
                }))
                .send()
                .await
                .map_err(|e| AppError::InternalError(format!("Failed to send via Telegram: {e}")))?;
            if !resp.status().is_success() {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                tracing::error!("Telegram sendMessage failed: {status} {body}");
                return Err(AppError::InternalError(format!("Telegram send failed: {status}")));
            }
        }
        _ => return Err(AppError::BadRequest(format!("Unknown provider: {}", integration.provider))),
    }

    Ok(())
}

/// Generate TTS audio (via the configured provider) and send it via the appropriate channel.
async fn send_responses_as_audio(
    db: &DbSession,
    encryption: &EncryptionService,
    config: &Config,
    user_id: &Uuid,
    audio_provider: &str,
    voice_id: &str,
    integration: &AssistantIntegration,
    contact_phone: &str,
    text: &str,
) -> Result<(), AppError> {
    let user = crate::services::auth::get_user_by_id(db, user_id).await?;

    // Use OGG Opus for Telegram voice messages; MP3 for WhatsApp/others
    let (elevenlabs_format, mime) = if integration.provider == "telegram" {
        ("opus_48000_192", "audio/ogg")
    } else {
        ("mp3_44100_128", "audio/mpeg")
    };

    let audio_bytes = match audio_provider {
        "openai" => {
            let encrypted_key = user
                .api_key_openai
                .ok_or_else(|| AppError::BadRequest("OpenAI API key not configured".into()))?;
            let api_key = encryption.decrypt(&encrypted_key)?;
            crate::services::openai_audio::text_to_speech(&api_key, voice_id, text).await?
        }
        _ => {
            // Default: elevenlabs
            let encrypted_key = user
                .api_key_elevenlabs
                .ok_or_else(|| AppError::BadRequest("ElevenLabs API key not configured".into()))?;
            let api_key = encryption.decrypt(&encrypted_key)?;
            crate::services::elevenlabs::text_to_speech(&api_key, voice_id, text, elevenlabs_format).await?
        }
    };

    send_audio_via_provider(config, integration, contact_phone, &audio_bytes, mime).await
}

async fn send_audio_via_provider(
    config: &Config,
    integration: &AssistantIntegration,
    contact_phone: &str,
    audio_bytes: &[u8],
    mime: &str,
) -> Result<(), AppError> {
    let client = Client::new();
    let connection_phone = integration.config_phone_number.as_deref().unwrap_or_default();

    match integration.provider.as_str() {
        "baileys" => {
            let jid = format!("{}@s.whatsapp.net", contact_phone.trim_start_matches('+'));
            let url = format!(
                "{}/connections/{}/send-message",
                config.baileys_url, connection_phone
            );
            let b64 = BASE64.encode(audio_bytes);
            let resp = client
                .post(&url)
                .header("x-api-key", &config.baileys_api_key)
                .json(&json!({
                    "jid": jid,
                    "messageContent": {
                        "audio": b64,
                        "mimetype": mime,
                        "ptt": false
                    }
                }))
                .send()
                .await
                .map_err(|e| AppError::InternalError(format!("Baileys audio send failed: {e}")))?;
            if !resp.status().is_success() {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                return Err(AppError::InternalError(format!(
                    "Baileys audio send error {status}: {body}"
                )));
            }
        }
        "meta_official" => {
            let access_token = integration.config_token.as_deref().unwrap_or_default();
            let phone_number_id = connection_phone;

            // Step 1: upload media to Meta
            let media_url =
                format!("https://graph.facebook.com/v21.0/{phone_number_id}/media");
            let file_part = reqwest::multipart::Part::bytes(audio_bytes.to_vec())
                .file_name("audio.mp3")
                .mime_str(mime)
                .map_err(|e| AppError::InternalError(format!("MIME error: {e}")))?;
            let form = reqwest::multipart::Form::new()
                .text("messaging_product", "whatsapp")
                .text("type", mime.to_string())
                .part("file", file_part);

            let upload_resp = client
                .post(&media_url)
                .bearer_auth(access_token)
                .multipart(form)
                .send()
                .await
                .map_err(|e| AppError::InternalError(format!("Meta media upload failed: {e}")))?;

            if !upload_resp.status().is_success() {
                let status = upload_resp.status();
                let body = upload_resp.text().await.unwrap_or_default();
                return Err(AppError::InternalError(format!(
                    "Meta media upload error {status}: {body}"
                )));
            }

            let upload_data: serde_json::Value = upload_resp
                .json()
                .await
                .map_err(|e| AppError::InternalError(format!("Meta upload parse error: {e}")))?;
            let media_id = upload_data["id"]
                .as_str()
                .ok_or_else(|| AppError::InternalError("No media_id in Meta response".into()))?;

            // Step 2: send audio message
            let msg_url =
                format!("https://graph.facebook.com/v21.0/{phone_number_id}/messages");
            let resp = client
                .post(&msg_url)
                .bearer_auth(access_token)
                .json(&json!({
                    "messaging_product": "whatsapp",
                    "recipient_type": "individual",
                    "to": contact_phone.trim_start_matches('+'),
                    "type": "audio",
                    "audio": { "id": media_id }
                }))
                .send()
                .await
                .map_err(|e| AppError::InternalError(format!("Meta audio send failed: {e}")))?;

            if !resp.status().is_success() {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                return Err(AppError::InternalError(format!(
                    "Meta audio send error {status}: {body}"
                )));
            }
        }
        "telegram" => {
            let token = integration.config_token.as_deref().unwrap_or_default();
            let url = format!("https://api.telegram.org/bot{token}/sendVoice");
            let ext = if mime.contains("ogg") { "ogg" } else { "mp3" };
            let file_part = reqwest::multipart::Part::bytes(audio_bytes.to_vec())
                .file_name(format!("voice.{ext}"))
                .mime_str(mime)
                .map_err(|e| AppError::InternalError(format!("MIME error: {e}")))?;
            let form = reqwest::multipart::Form::new()
                .text("chat_id", contact_phone.to_string())
                .part("voice", file_part);

            let resp = client
                .post(&url)
                .multipart(form)
                .send()
                .await
                .map_err(|e| AppError::InternalError(format!("Telegram sendVoice failed: {e}")))?;

            if !resp.status().is_success() {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                return Err(AppError::InternalError(format!(
                    "Telegram sendVoice error {status}: {body}"
                )));
            }
        }
        p => {
            return Err(AppError::BadRequest(format!(
                "Audio not supported for provider: {p}"
            )))
        }
    }

    Ok(())
}

async fn update_usage_stats(db: &DbSession, user_id: &Uuid, assistant_id: &Uuid, tokens: i32) -> Result<(), AppError> {
    let today = Utc::now().format("%Y-%m-%d").to_string();

    // Read current stats
    let result = db.query_unpaged(
        "SELECT total_tokens, total_messages FROM inertial_eclipse.usage_stats WHERE user_id = ? AND assistant_id = ? AND period = ?",
        (user_id, assistant_id, &today as &str),
    ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let (current_tokens, current_messages) = result
        .maybe_first_row_typed::<(i64, i64)>()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?
        .unwrap_or((0, 0));

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.usage_stats (user_id, assistant_id, period, total_tokens, total_messages) VALUES (?, ?, ?, ?, ?)",
        (user_id, assistant_id, &today as &str, current_tokens + tokens as i64, current_messages + 2),
    ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

pub async fn toggle_ai_enabled(
    db: &DbSession,
    assistant_id: &Uuid,
    user_id: &Uuid,
    conversation_id: &Uuid,
    ai_enabled: bool,
) -> Result<(), AppError> {
    // Verify conversation exists and belongs to user
    get_conversation(db, assistant_id, user_id, conversation_id).await?;

    db.query_unpaged(
        "UPDATE inertial_eclipse.conversations SET ai_enabled = ? WHERE assistant_id = ? AND user_id = ? AND id = ?",
        (ai_enabled, assistant_id, user_id, conversation_id),
    ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

pub async fn delete_conversation(
    db: &DbSession,
    assistant_id: &Uuid,
    user_id: &Uuid,
    conversation_id: &Uuid,
) -> Result<(), AppError> {
    // Verify conversation exists and belongs to user
    get_conversation(db, assistant_id, user_id, conversation_id).await?;

    // Delete all messages for this conversation
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.messages WHERE conversation_id = ?",
        (conversation_id,),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Delete the conversation itself
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.conversations WHERE assistant_id = ? AND user_id = ? AND id = ?",
        (assistant_id, user_id, conversation_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}


#[derive(Debug, Serialize)]
pub struct SummaryResponse {
    pub summary: String,
    pub tokens_used: i32,
}

pub async fn summarize_conversation(
    db: &DbSession,
    encryption: &EncryptionService,
    user_id: &Uuid,
    assistant_id: &Uuid,
    conversation_id: &Uuid,
    provider: &str,
    model: &str,
) -> Result<SummaryResponse, AppError> {
    // Validate ownership
    let _conv = get_conversation(db, assistant_id, user_id, conversation_id).await?;

    // Get all messages (up to 200)
    let messages = get_recent_messages(db, conversation_id, 200).await?;
    if messages.is_empty() {
        return Err(AppError::BadRequest("Conversa sem mensagens para resumir".into()));
    }

    // Get user's API key for the chosen provider
    let user = crate::services::auth::get_user_by_id(db, user_id).await?;
    let encrypted_key = match provider {
        "openai" => user.api_key_openai,
        "claude" => user.api_key_claude,
        "gemini" => user.api_key_gemini,
        _ => None,
    }
    .ok_or_else(|| AppError::BadRequest("Chave de API não configurada para este provedor".into()))?;

    let api_key = encryption.decrypt(&encrypted_key)?;

    // Build conversation transcript
    let mut transcript = String::new();
    for msg in &messages {
        let role_label = if msg.role == "user" { "Cliente" } else { "Agente" };
        transcript.push_str(&format!("[{}] {}: {}\n", msg.created_at.format("%d/%m %H:%M"), role_label, msg.content.as_deref().unwrap_or("")));
    }

    let system_prompt = "Você é um analista especializado em atendimento ao cliente. Analise a conversa abaixo entre um Agente (IA) e um Cliente e forneça:\n\n\
        1. **Resumo da Conversa**: Um resumo conciso dos principais tópicos discutidos e do resultado da interação.\n\
        2. **Avaliação do Atendimento**: Avalie a qualidade da interação Agente-Cliente considerando:\n\
           - Clareza e precisão das respostas do Agente\n\
           - Tempo de resolução / eficiência\n\
           - Tom e cordialidade\n\
           - Se o problema/dúvida do Cliente foi resolvido\n\
        3. **Nota Geral**: De 1 a 10, com justificativa.\n\
        4. **Sugestões de Melhoria**: Se aplicável, o que poderia ser melhorado no atendimento.\n\n\
        Responda em português brasileiro de forma clara e estruturada.";

    let llm_messages = vec![
        LlmMessage { role: "system".into(), content: system_prompt.into(), media_base64: None, media_mime_type: None },
        LlmMessage { role: "user".into(), content: format!("Conversa para análise:\n\n{transcript}"), media_base64: None, media_mime_type: None },
    ];

    let response = llm::call_llm(provider, model, &api_key, llm_messages, 0.3, 2000).await?;

    Ok(SummaryResponse {
        summary: response.content,
        tokens_used: response.tokens_used,
    })
}

// ─── Built-in tool: Send Document ────────────────────────────────────────────

/// Extract a filename from a URL path, or use a default.
fn filename_from_url(url: &str, provided: Option<&str>) -> String {
    if let Some(name) = provided {
        if !name.is_empty() {
            return name.to_string();
        }
    }
    url.split('?')
        .next()
        .unwrap_or(url)
        .rsplit('/')
        .next()
        .filter(|s| !s.is_empty() && s.contains('.'))
        .unwrap_or("document")
        .to_string()
}

/// Download a file from a URL and determine its content type.
/// Returns (bytes, content_type, is_image).
async fn download_file_from_url(url: &str) -> Result<(Vec<u8>, String, bool), AppError> {
    let client = Client::new();
    let resp = client
        .get(url)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| AppError::InternalError(format!("Failed to download file from URL: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::InternalError(format!(
            "File download failed: HTTP {}",
            resp.status()
        )));
    }

    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();

    let is_image = content_type.starts_with("image/");

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::InternalError(format!("Failed to read file bytes: {e}")))?
        .to_vec();

    if bytes.is_empty() {
        return Err(AppError::InternalError("Downloaded file is empty".into()));
    }

    Ok((bytes, content_type, is_image))
}

async fn send_document_via_provider(
    config: &Config,
    integration: &AssistantIntegration,
    contact_phone: &str,
    url: &str,
    caption: Option<&str>,
    filename: Option<&str>,
) -> Result<(), AppError> {
    let connection_phone = integration.config_phone_number.as_deref().unwrap_or_default();

    match integration.provider.as_str() {
        "baileys" => {
            // Baileys requires base64-encoded content, so download first
            let (bytes, content_type, is_image) = download_file_from_url(url).await?;
            let b64 = BASE64.encode(&bytes);

            let jid = format!("{}@s.whatsapp.net", contact_phone.trim_start_matches('+'));
            let api_url = format!("{}/connections/{}/send-message", config.baileys_url, connection_phone);

            let message_content = if is_image {
                json!({
                    "image": b64,
                    "mimetype": content_type,
                    "caption": caption.unwrap_or_default()
                })
            } else {
                let fname = filename_from_url(url, filename);
                json!({
                    "document": b64,
                    "mimetype": content_type,
                    "fileName": fname,
                    "caption": caption.unwrap_or_default()
                })
            };

            let client = Client::new();
            let resp = client
                .post(&api_url)
                .header("x-api-key", &config.baileys_api_key)
                .json(&json!({
                    "jid": jid,
                    "messageContent": message_content
                }))
                .send()
                .await
                .map_err(|e| AppError::InternalError(format!("Failed to send document via baileys: {e}")))?;
            if !resp.status().is_success() {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                tracing::error!("Baileys send-document failed: {status} {body}");
                return Err(AppError::InternalError(format!("Baileys send-document failed: {status}")));
            }
        }
        "meta_official" => {
            // Meta supports sending by URL link directly
            let (_, content_type, is_image) = download_file_from_url(url).await?;
            let _ = content_type; // used only for type detection

            let access_token = integration.config_token.as_deref().unwrap_or_default();
            let phone_number_id = connection_phone;
            let api_url = format!("https://graph.facebook.com/v21.0/{phone_number_id}/messages");

            let client = Client::new();
            let body = if is_image {
                json!({
                    "messaging_product": "whatsapp",
                    "recipient_type": "individual",
                    "to": contact_phone.trim_start_matches('+'),
                    "type": "image",
                    "image": {
                        "link": url,
                        "caption": caption.unwrap_or_default()
                    }
                })
            } else {
                let fname = filename_from_url(url, filename);
                json!({
                    "messaging_product": "whatsapp",
                    "recipient_type": "individual",
                    "to": contact_phone.trim_start_matches('+'),
                    "type": "document",
                    "document": {
                        "link": url,
                        "caption": caption.unwrap_or_default(),
                        "filename": fname
                    }
                })
            };

            let resp = client
                .post(&api_url)
                .bearer_auth(access_token)
                .json(&body)
                .send()
                .await
                .map_err(|e| AppError::InternalError(format!("Failed to send document via Meta: {e}")))?;
            if !resp.status().is_success() {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                tracing::error!("Meta send-document failed: {status} {body}");
                return Err(AppError::InternalError(format!("Meta send-document failed: {status}")));
            }
        }
        "telegram" => {
            // Telegram supports sending by URL directly
            let (_, _, is_image) = download_file_from_url(url).await?;

            let token = integration.config_token.as_deref().unwrap_or_default();
            let (method, file_field) = if is_image {
                ("sendPhoto", "photo")
            } else {
                ("sendDocument", "document")
            };
            let api_url = format!("https://api.telegram.org/bot{token}/{method}");

            let mut body = json!({
                "chat_id": contact_phone,
                file_field: url
            });
            if let Some(cap) = caption {
                body["caption"] = json!(cap);
            }

            let client = Client::new();
            let resp = client
                .post(&api_url)
                .json(&body)
                .send()
                .await
                .map_err(|e| AppError::InternalError(format!("Failed to send document via Telegram: {e}")))?;
            if !resp.status().is_success() {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                tracing::error!("Telegram {method} failed: {status} {body}");
                return Err(AppError::InternalError(format!("Telegram {method} failed: {status}")));
            }
        }
        _ => return Err(AppError::BadRequest(format!("Unknown provider: {}", integration.provider))),
    }

    tracing::info!(provider = %integration.provider, url = %url, "Document sent via tool");
    Ok(())
}

// ─── Built-in tool: PIX QR Code Sender ──────────────────────────────────────

async fn send_pix_qr_via_provider(
    config: &Config,
    integration: &AssistantIntegration,
    contact_phone: &str,
    qr_base64: &str,
    caption: &str,
) -> Result<(), AppError> {
    let connection_phone = integration.config_phone_number.as_deref().unwrap_or_default();

    match integration.provider.as_str() {
        "baileys" => {
            let jid = format!("{}@s.whatsapp.net", contact_phone.trim_start_matches('+'));
            let api_url = format!("{}/connections/{}/send-message", config.baileys_url, connection_phone);

            let client = Client::new();
            let resp = client
                .post(&api_url)
                .header("x-api-key", &config.baileys_api_key)
                .json(&json!({
                    "jid": jid,
                    "messageContent": {
                        "image": qr_base64,
                        "mimetype": "image/png",
                        "caption": caption
                    }
                }))
                .send()
                .await
                .map_err(|e| AppError::InternalError(format!("Failed to send PIX QR via baileys: {e}")))?;
            if !resp.status().is_success() {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                tracing::error!("Baileys send PIX QR failed: {status} {body}");
                return Err(AppError::InternalError(format!("Baileys send PIX QR failed: {status}")));
            }
        }
        "meta_official" => {
            // Meta Official API doesn't support base64 directly
            // Send the copia-e-cola as a text message instead
            if let Err(e) = send_message_via_provider(config, integration, contact_phone, caption).await {
                tracing::error!(error = %e, "Failed to send PIX text via Meta Official");
                return Err(e);
            }
        }
        "telegram" => {
            let token = integration.config_token.as_deref().unwrap_or_default();
            let api_url = format!("https://api.telegram.org/bot{token}/sendPhoto");

            // Decode base64 to bytes and send as multipart with caption
            if let Ok(bytes) = BASE64.decode(qr_base64) {
                let part = reqwest::multipart::Part::bytes(bytes)
                    .file_name("pix_qr.png")
                    .mime_str("image/png")
                    .unwrap_or_else(|_| reqwest::multipart::Part::bytes(vec![]));
                let form = reqwest::multipart::Form::new()
                    .text("chat_id", contact_phone.to_string())
                    .text("caption", caption.to_string())
                    .part("photo", part);

                let client = Client::new();
                let resp = client.post(&api_url).multipart(form).send().await
                    .map_err(|e| AppError::InternalError(format!("Failed to send PIX QR via Telegram: {e}")))?;
                if !resp.status().is_success() {
                    let status = resp.status();
                    let body = resp.text().await.unwrap_or_default();
                    tracing::error!("Telegram send PIX QR failed: {status} {body}");
                }
            }
        }
        _ => {}
    }

    tracing::info!(provider = %integration.provider, "PIX QR code sent");
    Ok(())
}

// ─── Built-in tool: Notify Human Agent ───────────────────────────────────────

async fn notify_human_agent(
    db: &DbSession,
    config: &Config,
    owner_user_id: &Uuid,
    assistant_id: &Uuid,
    assistant_name: &str,
    reason: &str,
    contact_phone: &str,
) -> Result<(), AppError> {
    let title = format!("Solicitação de Agente Humano - {assistant_name}");
    let message = format!(
        "Contato {contact_phone} precisa de atendimento humano. Motivo: {reason}"
    );

    // Notify assistant owner
    let owner = crate::services::auth::get_user_by_id(db, owner_user_id).await?;
    crate::services::notification::create_notification(
        db,
        owner_user_id,
        Some(assistant_id),
        None,
        "human_agent_request",
        &title,
        &message,
    )
    .await?;
    if let Err(e) = crate::services::email::send_human_agent_email(
        config,
        &owner.email,
        assistant_name,
        contact_phone,
        reason,
    )
    .await
    {
        tracing::error!(error = %e, "Failed to send human agent email to owner");
    }

    // Notify all users with accepted share tokens
    let token_users =
        crate::services::assistant::list_token_users(db, assistant_id).await?;
    for user in &token_users {
        crate::services::notification::create_notification(
            db,
            &user.user_id,
            Some(assistant_id),
            None,
            "human_agent_request",
            &title,
            &message,
        )
        .await
        .ok(); // Don't fail if one notification fails
        if let Err(e) = crate::services::email::send_human_agent_email(
            config,
            &user.user_email,
            assistant_name,
            contact_phone,
            reason,
        )
        .await
        {
            tracing::error!(error = %e, user_email = %user.user_email, "Failed to send human agent email to token user");
        }
    }

    tracing::info!(assistant = %assistant_name, contact = %contact_phone, "Human agent notification sent");
    Ok(())
}

async fn notify_appointment_event(
    db: &DbSession,
    config: &Config,
    owner_user_id: &Uuid,
    assistant_id: &Uuid,
    assistant_name: &str,
    appointment: &crate::models::appointment::Appointment,
    action: &str,
) -> Result<(), AppError> {
    let title = match action {
        "created" => format!("Novo agendamento - {assistant_name}"),
        "cancelled" => format!("Agendamento cancelado - {assistant_name}"),
        "rescheduled" => format!("Agendamento reagendado - {assistant_name}"),
        _ => format!("Atualização de agendamento - {assistant_name}"),
    };
    let message = format!(
        "{} | {} em {} | Cliente: {} ({})",
        title,
        appointment.appointment_type.as_deref().unwrap_or("Agendamento"),
        appointment.date_time.format("%d/%m/%Y %H:%M"),
        appointment.client_name,
        appointment.client_phone,
    );

    // Notify assistant owner
    let owner = crate::services::auth::get_user_by_id(db, owner_user_id).await?;
    crate::services::notification::create_notification(
        db,
        owner_user_id,
        Some(assistant_id),
        None,
        "appointment",
        &title,
        &message,
    )
    .await?;
    if let Err(e) = crate::services::email::send_appointment_email(
        config,
        &owner.email,
        assistant_name,
        action,
        &appointment.client_name,
        appointment.client_email.as_deref().unwrap_or(""),
        &appointment.client_phone,
        &appointment.date_time.format("%d/%m/%Y %H:%M").to_string(),
        appointment.duration_minutes,
        appointment.appointment_type.as_deref().unwrap_or(""),
        appointment.notes.as_deref().unwrap_or(""),
        appointment.origin_channel.as_deref().unwrap_or(""),
    )
    .await
    {
        tracing::error!(error = %e, "Failed to send appointment email to owner");
    }

    // Notify all users with accepted share tokens
    let token_users =
        crate::services::assistant::list_token_users(db, assistant_id).await?;
    for user in &token_users {
        crate::services::notification::create_notification(
            db,
            &user.user_id,
            Some(assistant_id),
            None,
            "appointment",
            &title,
            &message,
        )
        .await
        .ok();
        if let Err(e) = crate::services::email::send_appointment_email(
            config,
            &user.user_email,
            assistant_name,
            action,
            &appointment.client_name,
            appointment.client_email.as_deref().unwrap_or(""),
            &appointment.client_phone,
            &appointment.date_time.format("%d/%m/%Y %H:%M").to_string(),
            appointment.duration_minutes,
            appointment.appointment_type.as_deref().unwrap_or(""),
            appointment.notes.as_deref().unwrap_or(""),
            appointment.origin_channel.as_deref().unwrap_or(""),
        )
        .await
        {
            tracing::error!(error = %e, user_email = %user.user_email, "Failed to send appointment email to token user");
        }
    }

    tracing::info!(assistant = %assistant_name, action = %action, client = %appointment.client_name, "Appointment notification sent");
    Ok(())
}
