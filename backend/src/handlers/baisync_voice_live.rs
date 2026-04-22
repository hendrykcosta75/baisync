//! WebSocket proxy between the browser and Google AI Studio Live API for the
//! Baisync Agent voice panel (Sophie). Mirrors `swot_interview_live.rs` but
//! scoped per-user (no workspace) and with a Baisync-assistant system prompt
//! tailored for voice conversations (no UI blocks, no actions — just speech).
//!
//! Flow:
//!   1. Frontend POSTs `/api/baisync/voice/live-ticket` (JWT cookie) → `{ticket}`
//!   2. Frontend opens WS `/api/baisync/voice/live?ticket=<ticket>`
//!   3. Handler validates ticket, opens upstream WS to Google, relays frames.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Extension, Query};
use axum::response::Response;
use axum::Json;
use chrono::Utc;
use futures::{SinkExt, StreamExt};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::protocol::Message as TMessage;
use uuid::Uuid;

use crate::config::Config;
use crate::db::DbSession;
use crate::errors::AppError;
use crate::handlers::baisync::{get_skill_prompt, get_usage_tokens, increment_usage_tokens};
use crate::middleware::auth::AuthUser;
use crate::services::session::{
    append_event, create_session, SessionEventType, SessionId,
};

// ─── Ticket ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct VoiceTicketClaims {
    sub: String,
    exp: usize,
    kind: String,
}

#[derive(Debug, Serialize)]
pub struct VoiceTicketResponse {
    pub ticket: String,
}

/// POST /api/baisync/voice/live-ticket
pub async fn voice_ticket(
    Extension(config): Extension<Config>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<VoiceTicketResponse>, AppError> {
    let exp = Utc::now()
        .checked_add_signed(chrono::Duration::seconds(30))
        .ok_or_else(|| AppError::InternalError("time overflow".into()))?
        .timestamp() as usize;

    let claims = VoiceTicketClaims {
        sub: auth_user.user_id.to_string(),
        exp,
        kind: "baisync-voice".into(),
    };

    let ticket = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(config.jwt_secret.as_bytes()),
    )
    .map_err(|e| AppError::InternalError(format!("failed to sign ticket: {e}")))?;

    Ok(Json(VoiceTicketResponse { ticket }))
}

// ─── WebSocket ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct VoiceQuery {
    pub ticket: String,
}

/// GET /api/baisync/voice/live?ticket=...
pub async fn voice_live_ws(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Query(q): Query<VoiceQuery>,
    ws: WebSocketUpgrade,
) -> Result<Response, AppError> {
    let mut validation = Validation::default();
    validation.leeway = 5;
    let token_data = decode::<VoiceTicketClaims>(
        &q.ticket,
        &DecodingKey::from_secret(config.jwt_secret.as_bytes()),
        &validation,
    )
    .map_err(|_| AppError::Unauthorized("Invalid or expired ticket".into()))?;

    if token_data.claims.kind != "baisync-voice" {
        return Err(AppError::Unauthorized("Wrong ticket kind".into()));
    }

    // S3.2 — recover the voice caller's `user_id` from the ticket's `sub`
    // claim so session_events can be tenant-scoped. If the claim is
    // malformed (older ticket), fall back to a nil uuid so voice still
    // works but events are not persisted (the session create below will
    // error harmlessly and we drop session tracking for this call).
    let user_id = Uuid::parse_str(&token_data.claims.sub).unwrap_or_else(|_| {
        tracing::warn!(
            sub = %token_data.claims.sub,
            "baisync voice ticket has non-UUID sub; session tracking disabled for this call"
        );
        Uuid::nil()
    });

    let api_key = config.baisync_api_key.clone();
    if api_key.is_empty() {
        return Err(AppError::InternalError(
            "BAISYNC_API_KEY not configured".into(),
        ));
    }

    // S3.2 — open a session before the WS upgrade so subsequent events
    // have a target partition. Sophie is platform-level: both
    // `conversation_id` and `assistant_id` use `Uuid::nil()`, matching
    // the convention already established by `handlers::baisync::chat`.
    //
    // Failure is non-fatal: we fall back to `None` and the bridge emits
    // no events. Voice always works; only the audit log is skipped.
    let session_id: Option<SessionId> = if user_id.is_nil() {
        None
    } else {
        match create_session(&db, user_id, Uuid::nil(), Uuid::nil()).await {
            Ok(id) => Some(id),
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    "baisync voice session create failed; continuing without session tracking"
                );
                None
            }
        }
    };

    let limit = config.baisync_rate_limit;
    Ok(ws.on_upgrade(move |socket| async move {
        if let Err(e) = run_bridge(socket, api_key, db, user_id, limit, session_id).await {
            tracing::warn!("Baisync voice bridge ended with error: {e}");
        }
    }))
}

// ─── Bridge ────────────────────────────────────────────────────────────────

const GOOGLE_LIVE_URL: &str =
    "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const LIVE_MODEL: &str = "models/gemini-3.1-flash-live-preview";
const LIVE_VOICE: &str = "Achernar";

type GoogleTx = futures::stream::SplitSink<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    TMessage,
>;
type GoogleRx = futures::stream::SplitStream<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
>;

async fn build_voice_system_prompt(db: &DbSession, user_id: &Uuid) -> String {
    let user_name = crate::services::auth::get_user_by_id(db, user_id)
        .await
        .map(|u| {
            u.name
                .split_whitespace()
                .next()
                .unwrap_or("")
                .to_string()
        })
        .unwrap_or_default();
    let assistants_count = crate::services::assistant::list_assistants(db, user_id)
        .await
        .map(|v| v.len())
        .unwrap_or(0);

    let user_line = if user_name.is_empty() {
        String::new()
    } else {
        format!("Você está falando com {}. ", user_name)
    };

    format!(
        r#"Você é a Sophie, a assistente da plataforma Baisync. Você está conversando por voz em tempo real.

## Sobre você
- Persona: mulher jovem, tom descontraído e próximo, mas profissional.
- {user_line}O usuário tem {assistants_count} assistente(s) configurado(s).
- Você ajuda a gerenciar assistentes de IA, integrações (WhatsApp, Meta, Telegram), ferramentas e dúvidas sobre a plataforma.
- Você NÃO é uma inteligência artificial — você é a assistente Sophie. Nunca se refira como IA, modelo ou LLM.

## Regras de voz
- RESPONDA SEMPRE EM PORTUGUÊS BRASILEIRO (pt-BR).
- Respostas curtas e conversacionais, adequadas para fala (não leitura).
- Não use markdown, listas, tabelas, XML ou blocos de código.
- Se precisar listar, fale: "primeiro…, depois…, por último…".

## Ferramentas disponíveis
- `ativar_skill(nome)`: ativa guia detalhado. Nomes: `criar_atendente`, `sobre_plataforma`.
  Use quando o usuário quiser criar um assistente ou entender a plataforma.
- `tirar_print()`: captura screenshot da tela do usuário.
  Use quando o usuário mencionar confusão com uma página, pedir ajuda visual, ou quando
  ver a tela ajudaria a dar instruções mais precisas. Após receber a imagem, descreva
  brevemente o que vê e guie o usuário passo a passo.

## Escopo
- Foque em: criar/configurar assistentes, planos, integrações, dúvidas sobre a plataforma Baisync.
- Chame o usuário pelo primeiro nome quando souber; caso contrário, fale no "você".
"#,
        user_line = user_line,
        assistants_count = assistants_count
    )
}

async fn open_google_session(api_key: &str, system_prompt: &str) -> Result<(GoogleTx, GoogleRx), String> {
    let url = format!("{GOOGLE_LIVE_URL}?key={api_key}");
    let (google_ws, resp) = connect_async(&url)
        .await
        .map_err(|e| format!("connect_async failed: {e}"))?;
    tracing::info!("Baisync voice: upstream connected (status={})", resp.status());

    let setup = serde_json::json!({
        "setup": {
            "model": LIVE_MODEL,
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {
                    "voiceConfig": {
                        "prebuiltVoiceConfig": { "voiceName": LIVE_VOICE }
                    },
                    "languageCode": "pt-BR"
                }
            },
            "systemInstruction": {
                "parts": [{ "text": system_prompt }]
            },
            "inputAudioTranscription": {},
            "outputAudioTranscription": {},
            "tools": [{
                "functionDeclarations": [
                    {
                        "name": "ativar_skill",
                        "description": "Ativa uma skill para obter guia detalhado. Use quando o usuário quiser criar um assistente ('criar_atendente') ou tirar dúvidas sobre a plataforma ('sobre_plataforma').",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {
                                "nome": {
                                    "type": "STRING",
                                    "description": "Identificador da skill",
                                    "enum": ["criar_atendente", "sobre_plataforma"]
                                }
                            },
                            "required": ["nome"]
                        }
                    },
                    {
                        "name": "tirar_print",
                        "description": "Captura um screenshot da tela atual do usuário para você ver o que ele está visualizando. Use quando o usuário pedir ajuda com algo que está vendo na tela, mencionar que está confuso com alguma página, ou quando o contexto visual ajudaria a dar uma resposta mais precisa. Após receber a imagem, descreva o que vê e dê instruções contextuais.",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {},
                            "required": []
                        }
                    }
                ]
            }]
        }
    });

    let (mut google_tx, mut google_rx) = google_ws.split();
    tracing::info!("Baisync voice: sending setup");
    google_tx
        .send(TMessage::Text(setup.to_string().into()))
        .await
        .map_err(|e| format!("setup send failed: {e}"))?;

    // Wait for setupComplete
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(8);
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err("timeout waiting for setupComplete".into());
        }
        let next = match tokio::time::timeout(remaining, google_rx.next()).await {
            Ok(v) => v,
            Err(_) => return Err("timeout waiting for setupComplete".into()),
        };
        let text = match next {
            Some(Ok(TMessage::Text(t))) => t.to_string(),
            Some(Ok(TMessage::Binary(b))) => match String::from_utf8(b.to_vec()) {
                Ok(s) => s,
                Err(_) => continue,
            },
            Some(Ok(TMessage::Close(frame))) => {
                return Err(format!("closed before setup: {frame:?}"));
            }
            Some(Ok(_)) => continue,
            Some(Err(e)) => return Err(format!("stream error before setup: {e}")),
            None => return Err("stream ended before setup".into()),
        };
        let v: serde_json::Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if v.get("setupComplete").is_some() {
            break;
        }
        if let Some(err) = v.get("error") {
            return Err(format!("google error before setup: {err}"));
        }
    }

    // Prime Sophie's greeting
    let prime = serde_json::json!({
        "realtimeInput": {
            "text": "Cumprimente o cliente brevemente e pergunte como pode ajudar hoje."
        }
    });
    google_tx
        .send(TMessage::Text(prime.to_string().into()))
        .await
        .map_err(|e| format!("prime send failed: {e}"))?;

    Ok((google_tx, google_rx))
}

const MAX_SETUP_RETRIES: u32 = 3;

/// S3.2 — truncate transcript/reply previews before logging. Voice
/// transcripts can run long, and `session_events.payload` is TEXT; 500
/// chars is enough to triage a session in Sophie's audit UI without
/// bloating the partition.
const PREVIEW_MAX_CHARS: usize = 500;

fn truncate_preview(s: &str) -> String {
    if s.chars().count() <= PREVIEW_MAX_CHARS {
        s.to_string()
    } else {
        let truncated: String = s.chars().take(PREVIEW_MAX_CHARS).collect();
        format!("{truncated}…")
    }
}

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

async fn run_bridge(
    browser_ws: WebSocket,
    api_key: String,
    db: DbSession,
    user_id: Uuid,
    rate_limit: i32,
    session_id: Option<SessionId>,
) -> Result<(), String> {
    // Build system prompt once before the retry loop so DB is not re-queried on each attempt.
    let system_prompt = build_voice_system_prompt(&db, &user_id).await;

    let mut last_err = String::from("unknown");
    let mut pair: Option<(GoogleTx, GoogleRx)> = None;
    for attempt in 1..=MAX_SETUP_RETRIES {
        match open_google_session(&api_key, &system_prompt).await {
            Ok(p) => {
                tracing::info!("Baisync voice: session ready on attempt {attempt}");
                pair = Some(p);
                break;
            }
            Err(e) => {
                tracing::warn!("Baisync voice: setup attempt {attempt} failed: {e}");
                last_err = e;
                tokio::time::sleep(std::time::Duration::from_millis(400 * attempt as u64)).await;
            }
        }
    }

    let (mut browser_tx, mut browser_rx) = browser_ws.split();
    let (mut google_tx, mut google_rx) = match pair {
        Some(p) => p,
        None => {
            let _ = browser_tx
                .send(Message::Text(
                    serde_json::json!({
                        "type": "error",
                        "message": format!("Falha após {MAX_SETUP_RETRIES} tentativas: {last_err}")
                    })
                    .to_string()
                    .into(),
                ))
                .await;
            return Err(last_err);
        }
    };

    let _ = browser_tx
        .send(Message::Text(
            serde_json::json!({ "type": "ready" }).to_string().into(),
        ))
        .await;

    // S3.2 — per-session lifecycle tracking.
    //
    // Turn-boundary semantics for Gemini Live (no explicit user-end frame):
    //   * `user_turn_started` — on the first browser→backend audio (or text)
    //     frame of the current turn.
    //   * `user_turn_completed` — emitted LAZILY when we detect the server
    //     has moved on (first model audio chunk, or `turnComplete`,
    //     whichever arrives first). Google's VAD owns the hard end-of-speech
    //     boundary; we don't have a cleaner signal from the client side.
    //   * `model_turn_started` — on the first `modelTurn.parts` with audio
    //     from Google for the current turn.
    //   * `model_turn_completed` — on `serverContent.turnComplete`.
    //
    // All `append_event` calls are sync (mpsc `try_send`); they never
    // `.await` and never hold the proxy loop. `session_id` is `None` when
    // session creation failed — in that case every emission is a no-op.
    let mut user_turn_active = false;
    let mut user_turn_start_ms: i64 = 0;
    let mut user_transcript_buf = String::new();
    let mut model_turn_active = false;
    let mut model_turn_start_ms: i64 = 0;
    let mut model_transcript_buf = String::new();
    // Cumulative token total reported by Gemini Live. `usageMetadata` arrives
    // in a standalone frame (no `serverContent`) so we track the last-seen
    // total and only bill the delta to avoid double-counting across frames.
    let mut tokens_billed: i64 = 0;

    // Keepalive: send WebSocket Ping frames every 25 s to prevent reverse-proxy
    // (Traefik) idle-timeout disconnects. Pings are protocol-level and
    // invisible to both Google's Live API and the browser application layer.
    let mut keepalive = tokio::time::interval(std::time::Duration::from_secs(25));
    keepalive.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    keepalive.tick().await; // consume the first immediate tick — first ping at t=25s

    loop {
        tokio::select! {
            // Keepalive pings — keep both WebSocket legs alive through Traefik.
            _ = keepalive.tick() => {
                if browser_tx.send(Message::Ping(vec![].into())).await.is_err() {
                    break;
                }
                if google_tx.send(TMessage::Ping(vec![])).await.is_err() {
                    break;
                }
            }

            // Browser → Google
            msg = browser_rx.next() => {
                let Some(Ok(msg)) = msg else { break };
                match msg {
                    Message::Text(raw) => {
                        let parsed: serde_json::Value = match serde_json::from_str(raw.as_str()) {
                            Ok(v) => v,
                            Err(_) => continue,
                        };
                        let kind = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");
                        match kind {
                            "audio" => {
                                let Some(b64) = parsed.get("data").and_then(|v| v.as_str()) else { continue };
                                // S3.2 — first user audio frame starts a
                                // new user turn. Subsequent frames are
                                // silent until the boundary flips.
                                if !user_turn_active {
                                    if let Some(sid) = session_id {
                                        append_event(
                                            user_id,
                                            sid,
                                            SessionEventType::UserTurnStarted,
                                            serde_json::json!({
                                                "timestamp_ms": now_ms()
                                            }).to_string(),
                                        );
                                    }
                                    user_turn_active = true;
                                    user_turn_start_ms = now_ms();
                                    user_transcript_buf.clear();
                                }
                                let frame = serde_json::json!({
                                    "realtimeInput": {
                                        "audio": {
                                            "mimeType": "audio/pcm;rate=16000",
                                            "data": b64
                                        }
                                    }
                                });
                                if google_tx.send(TMessage::Text(frame.to_string().into())).await.is_err() {
                                    break;
                                }
                            }
                            "text" => {
                                let Some(text) = parsed.get("text").and_then(|v| v.as_str()) else { continue };
                                // S3.2 — typed user input also opens a
                                // user turn if one isn't already open.
                                if !user_turn_active {
                                    if let Some(sid) = session_id {
                                        append_event(
                                            user_id,
                                            sid,
                                            SessionEventType::UserTurnStarted,
                                            serde_json::json!({
                                                "timestamp_ms": now_ms()
                                            }).to_string(),
                                        );
                                    }
                                    user_turn_active = true;
                                    user_turn_start_ms = now_ms();
                                    user_transcript_buf.clear();
                                }
                                user_transcript_buf.push_str(text);
                                let frame = serde_json::json!({
                                    "realtimeInput": { "text": text }
                                });
                                if google_tx.send(TMessage::Text(frame.to_string().into())).await.is_err() {
                                    break;
                                }
                            }
                            "screenshot_response" => {
                                let Some(data) = parsed.get("data").and_then(|v| v.as_str()) else { continue };
                                let mime = parsed.get("mimeType").and_then(|v| v.as_str()).unwrap_or("image/jpeg");
                                let frame = serde_json::json!({
                                    "realtimeInput": {
                                        "video": {
                                            "mimeType": mime,
                                            "data": data
                                        }
                                    }
                                });
                                if google_tx.send(TMessage::Text(frame.to_string().into())).await.is_err() {
                                    break;
                                }
                            }
                            "end" => break,
                            _ => {}
                        }
                    }
                    Message::Close(_) => break,
                    _ => {}
                }
            }

            // Google → Browser
            msg = google_rx.next() => {
                let msg = match msg {
                    Some(Ok(m)) => m,
                    Some(Err(e)) => {
                        tracing::error!("Baisync voice: google stream error: {e}");
                        let _ = browser_tx.send(Message::Text(
                            serde_json::json!({
                                "type": "error",
                                "message": format!("Google stream error: {e}")
                            }).to_string().into()
                        )).await;
                        break;
                    }
                    None => break,
                };
                let text = match msg {
                    TMessage::Text(t) => t.to_string(),
                    TMessage::Binary(b) => match String::from_utf8(b.to_vec()) {
                        Ok(s) => s,
                        Err(_) => continue,
                    },
                    TMessage::Close(frame) => {
                        tracing::warn!("Baisync voice: google closed the WS: {:?}", frame);
                        let _ = browser_tx.send(Message::Text(
                            serde_json::json!({
                                "type": "error",
                                "message": format!("Google closed connection: {:?}", frame)
                            }).to_string().into()
                        )).await;
                        break;
                    }
                    _ => continue,
                };
                let value: serde_json::Value = match serde_json::from_str(&text) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                if let Some(err) = value.get("error") {
                    tracing::error!("Baisync voice: google error: {err}");
                    let _ = browser_tx.send(Message::Text(
                        serde_json::json!({
                            "type": "error",
                            "message": err.to_string()
                        }).to_string().into()
                    )).await;
                    continue;
                }

                // `usageMetadata` arrives as a standalone top-level frame
                // (separate from `serverContent`) in Gemini Live. The value
                // is cumulative for the session, so we only bill the delta
                // since the last time we saw it to avoid double-counting.
                if !user_id.is_nil() {
                    if let Some(total) = value
                        .pointer("/usageMetadata/totalTokenCount")
                        .and_then(|v| v.as_i64())
                    {
                        let delta = total - tokens_billed;
                        if delta > 0 {
                            tokens_billed = total;
                            increment_usage_tokens(&db, &user_id, delta).await;
                            let new_used = get_usage_tokens(&db, &user_id).await;
                            let pct = if rate_limit > 0 {
                                ((new_used as f64 / rate_limit as f64) * 100.0) as i32
                            } else {
                                0_i32
                            };
                            let _ = browser_tx.send(Message::Text(
                                serde_json::json!({
                                    "type": "rate_limit",
                                    "used": new_used,
                                    "limit": rate_limit,
                                    "pct": pct,
                                }).to_string().into()
                            )).await;
                        }
                    }
                }

                if let Some(server_content) = value.get("serverContent") {
                    // Model audio parts
                    if let Some(parts) = server_content
                        .pointer("/modelTurn/parts")
                        .and_then(|p| p.as_array())
                    {
                        // S3.2 — first model audio of a turn. If a user
                        // turn is still "active", Google has just taken
                        // over the mic: close the user turn FIRST, then
                        // open the model turn.
                        let has_audio = parts.iter().any(|p| {
                            p.get("inlineData")
                                .and_then(|i| i.get("mimeType"))
                                .and_then(|m| m.as_str())
                                .map(|m| m.starts_with("audio/"))
                                .unwrap_or(false)
                        });
                        if has_audio {
                            if user_turn_active {
                                if let Some(sid) = session_id {
                                    append_event(
                                        user_id,
                                        sid,
                                        SessionEventType::UserTurnCompleted,
                                        serde_json::json!({
                                            "duration_ms": now_ms() - user_turn_start_ms,
                                            "transcript_preview": truncate_preview(&user_transcript_buf),
                                        }).to_string(),
                                    );
                                }
                                user_turn_active = false;
                            }
                            if !model_turn_active {
                                if let Some(sid) = session_id {
                                    append_event(
                                        user_id,
                                        sid,
                                        SessionEventType::ModelTurnStarted,
                                        serde_json::json!({
                                            "timestamp_ms": now_ms()
                                        }).to_string(),
                                    );
                                }
                                model_turn_active = true;
                                model_turn_start_ms = now_ms();
                                model_transcript_buf.clear();
                            }
                        }
                        for part in parts {
                            if let Some(inline) = part.get("inlineData") {
                                let mime = inline.get("mimeType").and_then(|v| v.as_str()).unwrap_or("");
                                if mime.starts_with("audio/") {
                                    if let Some(data) = inline.get("data").and_then(|v| v.as_str()) {
                                        let _ = browser_tx.send(Message::Text(
                                            serde_json::json!({
                                                "type": "audio",
                                                "mimeType": mime,
                                                "data": data
                                            }).to_string().into()
                                        )).await;
                                    }
                                }
                            }
                        }
                    }

                    // Input (user) transcription
                    if let Some(t) = server_content
                        .pointer("/inputTranscription/text")
                        .and_then(|v| v.as_str())
                    {
                        if !t.is_empty() {
                            // S3.2 — accumulate so the UserTurnCompleted
                            // event carries a useful transcript preview.
                            user_transcript_buf.push_str(t);
                            let _ = browser_tx.send(Message::Text(
                                serde_json::json!({
                                    "type": "transcript",
                                    "role": "user",
                                    "text": t
                                }).to_string().into()
                            )).await;
                        }
                    }

                    // Output (assistant) transcription
                    if let Some(t) = server_content
                        .pointer("/outputTranscription/text")
                        .and_then(|v| v.as_str())
                    {
                        if !t.is_empty() {
                            // S3.2 — accumulate model-side transcript for
                            // the ModelTurnCompleted reply_preview.
                            model_transcript_buf.push_str(t);
                            let _ = browser_tx.send(Message::Text(
                                serde_json::json!({
                                    "type": "transcript",
                                    "role": "assistant",
                                    "text": t
                                }).to_string().into()
                            )).await;
                        }
                    }

                    if server_content
                        .get("turnComplete")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false)
                    {
                        // S3.2 — `turnComplete` unambiguously closes the
                        // model turn. We also close a still-open user
                        // turn here as a safety net (tiny utterances
                        // where Gemini returns turnComplete without a
                        // modelTurn audio frame yet).
                        if user_turn_active {
                            if let Some(sid) = session_id {
                                append_event(
                                    user_id,
                                    sid,
                                    SessionEventType::UserTurnCompleted,
                                    serde_json::json!({
                                        "duration_ms": now_ms() - user_turn_start_ms,
                                        "transcript_preview": truncate_preview(&user_transcript_buf),
                                    }).to_string(),
                                );
                            }
                            user_turn_active = false;
                        }
                        if model_turn_active {
                            if let Some(sid) = session_id {
                                append_event(
                                    user_id,
                                    sid,
                                    SessionEventType::ModelTurnCompleted,
                                    serde_json::json!({
                                        "duration_ms": now_ms() - model_turn_start_ms,
                                        "reply_preview": truncate_preview(&model_transcript_buf),
                                    }).to_string(),
                                );
                            }
                            model_turn_active = false;
                        }

                        let _ = browser_tx.send(Message::Text(
                            serde_json::json!({ "type": "turn_complete" }).to_string().into()
                        )).await;
                    }

                    if server_content
                        .get("interrupted")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false)
                    {
                        // S3.2 — treat interruption as an early end of
                        // the model turn (user spoke over Sophie).
                        if model_turn_active {
                            if let Some(sid) = session_id {
                                append_event(
                                    user_id,
                                    sid,
                                    SessionEventType::ModelTurnCompleted,
                                    serde_json::json!({
                                        "duration_ms": now_ms() - model_turn_start_ms,
                                        "reply_preview": truncate_preview(&model_transcript_buf),
                                        "interrupted": true,
                                    }).to_string(),
                                );
                            }
                            model_turn_active = false;
                        }
                        let _ = browser_tx.send(Message::Text(
                            serde_json::json!({ "type": "interrupted" }).to_string().into()
                        )).await;
                    }
                }

                // S3.2 — Gemini Live tool-call dispatch. The Live API sends tool
                // calls as a top-level `toolCall.functionCalls` array (separate
                // from `serverContent`). We execute the tool, then send back
                // `toolResponse` with the matching `id` — without it Google hangs
                // waiting for a response and the session deadlocks.
                if let Some(calls) = value
                    .pointer("/toolCall/functionCalls")
                    .and_then(|v| v.as_array())
                {
                    let mut function_responses: Vec<serde_json::Value> = Vec::new();

                    for call in calls {
                        let call_id = call
                            .get("id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let tool_name = call
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let args = call
                            .get("args")
                            .cloned()
                            .unwrap_or(serde_json::Value::Null);

                        // Audit log (fire-and-forget)
                        if let Some(sid) = session_id {
                            append_event(
                                user_id,
                                sid,
                                SessionEventType::ToolCall,
                                serde_json::json!({
                                    "tool_name": &tool_name,
                                    "args": &args,
                                    "source": "voice",
                                }).to_string(),
                            );
                        }

                        let output = match tool_name.as_str() {
                            "ativar_skill" => {
                                let skill_name = args
                                    .get("nome")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                match get_skill_prompt(skill_name) {
                                    Some(content) => serde_json::json!({ "output": content }),
                                    None => serde_json::json!({
                                        "output": format!("Skill '{skill_name}' não encontrada.")
                                    }),
                                }
                            }
                            "tirar_print" => {
                                let _ = browser_tx
                                    .send(Message::Text(
                                        serde_json::json!({"type": "screenshot_request"})
                                            .to_string()
                                            .into(),
                                    ))
                                    .await;
                                serde_json::json!({
                                    "output": "Screenshot solicitado. Aguardando imagem do cliente para análise."
                                })
                            }
                            other => {
                                tracing::warn!("Baisync voice: unknown tool called: {other}");
                                serde_json::json!({ "output": "Ferramenta não reconhecida." })
                            }
                        };

                        function_responses.push(serde_json::json!({
                            "id": call_id,
                            "name": tool_name,
                            "response": output
                        }));
                    }

                    if !function_responses.is_empty() {
                        let tool_response = serde_json::json!({
                            "toolResponse": { "functionResponses": function_responses }
                        });
                        if google_tx
                            .send(TMessage::Text(tool_response.to_string().into()))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                }
            }
        }
    }

    // S3.2 — flush any still-open turns on disconnect so the audit log
    // doesn't have dangling Started events without a matching Completed.
    if user_turn_active {
        if let Some(sid) = session_id {
            append_event(
                user_id,
                sid,
                SessionEventType::UserTurnCompleted,
                serde_json::json!({
                    "duration_ms": now_ms() - user_turn_start_ms,
                    "transcript_preview": truncate_preview(&user_transcript_buf),
                    "closed_by": "disconnect",
                }).to_string(),
            );
        }
    }
    if model_turn_active {
        if let Some(sid) = session_id {
            append_event(
                user_id,
                sid,
                SessionEventType::ModelTurnCompleted,
                serde_json::json!({
                    "duration_ms": now_ms() - model_turn_start_ms,
                    "reply_preview": truncate_preview(&model_transcript_buf),
                    "closed_by": "disconnect",
                }).to_string(),
            );
        }
    }

    let _ = google_tx.send(TMessage::Close(None)).await;
    let _ = browser_tx.send(Message::Close(None)).await;
    Ok(())
}
