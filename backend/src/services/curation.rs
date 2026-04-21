//! T3.3 — Background curation agent.
//!
//! Every 24h (see [`spawn_curation_poller`]) this service sweeps
//! `llm_call_logs` for the last 7 days, per assistant, computes error rates,
//! and when an assistant crosses [`CURATION_ERROR_THRESHOLD`] it creates a
//! `curation_suggestion` notification asking the operator to review the
//! assistant's config. Idempotent: the same assistant gets at most one
//! suggestion per [`SUGGESTION_DEDUP_HOURS`].
//!
//! # Multi-tenancy
//! - The initial `SELECT user_id, id FROM assistants` is an intentional
//!   cross-tenant sweep (see `// allow-filter:` comment below) — the
//!   curation pass is, by design, administrative.
//! - Every subsequent per-assistant query uses the FULL partition key
//!   `(user_id, assistant_id)` on `llm_call_logs`, preserving per-tenant
//!   isolation once we know which assistant we're looking at.
//! - Notifications are INSERTed with `user_id` as the partition key.
//!
//! # Why this service is so noise-resistant
//! - `CURATION_MIN_CALLS = 10` — assistants with tiny traffic never trigger.
//! - `CURATION_ERROR_THRESHOLD = 5%` — raw noise floor from provider
//!   timeouts/rate limits.
//! - `SUGGESTION_DEDUP_HOURS = 24` — the same assistant can't get spammed.
//! - `Config::curation_enabled` defaults to `false` — operators opt in.
//!
//! # Testability
//! The per-pass flow is split into small pure helpers
//! ([`compute_error_rate`], [`top_n_errors`], [`should_emit`],
//! [`within_dedup_window`]) so unit tests exercise the decision logic
//! without touching Cassandra. Integration with the database is deferred
//! to the harness/staging environment.

use std::collections::HashMap;
use std::time::Duration;

use chrono::{DateTime, Utc};
use scylla::frame::value::CqlTimestamp;
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;

/// Error-rate threshold above which the assistant gets a suggestion. 0.05 = 5%.
pub const CURATION_ERROR_THRESHOLD: f32 = 0.05;

/// Look-back window for the per-assistant error-rate scan.
pub const CURATION_WINDOW_DAYS: i64 = 7;

/// Minimum number of LLM calls in the window before we even compute a rate.
/// Below this, the sample size is too small to distinguish noise from signal.
pub const CURATION_MIN_CALLS: u64 = 10;

/// Per-assistant notification dedup window: do not emit a fresh
/// `curation_suggestion` if one was created within this many hours.
pub const SUGGESTION_DEDUP_HOURS: i64 = 24;

/// Notification type string — stable identifier used both in the
/// `notifications.notification_type` column and in the dedup scan.
pub const CURATION_NOTIFICATION_TYPE: &str = "curation_suggestion";

/// How many assistant rows we pull per notifications dedup scan. 100 is
/// generous — we only need the last 24h worth per user, and the rows are
/// cheap.
const NOTIFICATION_SCAN_LIMIT: i32 = 100;

/// How many `llm_call_logs` rows to pull per assistant per pass. 2000 covers
/// a very busy assistant (≈285 calls/day) over a 7d window. Increase if
/// production ever needs more.
const LLM_LOG_SCAN_LIMIT: i32 = 2000;

/// How many distinct error messages to surface in the notification payload.
const TOP_ERRORS_KEEP: usize = 3;

/// Interval between curation passes (24h).
const POLL_INTERVAL: Duration = Duration::from_secs(24 * 3600);

/// One assistant's statistics for the window.
#[derive(Debug, Clone)]
pub struct AssistantStats {
    pub user_id: Uuid,
    pub assistant_id: Uuid,
    pub assistant_name: String,
    pub total_calls: u64,
    pub error_calls: u64,
    pub error_rate: f32,
    /// Top `TOP_ERRORS_KEEP` distinct error messages by frequency.
    pub top_error_messages: Vec<String>,
}

/// Aggregated pass outcome, for tracing.
#[derive(Debug, Default, Clone, Copy)]
pub struct CurationPassSummary {
    /// Assistants discovered in the initial list.
    pub scanned: u32,
    /// Assistants below `CURATION_MIN_CALLS` — skipped as noise.
    pub skipped_noise: u32,
    /// Assistants above the threshold that would emit, but blocked by dedup.
    pub skipped_dedup: u32,
    /// Assistants above the threshold that got a fresh suggestion.
    pub emitted: u32,
}

// ─── Pure helpers (unit-tested) ─────────────────────────────────────────────

/// Pure: compute error rate from counts. Returns 0.0 when `total == 0` to
/// avoid division-by-zero.
pub fn compute_error_rate(total: u64, errors: u64) -> f32 {
    if total == 0 {
        return 0.0;
    }
    // Guard against a bogus caller where errors > total — clamp to 1.0.
    let clamped = errors.min(total);
    (clamped as f32) / (total as f32)
}

/// Pure: given an iterator of error messages, return the top-N by frequency.
/// Ties break by the message string (lexicographic) so the output is
/// deterministic across passes — useful for tests and for operators
/// comparing two consecutive notifications.
pub fn top_n_errors<I>(messages: I, n: usize) -> Vec<String>
where
    I: IntoIterator<Item = String>,
{
    if n == 0 {
        return Vec::new();
    }
    let mut counts: HashMap<String, u64> = HashMap::new();
    for msg in messages {
        if msg.is_empty() {
            continue;
        }
        *counts.entry(msg).or_insert(0) += 1;
    }
    let mut pairs: Vec<(String, u64)> = counts.into_iter().collect();
    // Sort by count desc, then message asc for determinism.
    pairs.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    pairs.into_iter().take(n).map(|(msg, _)| msg).collect()
}

/// Pure: decision for whether a fresh notification should be emitted given
/// the window's counts. Returns `EmissionDecision` with a reason (useful for
/// tracing and tests). **Does not** include the dedup check — that needs a
/// database round-trip and is handled separately in [`within_dedup_window`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EmissionDecision {
    /// Total calls < `CURATION_MIN_CALLS` — sample too small.
    SkippedNoise,
    /// Error rate computed but under threshold — assistant is healthy.
    BelowThreshold,
    /// Should emit — error rate exceeds threshold and we have enough samples.
    Emit,
}

/// Pure: combine the threshold + min-calls logic. Factored out so the noise
/// floor and the threshold are jointly testable.
pub fn should_emit(total_calls: u64, error_calls: u64) -> EmissionDecision {
    if total_calls < CURATION_MIN_CALLS {
        return EmissionDecision::SkippedNoise;
    }
    let rate = compute_error_rate(total_calls, error_calls);
    if rate > CURATION_ERROR_THRESHOLD {
        EmissionDecision::Emit
    } else {
        EmissionDecision::BelowThreshold
    }
}

/// Pure: given "now" and the timestamp of the most recent existing
/// `curation_suggestion` for this assistant (if any), decide whether a new
/// emission would be inside the dedup window.
///
/// Returns `true` when the last suggestion exists AND is newer than
/// `now - SUGGESTION_DEDUP_HOURS`. In that case the caller must skip.
pub fn within_dedup_window(
    now: DateTime<Utc>,
    last_suggestion_at: Option<DateTime<Utc>>,
) -> bool {
    let Some(last) = last_suggestion_at else {
        return false;
    };
    let window = chrono::Duration::hours(SUGGESTION_DEDUP_HOURS);
    // Dedup applies when the last suggestion was within the window, i.e.
    // now - last < window.
    let age = now.signed_duration_since(last);
    age < window
}

// ─── Public entrypoints ─────────────────────────────────────────────────────

/// Spawn the 24h curation poller. No-ops (but still logs) when
/// `config.curation_enabled == false`.
///
/// Non-blocking at startup: returns a `JoinHandle` but the background task
/// only does its first tick after [`POLL_INTERVAL`] (or exits immediately
/// when disabled).
pub fn spawn_curation_poller(
    db: DbSession,
    enabled: bool,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        if !enabled {
            tracing::info!(
                event = "curation.poller_disabled",
                "spawn_curation_poller: CURATION_ENABLED=false, exiting without scheduling."
            );
            return;
        }

        tracing::info!(
            event = "curation.poller_started",
            interval_hours = 24,
            window_days = CURATION_WINDOW_DAYS,
            threshold_pct = CURATION_ERROR_THRESHOLD * 100.0,
            min_calls = CURATION_MIN_CALLS,
            dedup_hours = SUGGESTION_DEDUP_HOURS,
            "T3.3 curation poller running"
        );

        let mut interval = tokio::time::interval(POLL_INTERVAL);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        // `tokio::time::interval` fires immediately on first `.tick()`. We
        // want the first real pass to happen after POLL_INTERVAL so the
        // service doesn't ship a burst of notifications the second it
        // boots. Discard the first tick.
        interval.tick().await;

        loop {
            interval.tick().await;
            match run_curation_pass(&db).await {
                Ok(summary) => {
                    tracing::info!(
                        event = "curation.pass_complete",
                        scanned = summary.scanned,
                        skipped_noise = summary.skipped_noise,
                        skipped_dedup = summary.skipped_dedup,
                        emitted = summary.emitted,
                        "curation pass complete"
                    );
                }
                Err(e) => {
                    tracing::error!(error = %e, "curation pass failed");
                }
            }
        }
    })
}

/// Run a single curation pass. Exposed as a free function so admin tools /
/// tests can invoke it directly without scheduling.
///
/// Flow:
/// 1. List all `(user_id, assistant_id, name)` tuples (cross-tenant sweep).
/// 2. For each, scan `llm_call_logs` in the last 7d, count total/errors.
/// 3. Short-circuit when total < `CURATION_MIN_CALLS`.
/// 4. When error_rate > `CURATION_ERROR_THRESHOLD`, check dedup and emit.
pub async fn run_curation_pass(
    db: &DbSession,
) -> Result<CurationPassSummary, AppError> {
    let assistants = list_all_assistants(db).await?;
    let now = Utc::now();
    let window_start_ms = (now - chrono::Duration::days(CURATION_WINDOW_DAYS)).timestamp_millis();

    let mut summary = CurationPassSummary {
        scanned: assistants.len() as u32,
        ..Default::default()
    };

    for (user_id, assistant_id, assistant_name) in assistants {
        match evaluate_one(db, &user_id, &assistant_id, &assistant_name, window_start_ms, now).await
        {
            Ok(EvalOutcome::SkippedNoise) => summary.skipped_noise += 1,
            Ok(EvalOutcome::BelowThreshold) => { /* healthy — no bucket */ }
            Ok(EvalOutcome::SkippedDedup) => summary.skipped_dedup += 1,
            Ok(EvalOutcome::Emitted(stats)) => {
                summary.emitted += 1;
                tracing::info!(
                    event = "curation.suggestion_emitted",
                    user_id = %stats.user_id,
                    assistant_id = %stats.assistant_id,
                    total_calls = stats.total_calls,
                    error_calls = stats.error_calls,
                    error_rate_pct = (stats.error_rate * 100.0),
                    "curation suggestion notification created"
                );
            }
            Err(e) => {
                // Non-fatal: one assistant failed; next one tries.
                tracing::warn!(
                    error = %e,
                    user_id = %user_id,
                    assistant_id = %assistant_id,
                    "curation: per-assistant evaluation failed"
                );
            }
        }
    }

    Ok(summary)
}

// ─── Internal per-assistant logic ───────────────────────────────────────────

enum EvalOutcome {
    SkippedNoise,
    BelowThreshold,
    SkippedDedup,
    Emitted(AssistantStats),
}

async fn evaluate_one(
    db: &DbSession,
    user_id: &Uuid,
    assistant_id: &Uuid,
    assistant_name: &str,
    window_start_ms: i64,
    now: DateTime<Utc>,
) -> Result<EvalOutcome, AppError> {
    // Fetch recent LLM calls (partitioned by user_id+assistant_id).
    let calls = fetch_recent_llm_calls(db, user_id, assistant_id, window_start_ms).await?;

    let total = calls.len() as u64;
    let errors: Vec<String> = calls
        .into_iter()
        .filter_map(|(error_opt, _)| error_opt)
        .filter(|s| !s.is_empty())
        .collect();
    let error_count = errors.len() as u64;

    match should_emit(total, error_count) {
        EmissionDecision::SkippedNoise => return Ok(EvalOutcome::SkippedNoise),
        EmissionDecision::BelowThreshold => return Ok(EvalOutcome::BelowThreshold),
        EmissionDecision::Emit => {}
    }

    let rate = compute_error_rate(total, error_count);
    let top = top_n_errors(errors, TOP_ERRORS_KEEP);

    // Dedup check: have we sent a curation_suggestion for this assistant
    // within the last SUGGESTION_DEDUP_HOURS?
    let last_ts = fetch_last_curation_suggestion_at(db, user_id, assistant_id).await?;
    if within_dedup_window(now, last_ts) {
        return Ok(EvalOutcome::SkippedDedup);
    }

    let stats = AssistantStats {
        user_id: *user_id,
        assistant_id: *assistant_id,
        assistant_name: assistant_name.to_string(),
        total_calls: total,
        error_calls: error_count,
        error_rate: rate,
        top_error_messages: top,
    };

    emit_curation_notification(db, &stats).await?;
    Ok(EvalOutcome::Emitted(stats))
}

/// Fetch all assistants across tenants. Returns `(user_id, assistant_id, name)`.
///
/// This is an intentional cross-tenant sweep — the curation agent is an
/// admin/background process, not a user-facing handler. Subsequent queries
/// for each assistant are scoped by the full partition key.
async fn list_all_assistants(
    db: &DbSession,
) -> Result<Vec<(Uuid, Uuid, String)>, AppError> {
    // allow-filter: curation cross-tenant sweep — admin background process,
    // subsequent per-assistant queries use the full (user_id, assistant_id)
    // partition key.
    let result = db
        .query_unpaged(
            "SELECT user_id, id, name FROM inertial_eclipse.assistants",
            &[],
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;
    let mut out = Vec::new();
    for row in rows.rows::<(Uuid, Uuid, String)>()? {
        let (user_id, assistant_id, name) = row.map_err(|e| AppError::DatabaseError(e.to_string()))?;
        out.push((user_id, assistant_id, name));
    }
    Ok(out)
}

/// Fetch `(error, created_at_ms)` pairs from `llm_call_logs` for a single
/// assistant in the 7d window. Filters by `created_at >= window_start`
/// in memory (no index on `created_at`, but the PK `(user_id,
/// assistant_id)` already scopes the partition tightly).
async fn fetch_recent_llm_calls(
    db: &DbSession,
    user_id: &Uuid,
    assistant_id: &Uuid,
    window_start_ms: i64,
) -> Result<Vec<(Option<String>, i64)>, AppError> {
    let query = format!(
        "SELECT error, created_at FROM inertial_eclipse.llm_call_logs \
         WHERE user_id = ? AND assistant_id = ? LIMIT {LLM_LOG_SCAN_LIMIT}"
    );
    let result = db
        .query_unpaged(query, (user_id, assistant_id))
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    type Row = (Option<String>, Option<DateTime<Utc>>);
    let rows = result.into_rows_result()?;
    let mut out = Vec::new();
    for row in rows.rows::<Row>()? {
        let r = row.map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let created_at_ms = match r.1 {
            Some(t) => t.timestamp_millis(),
            // Row without created_at: treat as out-of-window (skip). Shouldn't
            // happen since the insert always sets it, but robust.
            None => continue,
        };
        if created_at_ms < window_start_ms {
            continue;
        }
        out.push((r.0, created_at_ms));
    }
    Ok(out)
}

/// Find the timestamp of the most-recent `curation_suggestion` notification
/// for `(user_id, assistant_id)`.
///
/// The notifications table partitions by `user_id` — so this query stays
/// tenant-scoped — but its clustering key `id UUID DESC` is lexicographic,
/// not chronological (no TIMEUUID). That means a plain `LIMIT N` would
/// return an arbitrary slice, not the "most recent N" in wall-clock time.
///
/// We fix that by scanning up to [`NOTIFICATION_SCAN_LIMIT`] rows WITHIN
/// the user's partition, filtering by `notification_type` +
/// `assistant_id` + `created_at` in memory. `ALLOW FILTERING` is used to
/// let Cassandra apply the `notification_type` filter push-down when
/// possible (there's no index on it, but the filter is scoped to a single
/// partition, so the cost is bounded by notifications-per-user).
async fn fetch_last_curation_suggestion_at(
    db: &DbSession,
    user_id: &Uuid,
    assistant_id: &Uuid,
) -> Result<Option<DateTime<Utc>>, AppError> {
    // allow-filter: bounded by the user_id partition (tenant-scoped). The
    // notification_type column has no index, but the partition slice is
    // already small (per-user scale) so this is cheap in practice.
    let query = format!(
        "SELECT assistant_id, notification_type, created_at FROM inertial_eclipse.notifications \
         WHERE user_id = ? AND notification_type = ? LIMIT {NOTIFICATION_SCAN_LIMIT} ALLOW FILTERING"
    );
    let result = db
        .query_unpaged(query, (user_id, CURATION_NOTIFICATION_TYPE))
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    type Row = (Option<Uuid>, Option<String>, Option<DateTime<Utc>>);
    let rows = result.into_rows_result()?;
    let mut latest: Option<DateTime<Utc>> = None;
    for row in rows.rows::<Row>()? {
        let (row_assistant_id, _row_type, row_created_at) =
            row.map_err(|e| AppError::DatabaseError(e.to_string()))?;
        // Filter by assistant_id here — Cassandra applied the type filter.
        if row_assistant_id.as_ref() != Some(assistant_id) {
            continue;
        }
        if let Some(ts) = row_created_at {
            latest = Some(match latest {
                Some(existing) if existing >= ts => existing,
                _ => ts,
            });
        }
    }
    Ok(latest)
}

/// Write a `curation_suggestion` notification row. The message body encodes
/// the key metrics in plain text for the UI; the JSON-like details are
/// encoded inline (notifications has no structured payload column, so we
/// stay consistent with the existing health_check / pix patterns).
async fn emit_curation_notification(
    db: &DbSession,
    stats: &AssistantStats,
) -> Result<(), AppError> {
    let title = format!(
        "Revise o assistente \"{}\" (erro {:.1}% em {}d)",
        stats.assistant_name,
        stats.error_rate * 100.0,
        CURATION_WINDOW_DAYS,
    );

    let top_str = if stats.top_error_messages.is_empty() {
        "—".to_string()
    } else {
        stats.top_error_messages.join(", ")
    };

    let message = format!(
        "Nos últimos {} dias este assistente teve taxa de erro de {:.1}% \
         ({} erros em {} chamadas LLM). Principais erros: {}. \
         Considere revisar system prompt, tools e thresholds.",
        CURATION_WINDOW_DAYS,
        stats.error_rate * 100.0,
        stats.error_calls,
        stats.total_calls,
        top_str,
    );

    // Inline INSERT — do NOT call `create_notification` because that helper
    // also publishes an SSE event, which for a background nightly sweep
    // would fire during off-hours and potentially wake up a sleeping UI.
    // A plain INSERT is enough: the UI will pick it up on next poll / next
    // SSE reconnect. If product later wants real-time, swap this for
    // `services::notification::create_notification`.
    let id = Uuid::new_v4();
    let now = CqlTimestamp(Utc::now().timestamp_millis());
    db.query_unpaged(
        "INSERT INTO inertial_eclipse.notifications \
         (user_id, id, assistant_id, integration_id, notification_type, title, message, is_read, created_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, false, ?)",
        (
            &stats.user_id,
            &id,
            Some(&stats.assistant_id),
            None::<Uuid>,
            CURATION_NOTIFICATION_TYPE,
            &title,
            &message,
            now,
        ),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(())
}

// ============================================================================
// Tests (pure helpers only — integration with Cassandra deferred)
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_rate_computation() {
        // Basic case: 10% error rate.
        assert!((compute_error_rate(100, 10) - 0.10).abs() < 1e-6);

        // Zero total → zero rate (no div-by-zero panic).
        assert_eq!(compute_error_rate(0, 0), 0.0);
        assert_eq!(compute_error_rate(0, 7), 0.0);

        // Zero errors → zero rate.
        assert_eq!(compute_error_rate(500, 0), 0.0);

        // Clamp: errors > total → cap at 1.0 instead of returning > 1.0
        // (defensive; shouldn't happen in prod).
        assert_eq!(compute_error_rate(10, 20), 1.0);
    }

    #[test]
    fn test_below_min_calls_skipped() {
        // Plan's test case: total=5, errors=3 (60% rate) — but sample too
        // small, should NOT emit.
        assert_eq!(should_emit(5, 3), EmissionDecision::SkippedNoise);

        // Exactly at the threshold boundary: 9 calls is still < min.
        assert_eq!(should_emit(9, 9), EmissionDecision::SkippedNoise);

        // 10 calls, 0 errors → below threshold (not noise).
        assert_eq!(should_emit(10, 0), EmissionDecision::BelowThreshold);
    }

    #[test]
    fn test_above_threshold_emits_suggestion() {
        // Plan's test case: total=100, errors=10 (10% rate) → emit.
        assert_eq!(should_emit(100, 10), EmissionDecision::Emit);

        // 100 calls, 6 errors (6%) → emit.
        assert_eq!(should_emit(100, 6), EmissionDecision::Emit);

        // 100 calls, exactly 5 errors (5%) → NOT emit (strictly `>`, not `>=`).
        assert_eq!(should_emit(100, 5), EmissionDecision::BelowThreshold);

        // 20 calls, 2 errors (10%) → emit (minimum sample cleared).
        assert_eq!(should_emit(20, 2), EmissionDecision::Emit);
    }

    #[test]
    fn test_dedup_skips_recent_suggestion() {
        let now = Utc::now();
        // Last suggestion 1h ago → within the 24h dedup window → skip.
        let last = now - chrono::Duration::hours(1);
        assert!(
            within_dedup_window(now, Some(last)),
            "1h-old suggestion must be inside the 24h dedup window"
        );

        // 23h old still skips (< 24h).
        let last_23h = now - chrono::Duration::hours(23);
        assert!(within_dedup_window(now, Some(last_23h)));
    }

    #[test]
    fn test_dedup_allows_after_window() {
        let now = Utc::now();
        // Last suggestion 25h ago → outside window → do NOT skip (allow emit).
        let last = now - chrono::Duration::hours(25);
        assert!(
            !within_dedup_window(now, Some(last)),
            "25h-old suggestion must be outside the 24h dedup window"
        );

        // Exactly 24h old should be treated as OUTSIDE the window
        // (comparison is `age < window`, so `age == window` falls through
        // to "allow"). Lock this boundary behavior for future refactors.
        let last_24h = now - chrono::Duration::hours(24);
        assert!(
            !within_dedup_window(now, Some(last_24h)),
            "boundary: exactly 24h old must allow a fresh emission"
        );

        // No previous suggestion at all → never dedups.
        assert!(!within_dedup_window(now, None));
    }

    #[test]
    fn test_top_errors_aggregation() {
        // 10 errors, 3 distinct messages with different frequencies.
        let errors = vec![
            "timeout".to_string(),
            "timeout".to_string(),
            "timeout".to_string(),
            "timeout".to_string(),
            "timeout".to_string(), // 5× timeout
            "provider_rate_limit".to_string(),
            "provider_rate_limit".to_string(),
            "provider_rate_limit".to_string(), // 3× rate_limit
            "invalid_response".to_string(),
            "invalid_response".to_string(), // 2× invalid
        ];
        let top = top_n_errors(errors, 3);
        assert_eq!(
            top,
            vec![
                "timeout".to_string(),
                "provider_rate_limit".to_string(),
                "invalid_response".to_string(),
            ],
        );
    }

    #[test]
    fn test_top_errors_ties_break_lexicographically() {
        // Two distinct errors each occurring exactly once — deterministic
        // ordering is required for stable test assertions and consistent
        // operator experience across consecutive passes.
        let errors = vec!["zebra".to_string(), "alpha".to_string()];
        let top = top_n_errors(errors, 2);
        // `alpha` < `zebra` lexicographically → alpha first.
        assert_eq!(top, vec!["alpha".to_string(), "zebra".to_string()]);
    }

    #[test]
    fn test_top_errors_ignores_empty_strings() {
        // Empty error strings shouldn't inflate counts — they come from the
        // `error` column being NULL and parsed as Option::None, which we
        // filter upstream, but be robust here too.
        let errors = vec![
            "".to_string(),
            "real_error".to_string(),
            "".to_string(),
        ];
        let top = top_n_errors(errors, 3);
        assert_eq!(top, vec!["real_error".to_string()]);
    }

    #[test]
    fn test_top_errors_respects_n_zero() {
        let errors = vec!["x".to_string(), "y".to_string()];
        let top = top_n_errors(errors, 0);
        assert!(top.is_empty());
    }

    #[test]
    fn test_curation_constants_match_plan() {
        // Lock the tunables specified in the T3.3 plan. If these move, the
        // decision should be explicit (bump this test in the same commit).
        assert!((CURATION_ERROR_THRESHOLD - 0.05).abs() < 1e-6);
        assert_eq!(CURATION_WINDOW_DAYS, 7);
        assert_eq!(CURATION_MIN_CALLS, 10);
        assert_eq!(SUGGESTION_DEDUP_HOURS, 24);
        assert_eq!(CURATION_NOTIFICATION_TYPE, "curation_suggestion");
    }
}
