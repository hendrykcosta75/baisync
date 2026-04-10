use axum::extract::{Extension, Path, Query};
use axum::Json;
use chrono::{Duration, Utc};
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
}

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

    let assistants = assistant::list_assistants(&db, &auth_user.user_id).await?;

    // Map period → (messages, tokens)
    let mut daily: std::collections::HashMap<String, (i64, i64)> =
        periods.iter().map(|d| (d.clone(), (0i64, 0i64))).collect();

    for asst in &assistants {
        let result = db
            .query_unpaged(
                "SELECT period, total_messages, total_tokens \
                 FROM inertial_eclipse.usage_stats \
                 WHERE user_id = ? AND assistant_id = ?",
                (&auth_user.user_id, &asst.id),
            )
            .await
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;

        for row in result
            .rows_typed::<(String, Option<i64>, Option<i64>)>()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?
        {
            let (period, messages, tokens) =
                row.map_err(|e| AppError::DatabaseError(e.to_string()))?;
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
            DailyUsage { date: date.clone(), requests, tokens }
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
        &db, &auth_user.user_id, &assistant_id, params.share_token.as_deref(), "read",
    ).await?;

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

    for row in result
        .rows_typed::<(String, Option<i64>, Option<i64>)>()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?
    {
        let (period, messages, tokens) =
            row.map_err(|e| AppError::DatabaseError(e.to_string()))?;
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
            DailyPoint { date: date.clone(), requests, tokens }
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
    let convs_page = messaging::list_conversations(&db, &assistant_id, &owner_id, 10000, None, None).await?;
    let convs = &convs_page.items;

    let last_interaction_at = convs
        .iter()
        .filter(|c| c.channel != "playground")
        .max_by_key(|c| c.last_message_at)
        .map(|c| c.last_message_at.to_rfc3339());

    let mut channel_map: std::collections::HashMap<String, i64> =
        std::collections::HashMap::new();
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

    // Verify ownership or share_token access
    assistant::resolve_assistant_access(
        &db, &auth_user.user_id, &assistant_id, params.share_token.as_deref(), "read",
    ).await?;

    // Get all tools, then batch-fetch their logs
    let tools = assistant::list_tools(&db, &assistant_id).await?;

    let mut all_logs: Vec<(chrono::DateTime<Utc>, AssistantLog)> = Vec::new();
    for tool in &tools {
        let logs = assistant::list_tool_call_logs(&db, &assistant_id, &tool.id, limit as i32)
            .await
            .unwrap_or_default();
        for log in logs {
            let ts = log.called_at;
            all_logs.push((ts, AssistantLog::from(log)));
        }
    }

    all_logs.sort_by(|a, b| b.0.cmp(&a.0));
    let offset = params.offset.unwrap_or(0);
    let page: Vec<AssistantLog> = all_logs.into_iter().skip(offset).take(limit).map(|(_, l)| l).collect();
    let has_more = page.len() == limit;

    Ok(Json(serde_json::json!({
        "items": page,
        "nextOffset": if has_more { Some(offset + limit) } else { None::<usize> },
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

    let assistants = assistant::list_assistants(&db, &auth_user.user_id).await?;

    let mut events: Vec<(chrono::DateTime<Utc>, ActivityEvent)> = Vec::new();

    for asst in &assistants {
        let convs_page =
            messaging::list_conversations(&db, &asst.id, &auth_user.user_id, 10000, None, None).await?;
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
    let result: Vec<ActivityEvent> =
        events.into_iter().take(limit).map(|(_, e)| e).collect();

    Ok(Json(result))
}
