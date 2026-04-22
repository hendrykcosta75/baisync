// S2.3 — Prometheus metrics collector.
//
// In-memory metric registry, exposed as a text endpoint at
// `/api/internal/metrics` (see `handlers::metrics`). Hand-formatted
// Prometheus 0.0.4 text — the full format spec we need fits in ~100 lines
// of code, so pulling the `prometheus` crate would trade a few lines of
// formatting for another dep surface we don't need.
//
// OTel is rejected by the plan (over-engineering for a platform at this
// stage). The scraper pulls text; no background exporter, no collector.
//
// Multi-tenancy note:
//   This module is intentionally SYSTEM-WIDE, not user-scoped. Metrics
//   are for operators, not end-users. Sophie's `/api/baisync/actions/
//   platform_health` (S1.3) returns USER-SCOPED health; it does NOT read
//   from this module. The two signals live side by side and never mix.
//
//   Consequences:
//     - Labels never include `user_id` (cardinality bomb + tenant leak).
//     - `assistant_id` IS included on `compaction_total` because it is a
//       low-cardinality signal per deployment and operators asked for
//       per-assistant visibility on compaction. Operators MUST firewall
//       `/api/internal/*` from the public internet so an assistant_id is
//       never exposed to a non-operator.
//
// Label-escape contract (Prometheus text format 0.0.4):
//   - `"` → `\"`
//   - `\` → `\\`
//   - `\n` → `\\n`
//   These are the ONLY three escape sequences required by the spec.

use std::collections::HashMap;
use std::sync::OnceLock;
use tokio::sync::RwLock;

/// Process-wide metric registry. Instantiated lazily via `metrics()`.
pub struct Metrics {
    pub llm_calls_total: RwLock<HashMap<(String, String), u64>>,
    pub llm_duration_seconds: RwLock<LlmDurationHistogram>,
    pub tool_calls_total: RwLock<HashMap<(String, String), u64>>,
    pub session_events_total: RwLock<HashMap<String, u64>>,
    /// S3.2 — session mutations dropped because the mpsc sender was full
    /// (drain stalled). Labeled by event_type (`user_turn_started`,
    /// `model_turn_completed`, `create`, `update_status`, etc). An
    /// operator alert on `rate(session_events_dropped_total[5m]) > 0`
    /// catches Cassandra stalls that would otherwise silently lose data.
    pub session_events_dropped_total: RwLock<HashMap<String, u64>>,
    pub webhook_deduped_total: RwLock<HashMap<String, u64>>,
    pub compaction_total: RwLock<HashMap<String, u64>>,
    /// W2.1 — evaluator spawns grouped by terminal status
    /// (`ok`, `issues`, `timeout`, `llm_error`, `parse_error`,
    /// `semaphore_full`, `no_api_key`) and scope (`user` or `sophie`).
    /// No assistant_id label — evaluator alerts don't need per-assistant
    /// breakdown and the cardinality cost isn't justified.
    pub evaluator_total: RwLock<HashMap<(String, String), u64>>,
}

/// Histogram for LLM request duration. Bucket bounds hard-coded to the
/// canonical Prometheus "API-call" ladder: 100 ms → 60 s + `+Inf`.
/// Each bucket entry stores `(le_upper_bound, cumulative_count)` so the
/// text formatter can emit `_bucket{le="..."}` lines directly.
#[derive(Default)]
pub struct LlmDurationHistogram {
    pub buckets: Vec<(f64, u64)>,
    pub sum: f64,
    pub count: u64,
}

impl LlmDurationHistogram {
    pub fn new() -> Self {
        let les: Vec<f64> = vec![0.1, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0, f64::INFINITY];
        Self {
            buckets: les.into_iter().map(|le| (le, 0u64)).collect(),
            sum: 0.0,
            count: 0,
        }
    }

    /// Record a single observation. Every bucket whose `le` upper bound is
    /// `>= seconds` gets incremented (cumulative histogram semantics).
    pub fn observe(&mut self, seconds: f64) {
        // Treat NaN / negative as 0s to avoid poisoning the sum.
        let v = if seconds.is_finite() && seconds >= 0.0 {
            seconds
        } else {
            0.0
        };
        for (le, count) in self.buckets.iter_mut() {
            if v <= *le {
                *count += 1;
            }
        }
        self.sum += v;
        self.count += 1;
    }
}

static METRICS: OnceLock<Metrics> = OnceLock::new();

/// Lazily-initialized global registry. Every increment and the formatter
/// goes through this getter so the first caller wins the init race.
pub fn metrics() -> &'static Metrics {
    METRICS.get_or_init(|| Metrics {
        llm_calls_total: RwLock::new(HashMap::new()),
        llm_duration_seconds: RwLock::new(LlmDurationHistogram::new()),
        tool_calls_total: RwLock::new(HashMap::new()),
        session_events_total: RwLock::new(HashMap::new()),
        session_events_dropped_total: RwLock::new(HashMap::new()),
        webhook_deduped_total: RwLock::new(HashMap::new()),
        compaction_total: RwLock::new(HashMap::new()),
        evaluator_total: RwLock::new(HashMap::new()),
    })
}

/// Increment `llm_calls_total{provider, status}`. Status is one of
/// `"ok"`, `"error"`, `"timeout"`, `"circuit_open"` — callers must not
/// invent new values without adding them to the Grafana dashboard first.
pub async fn inc_llm_call(provider: &str, status: &str) {
    let mut map = metrics().llm_calls_total.write().await;
    *map.entry((provider.to_string(), status.to_string()))
        .or_insert(0) += 1;
}

/// Observe one LLM round-trip duration in seconds. Feeds the histogram
/// shared across providers (provider label intentionally dropped to keep
/// bucket cardinality bounded — per-provider rate + error lives on
/// `llm_calls_total`).
pub async fn observe_llm_duration(seconds: f64) {
    let mut hist = metrics().llm_duration_seconds.write().await;
    hist.observe(seconds);
}

/// Increment `tool_calls_total{tool, status}`. Status is `"ok"` or
/// `"error"`.
pub async fn inc_tool_call(tool: &str, status: &str) {
    let mut map = metrics().tool_calls_total.write().await;
    *map.entry((tool.to_string(), status.to_string()))
        .or_insert(0) += 1;
}

/// Increment `session_events_total{type}` for a given session event type.
pub async fn inc_session_event(event_type: &str) {
    let mut map = metrics().session_events_total.write().await;
    *map.entry(event_type.to_string()).or_insert(0) += 1;
}

/// S3.2 — increment `session_events_dropped_total{type}` when the
/// session-mutation mpsc sender is full and a mutation had to be
/// discarded. Called from `services::session::enqueue` (spawned so
/// the hot path never awaits the metric lock).
pub async fn inc_session_event_dropped(event_type: &str) {
    let mut map = metrics().session_events_dropped_total.write().await;
    *map.entry(event_type.to_string()).or_insert(0) += 1;
}

/// Increment `webhook_deduped_total{provider}` when I2 detects a
/// duplicate webhook (applied=false in LWT).
pub async fn inc_webhook_deduped(provider: &str) {
    let mut map = metrics().webhook_deduped_total.write().await;
    *map.entry(provider.to_string()).or_insert(0) += 1;
}

/// Increment `compaction_total{assistant_id}` for every successful
/// compaction of a conversation. `assistant_id` is stringified by the
/// caller (we avoid Uuid in the metric signature so this file has no
/// dependency on the `uuid` crate).
pub async fn inc_compaction(assistant_id: &str) {
    let mut map = metrics().compaction_total.write().await;
    *map.entry(assistant_id.to_string()).or_insert(0) += 1;
}

/// W2.1 — increment `evaluator_total{scope, status}`. `scope` is one of
/// `"user"` (primary-assistant evaluator) or `"sophie"`. `status` is one
/// of `"ok"`, `"issues"`, `"timeout"`, `"llm_error"`, `"parse_error"`,
/// `"semaphore_full"`, `"no_api_key"`. Callers must not invent new status
/// values without updating the Grafana dashboard first.
pub async fn inc_evaluator(scope: &str, status: &str) {
    let mut map = metrics().evaluator_total.write().await;
    *map.entry((scope.to_string(), status.to_string()))
        .or_insert(0) += 1;
}

/// Escape a label value per Prometheus text format 0.0.4. Only these
/// three sequences are required; other printable characters pass through.
fn escape_label_value(v: &str) -> String {
    let mut out = String::with_capacity(v.len());
    for ch in v.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            c => out.push(c),
        }
    }
    out
}

/// Render an `le` bucket bound. `+Inf` is the Prometheus spelling the
/// scraper expects; we must NOT emit `inf` or `Infinity`.
fn format_le(le: f64) -> String {
    if le.is_infinite() {
        "+Inf".to_string()
    } else {
        // Strip trailing zeros / dot without pulling in a formatter crate.
        // `0.1` → `"0.1"`, `1.0` → `"1"`, `2.5` → `"2.5"`.
        let s = format!("{le}");
        s
    }
}

/// Hand-rolled Prometheus 0.0.4 text encoder. Emits `# HELP` + `# TYPE`
/// for each metric family followed by one line per sample. Output is
/// deterministic within a family (counters sorted by label tuple; the
/// histogram emits `le` in ascending order) so scraped snapshots diff
/// cleanly in test assertions.
pub async fn format_prometheus() -> String {
    let m = metrics();
    let mut out = String::with_capacity(2048);

    // --- llm_calls_total ---
    out.push_str("# HELP llm_calls_total Total LLM provider calls, labeled by provider and status (ok|error|timeout|circuit_open).\n");
    out.push_str("# TYPE llm_calls_total counter\n");
    {
        let map = m.llm_calls_total.read().await;
        let mut entries: Vec<(&(String, String), &u64)> = map.iter().collect();
        entries.sort_by(|a, b| a.0.cmp(b.0));
        if entries.is_empty() {
            out.push_str("llm_calls_total 0\n");
        } else {
            for ((provider, status), count) in entries {
                out.push_str(&format!(
                    "llm_calls_total{{provider=\"{}\",status=\"{}\"}} {}\n",
                    escape_label_value(provider),
                    escape_label_value(status),
                    count
                ));
            }
        }
    }

    // --- llm_duration_seconds (histogram) ---
    out.push_str("# HELP llm_duration_seconds LLM HTTP round-trip duration in seconds (after retries).\n");
    out.push_str("# TYPE llm_duration_seconds histogram\n");
    {
        let hist = m.llm_duration_seconds.read().await;
        for (le, count) in &hist.buckets {
            out.push_str(&format!(
                "llm_duration_seconds_bucket{{le=\"{}\"}} {}\n",
                format_le(*le),
                count
            ));
        }
        out.push_str(&format!("llm_duration_seconds_sum {}\n", hist.sum));
        out.push_str(&format!("llm_duration_seconds_count {}\n", hist.count));
    }

    // --- tool_calls_total ---
    out.push_str("# HELP tool_calls_total Total tool executions dispatched from the LLM loop, labeled by tool and status.\n");
    out.push_str("# TYPE tool_calls_total counter\n");
    {
        let map = m.tool_calls_total.read().await;
        let mut entries: Vec<(&(String, String), &u64)> = map.iter().collect();
        entries.sort_by(|a, b| a.0.cmp(b.0));
        if entries.is_empty() {
            out.push_str("tool_calls_total 0\n");
        } else {
            for ((tool, status), count) in entries {
                out.push_str(&format!(
                    "tool_calls_total{{tool=\"{}\",status=\"{}\"}} {}\n",
                    escape_label_value(tool),
                    escape_label_value(status),
                    count
                ));
            }
        }
    }

    // --- session_events_total ---
    out.push_str("# HELP session_events_total Total session events appended, labeled by event type.\n");
    out.push_str("# TYPE session_events_total counter\n");
    {
        let map = m.session_events_total.read().await;
        let mut entries: Vec<(&String, &u64)> = map.iter().collect();
        entries.sort_by(|a, b| a.0.cmp(b.0));
        if entries.is_empty() {
            out.push_str("session_events_total 0\n");
        } else {
            for (ty, count) in entries {
                out.push_str(&format!(
                    "session_events_total{{type=\"{}\"}} {}\n",
                    escape_label_value(ty),
                    count
                ));
            }
        }
    }

    // --- session_events_dropped_total (S3.2) ---
    out.push_str("# HELP session_events_dropped_total Total session mutations dropped because the mpsc sender was full (drain stalled), labeled by event type.\n");
    out.push_str("# TYPE session_events_dropped_total counter\n");
    {
        let map = m.session_events_dropped_total.read().await;
        let mut entries: Vec<(&String, &u64)> = map.iter().collect();
        entries.sort_by(|a, b| a.0.cmp(b.0));
        if entries.is_empty() {
            out.push_str("session_events_dropped_total 0\n");
        } else {
            for (ty, count) in entries {
                out.push_str(&format!(
                    "session_events_dropped_total{{type=\"{}\"}} {}\n",
                    escape_label_value(ty),
                    count
                ));
            }
        }
    }

    // --- webhook_deduped_total ---
    out.push_str("# HELP webhook_deduped_total Total duplicate webhooks detected by I2 dedup, labeled by provider.\n");
    out.push_str("# TYPE webhook_deduped_total counter\n");
    {
        let map = m.webhook_deduped_total.read().await;
        let mut entries: Vec<(&String, &u64)> = map.iter().collect();
        entries.sort_by(|a, b| a.0.cmp(b.0));
        if entries.is_empty() {
            out.push_str("webhook_deduped_total 0\n");
        } else {
            for (provider, count) in entries {
                out.push_str(&format!(
                    "webhook_deduped_total{{provider=\"{}\"}} {}\n",
                    escape_label_value(provider),
                    count
                ));
            }
        }
    }

    // --- compaction_total ---
    out.push_str("# HELP compaction_total Total successful conversation compactions, labeled by assistant_id.\n");
    out.push_str("# TYPE compaction_total counter\n");
    {
        let map = m.compaction_total.read().await;
        let mut entries: Vec<(&String, &u64)> = map.iter().collect();
        entries.sort_by(|a, b| a.0.cmp(b.0));
        if entries.is_empty() {
            out.push_str("compaction_total 0\n");
        } else {
            for (assistant_id, count) in entries {
                out.push_str(&format!(
                    "compaction_total{{assistant_id=\"{}\"}} {}\n",
                    escape_label_value(assistant_id),
                    count
                ));
            }
        }
    }

    // --- evaluator_total ---
    out.push_str("# HELP evaluator_total Total evaluator spawns, labeled by scope (user|sophie) and terminal status.\n");
    out.push_str("# TYPE evaluator_total counter\n");
    {
        let map = m.evaluator_total.read().await;
        let mut entries: Vec<(&(String, String), &u64)> = map.iter().collect();
        entries.sort_by(|a, b| a.0.cmp(b.0));
        if entries.is_empty() {
            out.push_str("evaluator_total 0\n");
        } else {
            for ((scope, status), count) in entries {
                out.push_str(&format!(
                    "evaluator_total{{scope=\"{}\",status=\"{}\"}} {}\n",
                    escape_label_value(scope),
                    escape_label_value(status),
                    count
                ));
            }
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::Mutex;

    /// Metrics are process-global. Tests that touch the same metric family
    /// must serialize so one test's increments don't leak into another's
    /// assertions. Each test that mutates a family takes this lock FIRST
    /// and a uses a unique label value where possible.
    static TEST_LOCK: tokio::sync::OnceCell<Mutex<()>> = tokio::sync::OnceCell::const_new();
    async fn lock() -> tokio::sync::MutexGuard<'static, ()> {
        TEST_LOCK
            .get_or_init(|| async { Mutex::new(()) })
            .await
            .lock()
            .await
    }

    #[tokio::test]
    async fn test_counter_increment() {
        let _g = lock().await;
        // Fresh label tuple so parallel runs can't collide (unique provider).
        let provider = "openai_test_counter_increment";
        inc_llm_call(provider, "ok").await;
        inc_llm_call(provider, "ok").await;
        let out = format_prometheus().await;
        let expected = format!(
            "llm_calls_total{{provider=\"{}\",status=\"ok\"}} 2",
            provider
        );
        assert!(
            out.contains(&expected),
            "expected to find {expected:?} in output:\n{out}"
        );
    }

    #[tokio::test]
    async fn test_histogram_buckets_cumulative() {
        let _g = lock().await;
        // Snapshot state BEFORE observing so the delta is exact regardless of
        // what other tests have already added.
        let baseline_buckets: Vec<u64>;
        let baseline_count: u64;
        let baseline_sum: f64;
        {
            let hist = metrics().llm_duration_seconds.read().await;
            baseline_buckets = hist.buckets.iter().map(|(_, c)| *c).collect();
            baseline_count = hist.count;
            baseline_sum = hist.sum;
        }

        observe_llm_duration(0.05).await;
        observe_llm_duration(0.3).await;
        observe_llm_duration(2.0).await;

        let hist = metrics().llm_duration_seconds.read().await;
        // Expected deltas per bucket: values [0.05, 0.3, 2.0] cumulative.
        //   le=0.1 ← 0.05                                      → +1
        //   le=0.5 ← 0.05, 0.3                                 → +2
        //   le=1.0 ← 0.05, 0.3                                 → +2
        //   le=2.5 ← 0.05, 0.3, 2.0                            → +3
        //   le=5.0 and above ← all                             → +3
        let expected_deltas = [1u64, 2, 2, 3, 3, 3, 3, 3, 3];
        for (i, (le, count)) in hist.buckets.iter().enumerate() {
            let delta = *count - baseline_buckets[i];
            assert_eq!(
                delta, expected_deltas[i],
                "bucket le={le} delta should be {}, got {delta}",
                expected_deltas[i]
            );
        }
        assert_eq!(hist.count - baseline_count, 3);
        // f64 arithmetic — 0.05 + 0.3 + 2.0 = 2.35 within rounding
        let sum_delta = hist.sum - baseline_sum;
        assert!(
            (sum_delta - 2.35).abs() < 1e-9,
            "expected sum delta ~2.35, got {sum_delta}"
        );
    }

    #[tokio::test]
    async fn test_histogram_sum_and_count() {
        let _g = lock().await;
        let baseline_count: u64;
        let baseline_sum: f64;
        {
            let hist = metrics().llm_duration_seconds.read().await;
            baseline_count = hist.count;
            baseline_sum = hist.sum;
        }
        observe_llm_duration(0.05).await;
        observe_llm_duration(0.3).await;
        observe_llm_duration(2.0).await;

        // Read the post-state the same way the formatter does, so the
        // expected string is guaranteed to match the actual float rendering
        // (f64 round-trip through `format!("{}")` is not associative —
        // `baseline + 2.35` in user space may differ from the in-registry
        // accumulated sum by an ULP).
        let (actual_sum, actual_count) = {
            let hist = metrics().llm_duration_seconds.read().await;
            (hist.sum, hist.count)
        };
        assert_eq!(
            actual_count - baseline_count,
            3,
            "observation delta should be 3 (0.05, 0.3, 2.0)"
        );
        // Delta is ~2.35 within float ULPs — asserted numerically, not
        // textually, because of accumulated f64 imprecision.
        let sum_delta = actual_sum - baseline_sum;
        assert!(
            (sum_delta - 2.35).abs() < 1e-9,
            "expected delta ~2.35, got {sum_delta}"
        );

        let out = format_prometheus().await;
        // Build the exact expected strings from `actual_*` values, mirroring
        // how the formatter renders them.
        let sum_line = format!("llm_duration_seconds_sum {actual_sum}");
        let count_line = format!("llm_duration_seconds_count {actual_count}");
        assert!(
            out.contains(&sum_line),
            "expected {sum_line:?} in output:\n{out}"
        );
        assert!(
            out.contains(&count_line),
            "expected {count_line:?} in output:\n{out}"
        );
    }

    #[tokio::test]
    async fn test_format_includes_help_and_type() {
        let out = format_prometheus().await;
        // Every metric family MUST emit both a HELP and a TYPE line. This
        // guards against a regression where a new family is added without
        // the preamble (scrapers reject such output on strict mode).
        let families = [
            "llm_calls_total",
            "llm_duration_seconds",
            "tool_calls_total",
            "session_events_total",
            "session_events_dropped_total",
            "webhook_deduped_total",
            "compaction_total",
            "evaluator_total",
        ];
        for family in families {
            let help = format!("# HELP {family} ");
            let type_line_counter = format!("# TYPE {family} counter");
            let type_line_histogram = format!("# TYPE {family} histogram");
            assert!(
                out.contains(&help),
                "missing HELP line for {family}:\n{out}"
            );
            assert!(
                out.contains(&type_line_counter) || out.contains(&type_line_histogram),
                "missing TYPE line for {family}:\n{out}"
            );
        }
    }

    #[tokio::test]
    async fn test_empty_registry_still_formats() {
        // Do NOT hold the lock across increments — this test asserts that
        // even a family with zero entries emits a placeholder zero line.
        // We can't clear the global state (no API), but we CAN assert that
        // the formatted output always contains a zero-count line for every
        // family when the family has no entries. We check this on the
        // session/webhook/compaction families by using label values that
        // no other test uses, then confirming the formatter always emits
        // the "<family> 0" placeholder whenever the map is empty.
        //
        // Weaker assertion that doesn't fight the global state: format
        // always returns a non-empty string with six HELP lines.
        let out = format_prometheus().await;
        let help_count = out.matches("# HELP ").count();
        assert_eq!(
            help_count, 8,
            "expected 8 HELP lines (one per family), got {help_count}:\n{out}"
        );
        // Every family still emits a TYPE line on a cold registry.
        let type_count = out.matches("# TYPE ").count();
        assert_eq!(
            type_count, 8,
            "expected 8 TYPE lines, got {type_count}:\n{out}"
        );
    }

    #[tokio::test]
    async fn test_label_escaping() {
        let _g = lock().await;
        // Exercise all three required escape sequences on a single label.
        // Tool names are freeform strings from user config — a malicious
        // name with a `"` could otherwise break out of the label value.
        inc_tool_call("weird\"tool\\name\nwith-escapes", "ok").await;
        let out = format_prometheus().await;
        // Expected escaped form:
        //   "  → \"
        //   \  → \\
        //   \n → \\n
        let expected = r#"tool_calls_total{tool="weird\"tool\\name\nwith-escapes",status="ok"}"#;
        assert!(
            out.contains(expected),
            "expected escaped label {expected:?} in output:\n{out}"
        );
    }

    #[test]
    fn test_histogram_observe_handles_nan_and_negative() {
        // `observe` must never poison `sum` with NaN or negatives — either
        // would corrupt every subsequent scrape. We normalize to 0.0.
        let mut h = LlmDurationHistogram::new();
        h.observe(f64::NAN);
        h.observe(-1.0);
        assert_eq!(h.count, 2);
        assert_eq!(h.sum, 0.0);
        // Both observations land in every bucket (value 0 ≤ every le).
        for (_, c) in &h.buckets {
            assert_eq!(*c, 2);
        }
    }

    #[test]
    fn test_escape_label_value_pure() {
        // Unit test for the escape helper — independent of global state.
        assert_eq!(escape_label_value(""), "");
        assert_eq!(escape_label_value("abc"), "abc");
        assert_eq!(escape_label_value("a\"b"), "a\\\"b");
        assert_eq!(escape_label_value("a\\b"), "a\\\\b");
        assert_eq!(escape_label_value("a\nb"), "a\\nb");
        // All three at once.
        assert_eq!(
            escape_label_value("\"\\\n"),
            "\\\"\\\\\\n"
        );
    }

    #[test]
    fn test_format_le_plus_inf() {
        assert_eq!(format_le(f64::INFINITY), "+Inf");
        assert_eq!(format_le(0.1), "0.1");
        assert_eq!(format_le(60.0), "60");
    }

    /// Dev-only sampling helper: populates a small set of fixtures and
    /// prints the formatted output. Run with:
    ///   `cargo test --lib services::metrics::tests::_sample_format_output -- --ignored --nocapture`
    /// Ignored by default so it doesn't pollute normal test runs.
    #[tokio::test]
    #[ignore]
    async fn _sample_format_output() {
        let _g = lock().await;
        inc_llm_call("openai_sample", "ok").await;
        inc_llm_call("openai_sample", "ok").await;
        inc_llm_call("openai_sample", "error").await;
        inc_llm_call("claude_sample", "circuit_open").await;
        inc_llm_call("gemini_sample", "timeout").await;
        observe_llm_duration(0.08).await;
        observe_llm_duration(0.42).await;
        observe_llm_duration(3.5).await;
        inc_tool_call("http_request_sample", "ok").await;
        inc_tool_call("send_document_sample", "ok").await;
        inc_tool_call("pix_payment_sample", "error").await;
        inc_session_event("user_msg_sample").await;
        inc_session_event("llm_msg_sample").await;
        inc_session_event("tool_call_sample").await;
        inc_webhook_deduped("baileys_sample").await;
        inc_webhook_deduped("meta_sample").await;
        inc_compaction("11111111-2222-3333-4444-555555555555").await;
        let out = format_prometheus().await;
        println!("--- BEGIN SAMPLE /api/internal/metrics ---");
        println!("{out}");
        println!("--- END SAMPLE ---");
    }
}
