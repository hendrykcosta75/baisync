use chrono::{Datelike, Utc};
use reqwest::Client;
use scylla::frame::value::{CqlTimestamp, CqlTimeuuid};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, OnceLock, RwLock};
use std::time::{Duration, Instant};
use tokio::sync::mpsc::UnboundedSender;
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::models::assistant::AssistantTool;

/// Default LLM provider HTTP timeout used when `Config` is not available in the
/// call path (e.g. ad-hoc unit tests exercising `call_llm`). Production paths
/// always pass `Config` via `ToolContext`.
const DEFAULT_LLM_TIMEOUT_SECS: u64 = 60;

/// Resolve the LLM HTTP timeout from `ToolContext`, falling back to the
/// default when `Config` is not attached. Kept as a function so a future
/// refactor that threads `Config` everywhere does not require rewriting
/// call sites.
fn resolve_llm_timeout(ctx: &ToolContext<'_>) -> Duration {
    let secs = ctx
        .config
        .map(|c| c.llm_global_timeout_secs)
        .unwrap_or(DEFAULT_LLM_TIMEOUT_SECS);
    Duration::from_secs(secs)
}

/// Map a `tokio::time::timeout` elapsed error to an LLM-friendly message.
/// Format matches the invariant in `docs/harness/tool-errors.md`.
fn llm_timeout_error(provider: &str, secs: u64) -> AppError {
    AppError::InternalError(format!(
        "A chamada ao provider {provider} excedeu {secs}s. Tente resposta mais concisa ou reduza max_tokens."
    ))
}

// ---------------------------------------------------------------------------
// W1.1 — In-memory circuit breaker per LLM provider.
//
// If a provider records FAIL_THRESHOLD failures within FAIL_WINDOW, the
// circuit opens and subsequent `call_*_raw` invocations short-circuit with an
// LLM-friendly message. There is no explicit reset — stale failures fall out
// of the window naturally (natural half-life), so after FAIL_WINDOW with no
// new failures the circuit closes again automatically.
//
// State is in-memory only (reset on deploy is acceptable).
// ---------------------------------------------------------------------------

/// Failure-tracking state for a single provider.
struct ProviderHealth {
    /// Timestamps of failures within the last FAIL_WINDOW. Older entries are
    /// pruned lazily on every `record_failure`.
    recent_failures: VecDeque<Instant>,
    /// Informational: when the provider last replied OK. Unused for gating
    /// (decay alone closes the circuit) but kept for potential tracing.
    last_success_at: Option<Instant>,
}

static PROVIDER_HEALTH: OnceLock<Arc<RwLock<HashMap<String, ProviderHealth>>>> = OnceLock::new();

fn health_map() -> &'static Arc<RwLock<HashMap<String, ProviderHealth>>> {
    PROVIDER_HEALTH.get_or_init(|| Arc::new(RwLock::new(HashMap::new())))
}

const FAIL_WINDOW: Duration = Duration::from_secs(60);
const FAIL_THRESHOLD: usize = 5;

/// Returns `Some(err_msg)` if the circuit is open for `provider` (i.e. at
/// least `FAIL_THRESHOLD` failures occurred within the last `FAIL_WINDOW`).
fn check_circuit_open(provider: &str) -> Option<String> {
    let now = Instant::now();
    let map = health_map().read().ok()?;
    let entry = map.get(provider)?;
    let fresh_fails = entry
        .recent_failures
        .iter()
        .filter(|t| now.duration_since(**t) < FAIL_WINDOW)
        .count();
    if fresh_fails >= FAIL_THRESHOLD {
        Some(format!(
            "Provider {provider} temporariamente instável (circuito aberto após {fresh_fails} falhas recentes). Tente configurar outro provider no assistente."
        ))
    } else {
        None
    }
}

/// Record a failed call to `provider`. Also prunes any failure timestamp
/// older than `FAIL_WINDOW` so the deque stays bounded.
fn record_failure(provider: &str) {
    if let Ok(mut map) = health_map().write() {
        let now = Instant::now();
        let entry = map
            .entry(provider.to_string())
            .or_insert_with(|| ProviderHealth {
                recent_failures: VecDeque::new(),
                last_success_at: None,
            });
        // Expire old failures at the front of the deque (lazy pruning).
        while let Some(front) = entry.recent_failures.front() {
            if now.duration_since(*front) >= FAIL_WINDOW {
                entry.recent_failures.pop_front();
            } else {
                break;
            }
        }
        entry.recent_failures.push_back(now);
        tracing::warn!(
            provider = provider,
            fresh_fails = entry.recent_failures.len(),
            "LLM provider failure recorded"
        );
    }
}

/// Record a successful call to `provider`. We do NOT clear the failure deque
/// on success — natural decay via `FAIL_WINDOW` is enough to close the
/// circuit and avoids a single good response re-opening a flaky provider.
fn record_success(provider: &str) {
    if let Ok(mut map) = health_map().write() {
        let entry = map
            .entry(provider.to_string())
            .or_insert_with(|| ProviderHealth {
                recent_failures: VecDeque::new(),
                last_success_at: None,
            });
        entry.last_success_at = Some(Instant::now());
    }
}

/// Test-only helper to reset all circuit-breaker state between unit tests.
#[cfg(test)]
fn reset_circuit_breaker_state() {
    if let Ok(mut map) = health_map().write() {
        map.clear();
    }
}

/// Decode a base64 blob and extract plain text via the RAG text extractor.
/// Returns `None` when decode or extraction fails — caller should then
/// fall back to the message's text-only content and log a warning.
fn extract_text_from_base64(b64: &str, mime: &str) -> Option<String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let bytes = STANDARD.decode(b64).ok()?;
    crate::services::rag::extract_text(&bytes, mime).ok()
}

// ---------------------------------------------------------------------------
// T1.2 — llm_call_logs as fire-and-forget session log.
//
// The hot LLM path no longer `.await`s a Cassandra INSERT. Instead it emits
// `LlmCallLogEvent`s to an unbounded mpsc channel; `main.rs` owns a drain task
// that applies them. This keeps provider latency independent of Cassandra.
//
// Lifecycle:
//   Started  -> INSERT   (status='in_progress')
//   Finished -> UPDATE   IF status='in_progress'  (status='completed')
//   Failed   -> UPDATE   IF status='in_progress'  (status='failed')
//
// The LWT guard makes the Finished/Failed apply idempotent and lets W1.3
// (crash recovery) safely mark abandoned in_progress rows as 'failed' later.
// ---------------------------------------------------------------------------

/// One step in the llm_call_logs session log.
///
/// Every variant carries the full tenant key (`user_id`, `assistant_id`) so
/// the drain writer can scope UPDATE WHERE clauses without consulting state.
#[derive(Debug)]
pub enum LlmCallLogEvent {
    Started {
        user_id: Uuid,
        assistant_id: Uuid,
        /// UUIDv1 derived from `started_at_ms` — used as the row `id` (TIMEUUID).
        id: Uuid,
        conversation_id: Option<Uuid>,
        provider: String,
        model: String,
        started_at_ms: i64,
        /// SHA-256 of serialized prompt messages, hex-truncated. Never plaintext.
        messages_digest: String,
        /// Logical kind: "primary" (today), "compaction" / "evaluator" (future).
        kind: String,
    },
    Finished {
        id: Uuid,
        user_id: Uuid,
        assistant_id: Uuid,
        tokens_used: i32,
        duration_ms: i32,
        tool_rounds: i32,
        tool_names: Vec<String>,
        retry_count: i32,
    },
    Failed {
        id: Uuid,
        user_id: Uuid,
        assistant_id: Uuid,
        duration_ms: i32,
        error: String,
        retry_count: i32,
    },
}

/// Global sender for `LlmCallLogEvent`s. Set once at startup from `main.rs`.
///
/// If unset (e.g. unit tests, `call_llm_with_tools` without ctx), `enqueue`
/// is a silent no-op — the LLM flow never fails because of logging.
pub static LLM_CALL_LOG_SENDER: OnceLock<UnboundedSender<LlmCallLogEvent>> = OnceLock::new();

/// Install the global sender. Call once from `main.rs` after `db::connect`.
pub fn init_llm_call_log_sender(s: UnboundedSender<LlmCallLogEvent>) {
    let _ = LLM_CALL_LOG_SENDER.set(s);
}

/// Fire-and-forget: push an event onto the drain channel.
///
/// Dropped events are logged at `debug` level only, since the channel is
/// unbounded in practice and a `send` failure here means the receiver task
/// has been dropped — we don't want to spam warnings on shutdown.
fn enqueue(event: LlmCallLogEvent) {
    if let Some(sender) = LLM_CALL_LOG_SENDER.get() {
        if sender.send(event).is_err() {
            tracing::debug!("llm_call_log drain receiver dropped; event discarded");
        }
    }
}

/// Hash `messages` for correlation without leaking user text. SHA-256 hex,
/// truncated to 32 chars (128 bits) — plenty of entropy for de-duplication.
pub(crate) fn digest_messages(messages: &[LlmMessage]) -> String {
    let serialized = serde_json::to_string(messages).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(serialized.as_bytes());
    let full = hex::encode(hasher.finalize());
    full.chars().take(32).collect()
}

/// Build a UUIDv1 from an epoch-ms timestamp. Used so the row `id` sorts by
/// session-start time without a separate clustering key.
fn timeuuid_from_ms(started_at_ms: i64) -> Uuid {
    // `uuid::timestamp::Timestamp::from_unix` expects seconds + subsec nanos.
    let secs = (started_at_ms / 1000).max(0) as u64;
    let nanos = ((started_at_ms.rem_euclid(1000)) * 1_000_000) as u32;
    let ts = uuid::timestamp::Timestamp::from_unix(uuid::NoContext, secs, nanos);
    Uuid::new_v1(ts, &[0x01, 0x23, 0x45, 0x67, 0x89, 0xab])
}

/// Drain a single `LlmCallLogEvent` onto Cassandra. Called only by the
/// background task spawned in `main.rs`; never by the hot LLM path.
///
/// Multi-tenancy: every UPDATE is scoped by `(user_id, assistant_id, id)` —
/// the row's full primary key, preserving partition isolation.
pub async fn apply_llm_call_log_event(
    db: &DbSession,
    event: LlmCallLogEvent,
) -> Result<(), AppError> {
    match event {
        LlmCallLogEvent::Started {
            user_id,
            assistant_id,
            id,
            conversation_id,
            provider,
            model,
            started_at_ms,
            messages_digest,
            kind,
        } => {
            let timeuuid = CqlTimeuuid::from(id);
            let ts = CqlTimestamp(started_at_ms);
            db.query_unpaged(
                "INSERT INTO inertial_eclipse.llm_call_logs \
                 (user_id, assistant_id, id, conversation_id, provider, model, \
                  status, started_at, messages_digest, kind, retry_count, \
                  tokens_used, duration_ms, tool_rounds, created_at) \
                 VALUES (?, ?, ?, ?, ?, ?, 'in_progress', ?, ?, ?, 0, 0, 0, 0, ?)",
                (
                    &user_id,
                    &assistant_id,
                    &timeuuid,
                    &conversation_id,
                    &provider,
                    &model,
                    ts,
                    &messages_digest,
                    &kind,
                    ts,
                ),
            )
            .await
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
            Ok(())
        }
        LlmCallLogEvent::Finished {
            id,
            user_id,
            assistant_id,
            tokens_used,
            duration_ms,
            tool_rounds,
            tool_names,
            retry_count,
        } => {
            let timeuuid = CqlTimeuuid::from(id);
            // LWT: only apply if still in_progress. Idempotent across retries
            // and safe against W1.3 recovery racing a late completion.
            db.query_unpaged(
                "UPDATE inertial_eclipse.llm_call_logs \
                 SET status = 'completed', tokens_used = ?, duration_ms = ?, \
                     tool_rounds = ?, tool_names = ?, retry_count = ? \
                 WHERE user_id = ? AND assistant_id = ? AND id = ? \
                 IF status = 'in_progress'",
                (
                    tokens_used,
                    duration_ms,
                    tool_rounds,
                    &tool_names,
                    retry_count,
                    &user_id,
                    &assistant_id,
                    &timeuuid,
                ),
            )
            .await
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
            Ok(())
        }
        LlmCallLogEvent::Failed {
            id,
            user_id,
            assistant_id,
            duration_ms,
            error,
            retry_count,
        } => {
            let timeuuid = CqlTimeuuid::from(id);
            db.query_unpaged(
                "UPDATE inertial_eclipse.llm_call_logs \
                 SET status = 'failed', duration_ms = ?, error = ?, retry_count = ? \
                 WHERE user_id = ? AND assistant_id = ? AND id = ? \
                 IF status = 'in_progress'",
                (
                    duration_ms,
                    &error,
                    retry_count,
                    &user_id,
                    &assistant_id,
                    &timeuuid,
                ),
            )
            .await
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
            Ok(())
        }
    }
}

/// Fold an extracted document's text into an existing user message body.
pub(crate) fn fold_document_text(original: &str, extracted: &str) -> String {
    if original.trim().is_empty() {
        format!("[Conteúdo do documento anexado]\n{extracted}")
    } else {
        format!("{original}\n\n[Conteúdo do documento anexado]\n{extracted}")
    }
}

/// Context passed to execute_tool for built-in tools that need database access
pub struct ToolContext<'a> {
    pub db: Option<&'a DbSession>,
    pub assistant_id: Option<Uuid>,
    pub user_id: Option<Uuid>,
    pub conversation_id: Option<Uuid>,
    pub config: Option<&'a crate::config::Config>,
    pub encryption: Option<&'a crate::services::encryption::EncryptionService>,
    /// W1.2 — per-assistant cap on tool-calling rounds. `None` means use
    /// [`DEFAULT_MAX_TOOL_ROUNDS`]. Enforced in each provider's tool loop.
    pub max_tool_rounds: Option<i32>,
    /// W1.2 — per-assistant cap on total wall-clock duration of the
    /// tool-calling loop, in milliseconds. `None` means use
    /// [`DEFAULT_MAX_DURATION_MS`]. Enforced between rounds; a running HTTP
    /// call is still allowed to finish.
    pub max_duration_ms: Option<i32>,
}

/// W1.2 defaults applied when the assistant has no override. Exposed so
/// callers (handlers, tests) share one source of truth.
pub const DEFAULT_MAX_TOOL_ROUNDS: i32 = 5;
pub const DEFAULT_MAX_DURATION_MS: i32 = 30_000;

#[derive(Debug, Serialize, Deserialize)]
pub struct LlmMessage {
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_base64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_mime_type: Option<String>,
}

#[derive(Debug)]
pub struct LlmResponse {
    pub content: String,
    pub tokens_used: i32,
    pub tool_call_records: Vec<ToolCallRecord>,
}

/// Tool definition converted for LLM providers
#[derive(Debug, Clone)]
pub struct LlmTool {
    pub id: Option<uuid::Uuid>,
    pub name: String,
    pub description: String,
    pub parameters: Value,
    pub endpoint: String,
    pub method: String,
    pub headers: Option<String>,
    /// Auth config extracted from __extended
    pub auth: Option<Value>,
    /// Query params extracted from __extended: [{"key":"k","value":"v"}, ...]
    pub query_params: Option<Vec<Value>>,
    /// Body content type: "json", "form-urlencoded", "raw"
    pub body_content_type: Option<String>,
    /// Body content template (with {{placeholders}})
    pub body_content: Option<String>,
    /// Tool type: "http_request", "send_document", "notify_human"
    pub tool_type: String,
}

/// Result of a single tool execution (for logging)
#[derive(Debug, Clone)]
pub struct ToolCallRecord {
    pub tool_id: Option<uuid::Uuid>,
    pub tool_name: String,
    pub arguments: Value,
    pub status_code: Option<i32>,
    pub response_body: Option<String>,
    pub error: Option<String>,
    pub duration_ms: i32,
    pub tool_type: String,
}

/// Sanitize a tool name to match OpenAI's pattern: ^[a-zA-Z0-9_-]+$
/// Removes accents, replaces spaces with underscores, strips invalid chars.
fn sanitize_tool_name(name: &str) -> String {
    let lowered = name.replace(' ', "_").to_lowercase();
    // Map common accented characters to ASCII equivalents
    let mut result = String::with_capacity(lowered.len());
    for c in lowered.chars() {
        match c {
            'á' | 'à' | 'ã' | 'â' | 'ä' => result.push('a'),
            'é' | 'è' | 'ê' | 'ë' => result.push('e'),
            'í' | 'ì' | 'î' | 'ï' => result.push('i'),
            'ó' | 'ò' | 'õ' | 'ô' | 'ö' => result.push('o'),
            'ú' | 'ù' | 'û' | 'ü' => result.push('u'),
            'ç' => result.push('c'),
            'ñ' => result.push('n'),
            c if c.is_ascii_alphanumeric() || c == '_' || c == '-' => result.push(c),
            _ => {} // strip any other invalid characters
        }
    }
    if result.is_empty() {
        "tool".to_string()
    } else {
        result
    }
}

/// Extract `{{placeholder}}` variable names from a string.
fn extract_placeholders(s: &str) -> Vec<String> {
    let mut vars = Vec::new();
    let mut rest = s;
    while let Some(start) = rest.find("{{") {
        let after = &rest[start + 2..];
        if let Some(end) = after.find("}}") {
            let var_name = after[..end].trim().to_string();
            if !var_name.is_empty() && !vars.contains(&var_name) {
                vars.push(var_name);
            }
            rest = &after[end + 2..];
        } else {
            break;
        }
    }
    vars
}

/// Build a JSON Schema from placeholder variables found in endpoint, headers, and body.
fn auto_schema_from_placeholders(
    endpoint: &str,
    headers: Option<&str>,
    body: Option<&str>,
) -> Value {
    let mut vars = extract_placeholders(endpoint);
    if let Some(h) = headers {
        for v in extract_placeholders(h) {
            if !vars.contains(&v) {
                vars.push(v);
            }
        }
    }
    if let Some(b) = body {
        for v in extract_placeholders(b) {
            if !vars.contains(&v) {
                vars.push(v);
            }
        }
    }

    if vars.is_empty() {
        return json!({"type": "object", "properties": {}});
    }

    let mut properties = serde_json::Map::new();
    for var in &vars {
        properties.insert(
            var.clone(),
            json!({"type": "string", "description": format!("Value for {{{{{}}}}}", var)}),
        );
    }

    json!({
        "type": "object",
        "properties": properties,
        "required": vars,
    })
}

impl From<&AssistantTool> for LlmTool {
    fn from(t: &AssistantTool) -> Self {
        let tool_type = t.tool_type.as_deref().unwrap_or("http_request").to_string();

        // Built-in tool types use hardcoded schemas
        match tool_type.as_str() {
            "send_document" => {
                return Self {
                    id: Some(t.id),
                    name: sanitize_tool_name(&t.name),
                    description: t
                        .description
                        .clone()
                        .unwrap_or_else(|| "Envia um documento ou imagem na conversa".to_string()),
                    parameters: json!({
                        "type": "object",
                        "properties": {
                            "caption": {"type": "string", "description": "Legenda opcional para acompanhar o documento"}
                        }
                    }),
                    endpoint: t.endpoint.clone(),
                    method: String::new(),
                    headers: None,
                    auth: None,
                    query_params: None,
                    body_content_type: None,
                    body_content: None,
                    tool_type,
                };
            }
            "notify_human" => {
                return Self {
                    id: Some(t.id),
                    name: sanitize_tool_name(&t.name),
                    description: t.description.clone().unwrap_or_else(|| "Notifica um agente humano para intervir na conversa quando não conseguir resolver o problema do usuário".to_string()),
                    parameters: json!({
                        "type": "object",
                        "properties": {
                            "reason": {"type": "string", "description": "Motivo pelo qual um agente humano é necessário"}
                        },
                        "required": ["reason"]
                    }),
                    endpoint: String::new(),
                    method: String::new(),
                    headers: None,
                    auth: None,
                    query_params: None,
                    body_content_type: None,
                    body_content: None,
                    tool_type,
                };
            }
            "pix_payment" => {
                return Self {
                    id: Some(t.id),
                    name: sanitize_tool_name(&t.name),
                    description: t.description.clone().unwrap_or_else(||
                        "Gera cobranças PIX e verifica status de pagamentos. Use create_charge para criar uma cobrança e check_status para verificar se foi paga.".to_string()
                    ),
                    parameters: json!({
                        "type": "object",
                        "properties": {
                            "action": {
                                "type": "string",
                                "enum": ["create_charge", "check_status"],
                                "description": "Ação: create_charge (criar nova cobrança PIX) ou check_status (verificar status de pagamento)"
                            },
                            "amount": {
                                "type": "number",
                                "description": "Valor da cobrança em reais (ex: 29.90). Obrigatório para create_charge."
                            },
                            "description": {
                                "type": "string",
                                "description": "Descrição da cobrança (ex: 'Pedido #123 - Pizza Margherita'). Obrigatório para create_charge."
                            },
                            "customer_name": {
                                "type": "string",
                                "description": "Nome completo do cliente. Obrigatório para create_charge."
                            },
                            "customer_cpf": {
                                "type": "string",
                                "description": "CPF do cliente (ex: '123.456.789-00'). Obrigatório para create_charge."
                            },
                            "charge_id": {
                                "type": "string",
                                "description": "ID da cobrança para consultar (obrigatório para check_status)"
                            }
                        },
                        "required": ["action"]
                    }),
                    endpoint: t.endpoint.clone(),
                    method: String::new(),
                    headers: t.headers_json.clone(),
                    auth: None,
                    query_params: None,
                    body_content_type: None,
                    body_content: None,
                    tool_type,
                };
            }
            "card_payment" => {
                return Self {
                    id: Some(t.id),
                    name: sanitize_tool_name(&t.name),
                    description: t.description.clone().unwrap_or_else(||
                        "Cria cobranças por cartão de crédito/débito e verifica status de pagamentos. O cliente recebe um link de pagamento seguro. REGRAS: 1) Sempre pergunte ao cliente se deseja pagar no crédito ou débito. 2) Se for crédito, pergunte em quantas parcelas (1x a 12x). 3) Só chame esta tool após confirmar esses dados com o cliente. 4) O valor mínimo por parcela é R$5,00. Exemplo: para 2x o valor mínimo da cobrança é R$10,00, para 3x é R$15,00. Se o valor for menor, informe o cliente e sugira menos parcelas ou pagamento à vista. 5) Débito é sempre à vista (1x).".to_string()
                    ),
                    parameters: json!({
                        "type": "object",
                        "properties": {
                            "action": {
                                "type": "string",
                                "enum": ["create_charge", "check_status"],
                                "description": "Ação: create_charge (criar nova cobrança por cartão) ou check_status (verificar status de pagamento)"
                            },
                            "amount": {
                                "type": "number",
                                "description": "Valor da cobrança em reais (ex: 29.90). Obrigatório para create_charge."
                            },
                            "description": {
                                "type": "string",
                                "description": "Descrição da cobrança (ex: 'Pedido #123 - Pizza Margherita'). Obrigatório para create_charge."
                            },
                            "customer_name": {
                                "type": "string",
                                "description": "Nome completo do cliente. Obrigatório para create_charge."
                            },
                            "payment_type": {
                                "type": "string",
                                "enum": ["credit", "debit"],
                                "description": "Tipo de pagamento: credit (cartão de crédito, permite parcelamento) ou debit (cartão de débito, sempre à vista). Obrigatório para create_charge."
                            },
                            "installments": {
                                "type": "integer",
                                "description": "Número de parcelas (1-12). Obrigatório para crédito — pergunte ao cliente antes. Para débito use 1. Valor mínimo por parcela: R$5,00. Exemplo: R$30 em 3x = R$10/parcela (ok). R$10 em 3x = R$3,33/parcela (não permitido, sugira 2x ou 1x)."
                            },
                            "charge_id": {
                                "type": "string",
                                "description": "ID da cobrança para consultar (obrigatório para check_status)"
                            }
                        },
                        "required": ["action", "payment_type", "installments"]
                    }),
                    endpoint: String::new(),
                    method: String::new(),
                    headers: t.headers_json.clone(),
                    auth: None,
                    query_params: None,
                    body_content_type: None,
                    body_content: None,
                    tool_type,
                };
            }
            "current_datetime" => {
                return Self {
                    id: Some(t.id),
                    name: sanitize_tool_name(&t.name),
                    description: t.description.clone().unwrap_or_else(||
                        "Retorna a data e hora atual. Use SEMPRE esta tool antes de falar sobre datas (hoje, amanhã, esta semana, próximo mês, etc.) ou antes de chamar check_availability / create em ferramentas de agendamento — o modelo não conhece a data real.".to_string()
                    ),
                    parameters: json!({
                        "type": "object",
                        "properties": {},
                    }),
                    endpoint: String::new(),
                    method: String::new(),
                    headers: t.headers_json.clone(),
                    auth: None,
                    query_params: None,
                    body_content_type: None,
                    body_content: None,
                    tool_type,
                };
            }
            "create_meeting" => {
                return Self {
                    id: Some(t.id),
                    name: sanitize_tool_name(&t.name),
                    description: t.description.clone().unwrap_or_else(||
                        "Cria um link de reunião por vídeo (instantânea ou agendada) para compartilhar com o cliente. Use meeting_type=instant quando o cliente quer conversar agora; meeting_type=scheduled quando é para uma data futura (forneça scheduled_start no formato ISO 8601).".to_string()
                    ),
                    parameters: json!({
                        "type": "object",
                        "properties": {
                            "meeting_type": {
                                "type": "string",
                                "enum": ["instant", "scheduled"],
                                "description": "instant = começa agora mesmo; scheduled = reunião futura (requer scheduled_start)"
                            },
                            "title": {
                                "type": "string",
                                "description": "Título curto da reunião (ex: 'Demo com João', 'Reunião de briefing')"
                            },
                            "scheduled_start": {
                                "type": "string",
                                "description": "Data e hora ISO 8601 do início (ex: 2026-04-15T14:00:00). Obrigatório apenas para meeting_type=scheduled."
                            }
                        },
                        "required": ["meeting_type", "title"]
                    }),
                    endpoint: String::new(),
                    method: String::new(),
                    headers: t.headers_json.clone(),
                    auth: None,
                    query_params: None,
                    body_content_type: None,
                    body_content: None,
                    tool_type,
                };
            }
            "schedule_appointment" => {
                return Self {
                    id: Some(t.id),
                    name: sanitize_tool_name(&t.name),
                    description: t.description.clone().unwrap_or_else(||
                        "Agenda, cancela ou reagenda compromissos. REGRAS OBRIGATÓRIAS: (1) SEMPRE chame data_hora_atual PRIMEIRO para saber o ano/mês/dia de hoje — NUNCA assuma pelo seu conhecimento interno. (2) SEMPRE use check_availability ANTES de create. (3) Todas as datas em date_time DEVEM ser futuras e usar o MESMO ANO retornado por data_hora_atual. Se o cliente disser 'semana que vem', some os dias à data de hoje — NUNCA invente anos anteriores.".to_string()
                    ),
                    parameters: json!({
                        "type": "object",
                        "properties": {
                            "action": {
                                "type": "string",
                                "enum": ["check_availability", "create", "cancel", "reschedule"],
                                "description": "Ação: check_availability (SEMPRE use primeiro — verificar disponibilidade), create (novo agendamento), cancel (cancelar), reschedule (reagendar)"
                            },
                            "client_name": { "type": "string", "description": "Nome completo do cliente" },
                            "client_email": { "type": "string", "description": "Email do cliente" },
                            "client_phone": { "type": "string", "description": "Telefone com código do país (ex: +5511999999999)" },
                            "date_time": { "type": "string", "description": "Data e hora ISO 8601 no formato YYYY-MM-DDTHH:MM:SS. OBRIGATÓRIO: precisa ser uma data FUTURA e o ANO precisa ser igual ao retornado por data_hora_atual (não use anos de seu treinamento). Ex.: se data_hora_atual retornou date=2026-04-17, use 2026-04-20T15:00:00 ou 2026-05-03T10:00:00." },
                            "duration_minutes": { "type": "integer", "description": "Duração em minutos" },
                            "appointment_type": { "type": "string", "description": "Tipo/motivo (ex: consulta, reunião, demonstração)" },
                            "notes": { "type": "string", "description": "Observações adicionais" },
                            "appointment_id": { "type": "string", "description": "ID do agendamento (obrigatório para cancel e reschedule)" },
                            "date": { "type": "string", "description": "Data no formato YYYY-MM-DD (para check_availability de um dia específico). Use o mesmo ano de data_hora_atual." },
                            "week_start": { "type": "string", "description": "Data início da semana YYYY-MM-DD (para check_availability — retorna resumo de 7 dias com disponibilidade). Use o mesmo ano de data_hora_atual." }
                        },
                        "required": ["action"]
                    }),
                    endpoint: String::new(),
                    method: String::new(),
                    headers: t.headers_json.clone(),
                    auth: None,
                    query_params: None,
                    body_content_type: None,
                    body_content: None,
                    tool_type,
                };
            }
            _ => {}
        }

        // HTTP Request tool — existing logic
        let mut body_content: Option<String> = None;
        let mut auth: Option<Value> = None;
        let mut query_params: Option<Vec<Value>> = None;
        let mut body_content_type: Option<String> = None;

        let user_schema = t
            .schema_json
            .as_deref()
            .and_then(|s| serde_json::from_str::<Value>(s).ok())
            .and_then(|v| {
                if v.get("__extended")
                    .and_then(|e| e.as_bool())
                    .unwrap_or(false)
                {
                    body_content = v
                        .get("bodyContent")
                        .and_then(|b| b.as_str())
                        .map(|s| s.to_string());
                    auth = v.get("auth").cloned();
                    query_params = v.get("queryParams").and_then(|qp| qp.as_array()).cloned();
                    body_content_type = v
                        .get("bodyContentType")
                        .and_then(|b| b.as_str())
                        .map(|s| s.to_string());

                    v.get("schema").and_then(|s| {
                        if s.is_string() {
                            serde_json::from_str(s.as_str().unwrap()).ok()
                        } else if s.is_object() {
                            Some(s.clone())
                        } else {
                            None
                        }
                    })
                } else {
                    Some(v)
                }
            });

        let parameters = match &user_schema {
            Some(schema)
                if schema
                    .get("properties")
                    .and_then(|p| p.as_object())
                    .map(|o| !o.is_empty())
                    .unwrap_or(false) =>
            {
                schema.clone()
            }
            _ => auto_schema_from_placeholders(
                &t.endpoint,
                t.headers_json.as_deref(),
                body_content.as_deref(),
            ),
        };

        Self {
            id: Some(t.id),
            name: sanitize_tool_name(&t.name),
            description: t.description.clone().unwrap_or_default(),
            parameters,
            endpoint: t.endpoint.clone(),
            method: t.method.clone(),
            headers: t.headers_json.clone(),
            auth,
            query_params,
            body_content_type,
            body_content,
            tool_type,
        }
    }
}

/// Whether the given provider can natively ingest `mime` as a media
/// attachment in its chat-completions API. Used to short-circuit messages
/// with unsupported types (e.g. XLSX/DOCX) before they reach the LLM and
/// surface raw "Unsupported MIME" errors to the end user.
///
/// Audio is intentionally not listed here — audio flows through STT
/// upstream and arrives as text content.
pub fn is_mime_supported_by_provider(provider: &str, mime: &str) -> bool {
    // PDFs are handled as extracted text for Grok/Deepseek; still treated
    // as "supported" so upstream code doesn't short-circuit those providers.
    match provider {
        "openai" => matches!(
            mime,
            "image/jpeg"
                | "image/png"
                | "image/gif"
                | "image/webp"
                | "application/pdf"
        ),
        "claude" => matches!(
            mime,
            "image/jpeg"
                | "image/png"
                | "image/gif"
                | "image/webp"
                | "application/pdf"
        ),
        "gemini" => {
            mime.starts_with("image/")
                || mime.starts_with("video/")
                || mime == "application/pdf"
                || mime == "text/plain"
        }
        // Grok natively takes jpg/png only; PDF goes through text extraction.
        "grok" => matches!(mime, "image/jpeg" | "image/png" | "application/pdf"),
        // Deepseek is text-only; only PDFs survive (as extracted text).
        "deepseek" => mime == "application/pdf",
        _ => false,
    }
}

pub async fn call_llm(
    provider: &str,
    model: &str,
    api_key: &str,
    messages: Vec<LlmMessage>,
    temperature: f32,
    max_tokens: i32,
) -> Result<LlmResponse, AppError> {
    call_llm_with_tools(
        provider,
        model,
        api_key,
        messages,
        temperature,
        max_tokens,
        &[],
    )
    .await
}

pub async fn call_llm_with_tools(
    provider: &str,
    model: &str,
    api_key: &str,
    messages: Vec<LlmMessage>,
    temperature: f32,
    max_tokens: i32,
    tools: &[LlmTool],
) -> Result<LlmResponse, AppError> {
    let ctx = ToolContext {
        db: None,
        assistant_id: None,
        user_id: None,
        conversation_id: None,
        config: None,
        encryption: None,
        max_tool_rounds: None,
        max_duration_ms: None,
    };
    call_llm_with_tools_ctx(
        provider,
        model,
        api_key,
        messages,
        temperature,
        max_tokens,
        tools,
        &ctx,
    )
    .await
}

/// Read the `last_message_at` timestamp of a conversation as epoch millis.
///
/// Used by the I1 drift tracing at the top of `call_llm_with_tools_ctx` to emit
/// how long the conversation has been idle before each LLM call. Best-effort —
/// any DB error or NULL value yields `Ok(None)` so callers can treat drift
/// as unknown without failing the LLM flow.
async fn query_last_message_at(
    db: &DbSession,
    assistant_id: Uuid,
    user_id: Uuid,
    conversation_id: Uuid,
) -> Result<Option<i64>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT last_message_at FROM inertial_eclipse.conversations \
             WHERE assistant_id = ? AND user_id = ? AND id = ?",
            (&assistant_id, &user_id, &conversation_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    type Row = (Option<chrono::DateTime<Utc>>,);
    let row = result.into_rows_result()?.maybe_first_row::<Row>()?;
    Ok(row.and_then(|(ts,)| ts.map(|t| t.timestamp_millis())))
}

pub async fn call_llm_with_tools_ctx(
    provider: &str,
    model: &str,
    api_key: &str,
    messages: Vec<LlmMessage>,
    temperature: f32,
    max_tokens: i32,
    tools: &[LlmTool],
    ctx: &ToolContext<'_>,
) -> Result<LlmResponse, AppError> {
    let client = Client::new();
    let started = std::time::Instant::now();
    let started_at_ms = Utc::now().timestamp_millis();

    // I1 — drift tracing. Best-effort, non-fatal.
    // Emits `drift_ms = now - last_message_at` so a 2-week histogram can
    // back the W1.3 recovery threshold. Missing context or DB errors
    // produce `drift_ms = None` but the event is still emitted.
    let drift_ms: Option<i64> = if let (Some(db), Some(conv_id), Some(user_id), Some(asst_id)) = (
        ctx.db,
        ctx.conversation_id,
        ctx.user_id,
        ctx.assistant_id,
    ) {
        match query_last_message_at(db, asst_id, user_id, conv_id).await {
            Ok(Some(last_ms)) => {
                let now_ms = Utc::now().timestamp_millis();
                Some(now_ms - last_ms)
            }
            Ok(None) => None,
            Err(e) => {
                tracing::warn!("I1 drift query failed: {e}");
                None
            }
        }
    } else {
        None
    };

    tracing::info!(
        event = "llm_call_started",
        drift_ms = drift_ms,
        conversation_id = ?ctx.conversation_id,
        assistant_id = ?ctx.assistant_id,
        provider = %provider,
        "llm call starting"
    );

    // T1.2 — emit `Started` into the fire-and-forget drain BEFORE the HTTP POST.
    // A row id is created here so `Finished`/`Failed` can target it via LWT.
    // Only produced when we have the full tenant context (webhook path, not
    // ad-hoc unit tests).
    let session_id: Option<Uuid> =
        if let (Some(user_id), Some(assistant_id)) = (ctx.user_id, ctx.assistant_id) {
            let id = timeuuid_from_ms(started_at_ms);
            enqueue(LlmCallLogEvent::Started {
                user_id,
                assistant_id,
                id,
                conversation_id: ctx.conversation_id,
                provider: provider.to_string(),
                model: model.to_string(),
                started_at_ms,
                messages_digest: digest_messages(&messages),
                kind: "primary".to_string(),
            });
            Some(id)
        } else {
            None
        };

    let result: Result<LlmResponse, AppError> = match provider {
        "openai" => {
            call_openai_with_tools(
                &client,
                api_key,
                model,
                messages,
                temperature,
                max_tokens,
                tools,
                ctx,
            )
            .await
        }
        "claude" => {
            call_claude_with_tools(
                &client,
                api_key,
                model,
                messages,
                temperature,
                max_tokens,
                tools,
                ctx,
            )
            .await
        }
        "gemini" => {
            call_gemini_with_tools(
                &client,
                api_key,
                model,
                messages,
                temperature,
                max_tokens,
                tools,
                ctx,
            )
            .await
        }
        "grok" => {
            call_grok_with_tools(
                &client,
                api_key,
                model,
                messages,
                temperature,
                max_tokens,
                tools,
                ctx,
            )
            .await
        }
        "deepseek" => {
            call_deepseek_with_tools(
                &client,
                api_key,
                model,
                messages,
                temperature,
                max_tokens,
                tools,
                ctx,
            )
            .await
        }
        _ => Err(AppError::BadRequest(format!(
            "Unknown LLM provider: {provider}"
        ))),
    };

    let duration_ms = started.elapsed().as_millis().min(i32::MAX as u128) as i32;

    // T1.2 — close the session log. Fire-and-forget; NEVER `.await` here.
    // retry_count defaults to 0 today; T2.2 will wire real values through ctx.
    if let (Some(id), Some(user_id), Some(assistant_id)) =
        (session_id, ctx.user_id, ctx.assistant_id)
    {
        match &result {
            Ok(r) => {
                let tool_names: Vec<String> = r
                    .tool_call_records
                    .iter()
                    .map(|t| t.tool_name.clone())
                    .collect();
                enqueue(LlmCallLogEvent::Finished {
                    id,
                    user_id,
                    assistant_id,
                    tokens_used: r.tokens_used,
                    duration_ms,
                    tool_rounds: r.tool_call_records.len() as i32,
                    tool_names,
                    retry_count: 0,
                });
            }
            Err(e) => {
                enqueue(LlmCallLogEvent::Failed {
                    id,
                    user_id,
                    assistant_id,
                    duration_ms,
                    error: e.to_string(),
                    retry_count: 0,
                });
            }
        }
    }

    result
}

struct RawLlmResult {
    content: String,
    tokens: i32,
    tool_calls: Option<Vec<ToolCall>>,
    /// Raw tool_calls JSON from OpenAI (needed to echo back in conversation)
    raw_tool_calls: Option<Value>,
    /// Raw content blocks from Claude (needed to echo back tool_use blocks)
    raw_content_blocks: Option<Value>,
}

struct ToolCall {
    id: String,
    name: String,
    arguments: Value,
}

/// Replace `{{key}}` placeholders in a string with values from the arguments JSON object.
fn interpolate_template(template: &str, arguments: &Value) -> String {
    let mut result = template.to_string();
    if let Some(obj) = arguments.as_object() {
        for (key, value) in obj {
            let placeholder = format!("{{{{{}}}}}", key); // produces {{key}}
            let replacement = match value {
                Value::String(s) => s.clone(),
                Value::Null => String::new(),
                other => other.to_string(),
            };
            result = result.replace(&placeholder, &replacement);
        }
    }
    result
}

/// Read an AI-tool-level "headers_json" config and return the expiry string saved by the UI.
/// Accepts `link_expiry` or `meeting_link_expiry` (schedule_appointment uses the latter).
fn meeting_expiry_from_headers(headers: Option<&str>, key: &str) -> Option<String> {
    let raw = headers?;
    let parsed: Value = serde_json::from_str(raw).ok()?;
    parsed
        .get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Create a meeting on behalf of the assistant's owner, reusing the same service path
/// as the dashboard (workspace + rate-limit + LiveKit room).
///
/// Note: `tenant_id` comes from `ToolContext.user_id`, which in this codebase's
/// multi-tenant convention is the **workspace_id** (the assistant's partition key),
/// not a real user id. We treat it as the workspace and resolve its owner for the
/// `created_by` / `host_user_id` fields the meetings service expects.
async fn create_meeting_for_tool(
    db: &DbSession,
    config: &crate::config::Config,
    tenant_id: &Uuid,
    title: &str,
    scheduled_start: Option<chrono::DateTime<chrono::Utc>>,
    link_expiry: Option<String>,
    start_now: bool,
) -> Result<crate::models::meeting::Meeting, AppError> {
    let workspace = crate::services::workspace::get_workspace(db, tenant_id).await?;
    let members = crate::services::workspace::list_members(db, tenant_id)
        .await
        .unwrap_or_default();
    let member_count = members.len() as i32;
    crate::services::meeting::check_and_increment_rate(db, &workspace.owner_id).await?;
    crate::services::meeting::create_meeting(
        db,
        crate::services::meeting::CreateMeetingParams {
            workspace_id: tenant_id,
            created_by: &workspace.owner_id,
            title: title.to_string(),
            participant_mode: if member_count > 1 {
                "workspace".into()
            } else {
                "personal".into()
            },
            scheduled_start,
            link_expiry,
            start_now,
            workspace_member_count: member_count.max(1),
            app_url: &config.app_url,
        },
    )
    .await
}

async fn execute_tool(
    client: &Client,
    tool: &LlmTool,
    arguments: &Value,
    ctx: &ToolContext<'_>,
) -> (String, ToolCallRecord) {
    let start = std::time::Instant::now();

    // Built-in tool types return synthetic results — actual side-effects are handled post-LLM
    match tool.tool_type.as_str() {
        "send_document" => {
            let result =
                r#"{"status":"queued","message":"Documento será enviado ao usuário."}"#.to_string();
            let record = ToolCallRecord {
                tool_id: tool.id,
                tool_name: tool.name.clone(),
                arguments: arguments.clone(),
                status_code: Some(200),
                response_body: Some(result.clone()),
                error: None,
                duration_ms: 0,
                tool_type: "send_document".to_string(),
            };
            return (result, record);
        }
        "notify_human" => {
            let result =
                r#"{"status":"queued","message":"Agente humano foi notificado."}"#.to_string();
            let record = ToolCallRecord {
                tool_id: tool.id,
                tool_name: tool.name.clone(),
                arguments: arguments.clone(),
                status_code: Some(200),
                response_body: Some(result.clone()),
                error: None,
                duration_ms: 0,
                tool_type: "notify_human".to_string(),
            };
            return (result, record);
        }
        "pix_payment" => {
            let action = arguments
                .get("action")
                .and_then(|v| v.as_str())
                .unwrap_or("create_charge");
            tracing::info!(action = %action, arguments = %arguments, "pix_payment tool called");

            let result = if action == "create_charge" {
                let amount = arguments
                    .get("amount")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                let desc = arguments
                    .get("description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let customer_name = arguments
                    .get("customer_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let customer_cpf = arguments
                    .get("customer_cpf")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");

                if amount <= 0.0 {
                    json!({"status": "error", "message": "Valor deve ser maior que zero."})
                        .to_string()
                } else if desc.is_empty() {
                    json!({"status": "error", "message": "Descrição é obrigatória."}).to_string()
                } else if customer_name.is_empty() || customer_cpf.is_empty() {
                    json!({"status": "error", "message": "Nome e CPF do cliente são obrigatórios."})
                        .to_string()
                } else {
                    json!({"status": "queued", "action": "create_charge", "message": "Cobrança PIX será gerada e enviada ao usuário."}).to_string()
                }
            } else if action == "check_status" {
                let charge_id_str = arguments
                    .get("charge_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if let (Some(db), Some(user_id), Some(encryption), Some(config)) =
                    (ctx.db, ctx.user_id, ctx.encryption, ctx.config)
                {
                    let conv_id = ctx.conversation_id;
                    match uuid::Uuid::parse_str(charge_id_str) {
                        Ok(cid) => {
                            // Use live check: actively polls MP API for pending MP charges
                            match crate::services::pix::check_charge_status_live(
                                db,
                                encryption,
                                config,
                                &user_id,
                                &cid,
                                conv_id.as_ref(),
                            )
                            .await
                            {
                                Ok(charge) => json!({
                                    "status": "ok",
                                    "charge_id": charge.id.to_string(),
                                    "payment_status": charge.status,
                                    "amount": charge.amount,
                                    "description": charge.description,
                                    "message": match charge.status.as_str() {
                                        "approved" => "Pagamento confirmado!",
                                        "pending" => "Pagamento ainda pendente.",
                                        "cancelled" => "Pagamento foi cancelado.",
                                        "refunded" => "Pagamento foi estornado.",
                                        _ => "Status desconhecido."
                                    }
                                })
                                .to_string(),
                                Err(e) => {
                                    json!({"status": "error", "message": e.to_string()}).to_string()
                                }
                            }
                        }
                        Err(_) => json!({"status": "error", "message": "ID da cobrança inválido."})
                            .to_string(),
                    }
                } else {
                    json!({"status": "error", "message": "Serviço de pagamento indisponível."})
                        .to_string()
                }
            } else {
                json!({"status": "error", "message": format!("Ação desconhecida: {}", action)})
                    .to_string()
            };

            let record = ToolCallRecord {
                tool_id: tool.id,
                tool_name: tool.name.clone(),
                arguments: arguments.clone(),
                status_code: Some(200),
                response_body: Some(result.clone()),
                error: None,
                duration_ms: start.elapsed().as_millis() as i32,
                tool_type: "pix_payment".to_string(),
            };
            return (result, record);
        }
        "card_payment" => {
            let action = arguments
                .get("action")
                .and_then(|v| v.as_str())
                .unwrap_or("create_charge");
            tracing::info!(action = %action, arguments = %arguments, "card_payment tool called");

            let result = if action == "create_charge" {
                let amount = arguments
                    .get("amount")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                let desc = arguments
                    .get("description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let customer_name = arguments
                    .get("customer_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let payment_type = arguments
                    .get("payment_type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("credit");
                let installments = arguments
                    .get("installments")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(1) as i32;

                if amount <= 0.0 {
                    json!({"status": "error", "message": "Valor deve ser maior que zero."})
                        .to_string()
                } else if desc.is_empty() {
                    json!({"status": "error", "message": "Descrição é obrigatória."}).to_string()
                } else if customer_name.is_empty() {
                    json!({"status": "error", "message": "Nome do cliente é obrigatório."})
                        .to_string()
                } else if payment_type != "credit" && payment_type != "debit" {
                    json!({"status": "error", "message": "Tipo de pagamento deve ser 'credit' ou 'debit'."}).to_string()
                } else if payment_type == "debit" && installments > 1 {
                    json!({"status": "error", "message": "Cartão de débito não permite parcelamento."}).to_string()
                } else if installments < 1 || installments > 12 {
                    json!({"status": "error", "message": "Parcelas devem ser entre 1 e 12."})
                        .to_string()
                } else if installments > 1 && (amount / installments as f64) < 5.0 {
                    let max_parcelas = (amount / 5.0).floor() as i32;
                    let sugestao = if max_parcelas >= 2 {
                        format!(
                            "Para R$ {:.2}, o máximo é {}x (R$ {:.2}/parcela).",
                            amount,
                            max_parcelas,
                            amount / max_parcelas as f64
                        )
                    } else {
                        format!(
                            "Para R$ {:.2}, apenas pagamento à vista (1x) é permitido.",
                            amount
                        )
                    };
                    json!({"status": "error", "message": format!("Valor mínimo por parcela é R$ 5,00. {}x de R$ {:.2} = R$ {:.2}/parcela. {}", installments, amount, amount / installments as f64, sugestao)}).to_string()
                } else {
                    let parcelas_msg = if installments > 1 {
                        format!(
                            "{}x de R$ {:.2}",
                            installments,
                            amount / installments as f64
                        )
                    } else {
                        "à vista".to_string()
                    };
                    json!({"status": "queued", "action": "create_charge", "message": format!("Link de pagamento por cartão de {} será gerado ({}).", if payment_type == "credit" { "crédito" } else { "débito" }, parcelas_msg)}).to_string()
                }
            } else if action == "check_status" {
                let charge_id_str = arguments
                    .get("charge_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if let (Some(db), Some(user_id), Some(encryption), Some(config)) =
                    (ctx.db, ctx.user_id, ctx.encryption, ctx.config)
                {
                    let conv_id = ctx.conversation_id;
                    match uuid::Uuid::parse_str(charge_id_str) {
                        Ok(cid) => {
                            match crate::services::card_payment::check_charge_status_live(
                                db,
                                encryption,
                                config,
                                &user_id,
                                &cid,
                                conv_id.as_ref(),
                            )
                            .await
                            {
                                Ok(charge) => json!({
                                    "status": "ok",
                                    "charge_id": charge.id.to_string(),
                                    "payment_status": charge.status,
                                    "amount": charge.amount,
                                    "description": charge.description,
                                    "checkout_url": charge.checkout_url,
                                    "message": match charge.status.as_str() {
                                        "approved" => "Pagamento confirmado!",
                                        "pending" => "Pagamento ainda pendente.",
                                        "cancelled" => "Pagamento foi cancelado ou expirou.",
                                        "refunded" => "Pagamento foi estornado.",
                                        _ => "Status desconhecido."
                                    }
                                })
                                .to_string(),
                                Err(e) => {
                                    json!({"status": "error", "message": e.to_string()}).to_string()
                                }
                            }
                        }
                        Err(_) => json!({"status": "error", "message": "ID da cobrança inválido."})
                            .to_string(),
                    }
                } else {
                    json!({"status": "error", "message": "Serviço de pagamento indisponível."})
                        .to_string()
                }
            } else {
                json!({"status": "error", "message": format!("Ação desconhecida: {}", action)})
                    .to_string()
            };

            let record = ToolCallRecord {
                tool_id: tool.id,
                tool_name: tool.name.clone(),
                arguments: arguments.clone(),
                status_code: Some(200),
                response_body: Some(result.clone()),
                error: None,
                duration_ms: start.elapsed().as_millis() as i32,
                tool_type: "card_payment".to_string(),
            };
            return (result, record);
        }
        "current_datetime" => {
            // Resolve the assistant's configured timezone if available, else São Paulo.
            let tz = if let (Some(db), Some(aid)) = (ctx.db, ctx.assistant_id) {
                crate::services::appointment::resolve_assistant_tz(db, &aid).await
            } else {
                chrono_tz::America::Sao_Paulo
            };
            let now_utc = chrono::Utc::now();
            let now_local = now_utc.with_timezone(&tz);
            let weekdays_pt = [
                "segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo",
            ];
            let weekday = weekdays_pt[now_local.weekday().num_days_from_monday() as usize];
            let result = json!({
                "status": "ok",
                "iso": now_local.to_rfc3339(),
                "iso_utc": now_utc.to_rfc3339(),
                "date": now_local.format("%Y-%m-%d").to_string(),
                "time": now_local.format("%H:%M").to_string(),
                "weekday": weekday,
                "timezone": tz.name(),
            })
            .to_string();

            let record = ToolCallRecord {
                tool_id: tool.id,
                tool_name: tool.name.clone(),
                arguments: arguments.clone(),
                status_code: Some(200),
                response_body: Some(result.clone()),
                error: None,
                duration_ms: start.elapsed().as_millis() as i32,
                tool_type: "current_datetime".to_string(),
            };
            return (result, record);
        }
        "create_meeting" => {
            let meeting_type = arguments
                .get("meeting_type")
                .and_then(|v| v.as_str())
                .unwrap_or("instant");
            let title = arguments
                .get("title")
                .and_then(|v| v.as_str())
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .unwrap_or("Reunião");
            tracing::info!(meeting_type = %meeting_type, title = %title, "create_meeting tool called");

            let result = if let (Some(db), Some(user_id), Some(config)) =
                (ctx.db, ctx.user_id, ctx.config)
            {
                let link_expiry = meeting_expiry_from_headers(tool.headers.as_deref(), "link_expiry")
                    .unwrap_or_else(|| "24h".to_string());

                let (scheduled_start, start_now) = if meeting_type == "scheduled" {
                    let scheduled_str = arguments
                        .get("scheduled_start")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let tz = if let Some(aid) = ctx.assistant_id {
                        crate::services::appointment::resolve_assistant_tz(db, &aid).await
                    } else {
                        chrono_tz::America::Sao_Paulo
                    };
                    match crate::services::appointment::parse_datetime_in_tz(scheduled_str, &tz) {
                        Some(dt) => (Some(dt), false),
                        None => (None, true), // fallback: treat as instant
                    }
                } else {
                    (None, true)
                };

                match create_meeting_for_tool(
                    db,
                    config,
                    &user_id,
                    title,
                    scheduled_start,
                    Some(link_expiry),
                    start_now,
                )
                .await
                {
                    Ok(meeting) => {
                        let starts_at = meeting
                            .scheduled_start
                            .or(meeting.started_at)
                            .map(|d| d.to_rfc3339());
                        json!({
                            "status": "ok",
                            "meeting_type": if start_now { "instant" } else { "scheduled" },
                            "code": meeting.code,
                            "share_url": meeting.share_url,
                            "starts_at": starts_at,
                            "expires_at": meeting.expires_at.map(|d| d.to_rfc3339()),
                        })
                        .to_string()
                    }
                    Err(e) => {
                        json!({"status": "error", "message": e.to_string()}).to_string()
                    }
                }
            } else {
                json!({"status": "error", "message": "Serviço de reuniões indisponível"})
                    .to_string()
            };

            let record = ToolCallRecord {
                tool_id: tool.id,
                tool_name: tool.name.clone(),
                arguments: arguments.clone(),
                status_code: Some(200),
                response_body: Some(result.clone()),
                error: None,
                duration_ms: start.elapsed().as_millis() as i32,
                tool_type: "create_meeting".to_string(),
            };
            return (result, record);
        }
        "schedule_appointment" => {
            let action = arguments
                .get("action")
                .and_then(|v| v.as_str())
                .unwrap_or("create");
            tracing::info!(action = %action, arguments = %arguments, "schedule_appointment tool called");

            let result = if action == "check_availability" {
                if let (Some(db), Some(assistant_id)) = (ctx.db, ctx.assistant_id) {
                    let date = arguments.get("date").and_then(|v| v.as_str()).unwrap_or("");
                    let week_start = arguments
                        .get("week_start")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");

                    if !week_start.is_empty() {
                        // Week-level availability summary (7 days)
                        match crate::services::appointment::get_available_days(
                            db,
                            &assistant_id,
                            week_start,
                        )
                        .await
                        {
                            Ok(days) => {
                                json!({"status": "ok", "week_start": week_start, "days": days})
                                    .to_string()
                            }
                            Err(e) => {
                                json!({"status": "error", "message": e.to_string()}).to_string()
                            }
                        }
                    } else if !date.is_empty() {
                        // Day-level: specific time slots
                        match crate::services::appointment::get_available_slots(db, &assistant_id, date).await {
                            Ok(slots) if slots.is_empty() => {
                                json!({"status": "ok", "available_slots": [], "message": "Não há horários disponíveis nesta data."}).to_string()
                            }
                            Ok(slots) => {
                                json!({"status": "ok", "available_slots": slots, "date": date}).to_string()
                            }
                            Err(e) => json!({"status": "error", "message": e.to_string()}).to_string(),
                        }
                    } else {
                        json!({"status": "error", "message": "Informe 'date' (YYYY-MM-DD) para horários ou 'week_start' (YYYY-MM-DD) para disponibilidade semanal."}).to_string()
                    }
                } else {
                    json!({"status": "error", "message": "Serviço de agendamento indisponível"})
                        .to_string()
                }
            } else if action == "create" {
                // Pre-validate before telling the LLM it's queued
                if let (Some(db), Some(assistant_id)) = (ctx.db, ctx.assistant_id) {
                    let date_time_str = arguments
                        .get("date_time")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let tz =
                        crate::services::appointment::resolve_assistant_tz(db, &assistant_id).await;
                    let dt_utc =
                        crate::services::appointment::parse_datetime_in_tz(date_time_str, &tz);

                    match dt_utc {
                        Some(dt_utc) => {
                            let duration = if let Some(d) = arguments.get("duration_minutes").and_then(|v| v.as_i64()) {
                                d as i32
                            } else {
                                match crate::services::appointment::get_availability(db, &assistant_id).await {
                                    Ok(Some(avail)) => avail.default_duration_minutes,
                                    _ => 30,
                                }
                            };
                            match crate::services::appointment::validate_appointment(db, &assistant_id, &dt_utc, duration, None).await {
                                Ok(errors) if !errors.is_empty() => {
                                    json!({"status": "error", "action": "create", "errors": errors, "message": "Não foi possível agendar. Informe os erros ao cliente e sugira alternativas."}).to_string()
                                }
                                Ok(_) => {
                                    // If the tool is configured to auto-generate a meeting, try it here
                                    // so the LLM can include the link in its natural-language reply.
                                    let auto_meeting = tool
                                        .headers
                                        .as_deref()
                                        .and_then(|h| serde_json::from_str::<Value>(h).ok())
                                        .and_then(|v| v.get("auto_generate_meeting").and_then(|b| b.as_bool()))
                                        .unwrap_or(false);

                                    let mut response = json!({
                                        "status": "queued",
                                        "action": "create",
                                        "message": "Agendamento validado e será processado."
                                    });

                                    if auto_meeting {
                                        if let (Some(user_id), Some(config)) = (ctx.user_id, ctx.config) {
                                            let link_expiry = meeting_expiry_from_headers(tool.headers.as_deref(), "meeting_link_expiry")
                                                .unwrap_or_else(|| "7d".to_string());
                                            let client_name = arguments
                                                .get("client_name")
                                                .and_then(|v| v.as_str())
                                                .map(|s| s.trim())
                                                .filter(|s| !s.is_empty())
                                                .unwrap_or("cliente");
                                            let title = format!("Compromisso: {}", client_name);
                                            match create_meeting_for_tool(db, config, &user_id, &title, Some(dt_utc), Some(link_expiry), false).await {
                                                Ok(meeting) => {
                                                    response["meeting"] = json!({
                                                        "id": meeting.id.to_string(),
                                                        "code": meeting.code,
                                                        "share_url": meeting.share_url,
                                                    });
                                                    response["message"] = json!("Agendamento validado. Link da reunião foi gerado — inclua-o na confirmação ao cliente.");
                                                }
                                                Err(e) => {
                                                    response["meeting_error"] = json!(e.to_string());
                                                }
                                            }
                                        }
                                    }

                                    response.to_string()
                                }
                                Err(e) => {
                                    json!({"status": "error", "action": "create", "message": format!("Erro ao validar: {}", e)}).to_string()
                                }
                            }
                        }
                        None => {
                            json!({"status": "error", "action": "create", "message": "Data/hora inválida. Use formato ISO 8601 (ex: 2026-04-15T14:00:00)"}).to_string()
                        }
                    }
                } else {
                    json!({"status": "error", "message": "Serviço de agendamento indisponível"})
                        .to_string()
                }
            } else if action == "reschedule" {
                // Pre-validate rescheduling
                if let (Some(db), Some(assistant_id)) = (ctx.db, ctx.assistant_id) {
                    let date_time_str = arguments
                        .get("date_time")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let appointment_id_str = arguments
                        .get("appointment_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let tz =
                        crate::services::appointment::resolve_assistant_tz(db, &assistant_id).await;
                    let dt_utc =
                        crate::services::appointment::parse_datetime_in_tz(date_time_str, &tz);

                    match (dt_utc, uuid::Uuid::parse_str(appointment_id_str)) {
                        (Some(dt_utc), Ok(appt_id)) => {
                            let duration = if let Some(d) = arguments.get("duration_minutes").and_then(|v| v.as_i64()) {
                                d as i32
                            } else if let Some(user_id) = ctx.user_id {
                                match crate::services::appointment::get_appointment(db, &user_id, &appt_id).await {
                                    Ok(existing) => existing.duration_minutes,
                                    _ => 30,
                                }
                            } else {
                                30
                            };
                            match crate::services::appointment::validate_appointment(db, &assistant_id, &dt_utc, duration, Some(&appt_id)).await {
                                Ok(errors) if !errors.is_empty() => {
                                    json!({"status": "error", "action": "reschedule", "errors": errors, "message": "Não foi possível reagendar. Informe os erros ao cliente e sugira alternativas."}).to_string()
                                }
                                Ok(_) => {
                                    json!({"status": "queued", "action": "reschedule", "message": "Reagendamento validado e será processado."}).to_string()
                                }
                                Err(e) => {
                                    json!({"status": "error", "action": "reschedule", "message": format!("Erro ao validar: {}", e)}).to_string()
                                }
                            }
                        }
                        _ => {
                            json!({"status": "error", "action": "reschedule", "message": "Data/hora ou ID do agendamento inválido."}).to_string()
                        }
                    }
                } else {
                    json!({"status": "error", "message": "Serviço de agendamento indisponível"})
                        .to_string()
                }
            } else {
                // cancel — no pre-validation needed, side effects in messaging.rs
                json!({"status": "queued", "action": action, "message": "Solicitação será processada."}).to_string()
            };

            let record = ToolCallRecord {
                tool_id: tool.id,
                tool_name: tool.name.clone(),
                arguments: arguments.clone(),
                status_code: Some(200),
                response_body: Some(result.clone()),
                error: None,
                duration_ms: start.elapsed().as_millis() as i32,
                tool_type: "schedule_appointment".to_string(),
            };
            return (result, record);
        }
        _ => {}
    }

    // Interpolate {{placeholders}} in the endpoint URL with argument values
    let mut endpoint = interpolate_template(&tool.endpoint, arguments);

    // Apply query parameters from extended config
    if let Some(query_params) = &tool.query_params {
        if let Ok(mut url) = reqwest::Url::parse(&endpoint) {
            for param in query_params {
                if let (Some(key), Some(value)) = (
                    param.get("key").and_then(|k| k.as_str()),
                    param.get("value").and_then(|v| v.as_str()),
                ) {
                    if !key.trim().is_empty() {
                        let interpolated_value = interpolate_template(value, arguments);
                        url.query_pairs_mut().append_pair(key, &interpolated_value);
                    }
                }
            }
            endpoint = url.to_string();
        }
    }

    let mut req = match tool.method.to_uppercase().as_str() {
        "GET" => client.get(&endpoint),
        "POST" => client.post(&endpoint),
        "PUT" => client.put(&endpoint),
        "PATCH" => client.patch(&endpoint),
        "DELETE" => client.delete(&endpoint),
        _ => client.post(&endpoint),
    };

    // Add custom headers (with placeholder interpolation)
    if let Some(headers_json) = &tool.headers {
        let interpolated = interpolate_template(headers_json, arguments);
        if let Ok(headers) = serde_json::from_str::<Value>(&interpolated) {
            if let Some(obj) = headers.as_object() {
                for (k, v) in obj {
                    if let Some(val) = v.as_str() {
                        req = req.header(k.as_str(), val);
                    }
                }
            }
        }
    }

    // Apply auth from extended config
    if let Some(auth) = &tool.auth {
        let auth_type = auth.get("type").and_then(|t| t.as_str()).unwrap_or("none");
        match auth_type {
            "bearer" => {
                if let Some(token) = auth.get("token").and_then(|t| t.as_str()) {
                    req = req.header("Authorization", format!("Bearer {token}"));
                }
            }
            "basic" => {
                let username = auth.get("username").and_then(|u| u.as_str()).unwrap_or("");
                let password = auth.get("password").and_then(|p| p.as_str()).unwrap_or("");
                req = req.basic_auth(username, Some(password));
            }
            "header" => {
                if let (Some(name), Some(value)) = (
                    auth.get("headerName").and_then(|n| n.as_str()),
                    auth.get("headerValue").and_then(|v| v.as_str()),
                ) {
                    req = req.header(name, value);
                }
            }
            _ => {}
        }
    }

    // For POST/PUT/PATCH, send body content or arguments
    if matches!(
        tool.method.to_uppercase().as_str(),
        "POST" | "PUT" | "PATCH"
    ) {
        if let Some(body_template) = &tool.body_content {
            if !body_template.trim().is_empty() {
                let interpolated_body = interpolate_template(body_template, arguments);
                let content_type = tool.body_content_type.as_deref().unwrap_or("json");
                match content_type {
                    "json" => {
                        req = req.header("Content-Type", "application/json");
                        req = req.body(interpolated_body);
                    }
                    "form-urlencoded" => {
                        req = req.header("Content-Type", "application/x-www-form-urlencoded");
                        req = req.body(interpolated_body);
                    }
                    _ => {
                        req = req.body(interpolated_body);
                    }
                }
            } else {
                req = req.json(arguments);
            }
        } else {
            req = req.json(arguments);
        }
    }

    let duration_ms = |s: std::time::Instant| s.elapsed().as_millis() as i32;

    tracing::info!(tool = %tool.name, endpoint = %endpoint, method = %tool.method, "Executing tool call");

    match req.send().await {
        Ok(resp) => {
            let status = resp.status().as_u16() as i32;
            tracing::info!(tool = %tool.name, status = status, "Tool call response");
            match resp.text().await {
                Ok(text) => {
                    let result_text = if text.len() > 65536 {
                        format!("{}...[truncated]", &text[..65536])
                    } else {
                        text.clone()
                    };
                    let record = ToolCallRecord {
                        tool_id: tool.id,
                        tool_name: tool.name.clone(),
                        arguments: arguments.clone(),
                        status_code: Some(status),
                        response_body: Some(if text.len() > 8000 {
                            format!("{}...[truncated]", &text[..8000])
                        } else {
                            text
                        }),
                        error: None,
                        duration_ms: duration_ms(start),
                        tool_type: tool.tool_type.clone(),
                    };
                    (result_text, record)
                }
                Err(e) => {
                    let err_msg = format!("Error reading tool response: {e}");
                    let record = ToolCallRecord {
                        tool_id: tool.id,
                        tool_name: tool.name.clone(),
                        arguments: arguments.clone(),
                        status_code: Some(status),
                        response_body: None,
                        error: Some(err_msg.clone()),
                        duration_ms: duration_ms(start),
                        tool_type: tool.tool_type.clone(),
                    };
                    (err_msg, record)
                }
            }
        }
        Err(e) => {
            let err_msg = format!("Error calling tool: {e}");
            tracing::error!(tool = %tool.name, error = %e, "Tool call failed");
            let record = ToolCallRecord {
                tool_id: tool.id,
                tool_name: tool.name.clone(),
                arguments: arguments.clone(),
                status_code: None,
                response_body: None,
                error: Some(err_msg.clone()),
                duration_ms: duration_ms(start),
                tool_type: tool.tool_type.clone(),
            };
            (err_msg, record)
        }
    }
}

// =====================================================================
// OpenAI
// =====================================================================

/// Returns true for reasoning models that don't accept temperature.
/// Includes o-series and GPT-5 family (all are reasoning models).
fn is_openai_reasoning_model(model: &str) -> bool {
    model.starts_with("o1")
        || model.starts_with("o3")
        || model.starts_with("o4")
        || model.starts_with("gpt-5")
}

/// Returns true for models that require max_completion_tokens instead of max_tokens
fn is_openai_new_api_model(model: &str) -> bool {
    is_openai_reasoning_model(model)
        || model.starts_with("gpt-5")
        || model.starts_with("gpt-4.1")
        || model.starts_with("chatgpt-")
}

/// OpenAI tool call loop with proper role="tool" + tool_call_id formatting
async fn call_openai_with_tools(
    client: &Client,
    api_key: &str,
    model: &str,
    messages: Vec<LlmMessage>,
    temperature: f32,
    max_tokens: i32,
    tools: &[LlmTool],
    ctx: &ToolContext<'_>,
) -> Result<LlmResponse, AppError> {
    // Convert LlmMessages to OpenAI JSON format.
    // GPT-5, GPT-4.1, o-series and chatgpt-* models use "developer" instead of "system".
    let use_developer_role = is_openai_new_api_model(model);
    let mut raw_messages: Vec<Value> = messages
        .iter()
        .map(|m| {
            let role = if m.role == "system" && use_developer_role {
                "developer"
            } else {
                &m.role
            };
            let content = if let (Some(b64), Some(mime)) = (&m.media_base64, &m.media_mime_type) {
                let mut parts = vec![];
                if !m.content.is_empty() {
                    parts.push(json!({"type": "text", "text": m.content}));
                }
                if mime == "application/pdf" {
                    parts.push(json!({
                        "type": "file",
                        "file": { "filename": "document.pdf", "file_data": format!("data:{mime};base64,{b64}") }
                    }));
                } else {
                    parts.push(json!({
                        "type": "image_url",
                        "image_url": { "url": format!("data:{mime};base64,{b64}") }
                    }));
                }
                json!(parts)
            } else {
                json!(m.content)
            };
            json!({"role": role, "content": content})
        })
        .collect();

    let mut total_tokens = 0i32;
    let mut all_records: Vec<ToolCallRecord> = Vec::new();

    let timeout = resolve_llm_timeout(ctx);
    // W1.2 caps (per-assistant overrides with code defaults).
    let max_rounds = ctx
        .max_tool_rounds
        .filter(|v| *v > 0)
        .unwrap_or(DEFAULT_MAX_TOOL_ROUNDS);
    let max_duration = Duration::from_millis(
        ctx.max_duration_ms
            .filter(|v| *v > 0)
            .unwrap_or(DEFAULT_MAX_DURATION_MS) as u64,
    );
    let loop_started = Instant::now();

    for round in 0..max_rounds {
        // W1.2 — duration cap check BEFORE issuing the next provider call.
        if loop_started.elapsed() > max_duration {
            tracing::warn!(
                event = "cap_hit",
                cap = "max_duration_ms",
                elapsed_ms = loop_started.elapsed().as_millis() as u64,
                budget_ms = max_duration.as_millis() as u64,
                provider = "openai",
                "tool loop duration cap hit"
            );
            return Err(AppError::InternalError(format!(
                "Limite de duração das rodadas de ferramentas atingido ({} ms). Considere simplificar o fluxo.",
                max_duration.as_millis()
            )));
        }

        let result = call_openai_raw(
            client,
            api_key,
            model,
            &raw_messages,
            temperature,
            max_tokens,
            tools,
            timeout,
        )
        .await?;
        total_tokens += result.tokens;

        match result.tool_calls {
            Some(calls) if !calls.is_empty() => {
                let tool_names: Vec<&str> = calls.iter().map(|c| c.name.as_str()).collect();
                tracing::info!(round = round, tools = ?tool_names, "OpenAI tool call round");
                // Echo back assistant message WITH the raw tool_calls array
                let mut assistant_msg = json!({
                    "role": "assistant",
                });
                if !result.content.is_empty() {
                    assistant_msg["content"] = json!(result.content);
                }
                if let Some(raw_tc) = &result.raw_tool_calls {
                    assistant_msg["tool_calls"] = raw_tc.clone();
                }
                raw_messages.push(assistant_msg);

                // Execute each tool and add results with role="tool" + tool_call_id
                for call in &calls {
                    let tool = tools.iter().find(|t| t.name == call.name);
                    let (tool_result, record) = if let Some(t) = tool {
                        execute_tool(client, t, &call.arguments, ctx).await
                    } else {
                        let err_msg = format!("Error: tool '{}' not found", call.name);
                        (
                            err_msg.clone(),
                            ToolCallRecord {
                                tool_id: None,
                                tool_name: call.name.clone(),
                                arguments: call.arguments.clone(),
                                status_code: None,
                                response_body: None,
                                error: Some(err_msg),
                                duration_ms: 0,
                                tool_type: "http_request".to_string(),
                            },
                        )
                    };
                    all_records.push(record);

                    raw_messages.push(json!({
                        "role": "tool",
                        "tool_call_id": call.id,
                        "content": tool_result,
                    }));
                }
            }
            _ => {
                return Ok(LlmResponse {
                    content: result.content,
                    tokens_used: total_tokens,
                    tool_call_records: all_records,
                });
            }
        }
    }

    tracing::warn!(
        event = "cap_hit",
        cap = "max_tool_rounds",
        rounds = max_rounds,
        provider = "openai",
        "tool loop rounds cap hit"
    );
    Err(AppError::InternalError(format!(
        "Limite de rodadas de ferramentas atingido ({max_rounds}). Considere simplificar o fluxo."
    )))
}

async fn call_openai_raw(
    client: &Client,
    api_key: &str,
    model: &str,
    messages: &[Value],
    temperature: f32,
    max_tokens: i32,
    tools: &[LlmTool],
    timeout: Duration,
) -> Result<RawLlmResult, AppError> {
    // W1.1 — short-circuit if provider health is poor.
    if let Some(err) = check_circuit_open("openai") {
        return Err(AppError::InternalError(err));
    }

    let result: Result<RawLlmResult, AppError> = async {
        let mut body = json!({
            "model": model,
            "messages": messages,
        });

        // Newer models use max_completion_tokens; older ones use max_tokens
        if is_openai_new_api_model(model) {
            body["max_completion_tokens"] = json!(max_tokens);
        } else {
            body["max_tokens"] = json!(max_tokens);
        }

        // Reasoning models don't accept temperature
        if !is_openai_reasoning_model(model) {
            body["temperature"] = json!(temperature);
        }

        if !tools.is_empty() {
            let functions: Vec<Value> = tools
                .iter()
                .map(|t| {
                    json!({
                        "type": "function",
                        "function": {
                            "name": t.name,
                            "description": t.description,
                            "parameters": t.parameters,
                        }
                    })
                })
                .collect();
            body["tools"] = json!(functions);
        }

        let send_fut = client
            .post("https://api.openai.com/v1/chat/completions")
            .header("Authorization", format!("Bearer {api_key}"))
            .json(&body)
            .send();
        let resp = tokio::time::timeout(timeout, send_fut)
            .await
            .map_err(|_| llm_timeout_error("openai", timeout.as_secs()))?
            .map_err(|e| AppError::InternalError(format!("OpenAI request failed: {e}")))?;

        let data: Value = resp
            .json()
            .await
            .map_err(|e| AppError::InternalError(format!("OpenAI response parse failed: {e}")))?;

        // Check for API error response
        if let Some(err) = data["error"]["message"].as_str() {
            tracing::error!("OpenAI API error for model {model}: {err}");
            return Err(AppError::InternalError(format!("OpenAI API error: {err}")));
        }

        let message = &data["choices"][0]["message"];
        let content = message["content"].as_str().unwrap_or("").to_string();
        let tokens = data["usage"]["total_tokens"].as_i64().unwrap_or(0) as i32;

        // Preserve raw tool_calls for echoing back
        let raw_tool_calls = message.get("tool_calls").cloned();

        let tool_calls = message["tool_calls"].as_array().map(|calls| {
            calls
                .iter()
                .filter_map(|c| {
                    let id = c["id"].as_str()?.to_string();
                    let name = c["function"]["name"].as_str()?.to_string();
                    let args: Value = c["function"]["arguments"]
                        .as_str()
                        .and_then(|s| serde_json::from_str(s).ok())
                        .unwrap_or(json!({}));
                    Some(ToolCall {
                        id,
                        name,
                        arguments: args,
                    })
                })
                .collect()
        });

        Ok(RawLlmResult {
            content,
            tokens,
            tool_calls,
            raw_tool_calls,
            raw_content_blocks: None,
        })
    }
    .await;

    match &result {
        Ok(_) => record_success("openai"),
        Err(_) => record_failure("openai"),
    }
    result
}

// =====================================================================
// Claude
// =====================================================================

/// Merge consecutive same-role messages and ensure alternation starts with "user".
/// Claude API requires strict user/assistant alternation.
fn coalesce_claude_messages(messages: Vec<Value>) -> Vec<Value> {
    if messages.is_empty() {
        return messages;
    }

    let mut coalesced: Vec<Value> = Vec::new();
    for msg in messages {
        let role = msg["role"].as_str().unwrap_or("user");
        if let Some(last) = coalesced.last_mut() {
            if last["role"].as_str().unwrap_or("") == role {
                // Merge: append content with separator
                let prev = last["content"].as_str().unwrap_or("").to_string();
                let curr = msg["content"].as_str().unwrap_or("");
                last["content"] = json!(format!("{prev}\n\n{curr}"));
                continue;
            }
        }
        coalesced.push(msg);
    }

    // Ensure first message is "user" (Claude requirement)
    if let Some(first) = coalesced.first() {
        if first["role"].as_str() == Some("assistant") {
            coalesced.insert(0, json!({"role": "user", "content": "Continue."}));
        }
    }

    coalesced
}

/// Claude tool call loop with proper tool_result content blocks + tool_use_id
async fn call_claude_with_tools(
    client: &Client,
    api_key: &str,
    model: &str,
    messages: Vec<LlmMessage>,
    temperature: f32,
    max_tokens: i32,
    tools: &[LlmTool],
    ctx: &ToolContext<'_>,
) -> Result<LlmResponse, AppError> {
    // Extract system message
    let system_msg = messages
        .iter()
        .find(|m| m.role == "system")
        .map(|m| m.content.clone());

    // Build initial messages (excluding system), then coalesce for alternation
    let initial: Vec<Value> = messages
        .iter()
        .filter(|m| m.role != "system")
        .map(|m| {
            let content = if let (Some(b64), Some(mime)) = (&m.media_base64, &m.media_mime_type) {
                let mut parts = vec![];
                if !m.content.is_empty() {
                    parts.push(json!({"type": "text", "text": m.content}));
                }
                if mime == "application/pdf" {
                    parts.push(json!({
                        "type": "document",
                        "source": { "type": "base64", "media_type": mime, "data": b64 }
                    }));
                } else {
                    parts.push(json!({
                        "type": "image",
                        "source": { "type": "base64", "media_type": mime, "data": b64 }
                    }));
                }
                json!(parts)
            } else {
                json!(m.content)
            };
            json!({"role": m.role, "content": content})
        })
        .collect();
    let mut raw_messages = coalesce_claude_messages(initial);

    let mut total_tokens = 0i32;
    let mut all_records: Vec<ToolCallRecord> = Vec::new();

    let timeout = resolve_llm_timeout(ctx);
    // W1.2 caps
    let max_rounds = ctx
        .max_tool_rounds
        .filter(|v| *v > 0)
        .unwrap_or(DEFAULT_MAX_TOOL_ROUNDS);
    let max_duration = Duration::from_millis(
        ctx.max_duration_ms
            .filter(|v| *v > 0)
            .unwrap_or(DEFAULT_MAX_DURATION_MS) as u64,
    );
    let loop_started = Instant::now();

    for round in 0..max_rounds {
        if loop_started.elapsed() > max_duration {
            tracing::warn!(
                event = "cap_hit",
                cap = "max_duration_ms",
                elapsed_ms = loop_started.elapsed().as_millis() as u64,
                budget_ms = max_duration.as_millis() as u64,
                provider = "claude",
                "tool loop duration cap hit"
            );
            return Err(AppError::InternalError(format!(
                "Limite de duração das rodadas de ferramentas atingido ({} ms). Considere simplificar o fluxo.",
                max_duration.as_millis()
            )));
        }
        let result = call_claude_raw(
            client,
            api_key,
            model,
            &raw_messages,
            &system_msg,
            temperature,
            max_tokens,
            tools,
            timeout,
        )
        .await?;
        total_tokens += result.tokens;

        match result.tool_calls {
            Some(calls) if !calls.is_empty() => {
                let tool_names: Vec<&str> = calls.iter().map(|c| c.name.as_str()).collect();
                tracing::info!(round = round, tools = ?tool_names, "Claude tool call round");
                // Echo back assistant message with the raw content blocks (text + tool_use)
                if let Some(raw_blocks) = &result.raw_content_blocks {
                    raw_messages.push(json!({
                        "role": "assistant",
                        "content": raw_blocks,
                    }));
                } else {
                    raw_messages.push(json!({
                        "role": "assistant",
                        "content": result.content,
                    }));
                }

                // Execute tools and build a SINGLE user message with all tool_result blocks
                let mut tool_result_blocks: Vec<Value> = Vec::new();
                for call in &calls {
                    let tool = tools.iter().find(|t| t.name == call.name);
                    let (tool_result, record) = if let Some(t) = tool {
                        execute_tool(client, t, &call.arguments, ctx).await
                    } else {
                        let err_msg = format!("Error: tool '{}' not found", call.name);
                        (
                            err_msg.clone(),
                            ToolCallRecord {
                                tool_id: None,
                                tool_name: call.name.clone(),
                                arguments: call.arguments.clone(),
                                status_code: None,
                                response_body: None,
                                error: Some(err_msg),
                                duration_ms: 0,
                                tool_type: "http_request".to_string(),
                            },
                        )
                    };
                    all_records.push(record);

                    tool_result_blocks.push(json!({
                        "type": "tool_result",
                        "tool_use_id": call.id,
                        "content": tool_result,
                    }));
                }

                raw_messages.push(json!({
                    "role": "user",
                    "content": tool_result_blocks,
                }));
            }
            _ => {
                return Ok(LlmResponse {
                    content: result.content,
                    tokens_used: total_tokens,
                    tool_call_records: all_records,
                });
            }
        }
    }

    tracing::warn!(
        event = "cap_hit",
        cap = "max_tool_rounds",
        rounds = max_rounds,
        provider = "claude",
        "tool loop rounds cap hit"
    );
    Err(AppError::InternalError(format!(
        "Limite de rodadas de ferramentas atingido ({max_rounds}). Considere simplificar o fluxo."
    )))
}

async fn call_claude_raw(
    client: &Client,
    api_key: &str,
    model: &str,
    messages: &[Value],
    system_msg: &Option<String>,
    temperature: f32,
    max_tokens: i32,
    tools: &[LlmTool],
    timeout: Duration,
) -> Result<RawLlmResult, AppError> {
    // W1.1 — short-circuit if provider health is poor.
    if let Some(err) = check_circuit_open("claude") {
        return Err(AppError::InternalError(err));
    }

    let result: Result<RawLlmResult, AppError> = async {
        let mut body = json!({
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        });

        if let Some(system) = system_msg {
            body["system"] = json!(system);
        }

        if !tools.is_empty() {
            let tool_defs: Vec<Value> = tools
                .iter()
                .map(|t| {
                    json!({
                        "name": t.name,
                        "description": t.description,
                        "input_schema": t.parameters,
                    })
                })
                .collect();
            body["tools"] = json!(tool_defs);
        }

        let send_fut = client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send();
        let resp = tokio::time::timeout(timeout, send_fut)
            .await
            .map_err(|_| llm_timeout_error("claude", timeout.as_secs()))?
            .map_err(|e| AppError::InternalError(format!("Claude request failed: {e}")))?;

        let data: Value = resp
            .json()
            .await
            .map_err(|e| AppError::InternalError(format!("Claude response parse failed: {e}")))?;

        // Check for API error response
        if let Some(err) = data["error"]["message"].as_str() {
            tracing::error!("Claude API error for model {model}: {err}");
            return Err(AppError::InternalError(format!("Claude API error: {err}")));
        }

        let mut content = String::new();
        let mut tool_calls = Vec::new();

        // Preserve raw content blocks for echoing back (needed for tool_use IDs)
        let raw_content_blocks = data.get("content").cloned();

        if let Some(blocks) = data["content"].as_array() {
            for block in blocks {
                match block["type"].as_str() {
                    Some("text") => {
                        content.push_str(block["text"].as_str().unwrap_or(""));
                    }
                    Some("tool_use") => {
                        if let (Some(id), Some(name)) =
                            (block["id"].as_str(), block["name"].as_str())
                        {
                            tool_calls.push(ToolCall {
                                id: id.to_string(),
                                name: name.to_string(),
                                arguments: block["input"].clone(),
                            });
                        }
                    }
                    _ => {}
                }
            }
        }

        let input_tokens = data["usage"]["input_tokens"].as_i64().unwrap_or(0);
        let output_tokens = data["usage"]["output_tokens"].as_i64().unwrap_or(0);

        Ok(RawLlmResult {
            content,
            tokens: (input_tokens + output_tokens) as i32,
            tool_calls: if tool_calls.is_empty() {
                None
            } else {
                Some(tool_calls)
            },
            raw_tool_calls: None,
            raw_content_blocks,
        })
    }
    .await;

    match &result {
        Ok(_) => record_success("claude"),
        Err(_) => record_failure("claude"),
    }
    result
}

// =====================================================================
// Gemini — supports function calling via `tools.functionDeclarations`
// =====================================================================

/// Gemini tool-call loop. Mirrors the Claude pattern: iterate up to 5 rounds,
/// echo `functionCall` parts back as a "model" turn, send `functionResponse`
/// parts as a "function" turn, stop when Gemini returns plain text.
async fn call_gemini_with_tools(
    client: &Client,
    api_key: &str,
    model: &str,
    messages: Vec<LlmMessage>,
    temperature: f32,
    max_tokens: i32,
    tools: &[LlmTool],
    ctx: &ToolContext<'_>,
) -> Result<LlmResponse, AppError> {
    let system_instruction = messages
        .iter()
        .find(|m| m.role == "system")
        .map(|m| json!({"parts": [{"text": m.content}]}));

    let initial: Vec<Value> = messages
        .iter()
        .filter(|m| m.role != "system")
        .map(|m| {
            let role = if m.role == "assistant" { "model" } else { "user" };
            let parts = if let (Some(b64), Some(mime)) = (&m.media_base64, &m.media_mime_type) {
                let mut p = vec![];
                if !m.content.is_empty() {
                    p.push(json!({"text": m.content}));
                }
                p.push(json!({"inline_data": {"mime_type": mime, "data": b64}}));
                p
            } else {
                vec![json!({"text": m.content})]
            };
            json!({"role": role, "parts": parts})
        })
        .collect();

    let mut contents = coalesce_gemini_contents(initial);

    let mut total_tokens = 0i32;
    let mut all_records: Vec<ToolCallRecord> = Vec::new();

    let timeout = resolve_llm_timeout(ctx);
    // W1.2 caps
    let max_rounds = ctx
        .max_tool_rounds
        .filter(|v| *v > 0)
        .unwrap_or(DEFAULT_MAX_TOOL_ROUNDS);
    let max_duration = Duration::from_millis(
        ctx.max_duration_ms
            .filter(|v| *v > 0)
            .unwrap_or(DEFAULT_MAX_DURATION_MS) as u64,
    );
    let loop_started = Instant::now();

    for round in 0..max_rounds {
        if loop_started.elapsed() > max_duration {
            tracing::warn!(
                event = "cap_hit",
                cap = "max_duration_ms",
                elapsed_ms = loop_started.elapsed().as_millis() as u64,
                budget_ms = max_duration.as_millis() as u64,
                provider = "gemini",
                "tool loop duration cap hit"
            );
            return Err(AppError::InternalError(format!(
                "Limite de duração das rodadas de ferramentas atingido ({} ms). Considere simplificar o fluxo.",
                max_duration.as_millis()
            )));
        }
        let result = call_gemini_raw(
            client,
            api_key,
            model,
            &contents,
            &system_instruction,
            temperature,
            max_tokens,
            tools,
            timeout,
        )
        .await?;
        total_tokens += result.tokens;

        match result.tool_calls {
            Some(calls) if !calls.is_empty() => {
                let tool_names: Vec<&str> = calls.iter().map(|c| c.name.as_str()).collect();
                tracing::info!(round = round, tools = ?tool_names, "Gemini tool call round");

                // Echo back the model turn with its raw parts (text + functionCall)
                if let Some(raw_parts) = &result.raw_content_blocks {
                    contents.push(json!({
                        "role": "model",
                        "parts": raw_parts,
                    }));
                } else {
                    contents.push(json!({
                        "role": "model",
                        "parts": [{"text": result.content}],
                    }));
                }

                // Execute all function calls and build functionResponse parts
                let mut response_parts: Vec<Value> = Vec::new();
                for call in &calls {
                    let tool = tools.iter().find(|t| t.name == call.name);
                    let (tool_result, record) = if let Some(t) = tool {
                        execute_tool(client, t, &call.arguments, ctx).await
                    } else {
                        let err_msg = format!("Error: tool '{}' not found", call.name);
                        (
                            err_msg.clone(),
                            ToolCallRecord {
                                tool_id: None,
                                tool_name: call.name.clone(),
                                arguments: call.arguments.clone(),
                                status_code: None,
                                response_body: None,
                                error: Some(err_msg),
                                duration_ms: 0,
                                tool_type: "http_request".to_string(),
                            },
                        )
                    };
                    all_records.push(record);

                    // Gemini requires functionResponse.response to be an object.
                    // If the tool returned JSON already, pass it through; else wrap as {content: ...}.
                    let response_value = serde_json::from_str::<Value>(&tool_result)
                        .ok()
                        .filter(|v| v.is_object())
                        .unwrap_or_else(|| json!({"content": tool_result}));

                    response_parts.push(json!({
                        "functionResponse": {
                            "name": call.name,
                            "response": response_value,
                        }
                    }));
                }

                contents.push(json!({
                    "role": "function",
                    "parts": response_parts,
                }));
            }
            _ => {
                return Ok(LlmResponse {
                    content: result.content,
                    tokens_used: total_tokens,
                    tool_call_records: all_records,
                });
            }
        }
    }

    tracing::warn!(
        event = "cap_hit",
        cap = "max_tool_rounds",
        rounds = max_rounds,
        provider = "gemini",
        "tool loop rounds cap hit"
    );
    Err(AppError::InternalError(format!(
        "Limite de rodadas de ferramentas atingido ({max_rounds}). Considere simplificar o fluxo."
    )))
}

async fn call_gemini_raw(
    client: &Client,
    api_key: &str,
    model: &str,
    contents: &[Value],
    system_instruction: &Option<Value>,
    temperature: f32,
    max_tokens: i32,
    tools: &[LlmTool],
    timeout: Duration,
) -> Result<RawLlmResult, AppError> {
    // W1.1 — short-circuit if provider health is poor.
    if let Some(err) = check_circuit_open("gemini") {
        return Err(AppError::InternalError(err));
    }

    let result: Result<RawLlmResult, AppError> = async {
        let mut body = json!({
            "contents": contents,
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_tokens,
            },
        });

        if let Some(si) = system_instruction {
            body["systemInstruction"] = si.clone();
        }

        if !tools.is_empty() {
            let function_declarations: Vec<Value> = tools
                .iter()
                .map(|t| {
                    json!({
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters,
                    })
                })
                .collect();
            body["tools"] = json!([{ "functionDeclarations": function_declarations }]);
        }

        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
        );

        let send_fut = client.post(&url).json(&body).send();
        let resp = tokio::time::timeout(timeout, send_fut)
            .await
            .map_err(|_| llm_timeout_error("gemini", timeout.as_secs()))?
            .map_err(|e| AppError::InternalError(format!("Gemini request failed: {e}")))?;

        let data: Value = resp
            .json()
            .await
            .map_err(|e| AppError::InternalError(format!("Gemini response parse failed: {e}")))?;

        if let Some(err) = data["error"]["message"].as_str() {
            tracing::error!("Gemini API error for model {model}: {err}");
            return Err(AppError::InternalError(format!("Gemini API error: {err}")));
        }

        let mut content = String::new();
        let mut tool_calls: Vec<ToolCall> = Vec::new();

        // Preserve the full parts array so we can echo it back on the next turn.
        let raw_parts = data["candidates"][0]["content"]["parts"]
            .as_array()
            .cloned()
            .map(Value::Array);

        if let Some(parts) = data["candidates"][0]["content"]["parts"].as_array() {
            for part in parts {
                if let Some(text) = part["text"].as_str() {
                    content.push_str(text);
                }
                if let Some(fc) = part.get("functionCall") {
                    if let Some(name) = fc["name"].as_str() {
                        let args = fc.get("args").cloned().unwrap_or(json!({}));
                        // Gemini doesn't return an id — synthesize one for logging parity.
                        let id = format!("gemini_call_{}_{}", name, tool_calls.len());
                        tool_calls.push(ToolCall {
                            id,
                            name: name.to_string(),
                            arguments: if args.is_null() { json!({}) } else { args },
                        });
                    }
                }
            }
        }

        let tokens = data["usageMetadata"]["totalTokenCount"]
            .as_i64()
            .unwrap_or(0) as i32;

        Ok(RawLlmResult {
            content,
            tokens,
            tool_calls: if tool_calls.is_empty() {
                None
            } else {
                Some(tool_calls)
            },
            raw_tool_calls: None,
            raw_content_blocks: raw_parts,
        })
    }
    .await;

    match &result {
        Ok(_) => record_success("gemini"),
        Err(_) => record_failure("gemini"),
    }
    result
}

/// Merge consecutive same-role Gemini contents into one entry.
fn coalesce_gemini_contents(contents: Vec<Value>) -> Vec<Value> {
    if contents.is_empty() {
        return contents;
    }

    let mut coalesced: Vec<Value> = Vec::new();
    for msg in contents {
        let role = msg["role"].as_str().unwrap_or("user");
        if let Some(last) = coalesced.last_mut() {
            if last["role"].as_str().unwrap_or("") == role {
                // Merge parts arrays
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

// =====================================================================
// Grok (xAI) — OpenAI-compatible at https://api.x.ai/v1
// =====================================================================

fn is_grok_reasoning_model(model: &str) -> bool {
    model.contains("-reasoning")
}

async fn call_grok_with_tools(
    client: &Client,
    api_key: &str,
    model: &str,
    messages: Vec<LlmMessage>,
    temperature: f32,
    max_tokens: i32,
    tools: &[LlmTool],
    ctx: &ToolContext<'_>,
) -> Result<LlmResponse, AppError> {
    // Grok (xAI) via /v1/chat/completions only accepts image/jpeg and image/png
    // as multimodal input. PDFs and other types are rejected by the API, so we
    // extract PDF text locally and fold it into the message body, and drop
    // other unsupported types with a warning.
    let mut raw_messages: Vec<Value> = messages
        .iter()
        .map(|m| {
            let content = match (&m.media_base64, &m.media_mime_type) {
                (Some(b64), Some(mime)) if mime == "image/jpeg" || mime == "image/png" => {
                    let mut parts = vec![];
                    if !m.content.is_empty() {
                        parts.push(json!({"type": "text", "text": m.content}));
                    }
                    parts.push(json!({
                        "type": "image_url",
                        "image_url": { "url": format!("data:{mime};base64,{b64}") }
                    }));
                    json!(parts)
                }
                (Some(b64), Some(mime)) if mime == "application/pdf" => {
                    match extract_text_from_base64(b64, mime) {
                        Some(extracted) => json!(fold_document_text(&m.content, &extracted)),
                        None => {
                            tracing::warn!(
                                "Grok: failed to extract text from PDF attachment; sending text-only"
                            );
                            json!(m.content)
                        }
                    }
                }
                (Some(_), Some(mime)) => {
                    tracing::warn!(
                        "Grok does not support attachments of type {mime}; sending text-only"
                    );
                    json!(m.content)
                }
                _ => json!(m.content),
            };
            json!({"role": m.role, "content": content})
        })
        .collect();

    let mut total_tokens = 0i32;
    let mut all_records: Vec<ToolCallRecord> = Vec::new();

    let timeout = resolve_llm_timeout(ctx);
    // W1.2 caps
    let max_rounds = ctx
        .max_tool_rounds
        .filter(|v| *v > 0)
        .unwrap_or(DEFAULT_MAX_TOOL_ROUNDS);
    let max_duration = Duration::from_millis(
        ctx.max_duration_ms
            .filter(|v| *v > 0)
            .unwrap_or(DEFAULT_MAX_DURATION_MS) as u64,
    );
    let loop_started = Instant::now();

    for round in 0..max_rounds {
        if loop_started.elapsed() > max_duration {
            tracing::warn!(
                event = "cap_hit",
                cap = "max_duration_ms",
                elapsed_ms = loop_started.elapsed().as_millis() as u64,
                budget_ms = max_duration.as_millis() as u64,
                provider = "grok",
                "tool loop duration cap hit"
            );
            return Err(AppError::InternalError(format!(
                "Limite de duração das rodadas de ferramentas atingido ({} ms). Considere simplificar o fluxo.",
                max_duration.as_millis()
            )));
        }
        let result = call_grok_raw(
            client,
            api_key,
            model,
            &raw_messages,
            temperature,
            max_tokens,
            tools,
            timeout,
        )
        .await?;
        total_tokens += result.tokens;

        match result.tool_calls {
            Some(calls) if !calls.is_empty() => {
                let tool_names: Vec<&str> = calls.iter().map(|c| c.name.as_str()).collect();
                tracing::info!(round = round, tools = ?tool_names, "Grok tool call round");
                let mut assistant_msg = json!({ "role": "assistant" });
                if !result.content.is_empty() {
                    assistant_msg["content"] = json!(result.content);
                }
                if let Some(raw_tc) = &result.raw_tool_calls {
                    assistant_msg["tool_calls"] = raw_tc.clone();
                }
                raw_messages.push(assistant_msg);

                for call in &calls {
                    let tool = tools.iter().find(|t| t.name == call.name);
                    let (tool_result, record) = if let Some(t) = tool {
                        execute_tool(client, t, &call.arguments, ctx).await
                    } else {
                        let err_msg = format!("Error: tool '{}' not found", call.name);
                        (
                            err_msg.clone(),
                            ToolCallRecord {
                                tool_id: None,
                                tool_name: call.name.clone(),
                                arguments: call.arguments.clone(),
                                status_code: None,
                                response_body: None,
                                error: Some(err_msg),
                                duration_ms: 0,
                                tool_type: "http_request".to_string(),
                            },
                        )
                    };
                    all_records.push(record);

                    raw_messages.push(json!({
                        "role": "tool",
                        "tool_call_id": call.id,
                        "content": tool_result,
                    }));
                }
            }
            _ => {
                return Ok(LlmResponse {
                    content: result.content,
                    tokens_used: total_tokens,
                    tool_call_records: all_records,
                });
            }
        }
    }

    tracing::warn!(
        event = "cap_hit",
        cap = "max_tool_rounds",
        rounds = max_rounds,
        provider = "grok",
        "tool loop rounds cap hit"
    );
    Err(AppError::InternalError(format!(
        "Limite de rodadas de ferramentas atingido ({max_rounds}). Considere simplificar o fluxo."
    )))
}

async fn call_grok_raw(
    client: &Client,
    api_key: &str,
    model: &str,
    messages: &[Value],
    temperature: f32,
    max_tokens: i32,
    tools: &[LlmTool],
    timeout: Duration,
) -> Result<RawLlmResult, AppError> {
    // W1.1 — short-circuit if provider health is poor.
    if let Some(err) = check_circuit_open("grok") {
        return Err(AppError::InternalError(err));
    }

    let result: Result<RawLlmResult, AppError> = async {
        let mut body = json!({
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        });

        if is_grok_reasoning_model(model) {
            body["reasoning_effort"] = json!("medium");
        }

        if !tools.is_empty() {
            let functions: Vec<Value> = tools
                .iter()
                .map(|t| {
                    json!({
                        "type": "function",
                        "function": {
                            "name": t.name,
                            "description": t.description,
                            "parameters": t.parameters,
                        }
                    })
                })
                .collect();
            body["tools"] = json!(functions);
        }

        let send_fut = client
            .post("https://api.x.ai/v1/chat/completions")
            .header("Authorization", format!("Bearer {api_key}"))
            .json(&body)
            .send();
        let resp = tokio::time::timeout(timeout, send_fut)
            .await
            .map_err(|_| llm_timeout_error("grok", timeout.as_secs()))?
            .map_err(|e| AppError::InternalError(format!("Grok request failed: {e}")))?;

        let data: Value = resp
            .json()
            .await
            .map_err(|e| AppError::InternalError(format!("Grok response parse failed: {e}")))?;

        if let Some(err) = data["error"]["message"].as_str() {
            tracing::error!("Grok API error for model {model}: {err}");
            return Err(AppError::InternalError(format!("Grok API error: {err}")));
        }

        let message = &data["choices"][0]["message"];
        let content = message["content"].as_str().unwrap_or("").to_string();
        let tokens = data["usage"]["total_tokens"].as_i64().unwrap_or(0) as i32;

        let raw_tool_calls = message.get("tool_calls").cloned();

        let tool_calls = message["tool_calls"].as_array().map(|calls| {
            calls
                .iter()
                .filter_map(|c| {
                    let id = c["id"].as_str()?.to_string();
                    let name = c["function"]["name"].as_str()?.to_string();
                    let args: Value = c["function"]["arguments"]
                        .as_str()
                        .and_then(|s| serde_json::from_str(s).ok())
                        .unwrap_or(json!({}));
                    Some(ToolCall {
                        id,
                        name,
                        arguments: args,
                    })
                })
                .collect()
        });

        Ok(RawLlmResult {
            content,
            tokens,
            tool_calls,
            raw_tool_calls,
            raw_content_blocks: None,
        })
    }
    .await;

    match &result {
        Ok(_) => record_success("grok"),
        Err(_) => record_failure("grok"),
    }
    result
}

// =====================================================================
// Deepseek — OpenAI-compatible at https://api.deepseek.com
// deepseek-reasoner: no tool calling, temperature ignored, reasoning_content
// must be stripped from assistant echoes before next turn.
// =====================================================================

fn is_deepseek_reasoner(model: &str) -> bool {
    model == "deepseek-reasoner"
}

async fn call_deepseek_with_tools(
    client: &Client,
    api_key: &str,
    model: &str,
    messages: Vec<LlmMessage>,
    temperature: f32,
    max_tokens: i32,
    tools: &[LlmTool],
    ctx: &ToolContext<'_>,
) -> Result<LlmResponse, AppError> {
    let effective_tools: &[LlmTool] = if is_deepseek_reasoner(model) {
        if !tools.is_empty() {
            tracing::warn!(
                "deepseek-reasoner does not support tool calling; ignoring {} tools",
                tools.len()
            );
        }
        &[]
    } else {
        tools
    };

    // Deepseek is text-only (no vision model, content must be a plain string).
    // Extract text from PDFs and fold into the message body; drop other
    // attachment types with a warning instead of silently losing them.
    let mut raw_messages: Vec<Value> = messages
        .iter()
        .map(|m| {
            let content = match (&m.media_base64, &m.media_mime_type) {
                (Some(b64), Some(mime)) if mime == "application/pdf" => {
                    match extract_text_from_base64(b64, mime) {
                        Some(extracted) => fold_document_text(&m.content, &extracted),
                        None => {
                            tracing::warn!(
                                "Deepseek: failed to extract text from PDF attachment; sending text-only"
                            );
                            m.content.clone()
                        }
                    }
                }
                (Some(_), Some(mime)) => {
                    tracing::warn!(
                        "Deepseek is text-only; dropping attachment of type {mime}"
                    );
                    m.content.clone()
                }
                _ => m.content.clone(),
            };
            json!({"role": m.role, "content": content})
        })
        .collect();

    let mut total_tokens = 0i32;
    let mut all_records: Vec<ToolCallRecord> = Vec::new();

    let timeout = resolve_llm_timeout(ctx);
    // W1.2 caps
    let max_rounds = ctx
        .max_tool_rounds
        .filter(|v| *v > 0)
        .unwrap_or(DEFAULT_MAX_TOOL_ROUNDS);
    let max_duration = Duration::from_millis(
        ctx.max_duration_ms
            .filter(|v| *v > 0)
            .unwrap_or(DEFAULT_MAX_DURATION_MS) as u64,
    );
    let loop_started = Instant::now();

    for round in 0..max_rounds {
        if loop_started.elapsed() > max_duration {
            tracing::warn!(
                event = "cap_hit",
                cap = "max_duration_ms",
                elapsed_ms = loop_started.elapsed().as_millis() as u64,
                budget_ms = max_duration.as_millis() as u64,
                provider = "deepseek",
                "tool loop duration cap hit"
            );
            return Err(AppError::InternalError(format!(
                "Limite de duração das rodadas de ferramentas atingido ({} ms). Considere simplificar o fluxo.",
                max_duration.as_millis()
            )));
        }
        let result = call_deepseek_raw(
            client,
            api_key,
            model,
            &raw_messages,
            temperature,
            max_tokens,
            effective_tools,
            timeout,
        )
        .await?;
        total_tokens += result.tokens;

        match result.tool_calls {
            Some(calls) if !calls.is_empty() => {
                let tool_names: Vec<&str> = calls.iter().map(|c| c.name.as_str()).collect();
                tracing::info!(round = round, tools = ?tool_names, "Deepseek tool call round");
                // Only echo content + tool_calls — never reasoning_content, which
                // Deepseek rejects on the next turn. call_deepseek_raw already
                // drops it since we only capture message["content"].
                let mut assistant_msg = json!({ "role": "assistant" });
                if !result.content.is_empty() {
                    assistant_msg["content"] = json!(result.content);
                }
                if let Some(raw_tc) = &result.raw_tool_calls {
                    assistant_msg["tool_calls"] = raw_tc.clone();
                }
                raw_messages.push(assistant_msg);

                for call in &calls {
                    let tool = effective_tools.iter().find(|t| t.name == call.name);
                    let (tool_result, record) = if let Some(t) = tool {
                        execute_tool(client, t, &call.arguments, ctx).await
                    } else {
                        let err_msg = format!("Error: tool '{}' not found", call.name);
                        (
                            err_msg.clone(),
                            ToolCallRecord {
                                tool_id: None,
                                tool_name: call.name.clone(),
                                arguments: call.arguments.clone(),
                                status_code: None,
                                response_body: None,
                                error: Some(err_msg),
                                duration_ms: 0,
                                tool_type: "http_request".to_string(),
                            },
                        )
                    };
                    all_records.push(record);

                    raw_messages.push(json!({
                        "role": "tool",
                        "tool_call_id": call.id,
                        "content": tool_result,
                    }));
                }
            }
            _ => {
                return Ok(LlmResponse {
                    content: result.content,
                    tokens_used: total_tokens,
                    tool_call_records: all_records,
                });
            }
        }
    }

    tracing::warn!(
        event = "cap_hit",
        cap = "max_tool_rounds",
        rounds = max_rounds,
        provider = "deepseek",
        "tool loop rounds cap hit"
    );
    Err(AppError::InternalError(format!(
        "Limite de rodadas de ferramentas atingido ({max_rounds}). Considere simplificar o fluxo."
    )))
}

async fn call_deepseek_raw(
    client: &Client,
    api_key: &str,
    model: &str,
    messages: &[Value],
    temperature: f32,
    max_tokens: i32,
    tools: &[LlmTool],
    timeout: Duration,
) -> Result<RawLlmResult, AppError> {
    // W1.1 — short-circuit if provider health is poor.
    if let Some(err) = check_circuit_open("deepseek") {
        return Err(AppError::InternalError(err));
    }

    let result: Result<RawLlmResult, AppError> = async {
        let mut body = json!({
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
        });

        // Reasoner silently ignores temperature — only send on deepseek-chat.
        if !is_deepseek_reasoner(model) {
            body["temperature"] = json!(temperature);
        }

        if !tools.is_empty() {
            let functions: Vec<Value> = tools
                .iter()
                .map(|t| {
                    json!({
                        "type": "function",
                        "function": {
                            "name": t.name,
                            "description": t.description,
                            "parameters": t.parameters,
                        }
                    })
                })
                .collect();
            body["tools"] = json!(functions);
        }

        let send_fut = client
            .post("https://api.deepseek.com/chat/completions")
            .header("Authorization", format!("Bearer {api_key}"))
            .json(&body)
            .send();
        let resp = tokio::time::timeout(timeout, send_fut)
            .await
            .map_err(|_| llm_timeout_error("deepseek", timeout.as_secs()))?
            .map_err(|e| AppError::InternalError(format!("Deepseek request failed: {e}")))?;

        let data: Value = resp
            .json()
            .await
            .map_err(|e| AppError::InternalError(format!("Deepseek response parse failed: {e}")))?;

        if let Some(err) = data["error"]["message"].as_str() {
            tracing::error!("Deepseek API error for model {model}: {err}");
            return Err(AppError::InternalError(format!("Deepseek API error: {err}")));
        }

        let message = &data["choices"][0]["message"];
        let content = message["content"].as_str().unwrap_or("").to_string();
        let tokens = data["usage"]["total_tokens"].as_i64().unwrap_or(0) as i32;

        let raw_tool_calls = message.get("tool_calls").cloned();

        let tool_calls = message["tool_calls"].as_array().map(|calls| {
            calls
                .iter()
                .filter_map(|c| {
                    let id = c["id"].as_str()?.to_string();
                    let name = c["function"]["name"].as_str()?.to_string();
                    let args: Value = c["function"]["arguments"]
                        .as_str()
                        .and_then(|s| serde_json::from_str(s).ok())
                        .unwrap_or(json!({}));
                    Some(ToolCall {
                        id,
                        name,
                        arguments: args,
                    })
                })
                .collect()
        });

        Ok(RawLlmResult {
            content,
            tokens,
            tool_calls,
            raw_tool_calls,
            raw_content_blocks: None,
        })
    }
    .await;

    match &result {
        Ok(_) => record_success("deepseek"),
        Err(_) => record_failure("deepseek"),
    }
    result
}

// =====================================================================
// Tests — W1.1 circuit breaker
// =====================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Serialize tests that touch the global circuit-breaker map so they
    /// can't race with one another inside the same test binary.
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    /// After 5 failures within the window, `check_circuit_open` must return
    /// the LLM-friendly error message.
    #[test]
    fn test_circuit_opens_after_5_failures() {
        let _g = TEST_LOCK.lock().unwrap();
        reset_circuit_breaker_state();

        let provider = "test_provider_opens";
        assert!(
            check_circuit_open(provider).is_none(),
            "circuit should start closed"
        );

        for _ in 0..(FAIL_THRESHOLD - 1) {
            record_failure(provider);
        }
        assert!(
            check_circuit_open(provider).is_none(),
            "circuit stays closed below threshold"
        );

        record_failure(provider); // 5th failure
        let open = check_circuit_open(provider);
        assert!(open.is_some(), "circuit opens at threshold");
        let msg = open.unwrap();
        assert!(
            msg.contains("circuito aberto"),
            "error message: {msg:?}"
        );
        assert!(
            msg.contains(provider),
            "error message should name the provider: {msg:?}"
        );
    }

    /// Failures accumulated on one provider must not affect another provider.
    #[test]
    fn test_different_providers_independent() {
        let _g = TEST_LOCK.lock().unwrap();
        reset_circuit_breaker_state();

        let a = "test_provider_a";
        let b = "test_provider_b";
        for _ in 0..FAIL_THRESHOLD {
            record_failure(a);
        }
        assert!(
            check_circuit_open(a).is_some(),
            "provider_a circuit should be open"
        );
        assert!(
            check_circuit_open(b).is_none(),
            "provider_b circuit should remain closed"
        );
    }

    /// A recorded success must NOT close the circuit on its own — we rely on
    /// natural window decay instead. This test documents that behavior so
    /// future refactors don't accidentally change it.
    ///
    /// NOTE: we intentionally do NOT test window decay via wall-clock sleep.
    /// `std::time::Instant` is monotonic and unaffected by `tokio::time::pause()`,
    /// and a real-time 60s sleep in the unit suite would be prohibitive. A
    /// clock-injection refactor is left for a future iteration; the decay
    /// logic itself (prune-on-front-of-deque in `record_failure` and
    /// window-filter in `check_circuit_open`) is straightforward.
    #[test]
    fn test_success_does_not_close_open_circuit() {
        let _g = TEST_LOCK.lock().unwrap();
        reset_circuit_breaker_state();

        let provider = "test_provider_success";
        for _ in 0..FAIL_THRESHOLD {
            record_failure(provider);
        }
        assert!(
            check_circuit_open(provider).is_some(),
            "circuit must be open after threshold failures"
        );

        record_success(provider);

        assert!(
            check_circuit_open(provider).is_some(),
            "success alone must NOT close the circuit (decay via FAIL_WINDOW only)"
        );
    }
}
