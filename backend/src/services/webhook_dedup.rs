//! I2 — Webhook dedup (shadow mode).
//!
//! Em Mode::Observe: INSERT ... IF NOT EXISTS via LWT. Se applied=false,
//! LOGA warn `webhook.duplicate_detected` mas NÃO bloqueia processamento.
//! T1.4 no futuro flipa para Mode::Block (retorna 200 OK imediato).
//!
//! Multi-tenancy: `processed_webhooks` não tem user_id — webhook chega
//! antes de resolver user. Exceção documentada em backend/AGENTS.md.

use scylla::frame::value::CqlTimestamp;

use crate::db::DbSession;
use crate::errors::AppError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// Log duplicates, continue processing (shadow).
    Observe,
    /// Reject duplicates with 200 OK (futuro T1.4).
    #[allow(dead_code)]
    Block,
}

/// Current mode. Shadow hoje; flip em T1.4.
pub const CURRENT_MODE: Mode = Mode::Observe;

pub enum DedupResult {
    /// First time seeing this event (or Observe mode forcing continuation).
    Applied,
    /// Seen before — only returned in Block mode; caller short-circuits with 200.
    #[allow(dead_code)]
    Duplicate,
}

/// Record webhook event_id. In Observe mode, logs warn on dup but
/// returns DedupResult::Applied anyway so caller continues processing.
/// In Block mode, returns Duplicate so caller short-circuits with 200.
pub async fn check_and_mark(
    db: &DbSession,
    provider: &str,
    event_id: &str,
) -> Result<DedupResult, AppError> {
    // Empty event_id → never dedup (best-effort).
    if event_id.is_empty() {
        return Ok(DedupResult::Applied);
    }

    let now = CqlTimestamp(chrono::Utc::now().timestamp_millis());

    // LWT: returns a row with [applied] boolean as first column on every call.
    // applied=true → row was newly inserted. applied=false → row already existed.
    let res = db
        .query_unpaged(
            "INSERT INTO inertial_eclipse.processed_webhooks (provider, event_id, processed_at) VALUES (?, ?, ?) IF NOT EXISTS",
            (provider, event_id, now),
        )
        .await
        .map_err(|e| AppError::InternalError(format!("dedup insert failed: {e}")))?;

    // Parse [applied] column from LWT response. Follow the same pattern used in
    // services/messaging.rs rate-limit CAS loop. If we can't parse, assume
    // applied=true (fail-open to not block legitimate traffic).
    let applied = res
        .into_rows_result()
        .ok()
        .and_then(|r| r.maybe_first_row::<(bool,)>().ok().flatten())
        .map(|(a,)| a)
        .unwrap_or(true);

    match (applied, CURRENT_MODE) {
        (true, _) => Ok(DedupResult::Applied),
        (false, Mode::Observe) => {
            tracing::warn!(
                event = "webhook.duplicate_detected",
                provider = %provider,
                event_id = %event_id,
                mode = "observe",
                "duplicate webhook detected (shadow mode — continuing)"
            );
            // S2.3 — count all duplicates, regardless of mode. Scrapers use
            // this to alert on elevated duplicate rates before we flip to
            // Block mode in T1.4.
            crate::services::metrics::inc_webhook_deduped(provider).await;
            Ok(DedupResult::Applied)
        }
        (false, Mode::Block) => {
            tracing::info!(
                event = "webhook.duplicate_blocked",
                provider = %provider,
                event_id = %event_id,
                "duplicate webhook rejected"
            );
            crate::services::metrics::inc_webhook_deduped(provider).await;
            Ok(DedupResult::Duplicate)
        }
    }
}
