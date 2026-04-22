//! WebSocket proxy between the browser and Google AI Studio Live API for the
//! SWOT interview (Sophie). The browser cannot open a native WebSocket with an
//! Authorization header, so authentication is done via a short-lived ticket
//! issued by `live_ticket` (called over the regular authenticated proxy).
//!
//! Flow:
//!   1. Frontend POSTs `/swot/interview/live-ticket` (auth cookie → JWT) → `{ticket}`
//!   2. Frontend opens WS `/swot/interview/live?ticket=<ticket>`
//!   3. Handler validates ticket, opens upstream WS to Google, relays frames
//!
//! Audio: browser sends PCM16 mono @16kHz in `{type:"audio",data:"<b64>"}`.
//! Google streams back PCM16 mono @24kHz which we forward as `{type:"audio",data:"<b64>"}`.
//! Transcripts arrive as text events and are also scanned for `<swot-questions>`
//! / `<swot-create>` tags which are extracted and emitted separately.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Extension, Path, Query};
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
// text-mode build_system_prompt and parse_swot_special_tags are not used in voice mode;
// voice uses function declarations instead of XML tags.
use crate::middleware::auth::AuthUser;
use crate::services::workspace as ws_service;

// ─── Ticket types ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct LiveTicketClaims {
    sub: String,
    wid: String,
    exp: usize,
    kind: String,
}

#[derive(Debug, Serialize)]
pub struct LiveTicketResponse {
    pub ticket: String,
}

/// POST /api/workspaces/{id}/swot/interview/live-ticket
///
/// Issues a short-lived (30s) signed ticket that the browser can pass as a
/// query param when opening the WebSocket. The ticket binds user_id to
/// workspace_id so a stolen ticket can't be reused for another workspace.
pub async fn live_ticket(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(auth_user): Extension<AuthUser>,
    Path(workspace_id): Path<Uuid>,
) -> Result<Json<LiveTicketResponse>, AppError> {
    ws_service::get_member_role(&db, &workspace_id, &auth_user.user_id).await?;

    let exp = Utc::now()
        .checked_add_signed(chrono::Duration::seconds(30))
        .ok_or_else(|| AppError::InternalError("time overflow".into()))?
        .timestamp() as usize;

    let claims = LiveTicketClaims {
        sub: auth_user.user_id.to_string(),
        wid: workspace_id.to_string(),
        exp,
        kind: "swot-live".into(),
    };

    let ticket = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(config.jwt_secret.as_bytes()),
    )
    .map_err(|e| AppError::InternalError(format!("failed to sign ticket: {e}")))?;

    Ok(Json(LiveTicketResponse { ticket }))
}

// ─── WebSocket handler ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct LiveQuery {
    pub ticket: String,
}

/// GET /api/workspaces/{id}/swot/interview/live?ticket=...
///
/// Public route (no middleware) — auth is enforced here via ticket validation.
pub async fn interview_live_ws(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Path(workspace_id): Path<Uuid>,
    Query(q): Query<LiveQuery>,
    ws: WebSocketUpgrade,
) -> Result<Response, AppError> {
    let mut validation = Validation::default();
    validation.leeway = 5;
    let token_data = decode::<LiveTicketClaims>(
        &q.ticket,
        &DecodingKey::from_secret(config.jwt_secret.as_bytes()),
        &validation,
    )
    .map_err(|_| AppError::Unauthorized("Invalid or expired ticket".into()))?;

    if token_data.claims.kind != "swot-live" {
        return Err(AppError::Unauthorized("Wrong ticket kind".into()));
    }

    let ticket_wid = token_data
        .claims
        .wid
        .parse::<Uuid>()
        .map_err(|_| AppError::Unauthorized("Invalid ticket workspace".into()))?;
    if ticket_wid != workspace_id {
        return Err(AppError::Unauthorized("Ticket/workspace mismatch".into()));
    }

    let user_id = token_data
        .claims
        .sub
        .parse::<Uuid>()
        .map_err(|_| AppError::Unauthorized("Invalid ticket subject".into()))?;

    ws_service::get_member_role(&db, &workspace_id, &user_id).await?;

    let api_key = config.baisync_api_key.clone();
    if api_key.is_empty() {
        return Err(AppError::InternalError(
            "BAISYNC_API_KEY not configured".into(),
        ));
    }

    let workspace = ws_service::get_workspace(&db, &workspace_id).await.ok();
    let ws_name = workspace
        .as_ref()
        .map(|w| w.name.clone())
        .unwrap_or_else(|| "Minha Empresa".into());

    Ok(ws.on_upgrade(move |socket| async move {
        if let Err(e) = run_bridge(socket, api_key, ws_name).await {
            tracing::warn!("SWOT live bridge ended with error: {e}");
        }
    }))
}

// ─── Bridge ─────────────────────────────────────────────────────────────────

// Google AI Studio Live API (NOT Vertex). Uses plain API key auth via
// the `key` query param. `v1beta` and `v1alpha` both route to Live; Gemini
// 2.5 models are served under v1beta.
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

fn build_voice_system_prompt(workspace_name: &str) -> String {
    format!(
        r#"Você é a Sophie, especialista em análise SWOT, conduzindo uma entrevista por voz.
O workspace atual se chama "{workspace_name}".

## Regras de voz
- RESPONDA SEMPRE EM PORTUGUÊS BRASILEIRO (pt-BR).
- Respostas curtas, conversacionais, para fala. Máximo 2 frases por vez.
- Não use markdown, listas, emojis, XML ou blocos de código.
- Faça UMA pergunta por vez e aguarde a resposta antes de continuar.
- NÃO mencione que é IA ou modelo de linguagem.

## Ferramentas disponíveis
- `criar_pergunta(pergunta, opcoes)`: emite pergunta com opções na tela do usuário.
  Use para perguntas de múltipla escolha. Após chamar a ferramenta, faça a mesma pergunta em voz também.
- `criar_analise_swot(titulo, itens)`: gera e exibe a análise SWOT final.
  Antes de chamar, avise verbalmente que está gerando a análise.

## Fluxo da entrevista
1. Saudação + pedir confirmação para começar.
2. Nome e setor da empresa → use `criar_pergunta` com opções de setor (Tecnologia, Saúde, Alimentação, Varejo, Serviços, Educação, Outro).
3. Porte da empresa → use `criar_pergunta` com opções (MEI/Autônomo, Microempresa, Pequena, Média, Grande).
4. Público-alvo principal → pergunta aberta (sem ferramenta).
5. Explorar forças, fraquezas, oportunidades e ameaças (perguntas abertas, uma por vez).
6. Após ~8 trocas, avisar que vai gerar o SWOT e chamar `criar_analise_swot` com ≥12 itens (≥3 por quadrante).

## Regras da análise
- Itens devem ser frases completas e acionáveis.
- Quadrantes válidos: strengths, weaknesses, opportunities, threats.
"#,
        workspace_name = workspace_name
    )
}

/// Connect to Google, send setup + prime, wait for `setupComplete`. Returns
/// the split streams ready to be bridged, or an error describing why the
/// handshake didn't finish. Called in a retry loop by the bridge so
/// transient Google failures (code=Error, "Internal error encountered")
/// don't bubble up to the user.
async fn open_google_session(api_key: &str, workspace_name: &str) -> Result<(GoogleTx, GoogleRx), String> {
    let url = format!("{GOOGLE_LIVE_URL}?key={api_key}");
    let (google_ws, resp) = connect_async(&url)
        .await
        .map_err(|e| format!("connect_async failed: {e}"))?;
    tracing::info!("SWOT live: upstream connected (status={})", resp.status());

    let system_prompt = build_voice_system_prompt(workspace_name);
    // The Gemini Live WebSocket protocol is strictly camelCase on the wire
    // (snake_case is silently accepted for some fields but causes
    // "Internal error encountered" for others like clientContent).
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
                        "name": "criar_pergunta",
                        "description": "Emite pergunta estruturada com opções na tela do usuário. Use para perguntas de múltipla escolha. Após chamar, repita a pergunta em voz.",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {
                                "pergunta": {
                                    "type": "STRING",
                                    "description": "Texto completo da pergunta"
                                },
                                "opcoes": {
                                    "type": "ARRAY",
                                    "description": "Opções de resposta. Omita para perguntas abertas.",
                                    "items": { "type": "STRING" }
                                }
                            },
                            "required": ["pergunta"]
                        }
                    },
                    {
                        "name": "criar_analise_swot",
                        "description": "Gera a análise SWOT final. Chame somente após coletar informações suficientes (~8 trocas). Mínimo 12 itens, 3 por quadrante.",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {
                                "titulo": {
                                    "type": "STRING",
                                    "description": "Título, ex: 'SWOT - Nome da Empresa'"
                                },
                                "itens": {
                                    "type": "ARRAY",
                                    "description": "Itens SWOT, mínimo 3 por quadrante.",
                                    "items": {
                                        "type": "OBJECT",
                                        "properties": {
                                            "quadrante": {
                                                "type": "STRING",
                                                "enum": ["strengths", "weaknesses", "opportunities", "threats"]
                                            },
                                            "conteudo": {
                                                "type": "STRING",
                                                "description": "Frase completa e acionável"
                                            }
                                        },
                                        "required": ["quadrante", "conteudo"]
                                    }
                                }
                            },
                            "required": ["titulo", "itens"]
                        }
                    }
                ]
            }]
        }
    });

    let (mut google_tx, mut google_rx) = google_ws.split();
    tracing::info!("SWOT live: sending setup: {}", setup);
    google_tx
        .send(TMessage::Text(setup.to_string().into()))
        .await
        .map_err(|e| format!("setup send failed: {e}"))?;

    // Wait for setupComplete (or an early failure). Time-bound so a silent
    // upstream doesn't hang the whole retry loop.
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(8);
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err("timeout waiting for setupComplete".into());
        }
        let next = tokio::time::timeout(remaining, google_rx.next()).await;
        let next = match next {
            Ok(v) => v,
            Err(_) => return Err("timeout waiting for setupComplete".into()),
        };
        // Google sends Live API frames as either Text or Binary (UTF-8 JSON
        // either way). Unify both into a `&str` before parsing.
        let text = match next {
            Some(Ok(TMessage::Text(t))) => t.to_string(),
            Some(Ok(TMessage::Binary(b))) => match String::from_utf8(b.to_vec()) {
                Ok(s) => s,
                Err(e) => {
                    tracing::warn!("SWOT live: setup-phase non-UTF8 binary: {e}");
                    continue;
                }
            },
            Some(Ok(TMessage::Close(frame))) => {
                return Err(format!("closed before setup: {frame:?}"));
            }
            Some(Ok(_)) => continue,
            Some(Err(e)) => return Err(format!("stream error before setup: {e}")),
            None => return Err("stream ended before setup".into()),
        };

        let preview: String = text.chars().take(500).collect();
        tracing::info!("SWOT live: setup-phase msg: {preview}");
        let v: serde_json::Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!("SWOT live: setup-phase non-JSON msg ({e}): {preview}");
                continue;
            }
        };
        if v.get("setupComplete").is_some() {
            break;
        }
        if let Some(err) = v.get("error") {
            return Err(format!("google error before setup: {err}"));
        }
    }

    // Prime Sophie's greeting. Gemini 3.1 Live expects realtimeInput.text for
    // in-conversation text (clientContent is only for seeding history).
    let prime = serde_json::json!({
        "realtimeInput": {
            "text": "Iniciar entrevista SWOT"
        }
    });
    google_tx
        .send(TMessage::Text(prime.to_string().into()))
        .await
        .map_err(|e| format!("prime send failed: {e}"))?;

    Ok((google_tx, google_rx))
}

const MAX_SETUP_RETRIES: u32 = 3;

async fn run_bridge(
    browser_ws: WebSocket,
    api_key: String,
    workspace_name: String,
) -> Result<(), String> {
    // Retry the handshake a few times for transient upstream failures.
    let mut last_err = String::from("unknown");
    let mut pair: Option<(GoogleTx, GoogleRx)> = None;
    for attempt in 1..=MAX_SETUP_RETRIES {
        match open_google_session(&api_key, &workspace_name).await {
            Ok(p) => {
                tracing::info!("SWOT live: session ready on attempt {attempt}");
                pair = Some(p);
                break;
            }
            Err(e) => {
                tracing::warn!("SWOT live: setup attempt {attempt} failed: {e}");
                last_err = e;
                tokio::time::sleep(std::time::Duration::from_millis(400 * attempt as u64)).await;
            }
        }
    }

    let (mut browser_tx, mut browser_rx) = browser_ws.split();
    let (mut google_tx, mut google_rx) = match pair {
        Some(p) => p,
        None => {
            let _ = browser_tx.send(Message::Text(
                serde_json::json!({
                    "type": "error",
                    "message": format!("Falha após {MAX_SETUP_RETRIES} tentativas: {last_err}")
                }).to_string().into()
            )).await;
            return Err(last_err);
        }
    };

    // Signal the UI that the session is ready to stream audio.
    let _ = browser_tx.send(Message::Text(
        serde_json::json!({ "type": "ready" }).to_string().into()
    )).await;

    let mut google_msg_count: u32 = 0;
    let mut user_audio_chunks: u32 = 0;
    let mut user_audio_bytes: usize = 0;
    let mut user_transcripts: u32 = 0;

    // Keepalive: send WebSocket Ping frames every 25 s to prevent reverse-proxy
    // (Traefik) idle-timeout disconnects.
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

            // ── Browser → Google ──
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
                                user_audio_chunks += 1;
                                user_audio_bytes += b64.len();
                                if user_audio_chunks == 1 || user_audio_chunks % 50 == 0 {
                                    tracing::info!(
                                        "SWOT live: user audio → google chunks={} total_b64_bytes={}",
                                        user_audio_chunks, user_audio_bytes
                                    );
                                }
                                // mediaChunks was deprecated in favour of the flat
                                // `audio` blob in newer Live API versions (3.1+).
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

            // ── Google → Browser ──
            msg = google_rx.next() => {
                let msg = match msg {
                    Some(Ok(m)) => m,
                    Some(Err(e)) => {
                        tracing::error!("SWOT live: google stream error: {e}");
                        let _ = browser_tx.send(Message::Text(
                            serde_json::json!({
                                "type": "error",
                                "message": format!("Google stream error: {e}")
                            }).to_string().into()
                        )).await;
                        break;
                    }
                    None => {
                        tracing::warn!("SWOT live: google stream ended");
                        break;
                    }
                };
                let text = match msg {
                    TMessage::Text(t) => t.to_string(),
                    TMessage::Binary(b) => match String::from_utf8(b.to_vec()) {
                        Ok(s) => s,
                        Err(_) => continue,
                    },
                    TMessage::Close(frame) => {
                        tracing::warn!("SWOT live: google closed the WS: {:?}", frame);
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

                google_msg_count += 1;
                if google_msg_count <= 5 {
                    let preview: String = text.chars().take(400).collect();
                    tracing::info!("SWOT live: google msg #{google_msg_count}: {preview}");
                }

                // Forward Google errors to the browser so they surface in the UI.
                if let Some(err) = value.get("error") {
                    tracing::error!("SWOT live: google error: {err}");
                    let _ = browser_tx.send(Message::Text(
                        serde_json::json!({
                            "type": "error",
                            "message": err.to_string()
                        }).to_string().into()
                    )).await;
                    continue;
                }


                if let Some(server_content) = value.get("serverContent") {
                    // Model turn: audio or text parts
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

                    // Input (user speech) transcription
                    if let Some(t) = server_content
                        .pointer("/inputTranscription/text")
                        .and_then(|v| v.as_str())
                    {
                        if !t.is_empty() {
                            user_transcripts += 1;
                            tracing::info!(
                                "SWOT live: user transcript #{user_transcripts}: {t}"
                            );
                            let _ = browser_tx.send(Message::Text(
                                serde_json::json!({
                                    "type": "transcript",
                                    "role": "user",
                                    "text": t
                                }).to_string().into()
                            )).await;
                        }
                    }

                    // Output (assistant speech) transcription
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

                // Gemini Live tool-call dispatch. Tool calls arrive as a top-level
                // `toolCall.functionCalls` frame (not inside `serverContent`). We
                // execute the tool as a side effect on the browser connection, then
                // send `toolResponse` back — the `id` must match or Google deadlocks.
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

                        tracing::info!("SWOT live: tool call — name={tool_name} id={call_id}");

                        match tool_name.as_str() {
                            "criar_pergunta" => {
                                let _ = browser_tx.send(Message::Text(
                                    serde_json::json!({
                                        "type": "questions",
                                        "payload": args
                                    }).to_string().into()
                                )).await;
                            }
                            "criar_analise_swot" => {
                                let _ = browser_tx.send(Message::Text(
                                    serde_json::json!({
                                        "type": "swot_create",
                                        "payload": args
                                    }).to_string().into()
                                )).await;
                            }
                            other => {
                                tracing::warn!("SWOT live: unknown tool: {other}");
                            }
                        }

                        function_responses.push(serde_json::json!({
                            "id": call_id,
                            "name": tool_name,
                            "response": { "output": "ok" }
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

    let _ = google_tx.send(TMessage::Close(None)).await;
    let _ = browser_tx.send(Message::Close(None)).await;
    Ok(())
}
