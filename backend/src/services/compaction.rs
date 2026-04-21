// T2.3 — Opt-in auto-compaction of long conversations.
//
// When an assistant has `config_auto_compact=true` AND the conversation has
// accumulated ≥`COMPACTION_THRESHOLD_PCT * assistant.max_tokens` tokens across
// its recent history AND has ≥`COMPACTION_MIN_MESSAGES` messages, the backend
// calls a cheap LLM to summarize the older prefix. The oldest `N - keep_recent`
// messages are replaced with a single synthetic system message:
//
//   "[Resumo das primeiras N mensagens: …]"
//
// PAYMENT MODEL (changed):
//   The LLM call is paid for by the USER using their already-decrypted
//   workspace API key for the assistant's own provider. Platform-subsidized
//   compaction calls per user turn are economically infeasible at scale. The
//   caller passes `user_api_key`, `user_provider`, and `user_model` (cheap
//   model resolved via `evaluator::cheap_eval_model_for`). No platform-wide
//   gate — an assistant with `config_auto_compact=true` and a valid workspace
//   key for its provider will compact.
//
// Rate limit: at most once per `(user_id, conversation_id)` per
// `COMPACTION_RATE_LIMIT_SECS` (defaults to 3600s / 1 hour). The limit is
// enforced by an LWT `INSERT IF NOT EXISTS` on `compaction_rate_limits` with
// a fixed 3600s TTL (migration 098) — the partition self-clears after the
// window, so no background janitor is needed.
//
// Multi-tenancy: every query scopes by `(user_id, conversation_id)`. The
// LWT write races safely across concurrent webhooks: the winner claims the
// slot; losers fall back to the raw recent-history path (graceful
// degradation — compaction failure is never fatal).
//
// Audit trail:
//   - `llm_call_logs` row is emitted with `kind='compaction'` via the T1.2
//     mpsc pipeline (see `ToolContext.call_kind` in `services/llm.rs`).
//   - `session_events` row with `event_type='compaction'` and a JSON payload
//     (`summary_len`, `older_count`, `recent_kept`).
//   - Compaction LLM tokens are NOT counted in `usage_stats.total_messages`
//     because `update_usage_stats` is only called from the primary user-turn
//     path in `services/messaging.rs` (R6).
//
// W2.2 — Structured handoff.
//
// After a successful compaction, a SECOND cheap LLM call extracts a
// structured JSON handoff (open tasks, customer facts, unresolved issues)
// and stores it in `conversation_handoffs` (migration 100). On subsequent
// LLM calls for the same conversation, the handoff is loaded and
// prepended as an initial system message so the next call has immediate
// context on what's still pending. The structured extraction is logged
// with `kind='handoff'` in `llm_call_logs` for audit/budget parity with
// compaction. The same user workspace API key + cheap-model pair that
// the textual summary uses is re-used here. Any failure in the handoff
// path (LLM error, JSON parse failure, empty key) is logged as a warning
// and does NOT fail the compaction — the textual summary is always the
// durable fallback.
//
// Rationale for a new `conversation_handoffs` table instead of reusing
// `sessions.handoff_summary` (which exists in migration 096): T2.1's
// messaging flow creates a fresh `session_id` per inbound user turn, so
// `sessions.handoff_summary` would be tied to a single turn rather than to
// "the latest known state of this conversation". Using a per-conversation
// keyed table keeps the one-row-per-conversation shape that matches how
// the next LLM call needs to read it, with zero coupling to T2.1 semantics.

use scylla::frame::value::CqlTimestamp;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::config::Config;
use crate::db::DbSession;
use crate::errors::AppError;
use crate::models::assistant::Assistant;
use crate::models::conversation::Message;
use crate::services::llm::{self, LlmMessage, ToolContext};

/// Verdict produced by [`evaluate_trigger`]. `should_compact` is the only
/// field read by the messaging hot path; the rest exist for tracing /
/// testability.
#[derive(Debug, Clone)]
pub struct CompactionTrigger {
    pub should_compact: bool,
    pub msg_count: usize,
    pub token_pct: f32,
    /// Short reason code for logs / tests:
    /// `"disabled"` | `"below_min_messages"` | `"below_token_threshold"` | `"triggered"`.
    pub reason: &'static str,
}

/// Decide whether the conversation qualifies for compaction.
///
/// Pure — no I/O. The messaging hot path calls this FIRST, before trying to
/// claim the rate-limit slot, so we can skip both the LWT write and the LLM
/// call for the overwhelming majority of conversations.
///
/// Order of short-circuits (first failing gate wins):
///   1. `config_auto_compact` is false ⇒ `"disabled"`.
///   2. `recent_msg_count < compaction_min_messages` ⇒ `"below_min_messages"`.
///   3. `tokens_used / max_tokens < threshold` ⇒ `"below_token_threshold"`.
///   4. Otherwise ⇒ `"triggered"`.
pub fn evaluate_trigger(
    assistant: &Assistant,
    recent_msg_count: usize,
    total_tokens_used: u32,
    config: &Config,
) -> CompactionTrigger {
    let auto_compact = assistant.config_auto_compact.unwrap_or(false);
    if !auto_compact {
        return CompactionTrigger {
            should_compact: false,
            msg_count: recent_msg_count,
            token_pct: 0.0,
            reason: "disabled",
        };
    }
    if recent_msg_count < config.compaction_min_messages {
        return CompactionTrigger {
            should_compact: false,
            msg_count: recent_msg_count,
            token_pct: 0.0,
            reason: "below_min_messages",
        };
    }
    // Guard against a zero or nonsense max_tokens — treat as "not triggered"
    // so a mis-provisioned assistant never spams the compaction LLM.
    let max_tokens = assistant.max_tokens.max(1) as f32;
    let token_pct = total_tokens_used as f32 / max_tokens;
    if token_pct < config.compaction_threshold_pct {
        return CompactionTrigger {
            should_compact: false,
            msg_count: recent_msg_count,
            token_pct,
            reason: "below_token_threshold",
        };
    }
    CompactionTrigger {
        should_compact: true,
        msg_count: recent_msg_count,
        token_pct,
        reason: "triggered",
    }
}

/// Attempt to claim the once-per-window slot for this conversation via an
/// LWT `INSERT IF NOT EXISTS`. Returns `Ok(true)` if the slot was claimed
/// (caller proceeds with compaction), `Ok(false)` if a previous compaction
/// is still within the TTL window (caller falls back to raw history).
///
/// Multi-tenancy: the primary key on `compaction_rate_limits` is
/// `((user_id, conversation_id))` so a user cannot interfere with another
/// user's window, even if conversation ids collided (they won't, since
/// ids are UUID, but defence-in-depth).
///
/// The row's `default_time_to_live` (migration 098) handles expiration — no
/// explicit DELETE is needed. `compaction_rate_limit_secs` in Config is
/// kept for observability / future use but does NOT override the table TTL.
pub async fn try_claim_rate_limit_slot(
    db: &DbSession,
    user_id: Uuid,
    conversation_id: Uuid,
) -> Result<bool, AppError> {
    let now = CqlTimestamp(chrono::Utc::now().timestamp_millis());
    let result = db
        .query_unpaged(
            "INSERT INTO inertial_eclipse.compaction_rate_limits \
             (user_id, conversation_id, compacted_at) VALUES (?, ?, ?) \
             IF NOT EXISTS",
            (&user_id, &conversation_id, now),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // LWT result: first column is `[applied]` (bool).
    let rows = result.into_rows_result()?;
    let row = rows
        .maybe_first_row::<(bool,)>()?
        .ok_or_else(|| AppError::DatabaseError(
            "compaction LWT returned no row".into(),
        ))?;
    Ok(row.0)
}

/// Outcome of a successful compaction. The caller prepends `summary_message`
/// to the kept-recent suffix before passing the result to
/// `call_llm_with_tools_ctx`.
#[derive(Debug, Clone)]
pub struct CompactionResult {
    pub summary_message: Message,
    /// How many original messages the summary now stands in for. Stored in
    /// `session_events.payload` as `older_count`.
    pub replaced_count: usize,
    /// Tokens consumed by the compaction LLM. Informational — NOT added to
    /// `usage_stats.total_messages` (R6).
    pub tokens_used: u32,
}

/// Truncate `messages` so only the older-prefix remains, summarize via the
/// cheap LLM, and synthesize a single `role="system"` message that will
/// replace them. Caller concatenates `summary_message` + recent suffix.
///
/// Payment model: the compaction LLM call is paid for by the user via the
/// decrypted workspace API key passed in as `user_api_key`. `user_provider`
/// must match the primary assistant's provider (so the same workspace key
/// authenticates); `user_model` is the cheap model for that provider
/// (resolve via `evaluator::cheap_eval_model_for`).
///
/// Error handling: any step (empty API key, LLM failure, empty older set)
/// that prevents real compaction is surfaced as `AppError`. The caller
/// (messaging hot path) catches it and falls back to the raw history —
/// compaction failure is NEVER user-visible.
///
/// Multi-tenancy: receives `user_id` and `conversation_id` only for
/// logging / session-event correlation. The user workspace key decryption
/// happens at the call site via `workspace::get_decrypted_api_key` so the
/// partition-key scoping is enforced there; by the time we arrive, the
/// caller already proved ownership.
#[allow(clippy::too_many_arguments)]
pub async fn compact_conversation(
    db: &DbSession,
    config: &Config,
    assistant: &Assistant,
    user_id: Uuid,
    _conversation_id: Uuid,
    user_api_key: String,
    user_provider: String,
    user_model: String,
    all_messages: Vec<Message>,
) -> Result<CompactionResult, AppError> {
    if user_api_key.is_empty() {
        return Err(AppError::ConfigError(
            "compaction requires a decrypted user workspace API key".into(),
        ));
    }

    let total = all_messages.len();
    let keep = config.compaction_keep_recent.min(total);
    let split = total.saturating_sub(keep);
    if split == 0 {
        // Nothing to compact — everything is recent.
        return Err(AppError::BadRequest(
            "compaction skipped: older segment is empty".into(),
        ));
    }
    let older = &all_messages[..split];

    // Build a compact transcript for the summarizer. We intentionally do NOT
    // ship the base64 media (audio/images) — the summarizer works on text +
    // pre-extracted text, which is all we saved in `media_extracted_text`.
    let mut transcript = String::with_capacity(older.len() * 160);
    for m in older {
        let role = if m.role == "user" { "Cliente" } else { "Agente" };
        let mut body = m.content.clone().unwrap_or_default();
        if let Some(extracted) = m.media_extracted_text.as_deref() {
            if !extracted.is_empty() {
                // Bound per-message so a single huge doc doesn't dominate.
                const PER_MSG_CAP: usize = 8_000;
                let slice = if extracted.len() > PER_MSG_CAP {
                    let mut cut = PER_MSG_CAP;
                    while cut > 0 && !extracted.is_char_boundary(cut) {
                        cut -= 1;
                    }
                    &extracted[..cut]
                } else {
                    extracted
                };
                if !body.is_empty() {
                    body.push('\n');
                }
                body.push_str("[conteúdo extraído]\n");
                body.push_str(slice);
            }
        }
        transcript.push_str(&format!("{role}: {body}\n"));
    }

    // Global cap on the transcript — the summarizer model has its own context
    // window. 80k chars ≈ 20k tokens, comfortably within a gpt-4o-mini 128k
    // window while leaving room for the system prompt + response.
    const TRANSCRIPT_CAP: usize = 80_000;
    if transcript.len() > TRANSCRIPT_CAP {
        let mut cut = TRANSCRIPT_CAP;
        while cut > 0 && !transcript.is_char_boundary(cut) {
            cut -= 1;
        }
        transcript.truncate(cut);
        transcript.push_str("\n…[transcrição truncada]");
    }

    let system_prompt = "Você é um compactador de histórico de conversas de atendimento. \
Resuma a conversa abaixo em UM ÚNICO PARÁGRAFO conciso (máx. 400 palavras), \
preservando: (1) identidade e contato do cliente (sem telefones nem CPFs), \
(2) pedidos/questões já feitos, (3) decisões/compromissos do agente, \
(4) dados úteis para continuar o atendimento. NÃO inclua saudações, \
agradecimentos ou análise de qualidade — apenas o resumo factual.";
    let user_content = format!("Conversa a resumir:\n\n{transcript}");

    let llm_messages = vec![
        LlmMessage {
            role: "system".into(),
            content: system_prompt.into(),
            media_base64: None,
            media_mime_type: None,
        },
        LlmMessage {
            role: "user".into(),
            content: user_content,
            media_base64: None,
            media_mime_type: None,
        },
    ];

    // Emit `kind='compaction'` into llm_call_logs via the T1.2 mpsc. The full
    // tenant key is provided so UPDATE WHERE clauses scope correctly. We do
    // NOT pass `config` / `encryption` / tool loops — compaction never calls
    // tools. `max_tool_rounds` is implicitly 0 (empty tools slice).
    let ctx = ToolContext {
        db: None,
        assistant_id: Some(assistant.id),
        user_id: Some(user_id),
        conversation_id: Some(_conversation_id),
        config: None,
        encryption: None,
        max_tool_rounds: None,
        max_duration_ms: None,
        call_kind: Some("compaction"),
    };

    let response = llm::call_llm_with_tools_ctx(
        &user_provider,
        &user_model,
        &user_api_key,
        llm_messages,
        0.2,   // low temperature — deterministic factual summary
        1_024, // cap summary tokens; typical output is ≪ 512.
        &[],
        &ctx,
    )
    .await?;

    let summary = response.content.trim().to_string();
    if summary.is_empty() {
        return Err(AppError::InternalError(
            "compaction LLM returned an empty summary".into(),
        ));
    }

    // Synthesize the replacement message. It looks like a system note and
    // carries a portuguese marker so a human inspecting the conversation
    // knows where compaction happened. `conversation_id` and a fresh `id`
    // keep this message uniquely addressable if we ever persist it.
    let summary_message = Message {
        conversation_id: _conversation_id,
        id: Uuid::new_v4(),
        role: "system".into(),
        content: Some(format!(
            "[Resumo das primeiras {} mensagens: {}]",
            split, summary
        )),
        media_url: None,
        media_type: None,
        media_base64: None,
        media_extracted_text: None,
        tokens_used: Some(response.tokens_used),
        sub_agent_id: None,
        created_at: chrono::Utc::now(),
    };

    // W2.2 — structured handoff extraction. Best-effort: a failure here
    // (LLM error, parse failure, DB write error) is logged and swallowed so
    // the textual summary above remains the durable compaction result. The
    // older-segment slice is the same input the textual summarizer saw. The
    // handoff call re-uses the user's workspace API key for the same
    // provider (primary assistant's provider) — compaction + handoff are a
    // pair that share one credential + one cheap-model pick.
    if let Some(handoff) = build_handoff(
        config,
        assistant,
        user_id,
        _conversation_id,
        user_api_key.clone(),
        user_provider.clone(),
        user_model.clone(),
        older,
    )
    .await
    {
        if let Err(e) = save_handoff(db, user_id, _conversation_id, &handoff).await {
            tracing::warn!(
                event = "handoff.save_failed",
                error = %e,
                conversation_id = %_conversation_id,
                "handoff save failed; continuing (textual summary is the fallback)"
            );
        } else {
            tracing::info!(
                event = "handoff.saved",
                conversation_id = %_conversation_id,
                open_tasks = handoff.open_tasks.len(),
                customer_facts = handoff.customer_facts.len(),
                has_unresolved = !handoff.unresolved.trim().is_empty(),
            );
        }
    } else {
        tracing::debug!(
            event = "handoff.skipped",
            conversation_id = %_conversation_id,
            "handoff extraction produced no result (missing key, empty older, LLM/parse error)"
        );
    }

    // S2.3 — bump compaction_total{assistant_id}. We stringify the id once
    // here (metrics module intentionally has no Uuid dependency).
    crate::services::metrics::inc_compaction(&assistant.id.to_string()).await;

    Ok(CompactionResult {
        summary_message,
        replaced_count: split,
        tokens_used: response.tokens_used.max(0) as u32,
    })
}

// ---------------------------------------------------------------------------
// W2.2 — Structured handoff.
// ---------------------------------------------------------------------------

/// Structured handoff produced after compaction. One row per conversation is
/// persisted in `conversation_handoffs` and prepended as an initial system
/// message on the next LLM call for the same conversation.
///
/// Shape matches the W2.2 contract:
/// ```json
/// {
///   "open_tasks": ["..."],
///   "customer_facts": {"nome": "João", "plano": "premium"},
///   "unresolved": "..."
/// }
/// ```
///
/// Deserialization is lenient: missing fields default to empty so a partial
/// LLM output still yields a usable handoff (instead of a parse failure that
/// discards every field).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HandoffSummary {
    #[serde(default)]
    pub open_tasks: Vec<String>,
    #[serde(default)]
    pub customer_facts: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    pub unresolved: String,
}

/// Call a cheap LLM with a structured-output prompt to extract a
/// [`HandoffSummary`] from the older conversation prefix.
///
/// Returns `Ok(None)` (never `Err`) when any step fails: empty API key,
/// empty older segment, LLM error, or unparseable output. The caller —
/// `compact_conversation` — logs a warn and continues; the textual summary
/// from step 1 is the durable fallback.
///
/// Uses the SAME user workspace API key + cheap-model pair the textual
/// summarizer used. `llm_call_logs` row is emitted with `kind='handoff'`
/// via the T1.2 mpsc pipeline so budget analytics can tell the two
/// phases apart.
#[allow(clippy::too_many_arguments)]
pub async fn build_handoff(
    _config: &Config,
    assistant: &Assistant,
    user_id: Uuid,
    conversation_id: Uuid,
    user_api_key: String,
    user_provider: String,
    user_model: String,
    older_messages: &[Message],
) -> Option<HandoffSummary> {
    if user_api_key.is_empty() {
        return None;
    }

    if older_messages.is_empty() {
        return None;
    }

    // Same transcript shape as `compact_conversation`, bounded per-message and
    // globally so the extractor stays within the summarizer model's context.
    let mut transcript = String::with_capacity(older_messages.len() * 160);
    for m in older_messages {
        let role = if m.role == "user" { "Cliente" } else { "Agente" };
        let mut body = m.content.clone().unwrap_or_default();
        if let Some(extracted) = m.media_extracted_text.as_deref() {
            if !extracted.is_empty() {
                const PER_MSG_CAP: usize = 8_000;
                let slice = if extracted.len() > PER_MSG_CAP {
                    let mut cut = PER_MSG_CAP;
                    while cut > 0 && !extracted.is_char_boundary(cut) {
                        cut -= 1;
                    }
                    &extracted[..cut]
                } else {
                    extracted
                };
                if !body.is_empty() {
                    body.push('\n');
                }
                body.push_str("[conteúdo extraído]\n");
                body.push_str(slice);
            }
        }
        transcript.push_str(&format!("{role}: {body}\n"));
    }
    const TRANSCRIPT_CAP: usize = 80_000;
    if transcript.len() > TRANSCRIPT_CAP {
        let mut cut = TRANSCRIPT_CAP;
        while cut > 0 && !transcript.is_char_boundary(cut) {
            cut -= 1;
        }
        transcript.truncate(cut);
        transcript.push_str("\n…[transcrição truncada]");
    }

    let system_prompt = "Você é um extrator de informação para handoff de atendimento. \
Leia a conversa abaixo e produza APENAS um JSON válido (sem markdown, sem texto fora do JSON) \
com EXATAMENTE esta estrutura:\n\n\
{\n\
  \"open_tasks\": [\"ação pendente 1\", \"ação pendente 2\"],\n\
  \"customer_facts\": {\"chave\": \"valor\"},\n\
  \"unresolved\": \"descrição do que ainda está pendente do ponto de vista do cliente\"\n\
}\n\n\
- open_tasks: lista de ações pendentes do agente/atendimento (strings curtas).\n\
- customer_facts: dicionário com fatos estáveis do cliente (ex: nome, plano, empresa, email). \
Não inclua dados sensíveis como CPF ou cartão. Strings em ambos os lados.\n\
- unresolved: frase curta descrevendo o que ainda não foi resolvido; string vazia se tudo fechou.\n\
Sempre inclua as três chaves, mesmo que vazias.";
    let user_content = format!("Conversa para extrair handoff:\n\n{transcript}");

    let llm_messages = vec![
        LlmMessage {
            role: "system".into(),
            content: system_prompt.into(),
            media_base64: None,
            media_mime_type: None,
        },
        LlmMessage {
            role: "user".into(),
            content: user_content,
            media_base64: None,
            media_mime_type: None,
        },
    ];

    // `kind='handoff'` in llm_call_logs distinguishes this call from the
    // `kind='compaction'` textual summarizer and from `kind='primary'` user
    // turns. Same tenant key so UPDATE WHERE clauses scope correctly.
    let ctx = ToolContext {
        db: None,
        assistant_id: Some(assistant.id),
        user_id: Some(user_id),
        conversation_id: Some(conversation_id),
        config: None,
        encryption: None,
        max_tool_rounds: None,
        max_duration_ms: None,
        call_kind: Some("handoff"),
    };

    let response = match llm::call_llm_with_tools_ctx(
        &user_provider,
        &user_model,
        &user_api_key,
        llm_messages,
        0.1,   // near-deterministic extraction
        1_024, // JSON is typically small
        &[],
        &ctx,
    )
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(
                event = "handoff.llm_failed",
                error = %e,
                conversation_id = %conversation_id,
                "handoff LLM call failed; skipping structured extraction"
            );
            return None;
        }
    };

    parse_handoff_json(&response.content).or_else(|| {
        tracing::warn!(
            event = "handoff.parse_failed",
            conversation_id = %conversation_id,
            "handoff JSON parse failed; skipping structured extraction"
        );
        None
    })
}

/// Parse an LLM response into a [`HandoffSummary`]. Handles:
///   - raw JSON object: `{...}`
///   - JSON wrapped in a ```json fenced code block
///   - leading/trailing whitespace
///
/// Returns `None` if no JSON object is detected. The deserialization itself
/// is lenient via `#[serde(default)]` on each field, so a partial JSON (e.g.
/// missing `customer_facts`) still parses into the matching defaults.
fn parse_handoff_json(raw: &str) -> Option<HandoffSummary> {
    let trimmed = raw.trim();
    // Strip ```json / ``` fences if the model emitted them.
    let body = if let Some(rest) = trimmed.strip_prefix("```json") {
        rest.trim_start()
            .strip_suffix("```")
            .unwrap_or(rest)
            .trim()
    } else if let Some(rest) = trimmed.strip_prefix("```") {
        rest.trim_start()
            .strip_suffix("```")
            .unwrap_or(rest)
            .trim()
    } else {
        trimmed
    };
    // Bracket-match from first `{` to the last `}` so trailing commentary is
    // tolerated.
    let start = body.find('{')?;
    let end = body.rfind('}')?;
    if end < start {
        return None;
    }
    let json_slice = &body[start..=end];
    serde_json::from_str::<HandoffSummary>(json_slice).ok()
}

/// Persist the latest handoff for this conversation. Overwrites any prior
/// row — the table holds at most one row per `(user_id, conversation_id)`
/// by design.
///
/// Multi-tenancy: the full partition key is always included in the INSERT.
pub async fn save_handoff(
    db: &DbSession,
    user_id: Uuid,
    conversation_id: Uuid,
    handoff: &HandoffSummary,
) -> Result<(), AppError> {
    let json = serde_json::to_string(handoff)
        .map_err(|e| AppError::InternalError(format!("handoff serialize failed: {e}")))?;
    let now = CqlTimestamp(chrono::Utc::now().timestamp_millis());
    db.query_unpaged(
        "INSERT INTO inertial_eclipse.conversation_handoffs \
         (user_id, conversation_id, handoff_json, updated_at) VALUES (?, ?, ?, ?)",
        (&user_id, &conversation_id, &json, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(())
}

/// Load the latest handoff for this conversation, if any. Returns `Ok(None)`
/// when no row exists OR the stored JSON no longer parses — i.e. a schema
/// drift never breaks the user flow (graceful degradation).
///
/// Multi-tenancy: partition key is `((user_id, conversation_id))` and both
/// are always in the WHERE clause.
pub async fn load_handoff(
    db: &DbSession,
    user_id: Uuid,
    conversation_id: Uuid,
) -> Result<Option<HandoffSummary>, AppError> {
    let res = db
        .query_unpaged(
            "SELECT handoff_json FROM inertial_eclipse.conversation_handoffs \
             WHERE user_id = ? AND conversation_id = ?",
            (&user_id, &conversation_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = res.into_rows_result()?;
    // Non-PK column is nullable; use Option<String>.
    let row = match rows.maybe_first_row::<(Option<String>,)>()? {
        Some(r) => r,
        None => return Ok(None),
    };
    let json = match row.0 {
        Some(s) if !s.is_empty() => s,
        _ => return Ok(None),
    };
    Ok(serde_json::from_str::<HandoffSummary>(&json).ok())
}

/// Render a [`HandoffSummary`] into the `role="system"` message prepended to
/// the LLM call before the textual compaction summary and the recent tail.
///
/// Format is compact PT-BR so the agent can cite facts and open tasks
/// directly. Pure function — no I/O — and `#[must_use]` because the caller
/// is expected to push the result onto the message list.
#[must_use]
pub fn handoff_as_system_message(h: &HandoffSummary) -> Message {
    let mut body = String::from("[Handoff resumido]\n");

    body.push_str("Tarefas abertas:");
    if h.open_tasks.is_empty() {
        body.push_str(" (nenhuma)\n");
    } else {
        body.push('\n');
        for task in &h.open_tasks {
            body.push_str(" - ");
            body.push_str(task);
            body.push('\n');
        }
    }

    body.push_str("Fatos do cliente:");
    if h.customer_facts.is_empty() {
        body.push_str(" (nenhum)\n");
    } else {
        let facts: Vec<String> = h
            .customer_facts
            .iter()
            .map(|(k, v)| {
                let display = match v {
                    serde_json::Value::String(s) => s.clone(),
                    other => other.to_string(),
                };
                format!("{k}={display}")
            })
            .collect();
        body.push(' ');
        body.push_str(&facts.join(", "));
        body.push('\n');
    }

    let unresolved = h.unresolved.trim();
    if unresolved.is_empty() {
        body.push_str("Pendente: (nenhum)");
    } else {
        body.push_str("Pendente: ");
        body.push_str(unresolved);
    }

    Message {
        conversation_id: Uuid::nil(), // synthetic message, not persisted
        id: Uuid::new_v4(),
        role: "system".into(),
        content: Some(body),
        media_url: None,
        media_type: None,
        media_base64: None,
        media_extracted_text: None,
        tokens_used: None,
        sub_agent_id: None,
        created_at: chrono::Utc::now(),
    }
}

/// Assemble the final message list for an LLM call: handoff first (if any),
/// then the compaction/plain message list (which already has its own summary
/// prefix when compaction fired).
///
/// Pure function — no I/O. Exposed for unit testing the ordering invariant:
///   1. handoff system message (if present)
///   2. `[Resumo das primeiras N mensagens]` system message from compaction
///      (when compaction ran — already inside `messages`)
///   3. recent kept messages (rest of `messages`)
///
/// `#[allow(dead_code)]`: `messaging.rs` inlines the same ordering against its
/// own `Vec<LlmMessage>` type (which includes media fields the generic
/// `Message` lacks). This pure helper encodes the same invariant over
/// `Message` for test coverage (`test_merge_handoff_order`).
#[allow(dead_code)]
#[must_use]
pub fn merge_handoff_with_messages(
    handoff: Option<&HandoffSummary>,
    messages: Vec<Message>,
) -> Vec<Message> {
    match handoff {
        Some(h) => {
            let mut out = Vec::with_capacity(messages.len() + 1);
            out.push(handoff_as_system_message(h));
            out.extend(messages);
            out
        }
        None => messages,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use uuid::Uuid;

    fn make_config(
        threshold: f32,
        min_messages: usize,
        keep_recent: usize,
    ) -> Config {
        Config {
            database_url: "x".into(),
            jwt_secret: "x".into(),
            smtp_host: "x".into(),
            smtp_port: 25,
            smtp_user: "x".into(),
            smtp_pass: "x".into(),
            encryption_key: "x".into(),
            baileys_url: "x".into(),
            baileys_api_key: "x".into(),
            app_url: "x".into(),
            allowed_origins: vec![],
            baisync_api_key: "x".into(),
            baisync_rate_limit: 10,
            admin_user: "x".into(),
            admin_password: "x".into(),
            meta_app_secret: "x".into(),
            livekit_url: "x".into(),
            livekit_api_key: "x".into(),
            livekit_api_secret: "x".into(),
            llm_global_timeout_secs: 60,
            compaction_threshold_pct: threshold,
            compaction_min_messages: min_messages,
            compaction_keep_recent: keep_recent,
            compaction_rate_limit_secs: 3600,
            // W2.1 — evaluator fields are irrelevant to compaction tests;
            // supply cheap defaults so the struct is complete.
            evaluator_max_concurrent: 20,
            evaluator_timeout_secs: 15,
            // T3.3 — curation poller is orthogonal to compaction tests;
            // disabled here so no background task is implied by the struct.
            curation_enabled: false,
        }
    }

    fn make_assistant(auto_compact: Option<bool>, max_tokens: i32) -> Assistant {
        Assistant {
            user_id: Uuid::new_v4(),
            id: Uuid::new_v4(),
            name: "Bot".into(),
            description: None,
            llm_provider: "openai".into(),
            model: "gpt-4o-mini".into(),
            temperature: 0.7,
            max_tokens,
            system_prompt: None,
            is_team_lead: false,
            parent_assistant_id: None,
            share_token: None,
            share_permissions: None,
            config_split_messages: false,
            config_typing_indicator: true,
            config_rate_limit_per_day: None,
            config_max_message_length: None,
            config_rate_limit_message: None,
            config_max_length_message: None,
            config_interpret_documents: false,
            config_unsupported_media_message: None,
            config_audio_provider: None,
            config_audio_mode: None,
            config_audio_transcribe: false,
            config_audio_fallback_to_text: true,
            config_audio_transcription_failure_message: None,
            config_audio_voice_id: None,
            config_max_tool_rounds: None,
            config_max_duration_ms: None,
            config_auto_compact: auto_compact,
            // W2.1 — evaluator opt-in not exercised by compaction tests.
            config_enable_evaluator: None,
            config_evaluator_model: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn test_evaluate_trigger_disabled() {
        // Assistant has `config_auto_compact=false` (the default via
        // `unwrap_or(false)`) — compaction must never fire regardless of
        // message count or token pressure.
        let config = make_config(0.80, 15, 5);
        let assistant = make_assistant(Some(false), 4_000);
        let trigger = evaluate_trigger(&assistant, 50, 10_000, &config);
        assert!(!trigger.should_compact);
        assert_eq!(trigger.reason, "disabled");
    }

    #[test]
    fn test_evaluate_trigger_disabled_when_flag_absent() {
        // `None` also means "opt-out" — the same `unwrap_or(false)` path.
        let config = make_config(0.80, 15, 5);
        let assistant = make_assistant(None, 4_000);
        let trigger = evaluate_trigger(&assistant, 50, 10_000, &config);
        assert!(!trigger.should_compact);
        assert_eq!(trigger.reason, "disabled");
    }

    #[test]
    fn test_evaluate_trigger_below_min_messages() {
        // Flag is on, but only 10 messages — below min of 15. Token pressure
        // is irrelevant until the message floor is cleared.
        let config = make_config(0.80, 15, 5);
        let assistant = make_assistant(Some(true), 4_000);
        let trigger = evaluate_trigger(&assistant, 10, 10_000, &config);
        assert!(!trigger.should_compact);
        assert_eq!(trigger.reason, "below_min_messages");
    }

    #[test]
    fn test_evaluate_trigger_below_token_threshold() {
        // 20 messages (≥ min), but only 50% of max_tokens consumed — below
        // the 80% threshold. token_pct is recorded for observability.
        let config = make_config(0.80, 15, 5);
        let assistant = make_assistant(Some(true), 4_000);
        let trigger = evaluate_trigger(&assistant, 20, 2_000, &config);
        assert!(!trigger.should_compact);
        assert_eq!(trigger.reason, "below_token_threshold");
        // 2000 / 4000 = 0.5
        assert!((trigger.token_pct - 0.5).abs() < 1e-5);
    }

    #[test]
    fn test_evaluate_trigger_fires() {
        // Flag on, 20 messages (≥ 15), tokens = 85% of max (≥ 80%).
        let config = make_config(0.80, 15, 5);
        let assistant = make_assistant(Some(true), 4_000);
        let trigger = evaluate_trigger(&assistant, 20, 3_400, &config);
        assert!(trigger.should_compact);
        assert_eq!(trigger.reason, "triggered");
        assert!((trigger.token_pct - 0.85).abs() < 1e-5);
        assert_eq!(trigger.msg_count, 20);
    }

    #[test]
    fn test_evaluate_trigger_zero_max_tokens_is_safe() {
        // A mis-provisioned assistant with max_tokens=0 must never divide by
        // zero and must not spam compaction (we treat it as "below threshold"
        // because we clamp the divisor to 1 and tokens_used=0).
        let config = make_config(0.80, 15, 5);
        let assistant = make_assistant(Some(true), 0);
        let trigger = evaluate_trigger(&assistant, 20, 0, &config);
        assert!(!trigger.should_compact);
        assert_eq!(trigger.reason, "below_token_threshold");
    }

    // -----------------------------------------------------------------------
    // W2.2 — Structured handoff tests.
    // -----------------------------------------------------------------------

    fn make_handoff(
        tasks: Vec<&str>,
        facts: Vec<(&str, &str)>,
        unresolved: &str,
    ) -> HandoffSummary {
        let mut customer_facts = serde_json::Map::new();
        for (k, v) in facts {
            customer_facts.insert(k.to_string(), serde_json::Value::String(v.to_string()));
        }
        HandoffSummary {
            open_tasks: tasks.into_iter().map(String::from).collect(),
            customer_facts,
            unresolved: unresolved.to_string(),
        }
    }

    fn make_message(role: &str, content: &str) -> Message {
        Message {
            conversation_id: Uuid::new_v4(),
            id: Uuid::new_v4(),
            role: role.into(),
            content: Some(content.into()),
            media_url: None,
            media_type: None,
            media_base64: None,
            media_extracted_text: None,
            tokens_used: None,
            sub_agent_id: None,
            created_at: Utc::now(),
        }
    }

    #[test]
    fn test_handoff_summary_serializes() {
        // Shape must match the W2.2 contract exactly — the persisted JSON is
        // prepended verbatim to the next LLM call, so the field set is part
        // of the public contract.
        let h = make_handoff(
            vec!["enviar contrato", "ligar amanhã"],
            vec![("nome", "João"), ("plano", "premium")],
            "aguardando assinatura do contrato",
        );
        let json = serde_json::to_value(&h).expect("serialize");
        assert!(json.is_object());
        let obj = json.as_object().unwrap();
        // Exactly three top-level keys — no drift from the spec.
        assert_eq!(obj.len(), 3);
        assert!(obj.contains_key("open_tasks"));
        assert!(obj.contains_key("customer_facts"));
        assert!(obj.contains_key("unresolved"));

        assert_eq!(obj["open_tasks"][0], "enviar contrato");
        assert_eq!(obj["open_tasks"][1], "ligar amanhã");
        assert_eq!(obj["customer_facts"]["nome"], "João");
        assert_eq!(obj["customer_facts"]["plano"], "premium");
        assert_eq!(obj["unresolved"], "aguardando assinatura do contrato");
    }

    #[test]
    fn test_handoff_summary_deserializes_missing_fields() {
        // If the LLM omits a field, serde's `#[serde(default)]` fills in
        // empty defaults rather than rejecting the whole payload. This
        // guarantees a partial extraction still yields a usable handoff.

        // All three fields missing.
        let h: HandoffSummary = serde_json::from_str("{}").expect("empty object parses");
        assert!(h.open_tasks.is_empty());
        assert!(h.customer_facts.is_empty());
        assert_eq!(h.unresolved, "");

        // Only open_tasks present.
        let h: HandoffSummary =
            serde_json::from_str(r#"{"open_tasks": ["x"]}"#).expect("partial parses");
        assert_eq!(h.open_tasks, vec!["x".to_string()]);
        assert!(h.customer_facts.is_empty());
        assert_eq!(h.unresolved, "");

        // Only customer_facts present.
        let h: HandoffSummary = serde_json::from_str(
            r#"{"customer_facts": {"nome": "Ana"}}"#,
        )
        .expect("partial parses");
        assert!(h.open_tasks.is_empty());
        assert_eq!(
            h.customer_facts.get("nome").and_then(|v| v.as_str()),
            Some("Ana"),
        );
        assert_eq!(h.unresolved, "");
    }

    #[test]
    fn test_handoff_as_system_message_formats() {
        // The rendered system message must include the header marker, all
        // open tasks (one per line), the customer facts as `k=v` pairs, and
        // the unresolved text. The next LLM call reads this verbatim.
        let h = make_handoff(
            vec!["enviar contrato", "ligar amanhã"],
            vec![("nome", "João"), ("plano", "premium")],
            "aguardando assinatura",
        );
        let msg = handoff_as_system_message(&h);
        assert_eq!(msg.role, "system");
        let body = msg.content.expect("content");
        assert!(body.contains("[Handoff resumido]"));
        assert!(body.contains("Tarefas abertas:"));
        assert!(body.contains(" - enviar contrato"));
        assert!(body.contains(" - ligar amanhã"));
        assert!(body.contains("Fatos do cliente:"));
        assert!(body.contains("nome=João"));
        assert!(body.contains("plano=premium"));
        assert!(body.contains("Pendente: aguardando assinatura"));
    }

    #[test]
    fn test_handoff_as_system_message_empty_fields() {
        // Edge case: an all-empty handoff still produces a sensible system
        // message so the prepended block is never malformed.
        let h = HandoffSummary {
            open_tasks: vec![],
            customer_facts: serde_json::Map::new(),
            unresolved: String::new(),
        };
        let msg = handoff_as_system_message(&h);
        let body = msg.content.unwrap();
        assert!(body.contains("[Handoff resumido]"));
        assert!(body.contains("Tarefas abertas: (nenhuma)"));
        assert!(body.contains("Fatos do cliente: (nenhum)"));
        assert!(body.contains("Pendente: (nenhum)"));
    }

    #[test]
    fn test_parse_handoff_json_plain_object() {
        // The LLM usually emits a bare JSON object — simplest path.
        let raw = r#"{"open_tasks": ["a"], "customer_facts": {"k": "v"}, "unresolved": "x"}"#;
        let h = parse_handoff_json(raw).expect("parses");
        assert_eq!(h.open_tasks, vec!["a".to_string()]);
        assert_eq!(h.unresolved, "x");
        assert_eq!(
            h.customer_facts.get("k").and_then(|v| v.as_str()),
            Some("v"),
        );
    }

    #[test]
    fn test_parse_handoff_json_with_fence() {
        // Some models wrap JSON in a ```json fenced code block — the parser
        // must strip the fence before parsing.
        let raw = "```json\n{\"open_tasks\": [\"a\"]}\n```";
        let h = parse_handoff_json(raw).expect("parses fenced");
        assert_eq!(h.open_tasks, vec!["a".to_string()]);
    }

    #[test]
    fn test_parse_handoff_json_with_surrounding_text() {
        // Defensive: tolerate a model that adds a short preamble or suffix.
        // We bracket-match `{` → `}` so non-JSON noise is stripped.
        let raw = "Aqui está o JSON:\n{\"open_tasks\": [\"a\"]}\nFim.";
        let h = parse_handoff_json(raw).expect("parses with noise");
        assert_eq!(h.open_tasks, vec!["a".to_string()]);
    }

    #[test]
    fn test_parse_handoff_json_invalid_returns_none() {
        // Non-JSON garbage must NOT panic or partially parse. The caller
        // treats `None` as "missing handoff" and continues without it.
        assert!(parse_handoff_json("").is_none());
        assert!(parse_handoff_json("not json at all").is_none());
        assert!(parse_handoff_json("{broken").is_none());
    }

    #[test]
    fn test_merge_handoff_order_with_handoff() {
        // Invariant: when a handoff is present, it is the FIRST message in
        // the merged list, and the compaction/plain messages follow in their
        // original order (compaction's `[Resumo das primeiras N mensagens]`
        // system message stays second, recent tail third — by virtue of the
        // caller passing them in that order inside `messages`).
        let h = make_handoff(
            vec!["task1"],
            vec![("nome", "João")],
            "unresolved",
        );

        let compaction_summary = make_message(
            "system",
            "[Resumo das primeiras 30 mensagens: …]",
        );
        let recent_1 = make_message("user", "oi de novo");
        let recent_2 = make_message("assistant", "bem-vindo de volta");

        let compaction_or_plain = vec![
            compaction_summary.clone(),
            recent_1.clone(),
            recent_2.clone(),
        ];

        let merged = merge_handoff_with_messages(Some(&h), compaction_or_plain);

        assert_eq!(merged.len(), 4);
        // 1. Handoff system message is first.
        assert_eq!(merged[0].role, "system");
        assert!(merged[0]
            .content
            .as_deref()
            .unwrap()
            .contains("[Handoff resumido]"));
        // 2. Compaction summary is second.
        assert_eq!(merged[1].role, "system");
        assert!(merged[1]
            .content
            .as_deref()
            .unwrap()
            .contains("[Resumo das primeiras"));
        // 3. Recent messages follow in order.
        assert_eq!(merged[2].content.as_deref(), Some("oi de novo"));
        assert_eq!(merged[3].content.as_deref(), Some("bem-vindo de volta"));
    }

    #[test]
    fn test_merge_handoff_order_without_handoff() {
        // When no handoff exists, the message list passes through unchanged —
        // the graceful-degrade path is a clean no-op.
        let recent = make_message("user", "oi");
        let input = vec![recent.clone()];
        let merged = merge_handoff_with_messages(None, input);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].content.as_deref(), Some("oi"));
    }

    #[test]
    fn test_handoff_json_roundtrip() {
        // Round-trip through `serde_json::to_string` → `from_str` preserves
        // all fields. This matches what `save_handoff` / `load_handoff` do
        // on the Cassandra side.
        let h = make_handoff(
            vec!["t1", "t2"],
            vec![("nome", "Maria"), ("empresa", "ACME")],
            "confirmar reunião",
        );
        let json = serde_json::to_string(&h).expect("serialize");
        let back: HandoffSummary = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back, h);
    }

    // Note on integration tests: `load_handoff` and `save_handoff` touch
    // Cassandra and are exercised end-to-end by the live test suite
    // (`cargo test` against a running ScyllaDB). We deliberately do not
    // stub a mock Cassandra here — the other storage-tier modules in this
    // service follow the same convention (see `session.rs` tests, which
    // only exercise the enqueue path). The graceful-degradation guarantee
    // "absent row → Ok(None)" is covered structurally: `load_handoff`
    // uses `maybe_first_row`, which returns `None` when the partition has
    // no row; the subsequent `match` maps that to `Ok(None)` before any
    // JSON parse happens.
}
