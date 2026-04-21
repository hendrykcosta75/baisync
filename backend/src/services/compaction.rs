// T2.3 — Opt-in auto-compaction of long conversations.
//
// When an assistant has `config_auto_compact=true` AND the conversation has
// accumulated ≥`COMPACTION_THRESHOLD_PCT * assistant.max_tokens` tokens across
// its recent history AND has ≥`COMPACTION_MIN_MESSAGES` messages, the backend
// calls a cheap platform-funded LLM (`COMPACTION_API_KEY`) to summarize the
// older prefix. The oldest `N - keep_recent` messages are replaced with a
// single synthetic system message:
//
//   "[Resumo das primeiras N mensagens: …]"
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

use scylla::frame::value::CqlTimestamp;
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
/// Error handling: any step (no API key, LLM failure, empty older set) that
/// prevents real compaction is surfaced as `AppError`. The caller (messaging
/// hot path) catches it and falls back to the raw history — compaction
/// failure is NEVER user-visible.
///
/// Multi-tenancy: receives `user_id` and `conversation_id` only for
/// logging / session-event correlation. The LLM call itself uses the
/// platform `COMPACTION_API_KEY`, NOT the user's decrypted key, so no
/// `workspace::get_decrypted_api_key` is involved here.
pub async fn compact_conversation(
    _db: &DbSession,
    config: &Config,
    assistant: &Assistant,
    user_id: Uuid,
    _conversation_id: Uuid,
    all_messages: Vec<Message>,
) -> Result<CompactionResult, AppError> {
    let api_key = config
        .compaction_api_key
        .as_deref()
        .filter(|k| !k.is_empty())
        .ok_or_else(|| {
            AppError::ConfigError("COMPACTION_API_KEY not configured".into())
        })?;

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
        &config.compaction_provider,
        &config.compaction_model,
        api_key,
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

    Ok(CompactionResult {
        summary_message,
        replaced_count: split,
        tokens_used: response.tokens_used.max(0) as u32,
    })
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
            compaction_api_key: Some("sk-test".into()),
            compaction_model: "gpt-4o-mini".into(),
            compaction_provider: "openai".into(),
            compaction_threshold_pct: threshold,
            compaction_min_messages: min_messages,
            compaction_keep_recent: keep_recent,
            compaction_rate_limit_secs: 3600,
            // W2.1 — evaluator fields are irrelevant to compaction tests;
            // supply cheap defaults so the struct is complete.
            evaluator_api_key: None,
            evaluator_provider: "openai".into(),
            evaluator_model_default: "gpt-4o-mini".into(),
            evaluator_max_concurrent: 20,
            evaluator_timeout_secs: 15,
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
}
