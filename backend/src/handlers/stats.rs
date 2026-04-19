use axum::extract::{Extension, Path, Query};
use axum::Json;
use chrono::{DateTime, Duration, Utc};
use scylla::frame::value::{CqlTimestamp, CqlTimeuuid};
use serde::{Deserialize, Serialize};
use serde_json;
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::models::assistant::ToolCallLog;
use crate::services::{assistant, messaging};

// ─── Query params ─────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct DaysQuery {
    pub days: Option<i64>,
    pub share_token: Option<String>,
    /// Comma-separated list of "YYYY-MM-DD" dates from the client's local timezone.
    /// When provided, these dates are used instead of generating from Utc::now().
    pub dates: Option<String>,
}

/// Parse a comma-separated dates string into a Vec of date strings (newest first).
/// Falls back to UTC-based generation if parsing fails or dates is None.
fn resolve_periods(dates: Option<&str>, days_fallback: i64) -> Vec<String> {
    if let Some(dates_str) = dates {
        let parsed: Vec<String> = dates_str
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| s.len() == 10) // "YYYY-MM-DD"
            .collect();
        if !parsed.is_empty() {
            return parsed;
        }
    }
    let today = Utc::now();
    (0..days_fallback)
        .map(|i| (today - Duration::days(i)).format("%Y-%m-%d").to_string())
        .collect()
}

#[derive(Deserialize)]
pub struct LimitQuery {
    pub limit: Option<usize>,
    pub offset: Option<usize>,
    pub share_token: Option<String>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    /// Browser's `-new Date().getTimezoneOffset()` (minutes east of UTC). When
    /// present, the date strings are interpreted in the user's local tz so a
    /// selection of "today" doesn't drop the last hours of the local day.
    pub tz_offset: Option<i32>,
}

/// Parse "YYYY-MM-DD" into millis-since-epoch bounds, honoring an optional
/// `tz_offset_minutes` so local-day boundaries align with what the user sees.
/// Returns (None, None) when both strings are missing or malformed.
fn parse_date_bounds(
    from_date: Option<&str>,
    to_date: Option<&str>,
    tz_offset_minutes: Option<i32>,
) -> (Option<i64>, Option<i64>) {
    // Local day starts at 00:00 local == 00:00 UTC − offset minutes.
    let offset_ms: i64 = tz_offset_minutes.unwrap_or(0) as i64 * 60_000;
    let from_ts = from_date.and_then(|s| {
        chrono::NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d")
            .ok()
            .and_then(|d| d.and_hms_opt(0, 0, 0))
            .map(|dt| dt.and_utc().timestamp_millis() - offset_ms)
    });
    let to_ts = to_date.and_then(|s| {
        chrono::NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d")
            .ok()
            .and_then(|d| d.and_hms_milli_opt(23, 59, 59, 999))
            .map(|dt| dt.and_utc().timestamp_millis() - offset_ms)
    });
    (from_ts, to_ts)
}

/// Safer upper bound than `i64::MAX` for CqlTimestamp — drivers treat this as
/// millis and year-292M values can roundtrip badly. Picks `9999-12-31T23:59:59.999Z`.
const CQL_TS_MAX_MS: i64 = 253_402_300_799_999;

// ─── GET /api/user/usage?days=N ───────────────────────────────────────────────
// Usage chart data: messages+tokens per day across all assistants.

#[derive(Serialize)]
pub struct DailyUsage {
    pub date: String,
    pub requests: i64,
    pub tokens: i64,
}

pub async fn user_usage(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Query(params): Query<DaysQuery>,
) -> Result<Json<Vec<DailyUsage>>, AppError> {
    let days = params.days.unwrap_or(14).min(90);
    let periods = resolve_periods(params.dates.as_deref(), days);

    let assistants = assistant::list_assistants(&db, &auth_user.workspace_id).await?;

    // Map period → (messages, tokens)
    let mut daily: std::collections::HashMap<String, (i64, i64)> =
        periods.iter().map(|d| (d.clone(), (0i64, 0i64))).collect();

    for asst in &assistants {
        let result = db
            .query_unpaged(
                "SELECT period, total_messages, total_tokens \
                 FROM inertial_eclipse.usage_stats \
                 WHERE user_id = ? AND assistant_id = ?",
                (&auth_user.workspace_id, &asst.id),
            )
            .await
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;

        let rows = result.into_rows_result()?;
        for row in rows.rows::<(String, Option<i64>, Option<i64>)>()?.flatten() {
            let (period, messages, tokens) = row;
            if let Some(entry) = daily.get_mut(&period) {
                entry.0 += messages.unwrap_or(0);
                entry.1 += tokens.unwrap_or(0);
            }
        }
    }

    // Return oldest → newest
    let data: Vec<DailyUsage> = periods
        .iter()
        .rev()
        .map(|date| {
            let (requests, tokens) = daily.get(date).copied().unwrap_or((0, 0));
            DailyUsage {
                date: date.clone(),
                requests,
                tokens,
            }
        })
        .collect();

    Ok(Json(data))
}

// ─── GET /api/assistants/{id}/stats?days=N ───────────────────────────────────
// Per-assistant stats: daily breakdown, totals, sparkline, channel breakdown.

#[derive(Serialize)]
pub struct DailyPoint {
    pub date: String,
    pub requests: i64,
    pub tokens: i64,
}

#[derive(Serialize)]
pub struct ChannelCount {
    pub channel: String,
    pub count: i64,
}

#[derive(Serialize)]
pub struct AssistantStats {
    pub total_tokens: i64,
    pub total_messages: i64,
    /// 7-day message sparkline (oldest → newest) kept for backward compat
    pub sparkline: Vec<i64>,
    /// Daily breakdown for the requested window (oldest → newest)
    pub daily: Vec<DailyPoint>,
    pub last_interaction_at: Option<String>,
    pub channel_breakdown: Vec<ChannelCount>,
}

pub async fn assistant_stats(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(assistant_id): Path<Uuid>,
    Query(params): Query<DaysQuery>,
) -> Result<Json<AssistantStats>, AppError> {
    let days = params.days.unwrap_or(14).max(1).min(30);

    // Verify ownership or share_token access
    let owner_id = assistant::resolve_assistant_access(
        &db,
        &auth_user.workspace_id,
        &assistant_id,
        params.share_token.as_deref(),
        "read",
    )
    .await?;

    let periods = resolve_periods(params.dates.as_deref(), days);

    // (requests, tokens) per day
    let mut daily_data: std::collections::HashMap<String, (i64, i64)> =
        periods.iter().map(|d| (d.clone(), (0i64, 0i64))).collect();
    let mut total_tokens = 0i64;
    let mut total_messages = 0i64;

    let result = db
        .query_unpaged(
            "SELECT period, total_messages, total_tokens \
             FROM inertial_eclipse.usage_stats \
             WHERE user_id = ? AND assistant_id = ?",
            (&owner_id, &assistant_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;
    for row in rows.rows::<(String, Option<i64>, Option<i64>)>()?.flatten() {
        let (period, messages, tokens) = row;
        let messages = messages.unwrap_or(0);
        let tokens = tokens.unwrap_or(0);
        if let Some(entry) = daily_data.get_mut(&period) {
            entry.0 += messages;
            entry.1 += tokens;
            total_tokens += tokens;
            total_messages += messages;
        }
    }

    // Daily breakdown oldest → newest
    let daily: Vec<DailyPoint> = periods
        .iter()
        .rev()
        .map(|date| {
            let (requests, tokens) = daily_data.get(date).copied().unwrap_or((0, 0));
            DailyPoint {
                date: date.clone(),
                requests,
                tokens,
            }
        })
        .collect();

    // Sparkline: last 7 days oldest → newest (backward compat)
    // Use the first 7 entries from periods (which are newest-first)
    let sparkline_periods: Vec<String> = periods.iter().take(7).cloned().collect();
    let sparkline: Vec<i64> = sparkline_periods
        .iter()
        .rev()
        .map(|d| daily_data.get(d).map(|(m, _)| *m).unwrap_or(0))
        .collect();

    // Conversations: last interaction + channel breakdown (fetch all for stats)
    let convs_page =
        messaging::list_conversations(&db, &assistant_id, &owner_id, 10000, None, None).await?;
    let convs = &convs_page.items;

    let last_interaction_at = convs
        .iter()
        .filter(|c| c.channel != "playground")
        .max_by_key(|c| c.last_message_at)
        .map(|c| c.last_message_at.to_rfc3339());

    let mut channel_map: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    for conv in convs {
        if conv.channel != "playground" {
            *channel_map.entry(conv.channel.clone()).or_insert(0) += 1;
        }
    }
    let mut channel_breakdown: Vec<ChannelCount> = channel_map
        .into_iter()
        .map(|(channel, count)| ChannelCount { channel, count })
        .collect();
    channel_breakdown.sort_by(|a, b| b.count.cmp(&a.count));

    Ok(Json(AssistantStats {
        total_tokens,
        total_messages,
        sparkline,
        daily,
        last_interaction_at,
        channel_breakdown,
    }))
}

// ─── GET /api/assistants/{id}/logs?limit=N ───────────────────────────────────
// All tool call logs across every tool of an assistant, sorted newest first.

#[derive(Serialize)]
pub struct AssistantLog {
    pub id: String,
    pub tool_id: String,
    pub tool_name: String,
    pub arguments: Option<String>,
    pub status_code: Option<i32>,
    pub response_body: Option<String>,
    pub error: Option<String>,
    pub duration_ms: i32,
    pub called_at: String,
}

impl From<ToolCallLog> for AssistantLog {
    fn from(l: ToolCallLog) -> Self {
        AssistantLog {
            id: l.id.to_string(),
            tool_id: l.tool_id.to_string(),
            tool_name: l.tool_name,
            arguments: l.arguments,
            status_code: l.status_code,
            response_body: l.response_body,
            error: l.error,
            duration_ms: l.duration_ms,
            called_at: l.called_at.to_rfc3339(),
        }
    }
}

pub async fn assistant_logs(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(assistant_id): Path<Uuid>,
    Query(params): Query<LimitQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let limit = params.limit.unwrap_or(100).min(500);
    let (from_ts, to_ts) = parse_date_bounds(
        params.from_date.as_deref(),
        params.to_date.as_deref(),
        params.tz_offset,
    );

    // Verify ownership or share_token access
    assistant::resolve_assistant_access(
        &db,
        &auth_user.workspace_id,
        &assistant_id,
        params.share_token.as_deref(),
        "read",
    )
    .await?;

    // Get all tools, then batch-fetch their logs
    let tools = assistant::list_tools(&db, &assistant_id).await?;

    let mut all_logs: Vec<(chrono::DateTime<Utc>, AssistantLog)> = Vec::new();
    for tool in &tools {
        let logs =
            assistant::list_tool_call_logs(&db, &assistant_id, &tool.id, limit as i32, from_ts, to_ts)
                .await
                .unwrap_or_default();
        for log in logs {
            let ts = log.called_at;
            all_logs.push((ts, AssistantLog::from(log)));
        }
    }

    all_logs.sort_by(|a, b| b.0.cmp(&a.0));
    let offset = params.offset.unwrap_or(0);
    let total_matched = all_logs.len();
    let page: Vec<AssistantLog> = all_logs
        .into_iter()
        .skip(offset)
        .take(limit)
        .map(|(_, l)| l)
        .collect();
    let has_more = total_matched > offset + page.len();

    Ok(Json(serde_json::json!({
        "items": page,
        "nextOffset": if has_more { Some(offset + limit) } else { None::<usize> },
    })))
}

// ─── GET /api/assistants/{id}/llm-logs?provider=&limit=&offset= ──────────────
// Per-call LLM provider log: one row per top-level call_llm invocation.

#[derive(Deserialize)]
pub struct LlmLogsQuery {
    pub limit: Option<usize>,
    pub offset: Option<usize>,
    pub provider: Option<String>,
    /// "all" | "success" | "error" — omitted or "all" returns everything.
    pub status: Option<String>,
    pub share_token: Option<String>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub tz_offset: Option<i32>,
}

#[derive(Serialize)]
pub struct LlmLogItem {
    pub id: String,
    pub conversation_id: Option<String>,
    pub contact_name: Option<String>,
    pub contact_number: Option<String>,
    pub provider: String,
    pub model: String,
    pub tokens_used: i32,
    pub duration_ms: i32,
    pub tool_rounds: i32,
    pub tool_names: Vec<String>,
    pub error: Option<String>,
    pub created_at: String,
}

pub async fn assistant_llm_logs(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(assistant_id): Path<Uuid>,
    Query(params): Query<LlmLogsQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let limit = params.limit.unwrap_or(50).min(200);
    let offset = params.offset.unwrap_or(0);
    let provider_filter = params
        .provider
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != "all");
    let status_filter = params
        .status
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != "all");

    // Resolve tenant — returns the partition-key user_id (owner).
    let tenant_user_id = assistant::resolve_assistant_access(
        &db,
        &auth_user.workspace_id,
        &assistant_id,
        params.share_token.as_deref(),
        "read",
    )
    .await?;

    let (from_ts, to_ts) = parse_date_bounds(
        params.from_date.as_deref(),
        params.to_date.as_deref(),
        params.tz_offset,
    );

    // Over-fetch when filtering so the post-filter page is still full. A date
    // range already bounds the scan on the clustering key, so we don't need
    // the 2000-row cap — dropping it prevents false `hasMore=false` inside a
    // narrow window.
    let has_filter = provider_filter.is_some() || status_filter.is_some();
    let has_date_range = from_ts.is_some() || to_ts.is_some();
    let scan_limit = if has_filter {
        if has_date_range {
            (offset + limit) * 4
        } else {
            ((offset + limit) * 4).min(2000)
        }
    } else {
        offset + limit + 1
    };

    // With a date range, narrow via minTimeuuid/maxTimeuuid on the clustering
    // key so Cassandra skips rows outside the window.
    let result = if has_date_range {
        let from = CqlTimestamp(from_ts.unwrap_or(0));
        let to = CqlTimestamp(to_ts.unwrap_or(CQL_TS_MAX_MS));
        db.query_unpaged(
            "SELECT id, conversation_id, provider, model, tokens_used, duration_ms, \
                    tool_rounds, tool_names, error, created_at \
             FROM inertial_eclipse.llm_call_logs \
             WHERE user_id = ? AND assistant_id = ? \
               AND id >= minTimeuuid(?) AND id <= maxTimeuuid(?) LIMIT ?",
            (tenant_user_id, assistant_id, from, to, scan_limit as i32),
        )
        .await
    } else {
        db.query_unpaged(
            "SELECT id, conversation_id, provider, model, tokens_used, duration_ms, \
                    tool_rounds, tool_names, error, created_at \
             FROM inertial_eclipse.llm_call_logs \
             WHERE user_id = ? AND assistant_id = ? LIMIT ?",
            (tenant_user_id, assistant_id, scan_limit as i32),
        )
        .await
    }
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;

    let mut items: Vec<LlmLogItem> = Vec::new();
    for row in rows
        .rows::<(
            CqlTimeuuid,
            Option<Uuid>,
            Option<String>,
            Option<String>,
            Option<i32>,
            Option<i32>,
            Option<i32>,
            Option<Vec<String>>,
            Option<String>,
            Option<DateTime<Utc>>,
        )>()?
        .flatten()
    {
        let provider = row.2.unwrap_or_default();
        if let Some(p) = provider_filter {
            if provider != p {
                continue;
            }
        }
        let error = row.8.clone();
        if let Some(s) = status_filter {
            let is_error = error.as_deref().map(|e| !e.is_empty()).unwrap_or(false);
            let wants_error = s == "error";
            if is_error != wants_error {
                continue;
            }
        }
        let id_uuid: Uuid = Uuid::from(row.0);
        let created_at_iso = row.9.unwrap_or_else(Utc::now).to_rfc3339();
        items.push(LlmLogItem {
            id: id_uuid.to_string(),
            conversation_id: row.1.map(|u: Uuid| u.to_string()),
            contact_name: None,
            contact_number: None,
            provider,
            model: row.3.unwrap_or_default(),
            tokens_used: row.4.unwrap_or(0),
            duration_ms: row.5.unwrap_or(0),
            tool_rounds: row.6.unwrap_or(0),
            tool_names: row.7.unwrap_or_default(),
            error,
            created_at: created_at_iso,
        });
    }

    let has_more = items.len() > offset + limit;
    let mut page: Vec<LlmLogItem> = items.into_iter().skip(offset).take(limit).collect();

    // Enrich with conversation contact info in one batched query.
    let conv_ids: Vec<Uuid> = {
        let mut seen = std::collections::HashSet::new();
        let mut ids: Vec<Uuid> = Vec::new();
        for item in &page {
            if let Some(cid) = item.conversation_id.as_deref() {
                if let Ok(u) = Uuid::parse_str(cid) {
                    if seen.insert(u) {
                        ids.push(u);
                    }
                }
            }
        }
        ids
    };
    if !conv_ids.is_empty() {
        let rows = db
            .query_unpaged(
                "SELECT id, contact_name, contact_number FROM inertial_eclipse.conversations \
                 WHERE assistant_id = ? AND user_id = ? AND id IN ?",
                (assistant_id, tenant_user_id, &conv_ids),
            )
            .await
            .map_err(|e| AppError::DatabaseError(e.to_string()))?
            .into_rows_result()?;

        let mut lookup: std::collections::HashMap<Uuid, (Option<String>, Option<String>)> =
            std::collections::HashMap::new();
        for row in rows
            .rows::<(Uuid, Option<String>, Option<String>)>()?
            .flatten()
        {
            lookup.insert(row.0, (row.1, row.2));
        }
        for item in page.iter_mut() {
            if let Some(cid) = item.conversation_id.as_deref() {
                if let Ok(u) = Uuid::parse_str(cid) {
                    if let Some((name, number)) = lookup.get(&u).cloned() {
                        item.contact_name = name;
                        item.contact_number = number;
                    }
                }
            }
        }
    }

    let returned = page.len();

    Ok(Json(serde_json::json!({
        "items": page,
        "nextOffset": if has_more && returned == limit { Some(offset + limit) } else { None::<usize> },
    })))
}

// ─── GET /api/user/activity?limit=N ──────────────────────────────────────────
// Recent activity feed: conversations sorted by last_message_at.

#[derive(Serialize)]
pub struct ActivityEvent {
    pub event_type: String,
    pub description: String,
    pub assistant_id: String,
    pub assistant_name: String,
    pub timestamp: String,
}

pub async fn user_activity(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Query(params): Query<LimitQuery>,
) -> Result<Json<Vec<ActivityEvent>>, AppError> {
    let limit = params.limit.unwrap_or(10).min(50);

    let assistants = assistant::list_assistants(&db, &auth_user.workspace_id).await?;

    let mut events: Vec<(chrono::DateTime<Utc>, ActivityEvent)> = Vec::new();

    for asst in &assistants {
        let convs_page = messaging::list_conversations(
            &db,
            &asst.id,
            &auth_user.workspace_id,
            10000,
            None,
            None,
        )
        .await?;
        for conv in convs_page.items {
            events.push((
                conv.last_message_at,
                ActivityEvent {
                    event_type: "conversation".to_string(),
                    description: format!(
                        "Conversa com {} via {}",
                        conv.contact_number, conv.channel
                    ),
                    assistant_id: asst.id.to_string(),
                    assistant_name: asst.name.clone(),
                    timestamp: conv.last_message_at.to_rfc3339(),
                },
            ));
        }
    }

    // Sort newest first, take limit
    events.sort_by(|a, b| b.0.cmp(&a.0));
    let result: Vec<ActivityEvent> = events.into_iter().take(limit).map(|(_, e)| e).collect();

    Ok(Json(result))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_date_bounds_none_when_absent() {
        assert_eq!(parse_date_bounds(None, None, None), (None, None));
    }

    #[test]
    fn parse_date_bounds_rejects_malformed() {
        assert_eq!(
            parse_date_bounds(Some("not-a-date"), Some("also-bad"), None),
            (None, None)
        );
        assert_eq!(
            parse_date_bounds(Some("2026-13-40"), None, None),
            (None, None)
        );
    }

    #[test]
    fn parse_date_bounds_utc_when_no_offset() {
        use chrono::NaiveDate;
        let expected_from = NaiveDate::from_ymd_opt(2026, 4, 19)
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp_millis();
        let expected_to = NaiveDate::from_ymd_opt(2026, 4, 19)
            .unwrap()
            .and_hms_milli_opt(23, 59, 59, 999)
            .unwrap()
            .and_utc()
            .timestamp_millis();
        let (from, to) = parse_date_bounds(Some("2026-04-19"), Some("2026-04-19"), None);
        assert_eq!(from, Some(expected_from));
        assert_eq!(to, Some(expected_to));
    }

    #[test]
    fn parse_date_bounds_shifts_with_tz_offset() {
        // UTC-3 (offset_minutes = -180) → local midnight is 3h later in UTC
        // so the bound timestamp is 3h after the UTC midnight of the same date.
        let (from_utc, to_utc) =
            parse_date_bounds(Some("2026-04-19"), Some("2026-04-19"), None);
        let (from_local, to_local) =
            parse_date_bounds(Some("2026-04-19"), Some("2026-04-19"), Some(-180));
        let shift = 180 * 60_000;
        assert_eq!(from_local, from_utc.map(|x| x + shift));
        assert_eq!(to_local, to_utc.map(|x| x + shift));
    }

    #[test]
    fn parse_date_bounds_partial_range_ok() {
        let (from, to) = parse_date_bounds(Some("2026-04-19"), None, None);
        assert!(from.is_some());
        assert_eq!(to, None);
        let (from, to) = parse_date_bounds(None, Some("2026-04-19"), None);
        assert_eq!(from, None);
        assert!(to.is_some());
    }
}
