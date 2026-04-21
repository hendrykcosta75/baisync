// T2.1 — Session service: fire-and-forget append log over Cassandra.
//
// Mirrors the mpsc pattern established by T1.2 (`services/llm.rs`) for
// `llm_call_logs`:
//   1. Hot path (messaging handler, baisync handler) never `.await`s the
//      session writes — it enqueues mutations on an unbounded channel.
//   2. `main.rs` owns a drain task that calls `apply_session_mutation` per
//      incoming item, so all Cassandra I/O stays off the user response path.
//
// Multi-tenancy is enforced at the schema level:
//   - `sessions` PK: ((user_id), session_id)
//   - `session_events` PK: ((user_id, session_id), event_id)
// Every read/write in this module scopes by those full partition keys.

use chrono::Utc;
use scylla::frame::value::{CqlTimestamp, CqlTimeuuid};
use std::sync::OnceLock;
use tokio::sync::mpsc::UnboundedSender;
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;

pub type SessionId = Uuid;

/// Logical event kinds emitted within a session.
///
/// Only `UserMsg`, `LlmMsg`, `ToolCall`, `ToolResult` are produced today.
/// `Compaction`, `EvaluatorVerdict`, `Plan`, `Wake` are reserved for
/// Onda 2 / Onda 3 (evaluator, compaction, wake/planner) and will begin
/// producing real events then. The variants are kept now so the table
/// schema and event_type column set are stable from day one.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum SessionEventType {
    UserMsg,
    LlmMsg,
    ToolCall,
    ToolResult,
    Compaction,
    EvaluatorVerdict,
    Plan,
    Wake,
}

impl SessionEventType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::UserMsg => "user_msg",
            Self::LlmMsg => "llm_msg",
            Self::ToolCall => "tool_call",
            Self::ToolResult => "tool_result",
            Self::Compaction => "compaction",
            Self::EvaluatorVerdict => "evaluator_verdict",
            Self::Plan => "plan",
            Self::Wake => "wake",
        }
    }
}

/// One mutation on the session log, drained asynchronously by the task in
/// `main.rs`. Every variant carries the full tenant key so the writer can
/// scope its WHERE/INSERT without consulting external state.
#[derive(Debug, Clone)]
pub enum SessionMutation {
    Create {
        user_id: Uuid,
        session_id: Uuid,
        conversation_id: Uuid,
        assistant_id: Uuid,
        status: String,
    },
    AppendEvent {
        user_id: Uuid,
        session_id: Uuid,
        event_id: Uuid,
        event_type: String,
        payload: String,
    },
    UpdateStatus {
        user_id: Uuid,
        session_id: Uuid,
        status: String,
        handoff_summary: Option<String>,
    },
}

/// Global sender for `SessionMutation`s. Set once at startup from `main.rs`.
///
/// When unset (unit tests, ad-hoc callers), `append_event` / `update_status`
/// silently drop the mutation — they never panic and never fail the caller.
/// `create_session` has a synchronous fallback so it can still return a
/// usable id even without the drain task.
static SESSION_SENDER: OnceLock<UnboundedSender<SessionMutation>> = OnceLock::new();

/// Install the global sender. Call once from `main.rs` after `db::connect`.
pub fn init_session_sender(sender: UnboundedSender<SessionMutation>) {
    let _ = SESSION_SENDER.set(sender);
}

/// `#[cfg(test)]`-only helper used by unit tests to exercise the
/// uninitialized-sender branch repeatedly. Production code never touches this.
///
/// NOTE: `OnceLock::take` requires `&mut`, which we cannot obtain from a
/// `static`. Instead we expose a flag the tests can check — the uninitialized
/// branch is the default, so tests only need to assert `append_event` is a
/// no-op when `SESSION_SENDER.get().is_none()`.
#[cfg(test)]
pub fn session_sender_is_initialized() -> bool {
    SESSION_SENDER.get().is_some()
}

fn enqueue(mutation: SessionMutation) {
    if let Some(sender) = SESSION_SENDER.get() {
        if sender.send(mutation).is_err() {
            tracing::debug!("session_mutation drain receiver dropped; mutation discarded");
        }
    }
}

/// Build a TIMEUUID-compatible UUID for a new session id. Same node-id
/// convention as `services/llm.rs::timeuuid_from_ms` so ids produced by
/// different subsystems remain comparable.
fn new_session_timeuuid() -> Uuid {
    let ts = uuid::timestamp::Timestamp::now(uuid::NoContext);
    Uuid::new_v1(ts, &[0x01, 0x23, 0x45, 0x67, 0x89, 0xab])
}

/// Create a session. Synchronous caller contract:
///   - Generates a TIMEUUID session id immediately.
///   - Enqueues the INSERT via mpsc when the drain is initialized.
///   - Falls back to a synchronous INSERT otherwise (tests, ad-hoc callers)
///     so the row actually exists when callers depend on it.
///
/// Returns the new `SessionId` so the caller can attach subsequent events.
pub async fn create_session(
    db: &DbSession,
    user_id: Uuid,
    conversation_id: Uuid,
    assistant_id: Uuid,
) -> Result<SessionId, AppError> {
    let session_id = new_session_timeuuid();
    let mutation = SessionMutation::Create {
        user_id,
        session_id,
        conversation_id,
        assistant_id,
        status: "active".to_string(),
    };

    if SESSION_SENDER.get().is_some() {
        enqueue(mutation);
    } else {
        // No drain task: write synchronously so the session row is visible
        // to any follow-up query. Only happens in tests today.
        apply_session_mutation(db, mutation).await?;
    }

    Ok(session_id)
}

/// Fire-and-forget: append an event to a session's log. Drops the event if
/// the drain is not installed (unit tests) — never fails the caller.
pub fn append_event(
    user_id: Uuid,
    session_id: SessionId,
    event_type: SessionEventType,
    payload: String,
) {
    let event_id = new_session_timeuuid();
    enqueue(SessionMutation::AppendEvent {
        user_id,
        session_id,
        event_id,
        event_type: event_type.as_str().to_string(),
        payload,
    });
}

/// Fire-and-forget: update a session's `status` (and optionally
/// `handoff_summary`). Drops the mutation when the drain is not installed.
pub async fn update_status(
    user_id: Uuid,
    session_id: SessionId,
    status: String,
    handoff_summary: Option<String>,
) {
    enqueue(SessionMutation::UpdateStatus {
        user_id,
        session_id,
        status,
        handoff_summary,
    });
}

/// One row returned by `get_events`. `event_id` is the TIMEUUID rendered as
/// its canonical string form so the frontend / API consumers don't need a
/// scylla-specific type.
///
/// `#[allow(dead_code)]`: only produced today by `get_events`, which is
/// consumed by S2.1's REST handler (not yet wired).
#[allow(dead_code)]
#[derive(Debug, Clone, serde::Serialize)]
pub struct SessionEventRow {
    pub event_id: String,
    pub event_type: String,
    pub payload: String,
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Fetch all events for a session. Scoped by the full `(user_id, session_id)`
/// partition key so a cross-tenant read is impossible.
///
/// `#[allow(dead_code)]`: consumed by S2.1's REST handler (not yet wired).
#[allow(dead_code)]
pub async fn get_events(
    db: &DbSession,
    user_id: &Uuid,
    session_id: &SessionId,
) -> Result<Vec<SessionEventRow>, AppError> {
    let timeuuid = CqlTimeuuid::from(*session_id);
    let res = db
        .query_unpaged(
            "SELECT event_id, event_type, payload, created_at FROM inertial_eclipse.session_events \
             WHERE user_id = ? AND session_id = ?",
            (user_id, &timeuuid),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = res.into_rows_result()?;
    let mut out = Vec::new();
    for row in rows.rows::<(
        CqlTimeuuid,
        Option<String>,
        Option<String>,
        Option<chrono::DateTime<chrono::Utc>>,
    )>()?
    {
        let (eid, etype, payload, created_at) = row
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let uuid: Uuid = Uuid::from_bytes(*eid.as_bytes());
        out.push(SessionEventRow {
            event_id: uuid.to_string(),
            event_type: etype.unwrap_or_default(),
            payload: payload.unwrap_or_default(),
            created_at,
        });
    }
    Ok(out)
}

/// Onda 3 stub — waking a sleeping session is not implemented yet. Returning
/// `Ok(())` keeps the call site compiling as the planner/wake machinery lands.
#[allow(dead_code)]
pub async fn wake(_session_id: SessionId) -> Result<(), AppError> {
    Ok(())
}

/// Drain one `SessionMutation` to Cassandra. Called only by the drain task
/// spawned in `main.rs` (or synchronously from `create_session` when the
/// drain is not initialized — i.e. tests).
///
/// Every query scopes by `user_id` (sessions) or `(user_id, session_id)`
/// (session_events). No ALLOW FILTERING, no cross-partition scans.
pub async fn apply_session_mutation(
    db: &DbSession,
    m: SessionMutation,
) -> Result<(), AppError> {
    match m {
        SessionMutation::Create {
            user_id,
            session_id,
            conversation_id,
            assistant_id,
            status,
        } => {
            let timeuuid = CqlTimeuuid::from(session_id);
            let now = CqlTimestamp(Utc::now().timestamp_millis());
            db.query_unpaged(
                "INSERT INTO inertial_eclipse.sessions \
                 (user_id, session_id, conversation_id, assistant_id, status, created_at) \
                 VALUES (?, ?, ?, ?, ?, ?)",
                (
                    &user_id,
                    &timeuuid,
                    &conversation_id,
                    &assistant_id,
                    &status,
                    now,
                ),
            )
            .await
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
            Ok(())
        }
        SessionMutation::AppendEvent {
            user_id,
            session_id,
            event_id,
            event_type,
            payload,
        } => {
            let s_timeuuid = CqlTimeuuid::from(session_id);
            let e_timeuuid = CqlTimeuuid::from(event_id);
            let now = CqlTimestamp(Utc::now().timestamp_millis());
            db.query_unpaged(
                "INSERT INTO inertial_eclipse.session_events \
                 (user_id, session_id, event_id, event_type, payload, created_at) \
                 VALUES (?, ?, ?, ?, ?, ?)",
                (
                    &user_id,
                    &s_timeuuid,
                    &e_timeuuid,
                    &event_type,
                    &payload,
                    now,
                ),
            )
            .await
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
            // S2.3 — bump session_events_total{type} after the write lands.
            // We increment AFTER the INSERT so a Cassandra failure never
            // inflates the counter above the number of events actually
            // persisted.
            crate::services::metrics::inc_session_event(&event_type).await;
            Ok(())
        }
        SessionMutation::UpdateStatus {
            user_id,
            session_id,
            status,
            handoff_summary,
        } => {
            let timeuuid = CqlTimeuuid::from(session_id);
            if let Some(summary) = handoff_summary {
                db.query_unpaged(
                    "UPDATE inertial_eclipse.sessions \
                     SET status = ?, handoff_summary = ? \
                     WHERE user_id = ? AND session_id = ?",
                    (&status, &summary, &user_id, &timeuuid),
                )
                .await
                .map_err(|e| AppError::DatabaseError(e.to_string()))?;
            } else {
                db.query_unpaged(
                    "UPDATE inertial_eclipse.sessions \
                     SET status = ? \
                     WHERE user_id = ? AND session_id = ?",
                    (&status, &user_id, &timeuuid),
                )
                .await
                .map_err(|e| AppError::DatabaseError(e.to_string()))?;
            }
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_event_type_as_str() {
        assert_eq!(SessionEventType::UserMsg.as_str(), "user_msg");
        assert_eq!(SessionEventType::LlmMsg.as_str(), "llm_msg");
        assert_eq!(SessionEventType::ToolCall.as_str(), "tool_call");
        assert_eq!(SessionEventType::ToolResult.as_str(), "tool_result");
        assert_eq!(SessionEventType::Compaction.as_str(), "compaction");
        assert_eq!(SessionEventType::EvaluatorVerdict.as_str(), "evaluator_verdict");
        assert_eq!(SessionEventType::Plan.as_str(), "plan");
        assert_eq!(SessionEventType::Wake.as_str(), "wake");
    }

    #[test]
    fn test_append_event_drops_if_no_sender() {
        // In the default unit-test environment the sender is never initialized.
        // `append_event` must return without panicking and without touching any
        // shared state — the mutation is simply dropped.
        //
        // Production assertion: `session_sender_is_initialized()` reports false
        // in a fresh test process, so the enqueue path is a silent no-op.
        assert!(
            !session_sender_is_initialized(),
            "test environment should never have a session sender installed before we call append_event"
        );
        let user_id = Uuid::new_v4();
        let session_id = Uuid::new_v4();
        // Must not panic.
        append_event(
            user_id,
            session_id,
            SessionEventType::UserMsg,
            "{\"content\":\"hello\"}".to_string(),
        );
    }

    #[test]
    fn test_session_mutation_serialize_payload() {
        // A JSON string payload survives a round-trip through the AppendEvent
        // mutation shape — proves we can embed arbitrary `serde_json` output
        // without escaping issues.
        let json = serde_json::json!({"content": "hi", "n": 42}).to_string();
        let m = SessionMutation::AppendEvent {
            user_id: Uuid::new_v4(),
            session_id: Uuid::new_v4(),
            event_id: Uuid::new_v4(),
            event_type: SessionEventType::LlmMsg.as_str().to_string(),
            payload: json.clone(),
        };
        match m {
            SessionMutation::AppendEvent { payload, .. } => {
                assert_eq!(payload, json);
                // Reparse to confirm it's still valid JSON.
                let v: serde_json::Value = serde_json::from_str(&payload).unwrap();
                assert_eq!(v["content"], "hi");
                assert_eq!(v["n"], 42);
            }
            _ => panic!("unexpected mutation variant"),
        }
    }
}
