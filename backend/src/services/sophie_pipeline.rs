// S2.2 — Sophie two-call pipeline (Planner + Generator).
//
// When the chat request carries the `?planner=true` query flag, Sophie runs
// through a cheap **planner** LLM call BEFORE the primary **generator** call.
// The planner reads the full system prompt + recent history + current user
// message and emits a structured JSON plan of up to three anticipated
// `baisync-action` steps. The generator then receives that plan prepended
// as an extra system-message hint and produces the actual user-visible reply
// over the existing SSE streaming path.
//
// Key design properties:
//
//   * **Advisory, never load-bearing**: the planner is a hint. Any failure
//     — missing API key, LLM error, timeout, unparseable JSON — is logged
//     at WARN and the handler silently falls through to the single-call
//     flow. Users never see a degraded response because of planner issues.
//
//   * **Shared platform key**: Sophie itself runs on the platform
//     `BAISYNC_API_KEY` (Gemini); the planner reuses that same key and a
//     cheap Gemini model. Sophie never touches a user workspace key — the
//     whole Sophie path is platform-funded (see `handlers::baisync::chat`).
//
//   * **Audit trail**: when a plan is produced it is appended to
//     `session_events` with `event_type='plan'` via the T2.1 mpsc. The
//     full JSON plan (strategy + steps) is the payload so operators can
//     inspect it via `GET /api/baisync/session/:id`.
//
//   * **Feature-gated**: the flag is parsed from the query string inside
//     `handlers::baisync::chat`. When absent, Sophie's behavior is
//     byte-identical to the pre-S2.2 flow — the planner code path is not
//     touched at all.
//
// Multi-tenancy: the planner itself performs NO database reads (the system
// prompt / history are passed in by the caller which already scoped them).
// The only DB write is through `append_event`, which uses the full
// `(user_id, session_id)` partition key of `session_events`. No cross-tenant
// path exists.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::config::Config;
use crate::services::llm::{self, LlmMessage, ToolContext};
use crate::services::session::{append_event, SessionEventType, SessionId};

/// One anticipated `baisync-action` step the planner proposes. The
/// `action` name must match one of the actions documented in the Sophie
/// system prompt — the planner is prompted to never invent new action
/// names. `confidence` is a self-reported hint; we neither enforce nor
/// reject values outside `[0.0, 1.0]` because the generator is free to
/// ignore the plan entirely.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlannedAction {
    pub action: String,
    pub rationale: String,
    pub confidence: f32,
}

/// Full plan returned by [`run_planner`]. `steps` is truncated to at most
/// three entries before being used as a generator preamble — the planner
/// prompt caps the count server-side so an over-long response doesn't
/// drown the generator context.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Plan {
    #[serde(default)]
    pub steps: Vec<PlannedAction>,
    #[serde(default)]
    pub overall_strategy: String,
}

/// Hard cap on the number of plan steps surfaced to the generator. Even if
/// the planner returns more, we silently truncate before the preamble is
/// built so the generator never sees an over-long list.
const MAX_PLAN_STEPS: usize = 3;

/// Hard cap on the planner's output token budget — the plan is tiny JSON
/// so 512 is plenty while keeping cost bounded.
const PLANNER_MAX_TOKENS: i32 = 512;

/// Keep the history snippet small so the planner prompt stays cheap. Five
/// turns is enough for local context without ballooning the token count.
const PLANNER_HISTORY_TAIL: usize = 5;

/// Per-history-message body cap so one huge pasted document doesn't
/// dominate the planner budget.
const PLANNER_MESSAGE_CAP: usize = 1_000;

/// Build the planner's user-role prompt. Pure function — no I/O — so it
/// can be unit-tested independently of any LLM call.
///
/// The prompt is PT-BR to match Sophie's conversational register. It
/// instructs the model to emit JSON ONLY, with a fixed top-level shape,
/// and to never invent new `baisync-action` names.
pub fn build_planner_prompt(
    system_prompt: &str,
    history_snippet: &str,
    user_message: &str,
) -> String {
    format!(
        "Você é o Planejador do Sophie. Seu trabalho: antecipar em ATÉ 3 passos quais \
\"baisync-action\" serão necessárias para atender o usuário, baseado no system prompt \
completo do Sophie e na mensagem atual.\n\
\n\
Retorne APENAS JSON válido, formato EXATO:\n\
{{\n\
  \"overall_strategy\": \"Descreva em 1-2 frases o que você pretende fazer\",\n\
  \"steps\": [\n\
    {{\"action\": \"nome_acao_1\", \"rationale\": \"por que\", \"confidence\": 0.0-1.0}}\n\
  ]\n\
}}\n\
\n\
Actions disponíveis são exatamente aquelas documentadas no system prompt. NÃO invente \
actions novas. Se o usuário pediu algo que não requer action (pergunta informativa), \
retorne \"steps\": [].\n\
\n\
--- SYSTEM PROMPT ---\n\
{system_prompt}\n\
\n\
--- ÚLTIMAS 5 MENSAGENS ---\n\
{history_snippet}\n\
\n\
--- MENSAGEM ATUAL ---\n\
{user_message}\n",
        system_prompt = system_prompt,
        history_snippet = history_snippet,
        user_message = user_message,
    )
}

/// Render the last-5 history tail into the compact `role: body` lines the
/// planner prompt expects. Each message body is bounded by
/// [`PLANNER_MESSAGE_CAP`] chars so a pasted document in a single turn
/// can't blow the token budget.
///
/// Pure function — exposed `pub` so the caller (chat handler) can build
/// the snippet directly from its own `BaisyncMessage` shape without
/// coupling this module to that type.
pub fn format_history_snippet(history: &[(String, String)]) -> String {
    let tail = if history.len() > PLANNER_HISTORY_TAIL {
        &history[history.len() - PLANNER_HISTORY_TAIL..]
    } else {
        history
    };
    let mut out = String::new();
    for (role, content) in tail {
        let role_label = match role.as_str() {
            "assistant" | "model" => "Sophie",
            "user" => "Usuário",
            other => other,
        };
        // Bound per-message body so one huge paste doesn't dominate.
        let body = if content.chars().count() > PLANNER_MESSAGE_CAP {
            // Char-based truncation so we don't split a multibyte char.
            let mut cut = 0usize;
            for (i, _) in content.char_indices().take(PLANNER_MESSAGE_CAP) {
                cut = i;
            }
            // Advance past the last complete char.
            if let Some((next_idx, _)) = content
                .char_indices()
                .find(|(i, _)| *i > cut)
            {
                cut = next_idx;
            } else {
                cut = content.len();
            }
            format!("{}…", &content[..cut])
        } else {
            content.clone()
        };
        out.push_str(&format!("{role_label}: {body}\n"));
    }
    if out.is_empty() {
        out.push_str("(sem histórico)\n");
    }
    out
}

/// Run the planner LLM call. Returns `Ok(None)` (never `Err`) whenever
/// anything prevents a usable plan from being produced — empty API key,
/// LLM error, timeout, unparseable output, or an empty steps array
/// combined with an empty strategy (nothing to prepend).
///
/// The caller — `handlers::baisync::chat` — treats `Ok(None)` as "plan
/// unavailable, proceed with the single-call flow". `api_key` is the
/// platform `BAISYNC_API_KEY` (same key Sophie's generator call uses);
/// the planner reuses it and a cheap Gemini model.
///
/// Multi-tenancy: the planner is a stateless LLM call. `user_id` is
/// threaded through for `ToolContext` so the `llm_call_logs` row scopes
/// correctly by the existing `((user_id, assistant_id), id)` partition key
/// (assistant_id = Uuid::nil() as Sophie uses the platform sentinel).
pub async fn run_planner(
    _config: &Config,
    api_key: &str,
    user_id: Uuid,
    system_prompt: &str,
    history: &[(String, String)],
    user_message: &str,
) -> Result<Option<Plan>, crate::errors::AppError> {
    // 1. Key check — fall through cleanly if BAISYNC_API_KEY is unset.
    if api_key.is_empty() {
        tracing::warn!(
            event = "sophie.planner.no_api_key",
            "planner requested but BAISYNC_API_KEY is empty; returning None \
             (falling back to single-call flow)"
        );
        return Ok(None);
    }
    let api_key = api_key.to_string();

    // 2. Build the prompt. The planner receives a SINGLE user-role message
    //    that embeds its own "system" instructions — this matches the
    //    evaluator pattern and keeps the call compatible with providers
    //    that enforce strict role ordering.
    let history_snippet = format_history_snippet(history);
    let prompt = build_planner_prompt(system_prompt, &history_snippet, user_message);

    let messages = vec![LlmMessage {
        role: "user".into(),
        content: prompt,
        media_base64: None,
        media_mime_type: None,
    }];

    // 3. ToolContext — Sophie is the platform agent, so `assistant_id`
    //    uses the nil-uuid sentinel (same as the session in the chat
    //    handler). `call_kind='planner'` keeps this call distinguishable
    //    from `primary` / `compaction` / `evaluator` rows in `llm_call_logs`.
    let ctx = ToolContext {
        db: None,
        assistant_id: Some(Uuid::nil()),
        user_id: Some(user_id),
        conversation_id: Some(Uuid::nil()),
        config: None,
        encryption: None,
        max_tool_rounds: None,
        max_duration_ms: None,
        call_kind: Some("planner"),
    };

    // 4. Execute — deterministic temperature, small token cap, no tools.
    //    Sophie's planner runs on the same Gemini key as the generator
    //    (BAISYNC_API_KEY). Use the cheap Gemini model.
    let provider = "gemini".to_string();
    let model = crate::services::evaluator::cheap_eval_model_for(&provider).to_string();

    let response = match llm::call_llm_with_tools_ctx(
        &provider,
        &model,
        &api_key,
        messages,
        0.1,
        PLANNER_MAX_TOKENS,
        &[],
        &ctx,
    )
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(
                event = "sophie.planner.llm_error",
                error = %e,
                "planner LLM call failed; continuing without plan"
            );
            return Ok(None);
        }
    };

    // 5. Parse — tolerant of markdown fences and surrounding prose.
    let mut plan = match parse_plan(&response.content) {
        Some(p) => p,
        None => {
            tracing::warn!(
                event = "sophie.planner.parse_error",
                raw = %response.content.chars().take(400).collect::<String>(),
                "planner response was not usable JSON; continuing without plan"
            );
            return Ok(None);
        }
    };

    // 6. Sanity trim: the prompt caps steps to 3, but defend against a
    //    noisy model that ignored the instruction.
    if plan.steps.len() > MAX_PLAN_STEPS {
        plan.steps.truncate(MAX_PLAN_STEPS);
    }

    // 7. Graceful no-op: an empty plan with no strategy tells the caller
    //    there's nothing useful to prepend. Treat as "no plan" rather
    //    than feeding the generator an empty preamble block.
    if plan.steps.is_empty() && plan.overall_strategy.trim().is_empty() {
        tracing::debug!(
            event = "sophie.planner.empty",
            "planner returned empty strategy + no steps; nothing to prepend"
        );
        return Ok(None);
    }

    Ok(Some(plan))
}

/// Parse the planner's raw LLM reply into a [`Plan`]. Mirrors
/// `compaction::parse_handoff_json` so the two structured-output paths
/// share the same "lenient JSON extraction" behavior.
///
/// Handles:
///   - raw JSON object: `{...}`
///   - JSON wrapped in a ```json / ``` fenced block
///   - JSON embedded in surrounding prose (bracket match `{` → last `}`)
///
/// Returns `None` if no JSON object can be recovered. Field-level
/// tolerance is provided by `#[serde(default)]` on [`Plan`] so a partial
/// LLM output (e.g. missing `overall_strategy`) still yields a usable
/// `Plan` instead of a parse failure.
pub fn parse_plan(raw: &str) -> Option<Plan> {
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
    serde_json::from_str::<Plan>(json_slice).ok()
}

/// Render a [`Plan`] into the system-message prefix that will be prepended
/// to the generator's contents. Format is compact PT-BR so Sophie's
/// existing system prompt style is preserved.
///
/// Pure function — `#[must_use]` because the caller is expected to
/// actually push the output into the contents array.
#[must_use]
pub fn format_plan_as_generator_preamble(plan: &Plan) -> String {
    let mut out = String::from("[Plano antecipado]\n");
    let strategy = plan.overall_strategy.trim();
    if strategy.is_empty() {
        out.push_str("Estratégia: (sem estratégia explícita)\n");
    } else {
        out.push_str("Estratégia: ");
        out.push_str(strategy);
        out.push('\n');
    }
    if plan.steps.is_empty() {
        out.push_str("(sem ações antecipadas — pergunta informativa)\n");
    } else {
        for (i, step) in plan.steps.iter().enumerate() {
            // 1-based index for readability in the model's context.
            out.push_str(&format!(
                "{}. action={} — {} (confiança {:.2})\n",
                i + 1,
                step.action,
                step.rationale,
                step.confidence,
            ));
        }
    }
    // Final note so the generator knows the plan is advisory.
    out.push_str(
        "Use o plano como referência; desvie se necessário. O plano é sugestão, não contrato.",
    );
    out
}

/// Fire-and-forget: append the plan to `session_events` with type `plan`.
/// Noops silently when `session_id` is `None` (session creation failed
/// upstream) — mirrors the pattern established in `handlers::baisync::chat`
/// for the UserMsg / LlmMsg events.
///
/// Payload is the JSON-serialized [`Plan`]; if serialization fails
/// (should never — plain struct) we write `{}` so the event still
/// records that a plan was produced.
pub fn record_plan_event(user_id: Uuid, session_id: Option<SessionId>, plan: &Plan) {
    let Some(sid) = session_id else {
        return;
    };
    let payload = serde_json::to_string(plan).unwrap_or_else(|_| "{}".into());
    append_event(user_id, sid, SessionEventType::Plan, payload);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_planner_prompt_includes_sections() {
        let p = build_planner_prompt(
            "You are Sophie, the platform agent.",
            "Usuário: oi\nSophie: olá",
            "liste meus assistentes",
        );
        // All three marker sections must be present.
        assert!(p.contains("--- SYSTEM PROMPT ---"));
        assert!(p.contains("--- ÚLTIMAS 5 MENSAGENS ---"));
        assert!(p.contains("--- MENSAGEM ATUAL ---"));
        // Interpolation happened.
        assert!(p.contains("You are Sophie, the platform agent."));
        assert!(p.contains("Usuário: oi"));
        assert!(p.contains("liste meus assistentes"));
        // Prompt instructs JSON output with the fixed shape.
        assert!(p.contains("APENAS JSON"));
        assert!(p.contains("overall_strategy"));
        assert!(p.contains("\"steps\""));
        assert!(p.contains("confidence"));
        // Guardrail wording is preserved.
        assert!(p.contains("NÃO invente"));
        assert!(p.contains("ATÉ 3 passos"));
    }

    #[test]
    fn test_parse_plan_valid() {
        // Plain JSON round-trips with all fields populated.
        let raw = r#"{
            "overall_strategy": "Listar assistentes e perguntar qual abrir",
            "steps": [
                {"action": "list_assistants", "rationale": "ver opções", "confidence": 0.9},
                {"action": "open_assistant", "rationale": "após escolha", "confidence": 0.5}
            ]
        }"#;
        let plan = parse_plan(raw).expect("valid JSON must parse");
        assert_eq!(
            plan.overall_strategy,
            "Listar assistentes e perguntar qual abrir"
        );
        assert_eq!(plan.steps.len(), 2);
        assert_eq!(plan.steps[0].action, "list_assistants");
        assert_eq!(plan.steps[0].rationale, "ver opções");
        assert!((plan.steps[0].confidence - 0.9).abs() < 1e-5);
        assert_eq!(plan.steps[1].action, "open_assistant");
        assert!((plan.steps[1].confidence - 0.5).abs() < 1e-5);
    }

    #[test]
    fn test_parse_plan_with_fence() {
        // LLMs frequently wrap JSON in ```json fenced blocks. The parser
        // must strip the fence before attempting to deserialize.
        let raw = "```json\n{\"overall_strategy\": \"x\", \"steps\": []}\n```";
        let plan = parse_plan(raw).expect("fenced JSON must parse");
        assert_eq!(plan.overall_strategy, "x");
        assert!(plan.steps.is_empty());
    }

    #[test]
    fn test_parse_plan_surrounded_by_prose() {
        // Defensive: tolerate preamble/suffix prose. Bracket-match from
        // the first `{` to the last `}` recovers the JSON island.
        let raw = "Claro, aqui está o plano:\n\
                   {\"overall_strategy\": \"strat\", \"steps\": [{\"action\": \"x\", \"rationale\": \"y\", \"confidence\": 0.7}]}\n\
                   Fim.";
        let plan = parse_plan(raw).expect("embedded JSON must parse");
        assert_eq!(plan.overall_strategy, "strat");
        assert_eq!(plan.steps.len(), 1);
        assert_eq!(plan.steps[0].action, "x");
    }

    #[test]
    fn test_parse_plan_invalid_returns_none() {
        // Empty input, missing braces, and garbage all return None without
        // panicking. The caller treats None as "no plan available".
        assert!(parse_plan("").is_none());
        assert!(parse_plan("not json at all").is_none());
        assert!(parse_plan("{broken").is_none());
        // Reversed braces — start > end.
        assert!(parse_plan("} {").is_none());
    }

    #[test]
    fn test_parse_plan_partial_fields_use_defaults() {
        // `#[serde(default)]` on Plan lets a partial payload parse with
        // empty defaults rather than failing hard. This keeps the planner
        // path resilient to a model that omits one field.
        let raw = r#"{"overall_strategy": "only strat"}"#;
        let plan = parse_plan(raw).expect("partial JSON parses via defaults");
        assert_eq!(plan.overall_strategy, "only strat");
        assert!(plan.steps.is_empty());

        let raw = r#"{"steps": [{"action": "a", "rationale": "r", "confidence": 0.1}]}"#;
        let plan = parse_plan(raw).expect("partial JSON parses via defaults");
        assert_eq!(plan.overall_strategy, "");
        assert_eq!(plan.steps.len(), 1);
    }

    #[test]
    fn test_format_plan_as_preamble() {
        // The rendered preamble must include the marker header, the
        // strategy line, and numbered steps with action / rationale /
        // confidence formatted to 2 decimals.
        let plan = Plan {
            overall_strategy: "Listar e escolher".to_string(),
            steps: vec![
                PlannedAction {
                    action: "list_assistants".to_string(),
                    rationale: "ver opções".to_string(),
                    confidence: 0.9,
                },
                PlannedAction {
                    action: "open_assistant".to_string(),
                    rationale: "após a escolha".to_string(),
                    confidence: 0.55,
                },
            ],
        };
        let rendered = format_plan_as_generator_preamble(&plan);
        assert!(rendered.starts_with("[Plano antecipado]"));
        assert!(rendered.contains("Estratégia: Listar e escolher"));
        // Numbered lines, 1-based.
        assert!(rendered.contains("1. action=list_assistants"));
        assert!(rendered.contains("2. action=open_assistant"));
        // Rationale + confidence surface in the same line.
        assert!(rendered.contains("— ver opções (confiança 0.90)"));
        assert!(rendered.contains("— após a escolha (confiança 0.55)"));
        // Advisory footer must be present so the generator knows the
        // plan is a hint, not a constraint.
        assert!(rendered.contains("desvie se necessário"));
    }

    #[test]
    fn test_format_plan_as_preamble_empty_steps() {
        // An informational-only plan (steps empty, strategy non-empty)
        // renders a sentinel line instead of leaving an empty numbered
        // block — the generator should see "(sem ações antecipadas …)".
        let plan = Plan {
            overall_strategy: "Só responder".to_string(),
            steps: vec![],
        };
        let rendered = format_plan_as_generator_preamble(&plan);
        assert!(rendered.contains("Estratégia: Só responder"));
        assert!(rendered.contains("(sem ações antecipadas"));
    }

    #[test]
    fn test_format_plan_as_preamble_empty_strategy() {
        // Strategy missing but steps present: we still emit the fallback
        // strategy sentinel so the rendered block is well-formed.
        let plan = Plan {
            overall_strategy: String::new(),
            steps: vec![PlannedAction {
                action: "a".into(),
                rationale: "r".into(),
                confidence: 0.1,
            }],
        };
        let rendered = format_plan_as_generator_preamble(&plan);
        assert!(rendered.contains("Estratégia: (sem estratégia explícita)"));
        assert!(rendered.contains("1. action=a"));
    }

    #[test]
    fn test_record_plan_event_noop_without_session() {
        // With no SessionId, record_plan_event must not panic and must not
        // touch any shared state (the session sender is never installed in
        // the test binary — mirrors test_append_event_drops_if_no_sender).
        let user_id = Uuid::new_v4();
        let plan = Plan {
            overall_strategy: "any".to_string(),
            steps: vec![],
        };
        // Must not panic.
        record_plan_event(user_id, None, &plan);
    }

    #[test]
    fn test_record_plan_event_with_session_does_not_panic() {
        // Same path with Some(session_id) — enqueues through append_event,
        // which in a fresh test process silently drops because no sender
        // is installed. The assertion is simply "no panic".
        let user_id = Uuid::new_v4();
        let session_id = Uuid::new_v4();
        let plan = Plan {
            overall_strategy: "x".to_string(),
            steps: vec![PlannedAction {
                action: "y".to_string(),
                rationale: "z".to_string(),
                confidence: 0.5,
            }],
        };
        record_plan_event(user_id, Some(session_id), &plan);
    }

    #[test]
    fn test_format_history_snippet_last_five() {
        // Only the last 5 messages are rendered; older ones are dropped
        // so the planner prompt stays bounded.
        let history: Vec<(String, String)> = (0..10)
            .map(|i| ("user".to_string(), format!("msg-{i}")))
            .collect();
        let snippet = format_history_snippet(&history);
        // The earliest five must NOT appear.
        for i in 0..5 {
            assert!(
                !snippet.contains(&format!("msg-{i}\n")),
                "old message msg-{i} should be dropped: snippet=\n{snippet}"
            );
        }
        // The most recent five MUST appear.
        for i in 5..10 {
            assert!(
                snippet.contains(&format!("msg-{i}")),
                "recent message msg-{i} must be present: snippet=\n{snippet}"
            );
        }
    }

    #[test]
    fn test_format_history_snippet_empty() {
        // With no history we emit a sentinel line so the prompt remains
        // well-formed and the model doesn't see an empty block.
        let snippet = format_history_snippet(&[]);
        assert!(snippet.contains("(sem histórico)"));
    }

    #[test]
    fn test_format_history_snippet_role_labels() {
        // Role labels are localized to PT-BR to match Sophie's register.
        let history = vec![
            ("user".to_string(), "oi".to_string()),
            ("assistant".to_string(), "olá".to_string()),
            ("model".to_string(), "alô".to_string()),
        ];
        let snippet = format_history_snippet(&history);
        assert!(snippet.contains("Usuário: oi"));
        assert!(snippet.contains("Sophie: olá"));
        // Gemini-style "model" role also maps to Sophie.
        assert!(snippet.contains("Sophie: alô"));
    }

    #[test]
    fn test_plan_serialization_roundtrips() {
        // Serializing a plan and parsing it back yields an identical plan.
        // This is what `record_plan_event` relies on for the payload.
        let original = Plan {
            overall_strategy: "s".to_string(),
            steps: vec![PlannedAction {
                action: "a".to_string(),
                rationale: "r".to_string(),
                confidence: 0.5,
            }],
        };
        let json = serde_json::to_string(&original).expect("serialize");
        let parsed: Plan = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(parsed, original);
    }

    #[test]
    fn test_max_plan_steps_is_three() {
        // Guard against a future refactor accidentally raising the cap.
        // The prompt text also advertises "ATÉ 3 passos" — if this changes
        // we'd need to update the prompt to match.
        assert_eq!(MAX_PLAN_STEPS, 3);
    }
}
