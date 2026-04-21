use axum::extract::Extension;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use chrono::{DateTime, Utc};
use scylla::frame::value::CqlTimeuuid;

use futures::stream::Stream;
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use std::sync::OnceLock;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

use uuid::Uuid;

use crate::config::Config;
use crate::db::DbSession;
use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::services::llm;

// ─── Types ───────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct BaisyncAttachment {
    #[allow(dead_code)]
    pub name: String,
    pub mime_type: String,
    pub data_base64: String,
}

#[derive(Debug, Deserialize)]
pub struct BaisyncChatRequest {
    pub message: String,
    #[serde(default)]
    pub history: Vec<BaisyncMessage>,
    pub skill: Option<String>,
    #[serde(default)]
    pub attachments: Vec<BaisyncAttachment>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct BaisyncFileRef {
    pub id: String,
    pub kind: String, // "image" or "file"
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct BaisyncMessage {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub file_refs: Vec<BaisyncFileRef>,
}

#[derive(Debug, Serialize)]
pub struct RateLimitResponse {
    pub used: i64,
    pub limit: i32,
    pub reset_at: String,
}

// ─── Skills ──────────────────────────────────────────────────────────────────

struct Skill {
    name: &'static str,
    description: &'static str,
    prompt: &'static str,
}

const SKILLS: &[Skill] = &[
    Skill {
        name: "criar_atendente",
        description: "Guia o usuário passo a passo na criação de um assistente de IA para atendimento ao cliente",
        prompt: include_str!("../../resources/sophie/skills/criar_atendente.md"),
    },
    Skill {
        name: "sobre_plataforma",
        description: "Responde dúvidas sobre o funcionamento e recursos da plataforma Baisync",
        prompt: include_str!("../../resources/sophie/skills/sobre_plataforma.md"),
    },
];

fn get_skill_prompt(name: &str) -> Option<&'static str> {
    SKILLS.iter().find(|s| s.name == name).map(|s| s.prompt)
}

fn skills_summary() -> String {
    SKILLS
        .iter()
        .map(|s| format!("- **{}**: {}", s.name, s.description))
        .collect::<Vec<_>>()
        .join("\n")
}

// ─── Rate Limiting ───────────────────────────────────────────────────────────

fn current_hour_bucket() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H").to_string()
}

fn next_hour_reset() -> String {
    let now = chrono::Utc::now();
    let next = now + chrono::Duration::hours(1);
    next.format("%Y-%m-%dT%H:00:00Z").to_string()
}

async fn get_usage_count(db: &DbSession, user_id: &Uuid) -> i64 {
    let bucket = current_hour_bucket();
    let result = db
        .query_unpaged(
            "SELECT count FROM inertial_eclipse.baisync_rate_limits WHERE user_id = ? AND hour_bucket = ?",
            (user_id, &bucket as &str),
        )
        .await;

    match result {
        Ok(res) => {
            if let Ok(rows) = res.into_rows_result() {
                if let Ok(Some((count,))) = rows.maybe_first_row::<(i64,)>() {
                    count
                } else {
                    0
                }
            } else {
                0
            }
        }
        Err(_) => 0,
    }
}

async fn increment_usage(db: &DbSession, user_id: &Uuid) {
    let bucket = current_hour_bucket();
    let _ = db
        .query_unpaged(
            "UPDATE inertial_eclipse.baisync_rate_limits SET count = count + 1 WHERE user_id = ? AND hour_bucket = ?",
            (user_id, &bucket as &str),
        )
        .await;
}

// ─── Chat endpoint (SSE streaming) ────��─────────────────────────────────────

pub async fn chat(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(encryption): Extension<crate::services::encryption::EncryptionService>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<BaisyncChatRequest>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
    let api_key = config.baisync_api_key.clone();
    if api_key.is_empty() {
        return Err(AppError::InternalError(
            "BAISYNC_API_KEY not configured".into(),
        ));
    }

    let user_id = auth_user.user_id;

    // Rate limit check
    let used = get_usage_count(&db, &user_id).await;
    let limit = config.baisync_rate_limit;
    if used >= limit as i64 {
        return Err(AppError::BadRequest(format!(
            "Limite de mensagens atingido ({}/{}). Tente novamente em breve.",
            used, limit
        )));
    }

    // Build system prompt
    let user = crate::services::auth::get_user_by_id(&db, &user_id).await?;
    let assistants = crate::services::assistant::list_assistants(&db, &user_id)
        .await
        .unwrap_or_default();

    let mut assistant_details = Vec::new();
    for a in &assistants {
        let mut detail = format!(
            "### {} (id: {})\n- Provedor: {} | Modelo: {}\n- Temperatura: {} | Max tokens: {}",
            a.name, a.id, a.llm_provider, a.model, a.temperature, a.max_tokens
        );
        if let Some(ref desc) = a.description {
            if !desc.is_empty() {
                detail.push_str(&format!("\n- Descrição: {}", desc));
            }
        }
        if let Some(ref sp) = a.system_prompt {
            if !sp.is_empty() {
                let truncated: String = sp.chars().take(300).collect();
                detail.push_str(&format!("\n- Prompt do sistema (resumo): {}...", truncated));
            }
        }
        detail.push_str(&format!(
            "\n- Configurações: split_msgs={}, typing={}, interpret_docs={}",
            a.config_split_messages, a.config_typing_indicator, a.config_interpret_documents
        ));
        if let Some(rl) = a.config_rate_limit_per_day {
            detail.push_str(&format!(", rate_limit={}/dia", rl));
        }

        // Fetch integrations
        if let Ok(integrations) =
            crate::services::assistant::list_integrations(&db, &encryption, &a.id, &user_id).await
        {
            if !integrations.is_empty() {
                let int_list: Vec<String> = integrations
                    .iter()
                    .map(|i| format!("{}/{} (status: {})", i.channel, i.provider, i.status))
                    .collect();
                detail.push_str(&format!("\n- Integrações: {}", int_list.join(", ")));
            }
        }

        // Fetch tools
        if let Ok(tools) = crate::services::assistant::list_tools(&db, &a.id).await {
            if !tools.is_empty() {
                let tool_list: Vec<String> = tools
                    .iter()
                    .map(|t| {
                        format!(
                            "{} ({})",
                            t.name,
                            if t.is_enabled { "ativo" } else { "inativo" }
                        )
                    })
                    .collect();
                detail.push_str(&format!("\n- Ferramentas: {}", tool_list.join(", ")));
            }
        }

        // Fetch files
        if let Ok(files) = crate::services::rag::list_files(&db, &a.id, &user_id).await {
            if !files.is_empty() {
                let file_list: Vec<String> = files
                    .iter()
                    .map(|f| format!("{} ({})", f.name, f.mime_type))
                    .collect();
                detail.push_str(&format!("\n- Arquivos (RAG): {}", file_list.join(", ")));
            }
        }

        assistant_details.push(detail);
    }

    let assistant_list = if assistant_details.is_empty() {
        "Nenhum assistente configurado ainda.".to_string()
    } else {
        assistant_details.join("\n\n")
    };

    // ─── Workspace & Channel Context ─────────────────────────────────────
    let active_ws_id = crate::services::workspace::get_active_workspace_id(&db, &user_id)
        .await
        .unwrap_or(user_id);
    let active_ws = crate::services::workspace::get_workspace(&db, &active_ws_id)
        .await
        .ok();
    let user_workspaces = crate::services::workspace::list_user_workspaces(&db, &user_id)
        .await
        .unwrap_or_default();
    let user_channels = crate::services::channel::list_user_channels(&db, &user_id, &active_ws_id)
        .await
        .unwrap_or_default();

    let workspace_context = {
        let active_ws_name = active_ws
            .as_ref()
            .map(|w| w.name.as_str())
            .unwrap_or("Pessoal");

        let ws_list: Vec<String> = user_workspaces
            .iter()
            .map(|w| {
                let marker = if w.workspace_id == active_ws_id {
                    " <- ativo"
                } else {
                    ""
                };
                format!(
                    "  - {} (id: {}, tipo: {}, role: {}){}",
                    w.workspace_name, w.workspace_id, w.workspace_type, w.role, marker
                )
            })
            .collect();

        let mut channel_lines: Vec<String> = user_channels
            .iter()
            .take(20)
            .map(|c| {
                let prefix = if c.channel_type == "dm" { "" } else { "#" };
                format!(
                    "  - {}{} ({}, {} não lidas) (id: {})",
                    prefix, c.channel_name, c.channel_type, c.unread_count, c.channel_id
                )
            })
            .collect();
        if user_channels.len() > 20 {
            channel_lines.push(format!(
                "  - ... e mais {} canais (use list_channels para ver todos)",
                user_channels.len() - 20
            ));
        }

        let channels_section = if channel_lines.is_empty() {
            "Nenhum canal no workspace ativo.".to_string()
        } else {
            channel_lines.join("\n")
        };

        format!(
            r#"## Contexto de Workspaces
- Workspace ativo: {active_ws_name} (id: {active_ws_id})
- Workspaces do usuário:
{ws_list}

### Canais no workspace ativo
{channels_section}"#,
            active_ws_name = active_ws_name,
            active_ws_id = active_ws_id,
            ws_list = ws_list.join("\n"),
            channels_section = channels_section,
        )
    };

    let mut system_prompt = format!(
        include_str!("../../resources/sophie/system.md"),
        user_name = if user.name.is_empty() {
            "Usuário"
        } else {
            &user.name
        },
        user_email = user.email,
        assistant_list = assistant_list,
        workspace_context = workspace_context,
        skills = skills_summary(),
    );

    // If a skill is active, inject its full prompt
    if let Some(ref skill_name) = req.skill {
        if let Some(skill_prompt) = get_skill_prompt(skill_name) {
            system_prompt.push_str("\n\n## Skill Ativa\n");
            system_prompt.push_str(skill_prompt);
        }
    }

    // Build Gemini contents
    let mut contents: Vec<serde_json::Value> = Vec::new();

    for msg in &req.history {
        let role = if msg.role == "assistant" { "model" } else { "user" };
        contents.push(serde_json::json!({
            "role": role,
            "parts": [{"text": msg.content}],
        }));
    }

    // Build user message — multimodal if attachments are present
    if req.attachments.is_empty() {
        contents.push(serde_json::json!({
            "role": "user",
            "parts": [{"text": req.message}],
        }));
    } else {
        let mut parts = vec![serde_json::json!({"text": req.message})];
        for att in &req.attachments {
            parts.push(serde_json::json!({
                "inline_data": {
                    "mime_type": att.mime_type,
                    "data": att.data_base64,
                }
            }));
        }
        contents.push(serde_json::json!({
            "role": "user",
            "parts": parts,
        }));
    }

    // Coalesce consecutive same-role messages (Gemini requirement)
    contents = coalesce_contents(contents);

    // Increment usage counter
    increment_usage(&db, &user_id).await;

    // Calculate rate limit info for warnings
    let new_used = used + 1;
    let pct = (new_used as f64 / limit as f64) * 100.0;

    // T1.3 — timeout envolve apenas a resposta inicial do HTTP POST (connect + headers).
    // O loop de frames SSE fica fora do escopo — streaming pode levar dezenas de segundos.
    let llm_timeout_secs = config.llm_global_timeout_secs;

    // Create channel for SSE events
    let (tx, rx) = mpsc::channel::<Result<Event, Infallible>>(128);

    // Spawn streaming task
    tokio::spawn(async move {
        // Send thinking status
        let _ = tx
            .send(Ok(Event::default().event("status").data(
                serde_json::json!({"text": "Analisando mensagem..."}).to_string(),
            )))
            .await;

        // Call Gemini streaming API
        let client = reqwest::Client::new();
        let body = serde_json::json!({
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": contents,
            "generationConfig": {
                "temperature": 0.7,
                "maxOutputTokens": 4096,
            },
            "tools": [{"google_search": {}}],
        });

        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:streamGenerateContent?alt=sse&key={}",
            api_key
        );

        // T1.3 — timeout só na resposta inicial do SSE.
        let send_fut = client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&body)
            .send();
        let resp = match tokio::time::timeout(
            std::time::Duration::from_secs(llm_timeout_secs),
            send_fut,
        )
        .await
        {
            Ok(res) => res,
            Err(_) => {
                let msg = format!(
                    "A chamada ao provider gemini excedeu {llm_timeout_secs}s. Tente resposta mais concisa ou reduza max_tokens."
                );
                tracing::error!("Gemini request timed out after {}s", llm_timeout_secs);
                let _ = tx
                    .send(Ok(Event::default().event("error").data(
                        serde_json::json!({"error": msg}).to_string(),
                    )))
                    .await;
                let _ = tx.send(Ok(Event::default().event("done").data("{}"))).await;
                return;
            }
        };

        let _ = tx
            .send(Ok(Event::default().event("status").data(
                serde_json::json!({"text": "Pensando sobre o problema..."}).to_string(),
            )))
            .await;

        match resp {
            Ok(response) => {
                if !response.status().is_success() {
                    let error_text = response.text().await.unwrap_or_default();
                    tracing::error!("Gemini API error: {}", error_text);
                    let _ = tx
                        .send(Ok(Event::default()
                            .event("error")
                            .data(serde_json::json!({"error": "Não foi possível processar sua mensagem no momento. Tente novamente."}).to_string())))
                        .await;
                    let _ = tx.send(Ok(Event::default().event("done").data("{}"))).await;
                    return;
                }

                // Process SSE stream from Gemini
                let mut stream = response.bytes_stream();
                let mut buffer = String::new();
                let mut full_content = String::new();

                use futures::StreamExt;
                while let Some(chunk_result) = stream.next().await {
                    match chunk_result {
                        Ok(bytes) => {
                            buffer.push_str(&String::from_utf8_lossy(&bytes));

                            // Process complete SSE lines
                            while let Some(pos) = buffer.find('\n') {
                                let line = buffer[..pos].trim().to_string();
                                buffer = buffer[pos + 1..].to_string();

                                if line.is_empty() {
                                    continue;
                                }

                                if let Some(data) = line.strip_prefix("data: ") {
                                    if let Ok(parsed) =
                                        serde_json::from_str::<serde_json::Value>(data)
                                    {
                                        // Gemini streaming: extract text from candidates
                                        if let Some(text) = parsed["candidates"][0]["content"]["parts"][0]["text"].as_str() {
                                            full_content.push_str(text);
                                            let _ = tx
                                                .send(Ok(Event::default().event("token").data(
                                                    serde_json::json!({"text": text})
                                                        .to_string(),
                                                )))
                                                .await;
                                        }
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            tracing::error!("Stream error: {}", e);
                            break;
                        }
                    }
                }

                // S1.2 — Log-only XML/JSON validation of baisync-action
                // payloads. Foundation for W2.1 evaluator. Must not touch
                // `full_content`, SSE events, or rate-limit state.
                validate_baisync_actions(&full_content);

                // Send rate limit warning if approaching limit
                if pct >= 60.0 {
                    let warning_msg = if pct >= 100.0 {
                        "Limite atingido. Tente novamente em breve.".to_string()
                    } else if pct >= 90.0 {
                        format!("Quase no limite! {}% usado.", pct as i32)
                    } else if pct >= 80.0 {
                        format!("Atenção: {}% do limite usado.", pct as i32)
                    } else {
                        format!("{}% do limite de mensagens usado.", pct as i32)
                    };
                    let rl_data = serde_json::json!({
                        "used": new_used,
                        "limit": limit,
                        "pct": pct as i32,
                        "warning": warning_msg,
                    });
                    let _ = tx
                        .send(Ok(Event::default()
                            .event("rate_limit")
                            .data(rl_data.to_string())))
                        .await;
                }

                let _ = tx
                    .send(Ok(Event::default().event("done").data(
                        serde_json::json!({"content_length": full_content.len()}).to_string(),
                    )))
                    .await;
            }
            Err(e) => {
                tracing::error!("Gemini request failed: {}", e);
                let _ = tx
                    .send(Ok(Event::default()
                        .event("error")
                        .data(serde_json::json!({"error": "Não foi possível processar sua mensagem no momento. Tente novamente."}).to_string())))
                    .await;
                let _ = tx.send(Ok(Event::default().event("done").data("{}"))).await;
            }
        }
    });

    let stream = ReceiverStream::new(rx);
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Compiled-once regex for scanning `<baisync-action>...</baisync-action>`
/// payloads inside the streamed response. The `(?s)` inline flag enables
/// DOTALL so `.` matches newlines — actions frequently span multiple lines.
fn action_regex() -> &'static regex::Regex {
    static R: OnceLock<regex::Regex> = OnceLock::new();
    R.get_or_init(|| {
        regex::Regex::new(r"(?s)<baisync-action>(.+?)</baisync-action>")
            .expect("static baisync-action regex must compile")
    })
}

/// S1.2 — Validate every `<baisync-action>…</baisync-action>` payload Sophie
/// emitted in the completed response. Log-only: malformed JSON produces a
/// `baisync.xml_malformed` warn, a non-zero total produces a single info
/// summary. Does NOT mutate the content, the SSE stream, or any state.
///
/// Foundation for W2.1 (evaluator); today it just gives us observability.
fn validate_baisync_actions(content: &str) {
    let mut total: usize = 0;
    let mut malformed: usize = 0;

    for cap in action_regex().captures_iter(content) {
        total += 1;
        // capture group 1 is the inner payload; regex guarantees presence.
        let inner = match cap.get(1) {
            Some(m) => m.as_str(),
            None => continue,
        };

        if let Err(e) = serde_json::from_str::<serde_json::Value>(inner) {
            malformed += 1;
            // Truncate by chars (not bytes) — Gemini emits UTF-8 Portuguese
            // with multibyte accents; slicing by bytes would panic.
            let preview: String = inner.chars().take(200).collect();
            tracing::warn!(
                event = "baisync.xml_malformed",
                error = %e,
                content_preview = %preview,
                "malformed baisync-action payload"
            );
        }
    }

    if total > 0 {
        tracing::info!(
            event = "baisync.actions_parsed",
            total = total,
            malformed = malformed,
            "sophie emitted actions"
        );
    }
}

/// Merge consecutive same-role Gemini contents into one entry.
fn coalesce_contents(contents: Vec<serde_json::Value>) -> Vec<serde_json::Value> {
    if contents.is_empty() {
        return contents;
    }

    let mut coalesced: Vec<serde_json::Value> = Vec::new();
    for msg in contents {
        let role = msg["role"].as_str().unwrap_or("user");
        if let Some(last) = coalesced.last_mut() {
            if last["role"].as_str().unwrap_or("") == role {
                if let (Some(existing), Some(new)) = (
                    last.get_mut("parts").and_then(|p| p.as_array_mut()),
                    msg["parts"].as_array(),
                ) {
                    existing.extend(new.iter().cloned());
                }
                continue;
            }
        }
        coalesced.push(msg);
    }

    coalesced
}

// ─── Rate limit info endpoint ──────��─────────────────────────────────────────

pub async fn rate_limit(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<RateLimitResponse>, AppError> {
    let used = get_usage_count(&db, &auth_user.user_id).await;

    Ok(Json(RateLimitResponse {
        used,
        limit: config.baisync_rate_limit,
        reset_at: next_hour_reset(),
    }))
}

// ─── S1.3 — Sophie self-introspection endpoints ──────────────────────────────
//
// Two GET endpoints Sophie can call via <baisync-action> to inspect her own
// failures and the platform health. Both scope strictly to the authenticated
// user_id; neither exposes data from other tenants.

/// Canonical LLM providers that the circuit breaker tracks. Keep this list in
/// sync with `services/llm.rs` callers (`openai`, `claude`, `gemini`, `grok`,
/// `deepseek`). Providers never seen by `record_failure` still appear in the
/// response with `open=false, fail_count_last_60s=0` so Sophie always gets a
/// complete picture regardless of recent traffic.
const CANONICAL_PROVIDERS: &[&str] = &["openai", "claude", "gemini", "grok", "deepseek"];

#[derive(Serialize)]
pub struct RecentError {
    pub id: String,
    pub assistant_id: String,
    pub conversation_id: Option<String>,
    pub provider: String,
    pub model: String,
    pub error: String,
    pub created_at: String,
    pub duration_ms: Option<i32>,
    pub tool_rounds: Option<i32>,
}

#[derive(Serialize)]
pub struct MyRecentErrorsResponse {
    pub errors: Vec<RecentError>,
    pub count: usize,
}

#[derive(Serialize)]
pub struct ProviderHealthSnapshot {
    pub provider: String,
    pub open: bool,
    pub fail_count_last_60s: u32,
}

#[derive(Serialize)]
pub struct BaisyncRateLimitSnapshot {
    pub used: i64,
    pub limit: i32,
    pub reset_at: String,
}

#[derive(Serialize)]
pub struct UsageQuotaSnapshot {
    pub total_messages: i64,
    pub total_tokens: i64,
}

#[derive(Serialize)]
pub struct PlatformHealthResponse {
    pub circuit_breaker_state: Vec<ProviderHealthSnapshot>,
    pub baisync_rate_limit_usage: BaisyncRateLimitSnapshot,
    pub usage_quota: UsageQuotaSnapshot,
}

/// GET /api/baisync/actions/my_recent_errors
///
/// Returns up to 20 most recent LLM call failures for the authenticated user,
/// across all of their assistants. Strategy (a) from the plan: first list the
/// user's assistants, then scan each partition individually, merge + truncate
/// in memory. This respects the `((user_id, assistant_id), id)` partition key
/// and never issues an `ALLOW FILTERING` scan of cross-tenant data.
pub async fn my_recent_errors(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<MyRecentErrorsResponse>, AppError> {
    let user_id = auth_user.user_id;

    // 1. List user's assistants (partition-key scoped).
    let assistants = crate::services::assistant::list_assistants(&db, &user_id)
        .await
        .unwrap_or_default();

    // 2. For each assistant partition, pull up to 20 rows newest-first and
    //    filter to those carrying a non-empty `error`. Cassandra `error` is
    //    nullable (non-PK), so we scope by the primary key and post-filter in
    //    memory. No ALLOW FILTERING needed.
    //
    //    Row shape mirrors the existing `assistant_llm_logs` query in
    //    `handlers/stats.rs` so the two endpoints stay consistent.
    type LogRow = (
        CqlTimeuuid,
        Option<Uuid>,     // conversation_id
        Option<String>,   // provider
        Option<String>,   // model
        Option<i32>,      // duration_ms
        Option<i32>,      // tool_rounds
        Option<String>,   // error
        Option<DateTime<Utc>>, // created_at
    );

    // Over-fetch per partition so non-error rows don't starve the final 20.
    // 40 rows per assistant keeps the total bounded even with many assistants.
    const PER_ASSISTANT_SCAN: i32 = 40;

    let mut candidates: Vec<(CqlTimeuuid, Uuid, LogRow)> = Vec::new();
    for asst in &assistants {
        let result = db
            .query_unpaged(
                "SELECT id, conversation_id, provider, model, duration_ms, \
                        tool_rounds, error, created_at \
                 FROM inertial_eclipse.llm_call_logs \
                 WHERE user_id = ? AND assistant_id = ? LIMIT ?",
                (&user_id, &asst.id, PER_ASSISTANT_SCAN),
            )
            .await
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;

        let rows = result.into_rows_result()?;
        for row in rows.rows::<LogRow>()?.flatten() {
            // Filter by non-empty error (post-fetch — the column is nullable
            // and there is no SAI index on `error`; a proper SAI index would
            // let us push this into the query but the data volume is small).
            if row.6.as_deref().map(|s| !s.is_empty()).unwrap_or(false) {
                candidates.push((row.0, asst.id, row));
            }
        }
    }

    // 3. Sort newest-first by TIMEUUID (natural time ordering) and truncate.
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    candidates.truncate(20);

    let errors: Vec<RecentError> = candidates
        .into_iter()
        .map(|(id_tuuid, assistant_id, row)| {
            let id_uuid: Uuid = Uuid::from(id_tuuid);
            RecentError {
                id: id_uuid.to_string(),
                assistant_id: assistant_id.to_string(),
                conversation_id: row.1.map(|u| u.to_string()),
                provider: row.2.unwrap_or_default(),
                model: row.3.unwrap_or_default(),
                error: row.6.unwrap_or_default(),
                created_at: row
                    .7
                    .map(|t| t.to_rfc3339())
                    .unwrap_or_default(),
                duration_ms: row.4,
                tool_rounds: row.5,
            }
        })
        .collect();

    let count = errors.len();
    Ok(Json(MyRecentErrorsResponse { errors, count }))
}

/// Merge the raw snapshot from `services/llm.rs` with the canonical provider
/// list so providers never seen by `record_failure` still appear with
/// zeroed counters. Extracted from the handler for unit-test coverage.
fn merge_with_canonical_providers(
    raw: Vec<(String, bool, u32)>,
) -> Vec<ProviderHealthSnapshot> {
    let mut seen: std::collections::HashMap<String, (bool, u32)> = raw
        .into_iter()
        .map(|(p, open, n)| (p, (open, n)))
        .collect();

    let mut out: Vec<ProviderHealthSnapshot> = Vec::with_capacity(CANONICAL_PROVIDERS.len());
    for p in CANONICAL_PROVIDERS {
        let (open, n) = seen
            .remove(*p)
            .unwrap_or((false, 0));
        out.push(ProviderHealthSnapshot {
            provider: (*p).to_string(),
            open,
            fail_count_last_60s: n,
        });
    }
    // Any extra providers that were tracked but aren't in the canonical list
    // (future-proofing) are appended at the end so the response is still
    // complete.
    for (provider, (open, n)) in seen {
        out.push(ProviderHealthSnapshot {
            provider,
            open,
            fail_count_last_60s: n,
        });
    }
    out
}

/// GET /api/baisync/actions/platform_health
///
/// Snapshot of platform health for Sophie:
///   - circuit_breaker_state: one entry per canonical provider
///   - baisync_rate_limit_usage: current-hour Sophie usage for this user
///   - usage_quota: aggregate messages/tokens from `usage_stats` for the user
///
/// Every query scopes to `auth_user.user_id`; no cross-tenant data escapes.
pub async fn platform_health(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<PlatformHealthResponse>, AppError> {
    let user_id = auth_user.user_id;

    // 1. Circuit breaker — live in-memory snapshot, no DB query.
    let raw = llm::snapshot_circuit_breaker_state();
    let circuit_breaker_state = merge_with_canonical_providers(raw);

    // 2. Baisync rate limit — current-hour count vs. configured limit.
    let used = get_usage_count(&db, &user_id).await;
    let baisync_rate_limit_usage = BaisyncRateLimitSnapshot {
        used,
        limit: config.baisync_rate_limit,
        reset_at: next_hour_reset(),
    };

    // 3. Usage quota — sum `total_messages` + `total_tokens` across all
    //    (user_id, assistant_id) rows in `usage_stats`. Mirrors the pattern
    //    in `handlers/stats.rs::user_usage` but aggregates instead of binning.
    let assistants = crate::services::assistant::list_assistants(&db, &user_id)
        .await
        .unwrap_or_default();

    let mut total_messages: i64 = 0;
    let mut total_tokens: i64 = 0;
    for asst in &assistants {
        let result = db
            .query_unpaged(
                "SELECT total_messages, total_tokens \
                 FROM inertial_eclipse.usage_stats \
                 WHERE user_id = ? AND assistant_id = ?",
                (&user_id, &asst.id),
            )
            .await
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;

        let rows = result.into_rows_result()?;
        for row in rows.rows::<(Option<i64>, Option<i64>)>()?.flatten() {
            total_messages += row.0.unwrap_or(0);
            total_tokens += row.1.unwrap_or(0);
        }
    }

    let usage_quota = UsageQuotaSnapshot {
        total_messages,
        total_tokens,
    };

    Ok(Json(PlatformHealthResponse {
        circuit_breaker_state,
        baisync_rate_limit_usage,
        usage_quota,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Renders the Sophie system prompt with deterministic fixture values and
    /// checks it against a frozen snapshot. This guards the markdown extraction
    /// in S1.1 — any change to `resources/sophie/system.md` that affects the
    /// rendered output will require updating `EXPECTED_LEN` and the marker
    /// assertions below.
    ///
    /// The snapshot was captured from the pre-refactor `r#"..."#` literal and
    /// verified byte-for-byte against the post-refactor `include_str!` path.
    #[test]
    fn test_system_prompt_render_stable() {
        let user_name = "Fixture User";
        let user_email = "fixture@example.com";
        let assistant_list = "### Teste (id: 00000000-0000-0000-0000-000000000001)\n- Provedor: openai | Modelo: gpt-4o";
        let workspace_context = "## Contexto de Workspaces\n- Workspace ativo: Pessoal";
        let skills = "- **criar_atendente**: ...\n- **sobre_plataforma**: ...";

        let rendered = format!(
            include_str!("../../resources/sophie/system.md"),
            user_name = user_name,
            user_email = user_email,
            assistant_list = assistant_list,
            workspace_context = workspace_context,
            skills = skills,
        );

        // Byte length captured pre-refactor (r#"..."# literal with same fixture).
        // S1.3 bumped the snapshot by 301 bytes when the new Observabilidade
        // section (get_my_recent_errors + get_platform_health) was added.
        const EXPECTED_LEN: usize = 16020;
        assert_eq!(
            rendered.len(),
            EXPECTED_LEN,
            "rendered system_prompt length drifted from snapshot ({EXPECTED_LEN} bytes)"
        );

        // Spot-check several markers that span the entire template to catch
        // any placeholder or escape regression.
        assert!(rendered.starts_with("Você é o Baisync Agent"));
        assert!(rendered.ends_with("independente do workspace ativo."));
        assert!(rendered.contains("- Nome: Fixture User"));
        assert!(rendered.contains("- Email: fixture@example.com"));
        assert!(rendered.contains("### Teste (id: 00000000-0000-0000-0000-000000000001)"));
        assert!(rendered.contains("- Workspace ativo: Pessoal"));
        assert!(rendered.contains("- **criar_atendente**: ..."));
        // Literal braces must survive the {{ }} → { } unescape step.
        assert!(rendered.contains("<baisync-ui>{\"type\": \"question_box\""));
        assert!(rendered.contains("<baisync-action>{\"action\": \"NOME\", \"data\": {...}}</baisync-action>"));
    }

    /// Sanity check for the two skill prompts (criar_atendente, sobre_plataforma).
    /// Full byte comparison is done on disk via the markdown files themselves;
    /// here we only assert that the `include_str!` path resolves and that the
    /// distinctive markers from each prompt are still present.
    #[test]
    fn test_skills_prompts_stable() {
        // Ordering in the SKILLS array matters for these assertions.
        assert_eq!(SKILLS.len(), 2);
        assert_eq!(SKILLS[0].name, "criar_atendente");
        assert_eq!(SKILLS[1].name, "sobre_plataforma");

        // criar_atendente — consultative flow marker.
        assert!(SKILLS[0].prompt.contains("UMA pergunta por vez"));
        assert_eq!(SKILLS[0].prompt.len(), 3088);

        // sobre_plataforma — platform description marker.
        assert!(SKILLS[1].prompt.contains("plataforma Baisync"));
        assert_eq!(SKILLS[1].prompt.len(), 1372);

        // Lookup helper still works post-refactor.
        assert!(get_skill_prompt("criar_atendente").is_some());
        assert!(get_skill_prompt("sobre_plataforma").is_some());
        assert!(get_skill_prompt("inexistente").is_none());
    }

    // ─── S1.2: validate_baisync_actions ──────────────────────────────────
    //
    // `validate_baisync_actions` is log-only and returns `()`. These tests
    // are smoke checks that the function does not panic on the expected
    // input shapes. The regex behavior is covered separately by
    // `test_action_regex_dotall` so we can catch the DOTALL regression if
    // someone drops the `(?s)` flag. Upstream crates (regex, serde_json)
    // are themselves well-tested, so we don't reimplement a log capture
    // here.

    #[test]
    fn test_validate_baisync_actions_valid_passes() {
        let content = r#"Claro! Aqui vão as ações:
<baisync-action>{"action": "list_assistants", "data": {}}</baisync-action>
Depois, esta também:
<baisync-action>{"action": "open_channel", "data": {"id": "abc"}}</baisync-action>
Pronto."#;
        // Must not panic. Both payloads are well-formed JSON.
        validate_baisync_actions(content);
    }

    #[test]
    fn test_validate_baisync_actions_malformed_detected() {
        let content = r#"Vou tentar duas:
<baisync-action>{"action": "list_assistants", "data": {}}</baisync-action>
E esta está quebrada:
<baisync-action>{not json}</baisync-action>"#;
        // Must not panic; the malformed one triggers a warn log internally.
        validate_baisync_actions(content);
    }

    #[test]
    fn test_validate_baisync_actions_no_matches() {
        let content = "Nenhuma ação aqui, apenas texto em português com acentuação (ção).";
        // Zero matches → zero warns, no info log, no panic.
        validate_baisync_actions(content);
    }

    #[test]
    fn test_validate_baisync_actions_multiline_action() {
        // Multi-line JSON inside the tag — DOTALL must allow `.` across `\n`.
        let content = "<baisync-action>{\n  \"action\": \"multi\",\n  \"data\": {\n    \"k\": \"v\"\n  }\n}</baisync-action>";
        // Must not panic; the JSON inside is valid once parsed.
        validate_baisync_actions(content);
    }

    #[test]
    fn test_action_regex_dotall() {
        // Direct regex sanity check — if someone drops `(?s)`, the `.+?`
        // will refuse to match across `\n` and this test fails.
        let input = "<baisync-action>{\n  \"action\": \"x\"\n}</baisync-action>";
        let re = action_regex();

        let matches: Vec<_> = re.captures_iter(input).collect();
        assert_eq!(matches.len(), 1, "expected exactly one match");

        let inner = matches[0].get(1).expect("capture group 1").as_str();
        assert!(inner.contains("\"action\": \"x\""));
        // The captured group must be parseable as JSON.
        let parsed: serde_json::Value =
            serde_json::from_str(inner).expect("multiline JSON must parse");
        assert_eq!(parsed["action"], "x");
    }

    // ─── S1.3: circuit breaker snapshot for platform_health endpoint ─────
    //
    // These tests exercise the public snapshot API exposed by
    // `services/llm.rs` and the merge logic used by the `platform_health`
    // handler. Static state is mutated, so the two tests share a mutex-like
    // sequential pattern: each one resets state at entry. They live in the
    // same `mod tests` block because they need access to private helpers
    // and the crate-local constants from `handlers::baisync`.

    /// Serialises circuit-breaker snapshot tests so they don't race on the
    /// shared global `PROVIDER_HEALTH` map. `cargo test --lib` runs tests
    /// in parallel by default; without this mutex, the two tests below
    /// would interleave `record_failure` calls and fail non-deterministically.
    static CB_TEST_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn test_snapshot_circuit_breaker_includes_all_providers() {
        let _guard = CB_TEST_MUTEX.lock().unwrap();
        llm::reset_circuit_breaker_state();

        let raw = llm::snapshot_circuit_breaker_state();
        let merged = merge_with_canonical_providers(raw);

        // All 5 canonical providers must be present, all closed, all zero.
        assert_eq!(
            merged.len(),
            CANONICAL_PROVIDERS.len(),
            "expected exactly the canonical providers when state is empty"
        );
        for snap in &merged {
            assert!(
                CANONICAL_PROVIDERS.contains(&snap.provider.as_str()),
                "unexpected provider in snapshot: {}",
                snap.provider
            );
            assert!(!snap.open, "provider {} should be closed", snap.provider);
            assert_eq!(
                snap.fail_count_last_60s, 0,
                "provider {} should have zero failures",
                snap.provider
            );
        }
    }

    #[test]
    fn test_snapshot_circuit_breaker_reflects_failures() {
        let _guard = CB_TEST_MUTEX.lock().unwrap();
        llm::reset_circuit_breaker_state();

        // Trigger 3 failures on openai — circuit still closed (threshold=5).
        for _ in 0..3 {
            llm::test_record_failure("openai");
        }
        let raw = llm::snapshot_circuit_breaker_state();
        let merged = merge_with_canonical_providers(raw);
        let openai = merged
            .iter()
            .find(|s| s.provider == "openai")
            .expect("openai must be present");
        assert_eq!(openai.fail_count_last_60s, 3);
        assert!(!openai.open, "openai circuit should still be closed at 3 failures");

        // Two more failures — now at 5, circuit opens.
        for _ in 0..2 {
            llm::test_record_failure("openai");
        }
        let raw = llm::snapshot_circuit_breaker_state();
        let merged = merge_with_canonical_providers(raw);
        let openai = merged
            .iter()
            .find(|s| s.provider == "openai")
            .expect("openai must be present");
        assert_eq!(openai.fail_count_last_60s, 5);
        assert!(openai.open, "openai circuit should open at 5 failures");

        // Other providers remain closed and zero.
        for other in ["claude", "gemini", "grok", "deepseek"] {
            let snap = merged
                .iter()
                .find(|s| s.provider == other)
                .unwrap_or_else(|| panic!("{other} must be present in merged snapshot"));
            assert!(!snap.open);
            assert_eq!(snap.fail_count_last_60s, 0);
        }

        llm::reset_circuit_breaker_state();
    }
}
