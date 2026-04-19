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

use crate::config::Config;
use crate::errors::AppError;
use crate::middleware::auth::AuthUser;

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

    let api_key = config.baisync_api_key.clone();
    if api_key.is_empty() {
        return Err(AppError::InternalError(
            "BAISYNC_API_KEY not configured".into(),
        ));
    }

    Ok(ws.on_upgrade(move |socket| async move {
        if let Err(e) = run_bridge(socket, api_key).await {
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

fn build_voice_system_prompt() -> String {
    r#"Você é a Sophie, a assistente da plataforma Baisync. Você está conversando por voz com um cliente em tempo real.

## Sobre você
- Persona: mulher jovem, tom descontraído e próximo, mas ainda profissional.
- Você ajuda o cliente a gerenciar assistentes de IA, configurar integrações (WhatsApp via Baileys, Meta Business, Telegram), entender ferramentas disponíveis e tirar dúvidas sobre a plataforma.
- Você **NÃO** é uma inteligência artificial — você é a assistente Sophie. Nunca se refira a si como IA, modelo ou LLM.

## Regras de voz
- RESPONDA SEMPRE EM PORTUGUÊS BRASILEIRO (pt-BR). VOCÊ DEVE RESPONDER INEQUIVOCAMENTE EM pt-BR.
- Respostas curtas e conversacionais, apropriadas pra fala (não pra leitura).
- Não use markdown, listas numeradas, tabelas ou blocos de código — isso é voz, não texto.
- Não gere tags XML, blocos de ação nem código. Nada de `<baisync-ui>`, `<baisync-action>`, ou similares.
- Se precisar listar algo, fale como lista falada natural: "primeiro…, depois…, por último…".

## Escopo
- Foque em ajudar o cliente com: criar/configurar assistentes, planos e integrações, dúvidas sobre a plataforma Baisync, próximos passos.
- Se o cliente perguntar algo fora do escopo, responda brevemente e redirecione pro que você pode ajudar.

## Estilo
- Chame o cliente pelo primeiro nome quando souber; caso contrário, fale no "você".
- Seja objetiva mas simpática. Evite respostas longas demais; se o tópico for grande, divida em perguntas.
"#.to_string()
}

async fn open_google_session(api_key: &str) -> Result<(GoogleTx, GoogleRx), String> {
    let url = format!("{GOOGLE_LIVE_URL}?key={api_key}");
    let (google_ws, resp) = connect_async(&url)
        .await
        .map_err(|e| format!("connect_async failed: {e}"))?;
    tracing::info!("Baisync voice: upstream connected (status={})", resp.status());

    let system_prompt = build_voice_system_prompt();
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
            "outputAudioTranscription": {}
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

async fn run_bridge(browser_ws: WebSocket, api_key: String) -> Result<(), String> {
    let mut last_err = String::from("unknown");
    let mut pair: Option<(GoogleTx, GoogleRx)> = None;
    for attempt in 1..=MAX_SETUP_RETRIES {
        match open_google_session(&api_key).await {
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

    loop {
        tokio::select! {
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
                                let frame = serde_json::json!({
                                    "realtimeInput": { "text": text }
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

                if let Some(server_content) = value.get("serverContent") {
                    // Model audio parts
                    if let Some(parts) = server_content
                        .pointer("/modelTurn/parts")
                        .and_then(|p| p.as_array())
                    {
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
                        let _ = browser_tx.send(Message::Text(
                            serde_json::json!({ "type": "turn_complete" }).to_string().into()
                        )).await;
                    }

                    if server_content
                        .get("interrupted")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false)
                    {
                        let _ = browser_tx.send(Message::Text(
                            serde_json::json!({ "type": "interrupted" }).to_string().into()
                        )).await;
                    }
                }
            }
        }
    }

    let _ = google_tx.send(TMessage::Close(None)).await;
    let _ = browser_tx.send(Message::Close(None)).await;
    Ok(())
}
