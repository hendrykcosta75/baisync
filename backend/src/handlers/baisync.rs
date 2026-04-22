use axum::extract::{Extension, Path, Query};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use chrono::{DateTime, Utc};
use scylla::frame::value::{Counter, CqlTimeuuid};

use futures::stream::Stream;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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

/// Gemini model used for Sophie's main streaming response. Exposed so the
/// SWOT interview handler and other SSE paths can stay in sync.
pub const SOPHIE_GEMINI_MODEL: &str = "gemini-3-flash-preview";


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

pub(crate) fn get_skill_prompt(name: &str) -> Option<&'static str> {
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

pub(crate) fn current_hour_bucket() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H").to_string()
}

fn next_hour_reset() -> String {
    let now = chrono::Utc::now();
    let next = now + chrono::Duration::hours(1);
    next.format("%Y-%m-%dT%H:00:00Z").to_string()
}

/// Read total tokens used by this user in the current hour bucket.
/// Reads the migration-107 `baisync_rate_limits_tokens` table (counter).
///
/// Counter columns are nullable at the row level — if the user has no
/// turns yet this hour, the partition doesn't exist and we return 0.
/// DB errors are logged (not swallowed) so a broken counter table is
/// visible in operator logs instead of masquerading as "zero usage".
pub async fn get_usage_tokens(db: &DbSession, user_id: &Uuid) -> i64 {
    let bucket = current_hour_bucket();
    let result = db
        .query_unpaged(
            "SELECT tokens_used FROM inertial_eclipse.baisync_rate_limits_tokens WHERE user_id = ? AND hour_bucket = ?",
            (user_id, &bucket as &str),
        )
        .await;

    match result {
        Ok(res) => match res.into_rows_result() {
            Ok(rows) => match rows.maybe_first_row::<(Option<Counter>,)>() {
                Ok(Some((Some(Counter(t)),))) => t,
                Ok(Some((None,))) => 0,
                Ok(None) => 0,
                Err(e) => {
                    tracing::warn!(
                        event = "baisync.usage_read_decode_error",
                        user_id = %user_id,
                        hour_bucket = %bucket,
                        error = %e,
                        "failed to decode baisync_rate_limits_tokens row — returning 0"
                    );
                    0
                }
            },
            Err(e) => {
                tracing::warn!(
                    event = "baisync.usage_read_rows_error",
                    user_id = %user_id,
                    hour_bucket = %bucket,
                    error = %e,
                    "baisync_rate_limits_tokens rows-result failed — returning 0"
                );
                0
            }
        },
        Err(e) => {
            tracing::warn!(
                event = "baisync.usage_read_query_error",
                user_id = %user_id,
                hour_bucket = %bucket,
                error = %e,
                "baisync_rate_limits_tokens SELECT failed — returning 0 (rate-limit may be stale)"
            );
            0
        }
    }
}

/// Increment the user's token counter by `delta` for the current hour.
/// Counter tables require the SET x = x + ? form. DB errors are logged
/// (not swallowed) so a broken counter is visible in operator logs — a
/// silent drop would let the rate limit drift below the real usage.
pub(crate) async fn increment_usage_tokens(db: &DbSession, user_id: &Uuid, delta: i64) {
    if delta <= 0 {
        return;
    }
    let bucket = current_hour_bucket();
    tracing::info!(
        event = "baisync.usage_write_attempt",
        user_id = %user_id,
        hour_bucket = %bucket,
        delta = delta,
        "about to UPDATE baisync_rate_limits_tokens"
    );
    // Scylla 0.15's strict type-check rejects plain `i64` for counter
    // columns on BOTH read and write paths. The increment must be wrapped
    // in `Counter(delta)` even though CQL semantically takes a bigint
    // addend — the driver ties the `?` placeholder to the column's
    // declared type (`counter`), not to the addition's CQL type.
    // Verified against a probe binary before committing this fix.
    match db
        .query_unpaged(
            "UPDATE inertial_eclipse.baisync_rate_limits_tokens SET tokens_used = tokens_used + ? WHERE user_id = ? AND hour_bucket = ?",
            (Counter(delta), user_id, &bucket as &str),
        )
        .await
    {
        Ok(_) => {
            tracing::info!(
                event = "baisync.usage_write_ok",
                user_id = %user_id,
                hour_bucket = %bucket,
                delta = delta,
                "UPDATE succeeded"
            );
        }
        Err(e) => {
            tracing::warn!(
                event = "baisync.usage_write_error",
                user_id = %user_id,
                hour_bucket = %bucket,
                delta = delta,
                error = %e,
                "baisync_rate_limits_tokens UPDATE failed — token usage NOT recorded for this turn"
            );
        }
    }
}

/// Rough token estimator used as a fallback when the Gemini SSE stream
/// does not emit `usageMetadata.totalTokenCount` (model variation,
/// upstream outage, early abort). Prevents a silent 0-cost billing path
/// that would cause `/usage` to stay at zero and the rate-limit block to
/// never trip. The heuristic is 1 token ≈ 4 chars, biased toward
/// counting more rather than less so users cannot game the counter by
/// driving Gemini down a frame-format path that omits usage metadata.
///
/// Pure function — trivial to unit-test.
fn estimate_tokens_from_chars(prompt_chars: usize, response_chars: usize) -> i64 {
    // Round-up division so a 3-char input counts as 1 token (not 0).
    fn ceil_div4(n: usize) -> usize {
        n.div_ceil(4)
    }
    let total = ceil_div4(prompt_chars).saturating_add(ceil_div4(response_chars));
    // Cap at i64::MAX defensively; in practice a single turn is well under
    // 1e6 chars so overflow is unreachable.
    total.min(i64::MAX as usize) as i64
}

// ─── Chat endpoint (SSE streaming) ────��─────────────────────────────────────

pub async fn chat(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(encryption): Extension<crate::services::encryption::EncryptionService>,
    Extension(auth_user): Extension<AuthUser>,
    Query(qs): Query<HashMap<String, String>>,
    Json(req): Json<BaisyncChatRequest>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
    let api_key = config.baisync_api_key.clone();
    if api_key.is_empty() {
        return Err(AppError::InternalError(
            "BAISYNC_API_KEY not configured".into(),
        ));
    }

    // S2.2 — `?planner=true` (or `?planner=1`) opts into the 2-call pipeline.
    // When absent or any other value, Sophie runs through the single-call
    // flow exactly as before — the planner code path is never touched. The
    // flag is dev/QA only; production keeps the default single-call path.
    let planner_enabled = qs
        .get("planner")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false);

    let gemini_model = SOPHIE_GEMINI_MODEL;

    let user_id = auth_user.user_id;

    // Rate limit: tokens per hour per user (migration 107). Pre-check: if
    // already at/over the budget, reject before calling Gemini. Post-stream
    // increment happens after we read `usageMetadata.totalTokenCount`.
    let used = get_usage_tokens(&db, &user_id).await;
    let limit = config.baisync_rate_limit;
    if used >= limit as i64 {
        return Err(AppError::BadRequest(format!(
            "Limite de tokens atingido ({}/{}). Tente novamente na próxima hora.",
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

    // Pre-existing usage from prior turns this hour. Per-turn token count is
    // extracted from `usageMetadata` during the SSE stream (below) and used
    // both for the live rate_limit event and the post-stream counter bump.
    let prior_used = used;

    // T1.3 — timeout envolve apenas a resposta inicial do HTTP POST (connect + headers).
    // O loop de frames SSE fica fora do escopo — streaming pode levar dezenas de segundos.
    let llm_timeout_secs = config.llm_global_timeout_secs;

    // T2.1 — open a session per Sophie chat call.
    //
    // Limitation (documented): today we create a brand-new session on every
    // Sophie call even when the request carries `req.history`. Sophie does
    // not yet have server-side session continuity — that's S2.1. Until then,
    // each call produces an independent session id; resuming a thread would
    // require the UI to send the previous session id along with the history,
    // which it does not.
    //
    // `assistant_id` is set to `Uuid::nil()` because Sophie is the platform
    // agent (not a user-created assistant); the nil uuid is the established
    // "no entity" sentinel used elsewhere in the codebase.
    // `conversation_id` also uses the nil uuid for the same reason — Sophie
    // chats do not flow through `conversations`/`messages` (those are for
    // WhatsApp/Telegram), so there is no conversation to tie to.
    let session_id_opt: Option<crate::services::session::SessionId> =
        match crate::services::session::create_session(
            &db,
            user_id,
            Uuid::nil(),
            Uuid::nil(),
        )
        .await
        {
            Ok(id) => Some(id),
            Err(e) => {
                tracing::warn!(error = %e, "sophie session create failed; continuing without session tracking");
                None
            }
        };

    // Capture the user message for the session log — `req` itself is
    // consumed later when building the Gemini body.
    let session_user_msg = req.message.clone();

    // S2.2 — capture planner inputs BEFORE the spawn so they survive the
    // `move` closure. Only the role + content pair is needed; attachments
    // and file_refs are irrelevant to the planner's text-only reasoning.
    // We only materialize these clones when `planner_enabled` is true so
    // the default single-call path stays cheap.
    let planner_history: Vec<(String, String)> = if planner_enabled {
        req.history
            .iter()
            .map(|m| (m.role.clone(), m.content.clone()))
            .collect()
    } else {
        Vec::new()
    };
    let planner_user_msg: String = if planner_enabled {
        req.message.clone()
    } else {
        String::new()
    };

    // Owned copy of the config for the spawn — the planner call needs it
    // for `ToolContext` wiring. Only cloned when the planner flag is on;
    // otherwise the default flow uses the existing captured values without
    // paying for the clone. (The planner re-uses `api_key` = BAISYNC_API_KEY
    // rather than a separate evaluator/compaction key.)
    let planner_config: Option<Config> = if planner_enabled {
        Some(config.clone())
    } else {
        None
    };

    // Clone the system prompt now so we can hand it to the Sophie evaluator
    // inside the spawn. `system_prompt` itself is mutated by the planner
    // (prepends a plan preamble) before it is sent to Gemini — we want the
    // base prompt, not the mutated one, so we capture a snapshot here.
    let evaluator_system_prompt = system_prompt.clone();
    // The user's message is also needed inside the evaluator spawn. `req`
    // is moved into the streaming closure below; capture a copy first.
    let evaluator_user_msg = req.message.clone();
    // Platform Gemini key — same key Sophie itself uses. Captured here so
    // the spawn closure can move it.
    let evaluator_api_key = api_key.clone();
    // Session id is Copy-safe (it's a TimeUuid wrapper); capture it so the
    // evaluator spawn can attach its verdict event to the same session.
    let evaluator_session_id = session_id_opt;
    // Concurrency cap for the evaluator semaphore — passed through so Sophie
    // and user-facing evaluators share the same configured budget
    // (`EVALUATOR_MAX_CONCURRENT`), regardless of which spawner races to init
    // the OnceLock semaphore first.
    let evaluator_max_concurrent = config.evaluator_max_concurrent;

    // Create channel for SSE events
    let (tx, rx) = mpsc::channel::<Result<Event, Infallible>>(128);

    // Spawn streaming task
    tokio::spawn(async move {
        // Mutable rebinding so the S2.2 planner path (below) can prepend
        // the plan preamble to the system prompt before the Gemini call
        // is assembled. When the planner flag is off, this is a no-op —
        // the variable is the same string captured from the handler.
        let mut system_prompt = system_prompt;

        // T2.1 — log the user message as early as possible in the spawned
        // task so a downstream panic / early-return still leaves us a record
        // of the turn the user kicked off.
        if let Some(sid) = session_id_opt {
            crate::services::session::append_event(
                user_id,
                sid,
                crate::services::session::SessionEventType::UserMsg,
                serde_json::json!({ "content": session_user_msg }).to_string(),
            );
        }

        // S2.2 — optional Planner call. Runs BEFORE the Gemini generator
        // HTTP request so the plan can be prepended to the system prompt
        // as an advisory hint. Critically:
        //   * Planner failure (no API key, LLM error, unparseable JSON)
        //     logs a WARN and falls through to the single-call flow; the
        //     user-facing response is never degraded.
        //   * The plan is recorded in `session_events` as a `plan` event
        //     via the T2.1 mpsc, inspectable through
        //     `GET /api/baisync/session/:id`.
        //   * The planner runs on the platform `BAISYNC_API_KEY` (Gemini) —
        //     NEVER a user workspace key.
        if planner_enabled {
            if let Some(ref p_config) = planner_config {
                match crate::services::sophie_pipeline::run_planner(
                    p_config,
                    &api_key,
                    user_id,
                    &system_prompt,
                    &planner_history,
                    &planner_user_msg,
                )
                .await
                {
                    Ok(Some(plan)) => {
                        // Audit log: the plan is durable in session_events
                        // so QA can inspect the exact JSON the planner
                        // produced for a given session.
                        crate::services::sophie_pipeline::record_plan_event(
                            user_id,
                            session_id_opt,
                            &plan,
                        );
                        // Prepend the plan preamble to the system prompt.
                        // Keeps the plan structurally separate from the
                        // base Sophie prompt via the `[Plano antecipado]`
                        // header so the generator can recognise it.
                        let preamble =
                            crate::services::sophie_pipeline::format_plan_as_generator_preamble(
                                &plan,
                            );
                        let mut combined = String::with_capacity(
                            preamble.len() + system_prompt.len() + 4,
                        );
                        combined.push_str(&preamble);
                        combined.push_str("\n\n");
                        combined.push_str(&system_prompt);
                        system_prompt = combined;
                        tracing::info!(
                            event = "sophie.planner.applied",
                            step_count = plan.steps.len(),
                            "plan applied as generator preamble"
                        );
                    }
                    Ok(None) => {
                        tracing::debug!(
                            event = "sophie.planner.unavailable",
                            "planner returned no plan; continuing with single-call flow"
                        );
                    }
                    Err(e) => {
                        // Defensive: run_planner currently never returns
                        // an Err, but if a future refactor surfaces one
                        // we still want the generator path to run.
                        tracing::warn!(
                            event = "sophie.planner.error",
                            error = %e,
                            "planner errored; continuing with single-call flow"
                        );
                    }
                }
            }
        }

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
            "https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?alt=sse&key={}",
            gemini_model, api_key
        );

        // T1.3 + T2.2 — retry the initial POST (connect + response headers)
        // only. Retry is scoped to before SSE bytes flow; once we start
        // streaming `response.bytes_stream()` we never rewind. Retrying after
        // streaming began would surface duplicate tokens / duplicate events
        // to the Sophie UI — violates R1 (no retry after parsed response).
        let body_ref = &body;
        let url_ref = url.as_str();
        let (resp_outer, _outcome) = crate::services::llm::retry_http_post(
            "gemini_stream",
            std::time::Duration::from_secs(llm_timeout_secs),
            || {
                client
                    .post(url_ref)
                    .header("Content-Type", "application/json")
                    .json(body_ref)
                    .send()
            },
        )
        .await;
        let response = match resp_outer {
            Ok(r) => r,
            Err(e) => {
                let msg = match e {
                    crate::errors::AppError::InternalError(inner) if inner.contains("timeout") => {
                        format!(
                            "A chamada ao provider gemini excedeu {llm_timeout_secs}s. Tente resposta mais concisa ou reduza max_tokens."
                        )
                    }
                    crate::errors::AppError::InternalError(inner) => inner,
                    other => other.to_string(),
                };
                tracing::error!("Gemini request failed: {msg}");
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

        // Retry helper already returns a ready `reqwest::Response` on Ok, so
        // we flow directly into the SSE-streaming path without re-matching.
        {
            {
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
                // Track the max totalTokenCount seen across SSE frames — Gemini
                // updates this cumulatively and the last frame carries the
                // final tally for this turn.
                let mut total_tokens: i64 = 0;
                // Gemini thinking models include internal reasoning tokens in
                // totalTokenCount but these are NOT billed in the Gemini
                // dashboard. Track thoughtsTokenCount to subtract them so our
                // counter matches what Gemini actually charges.
                let mut thoughts_tokens: i64 = 0;

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
                                        // Record the running token tally whenever a
                                        // frame reports it. Some frames omit it; we
                                        // keep the highest seen.
                                        if let Some(t) =
                                            parsed["usageMetadata"]["totalTokenCount"].as_i64()
                                        {
                                            if t > total_tokens {
                                                total_tokens = t;
                                            }
                                        }
                                        if let Some(t) =
                                            parsed["usageMetadata"]["thoughtsTokenCount"].as_i64()
                                        {
                                            if t > thoughts_tokens {
                                                thoughts_tokens = t;
                                            }
                                        }
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

                // Post-stream: bill the tokens this turn consumed to the
                // user's hour-bucket counter.
                //
                // Primary path: Gemini's SSE frames report
                // `usageMetadata.totalTokenCount` cumulatively; we keep the
                // max seen.
                //
                // Fallback: when the stream completed with non-empty content
                // but no metadata (model variation, upstream format change,
                // or an early frame cutoff), we estimate tokens from the
                // user message + assistant reply char counts (1 token ≈ 4
                // chars). Without this fallback, `/usage` would stay at 0
                // for the whole session and the per-hour block would never
                // trip — the bug this commit fixes.
                let billed_tokens: i64 = if total_tokens > 0 {
                    // Subtract thinking tokens — they're included in totalTokenCount
                    // but Gemini doesn't bill them (the dashboard excludes them).
                    (total_tokens - thoughts_tokens).max(0)
                } else if !full_content.is_empty() {
                    let estimated = estimate_tokens_from_chars(
                        session_user_msg.chars().count(),
                        full_content.chars().count(),
                    );
                    tracing::warn!(
                        event = "baisync.usage_metadata_missing",
                        user_id = %user_id,
                        response_chars = full_content.chars().count(),
                        prompt_chars = session_user_msg.chars().count(),
                        estimated_tokens = estimated,
                        "Gemini SSE did not report usageMetadata; billing estimated tokens"
                    );
                    estimated
                } else {
                    0
                };
                tracing::info!(
                    event = "baisync.post_stream_billing",
                    user_id = %user_id,
                    total_tokens_reported = total_tokens,
                    thoughts_tokens = thoughts_tokens,
                    billed_tokens = billed_tokens,
                    response_chars = full_content.chars().count(),
                    "post-stream billing decision"
                );
                if billed_tokens > 0 {
                    increment_usage_tokens(&db, &user_id, billed_tokens).await;
                }
                let new_used = prior_used + billed_tokens;
                let pct = if limit > 0 {
                    (new_used as f64 / limit as f64) * 100.0
                } else {
                    0.0
                };

                // S1.2 — Log-only XML/JSON validation of baisync-action
                // payloads. Foundation for W2.1 evaluator. Must not touch
                // `full_content`, SSE events, or rate-limit state.
                validate_baisync_actions(&full_content);

                // T2.1 — record the final LLM message and close the session.
                // Both writes are fire-and-forget; if the drain isn't
                // installed (tests), they're silently dropped.
                if let Some(sid) = session_id_opt {
                    crate::services::session::append_event(
                        user_id,
                        sid,
                        crate::services::session::SessionEventType::LlmMsg,
                        serde_json::json!({ "content": full_content }).to_string(),
                    );
                    crate::services::session::update_status(
                        user_id,
                        sid,
                        "completed".to_string(),
                        None,
                    )
                    .await;
                }

                // W2.1 (Sophie) — post-turn evaluator, fire-and-forget.
                // Runs on the same BAISYNC_API_KEY that Sophie itself used,
                // with a cheap Gemini model. The spawn is completely
                // independent of the SSE stream above: the user has already
                // seen the full response by the time we enqueue this. No
                // compaction counterpart — Sophie history is ephemeral
                // frontend state.
                crate::services::evaluator::spawn_sophie_evaluation(
                    db.clone(),
                    evaluator_api_key.clone(),
                    user_id,
                    evaluator_session_id,
                    evaluator_user_msg.clone(),
                    full_content.clone(),
                    &evaluator_system_prompt,
                    evaluator_max_concurrent,
                );

                // Always emit the `rate_limit` SSE event so the frontend's
                // `rateLimit` store stays in sync without a separate
                // fetchRateLimit round-trip. `warning` is populated only
                // when we cross a threshold — the UI uses its presence to
                // decide whether to render the warning banner.
                let warning_msg = if pct >= 100.0 {
                    Some("Limite de tokens atingido. Tente novamente em breve.".to_string())
                } else if pct >= 90.0 {
                    Some(format!("Quase no limite! {}% dos tokens usados.", pct as i32))
                } else if pct >= 80.0 {
                    Some(format!("Atenção: {}% dos tokens usados.", pct as i32))
                } else if pct >= 60.0 {
                    Some(format!("{}% do limite de tokens usado.", pct as i32))
                } else {
                    None
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

                let _ = tx
                    .send(Ok(Event::default().event("done").data(
                        serde_json::json!({"content_length": full_content.len()}).to_string(),
                    )))
                    .await;
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
    let used = get_usage_tokens(&db, &auth_user.user_id).await;

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

    // 2. Baisync rate limit — current-hour token usage vs. configured limit.
    let used = get_usage_tokens(&db, &user_id).await;
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

// ─── S2.1 — Sophie session hydration endpoints ───────────────────────────────
//
// Two GET endpoints that let the frontend rebuild Sophie's chat history from
// the server instead of trusting localStorage as the source of truth. Both
// scope strictly to `auth_user.user_id`; no cross-tenant data escapes.
//
// Design notes:
//   - Sophie rows are identified by `assistant_id = Uuid::nil() AND
//     conversation_id = Uuid::nil()` (the sentinel convention set in T2.1).
//     We filter in memory after fetching the user's partition so the query
//     stays partition-key scoped (no ALLOW FILTERING).
//   - 30-day retention is a product promise, not a storage guarantee. The
//     `session_events` table has TTL 90 days; we let callers (the frontend)
//     decide what to surface.
//   - `get_session` reuses `services::session::get_events`, which enforces
//     both PK columns (`user_id` + `session_id`). An empty result is treated
//     as 404 to avoid session-id enumeration.

/// One row returned by `GET /api/baisync/sessions`. Fields are strings/ISO
/// for easy consumption by the frontend (no scylla types leak into the API).
#[derive(Serialize)]
pub struct SophieSessionSummary {
    pub session_id: String,
    pub status: String,
    pub checkpoint_at: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Serialize)]
pub struct ListSophieSessionsResponse {
    pub sessions: Vec<SophieSessionSummary>,
}

/// One event as surfaced by `GET /api/baisync/session/{session_id}`. The
/// `payload` is the raw JSON string the backend stored — the frontend is
/// responsible for parsing it per `event_type`.
#[derive(Serialize)]
pub struct SessionEventDto {
    pub event_id: String,
    pub event_type: String,
    pub payload: String,
    pub created_at: Option<String>,
}

#[derive(Serialize)]
pub struct SophieSessionResponse {
    pub session_id: String,
    pub events: Vec<SessionEventDto>,
}

/// How many Sophie sessions to return, newest-first.
const SOPHIE_SESSION_LIST_LIMIT: usize = 50;

/// True iff the `(conversation_id, assistant_id)` pair matches the Sophie
/// sentinel convention (`Uuid::nil()` on both). Extracted so the filter can be
/// unit-tested without needing a live Cassandra fixture.
fn is_sophie_session(conversation_id: Option<Uuid>, assistant_id: Option<Uuid>) -> bool {
    conversation_id.unwrap_or(Uuid::nil()) == Uuid::nil()
        && assistant_id.unwrap_or(Uuid::nil()) == Uuid::nil()
}

/// GET `/api/baisync/sessions`
///
/// Lists the authenticated user's most recent Sophie sessions. The query is
/// partition-key scoped (`WHERE user_id = ?`), and we filter in memory to
/// Sophie rows (`assistant_id == nil && conversation_id == nil`) so no
/// ALLOW FILTERING is needed. Returns at most `SOPHIE_SESSION_LIST_LIMIT`
/// entries, newest first (clustering order is already DESC on session_id).
pub async fn list_sessions(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<ListSophieSessionsResponse>, AppError> {
    let user_id = auth_user.user_id;

    // Over-fetch a bit so in-memory filtering (Sophie rows only) still
    // returns up to `SOPHIE_SESSION_LIST_LIMIT` Sophie sessions even if
    // non-Sophie rows are interleaved in the partition.
    let fetch_cap: i32 = (SOPHIE_SESSION_LIST_LIMIT as i32).saturating_mul(4);

    let result = db
        .query_unpaged(
            "SELECT session_id, conversation_id, assistant_id, status, checkpoint_at, created_at \
             FROM inertial_eclipse.sessions \
             WHERE user_id = ? LIMIT ?",
            (&user_id, fetch_cap),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    type SessionRow = (
        CqlTimeuuid,
        Option<Uuid>, // conversation_id
        Option<Uuid>, // assistant_id
        Option<String>, // status
        Option<DateTime<Utc>>, // checkpoint_at
        Option<DateTime<Utc>>, // created_at
    );

    let rows = result.into_rows_result()?;
    let mut sessions: Vec<SophieSessionSummary> = Vec::new();
    for row in rows.rows::<SessionRow>()?.flatten() {
        let (session_tuuid, conv_id, asst_id, status, checkpoint_at, created_at) = row;

        // Sophie rows use the nil uuid sentinel (set by baisync::chat when
        // creating a session — see T2.1). Any other value means this row
        // belongs to a user-created assistant, not Sophie.
        if !is_sophie_session(conv_id, asst_id) {
            continue;
        }

        let session_uuid: Uuid = Uuid::from_bytes(*session_tuuid.as_bytes());
        sessions.push(SophieSessionSummary {
            session_id: session_uuid.to_string(),
            status: status.unwrap_or_default(),
            checkpoint_at: checkpoint_at.map(|t| t.to_rfc3339()),
            created_at: created_at.map(|t| t.to_rfc3339()),
        });

        if sessions.len() >= SOPHIE_SESSION_LIST_LIMIT {
            break;
        }
    }

    Ok(Json(ListSophieSessionsResponse { sessions }))
}

/// GET `/api/baisync/session/{session_id}`
///
/// Returns the events belonging to a specific Sophie session. Scoped by the
/// authenticated `user_id` (via `services::session::get_events`, which
/// filters on the full `(user_id, session_id)` partition key). A session that
/// doesn't exist for this user returns 404 — indistinguishable from a session
/// that belongs to another tenant, so we don't leak existence across users.
pub async fn get_session(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(session_id): Path<Uuid>,
) -> Result<Json<SophieSessionResponse>, AppError> {
    let user_id = auth_user.user_id;

    // `get_events` scopes by `(user_id, session_id)`. If the session belongs
    // to another user or doesn't exist, we get an empty Vec — treat it as
    // 404 so we don't distinguish "no access" from "doesn't exist".
    let events = crate::services::session::get_events(&db, &user_id, &session_id).await?;

    if events.is_empty() {
        return Err(AppError::NotFound("session not found".into()));
    }

    let dto_events: Vec<SessionEventDto> = events
        .into_iter()
        .map(|e| SessionEventDto {
            event_id: e.event_id,
            event_type: e.event_type,
            payload: e.payload,
            created_at: e.created_at.map(|t| t.to_rfc3339()),
        })
        .collect();

    Ok(Json(SophieSessionResponse {
        session_id: session_id.to_string(),
        events: dto_events,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fallback token estimator: 1 token ≈ 4 chars, round up per side so a
    /// 3-char input counts as 1 token (not 0). Exercised by the Sophie chat
    /// handler when Gemini's SSE stream omits `usageMetadata.totalTokenCount`.
    #[test]
    fn test_estimate_tokens_from_chars() {
        // Zero chars → zero tokens.
        assert_eq!(estimate_tokens_from_chars(0, 0), 0);
        // 4 chars in each side → exactly 1 + 1 = 2 tokens.
        assert_eq!(estimate_tokens_from_chars(4, 4), 2);
        // Partial buckets round up (3 chars is 1 token, not 0).
        assert_eq!(estimate_tokens_from_chars(3, 0), 1);
        assert_eq!(estimate_tokens_from_chars(0, 3), 1);
        // Mixed: 5 chars → ceil(5/4) = 2, 7 chars → ceil(7/4) = 2, total 4.
        assert_eq!(estimate_tokens_from_chars(5, 7), 4);
        // Larger realistic values: 200-char question, 800-char reply.
        // ceil(200/4) + ceil(800/4) = 50 + 200 = 250 tokens.
        assert_eq!(estimate_tokens_from_chars(200, 800), 250);
    }

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
        const EXPECTED_LEN: usize = 17542;
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

    // ─── S2.1: Sophie session hydration filter ───────────────────────────
    //
    // The `list_sessions` handler filters the caller's `sessions` partition
    // in memory to Sophie rows (assistant_id = nil AND conversation_id = nil).
    // We can't unit-test the full handler without a live Cassandra fixture,
    // but we can cover the classification helper exhaustively here — which
    // is the tricky bit that decides whether a row is considered a Sophie
    // session or a user-assistant session.

    #[test]
    fn test_list_sophie_sessions_filter_by_assistant_nil() {
        let nil = Uuid::nil();
        let some_assistant = Uuid::new_v4();
        let some_conversation = Uuid::new_v4();

        // Both ids nil → Sophie row (the sentinel convention from T2.1).
        assert!(is_sophie_session(Some(nil), Some(nil)));
        // Absent columns (schema permits NULL on both) default to nil.
        assert!(is_sophie_session(None, None));
        assert!(is_sophie_session(Some(nil), None));
        assert!(is_sophie_session(None, Some(nil)));

        // Any non-nil on either side disqualifies the row.
        assert!(!is_sophie_session(Some(some_conversation), Some(nil)));
        assert!(!is_sophie_session(Some(nil), Some(some_assistant)));
        assert!(!is_sophie_session(Some(some_conversation), Some(some_assistant)));
        assert!(!is_sophie_session(None, Some(some_assistant)));
        assert!(!is_sophie_session(Some(some_conversation), None));
    }

    #[test]
    fn test_sophie_session_summary_serialization_shape() {
        // Pinning the response shape so frontend consumers don't break if
        // someone renames a field or changes the ISO format.
        let summary = SophieSessionSummary {
            session_id: "11111111-1111-1111-1111-111111111111".to_string(),
            status: "completed".to_string(),
            checkpoint_at: Some("2026-04-20T12:00:00+00:00".to_string()),
            created_at: Some("2026-04-20T11:59:00+00:00".to_string()),
        };
        let rendered = serde_json::to_value(&summary).expect("serialize");
        assert_eq!(rendered["session_id"], "11111111-1111-1111-1111-111111111111");
        assert_eq!(rendered["status"], "completed");
        assert_eq!(rendered["checkpoint_at"], "2026-04-20T12:00:00+00:00");
        assert_eq!(rendered["created_at"], "2026-04-20T11:59:00+00:00");

        // Null created_at / checkpoint_at surface as JSON null, not missing.
        let empty = SophieSessionSummary {
            session_id: "22222222-2222-2222-2222-222222222222".to_string(),
            status: "active".to_string(),
            checkpoint_at: None,
            created_at: None,
        };
        let rendered = serde_json::to_value(&empty).expect("serialize");
        assert!(rendered["checkpoint_at"].is_null());
        assert!(rendered["created_at"].is_null());
    }

    #[test]
    fn test_session_event_dto_serialization_shape() {
        let dto = SessionEventDto {
            event_id: "33333333-3333-3333-3333-333333333333".to_string(),
            event_type: "user_msg".to_string(),
            payload: r#"{"content":"oi"}"#.to_string(),
            created_at: Some("2026-04-20T12:00:00+00:00".to_string()),
        };
        let rendered = serde_json::to_value(&dto).expect("serialize");
        assert_eq!(rendered["event_id"], "33333333-3333-3333-3333-333333333333");
        assert_eq!(rendered["event_type"], "user_msg");
        // Payload must be surfaced as the raw string, not a parsed object —
        // the frontend is the parser.
        assert_eq!(rendered["payload"], r#"{"content":"oi"}"#);
        assert_eq!(rendered["created_at"], "2026-04-20T12:00:00+00:00");
    }
}
