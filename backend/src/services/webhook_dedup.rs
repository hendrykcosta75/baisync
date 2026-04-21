//! T1.4 — Webhook dedup (Block mode).
//!
//! INSERT ... IF NOT EXISTS via LWT em `processed_webhooks`. Se applied=false
//! (evento já visto), retorna DedupResult::Duplicate e o caller responde 200
//! OK imediato sem reprocessar. Evita loops de resposta quando Baileys/Meta/
//! Telegram/Stripe/MP retransmitem o mesmo evento.
//!
//! Mode::Observe existe como feature-flag reversível caso a flipagem precise
//! ser desfeita rapidamente em produção — continua logando duplicata mas
//! deixa passar.
//!
//! Multi-tenancy: `processed_webhooks` não tem user_id — webhook chega
//! antes de resolver user. Exceção documentada em backend/AGENTS.md.

use scylla::frame::value::CqlTimestamp;

use crate::db::DbSession;
use crate::errors::AppError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// Log duplicates, continue processing (shadow / rollback switch).
    #[allow(dead_code)]
    Observe,
    /// Reject duplicates with 200 OK (production default — T1.4).
    Block,
}

/// Current mode. T1.4 ativo: duplicatas são bloqueadas com 200 OK.
pub const CURRENT_MODE: Mode = Mode::Block;

pub enum DedupResult {
    /// First time seeing this event (or Observe mode forcing continuation).
    Applied,
    /// Seen before — caller short-circuits with 200.
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Guard: production must stay in Block mode. T1.4 was flipped in auditoria
    /// Harness to fix the "IA manda várias mensagens seguidas" bug caused by
    /// Baileys/Meta/Telegram retransmitting webhooks. If this test fails,
    /// someone is about to reintroduce the loop.
    #[test]
    fn current_mode_must_be_block() {
        assert_eq!(
            CURRENT_MODE,
            Mode::Block,
            "webhook dedup must stay in Block mode — reverting to Observe reintroduces the duplicate-response loop"
        );
    }
}
