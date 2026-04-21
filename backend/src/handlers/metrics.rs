// S2.3 — Prometheus metrics endpoint.
//
// GET /api/internal/metrics — returns the in-memory metric registry in
// Prometheus text format 0.0.4. Always returns 200; response body is
// deterministic for a given state (counters sorted, histogram buckets in
// ascending `le` order).
//
// AUTH / TENANCY: this endpoint is PUBLIC (no JWT middleware). Prometheus
// scrapers do not carry user credentials, and the metrics are system-wide
// — not scoped to any one user. Sophie's `/api/baisync/actions/
// platform_health` (S1.3) is the user-scoped path and does NOT read from
// this endpoint.
//
// SECURITY — operator requirement: OPERATORS MUST FIREWALL `/api/internal/*`
// from the public internet. Options:
//   - Reverse proxy allowlist (nginx / Traefik) on the scraper's source IP.
//   - Kubernetes NetworkPolicy restricting ingress to the Prometheus pod.
//   - Coolify-level service mesh / private network for the scrape target.
// Failing to firewall this path leaks per-assistant compaction rates to
// any external caller.
//
// The `compaction_total` family carries `assistant_id` as a label — this
// is low-cardinality per deployment but MUST stay behind the firewall.

use axum::http::{header, StatusCode};
use axum::response::IntoResponse;

/// Public (unauthenticated) scrape endpoint — see module docs for the
/// firewall contract operators are required to honor.
pub async fn get_metrics() -> impl IntoResponse {
    let body = crate::services::metrics::format_prometheus().await;
    (
        StatusCode::OK,
        [(
            header::CONTENT_TYPE,
            "text/plain; version=0.0.4; charset=utf-8",
        )],
        body,
    )
}
