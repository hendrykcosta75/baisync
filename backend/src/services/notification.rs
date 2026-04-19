use std::collections::HashSet;

use chrono::Utc;
use scylla::frame::value::CqlTimestamp;
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::models::notification::Notification;

type NotificationRow = (
    Uuid,           // user_id
    Uuid,           // id
    Option<Uuid>,   // assistant_id
    Option<Uuid>,   // integration_id
    Option<String>, // notification_type
    Option<String>, // title
    Option<String>, // message
    Option<bool>,   // is_read
    CqlTimestamp,   // created_at
);

fn row_to_notification(r: NotificationRow) -> Notification {
    let created_at = chrono::DateTime::<chrono::Utc>::from(
        std::time::UNIX_EPOCH + std::time::Duration::from_millis(r.8 .0 as u64),
    );
    Notification {
        user_id: r.0,
        id: r.1,
        assistant_id: r.2,
        integration_id: r.3,
        notification_type: r.4.unwrap_or_default(),
        title: r.5.unwrap_or_default(),
        message: r.6.unwrap_or_default(),
        is_read: r.7.unwrap_or(false),
        created_at,
    }
}

pub async fn create_notification(
    db: &DbSession,
    user_id: &Uuid,
    assistant_id: Option<&Uuid>,
    integration_id: Option<&Uuid>,
    notification_type: &str,
    title: &str,
    message: &str,
) -> Result<Notification, AppError> {
    let id = Uuid::new_v4();
    let now = CqlTimestamp(Utc::now().timestamp_millis());

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.notifications (user_id, id, assistant_id, integration_id, notification_type, title, message, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, false, ?)",
        (user_id, &id, assistant_id, integration_id, notification_type, title, message, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Publish SSE event via global bus
    crate::services::events::publish_global(
        user_id,
        crate::services::events::SseEvent {
            event_type: "notification_created".into(),
            data: serde_json::json!({
                "id": id.to_string(),
                "title": title,
                "type": notification_type,
            })
            .to_string(),
        },
    )
    .await;

    Ok(Notification {
        user_id: *user_id,
        id,
        assistant_id: assistant_id.copied(),
        integration_id: integration_id.copied(),
        notification_type: notification_type.to_string(),
        title: title.to_string(),
        message: message.to_string(),
        is_read: false,
        created_at: Utc::now(),
    })
}

/// Create a notification for all members of a workspace.
/// Used for workspace-level events (e.g. new message from customer, payment received).
pub async fn notify_workspace_members(
    db: &DbSession,
    workspace_id: &Uuid,
    assistant_id: Option<&Uuid>,
    integration_id: Option<&Uuid>,
    notification_type: &str,
    title: &str,
    message: &str,
) -> Result<(), AppError> {
    let members = crate::services::workspace::list_members(db, workspace_id).await?;
    let recipients: Vec<Uuid> = members.into_iter().map(|m| m.user_id).collect();
    notify_recipients(
        db,
        &recipients,
        assistant_id,
        integration_id,
        notification_type,
        title,
        message,
    )
    .await
}

/// Recipient scope for `notify_human` (and other scoped notifications).
#[derive(Debug, Clone)]
pub enum NotifyScopeKind {
    AllWorkspace,
    Teams,
    SpecificUsers,
}

#[derive(Debug, Clone)]
pub struct NotifyScope {
    pub kind: NotifyScopeKind,
    pub team_ids: Vec<Uuid>,
    pub user_ids: Vec<Uuid>,
}

impl Default for NotifyScope {
    fn default() -> Self {
        Self {
            kind: NotifyScopeKind::AllWorkspace,
            team_ids: Vec::new(),
            user_ids: Vec::new(),
        }
    }
}

/// Parse scope config from a tool's `headers_json` payload.
/// Falls back to `AllWorkspace` (preserving pre-feature behavior) when headers
/// are missing, empty, or malformed.
pub fn parse_notify_scope_from_headers(headers: Option<&str>) -> NotifyScope {
    let Some(raw) = headers.filter(|s| !s.is_empty()) else {
        return NotifyScope::default();
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) else {
        return NotifyScope::default();
    };
    let parse_uuid_array = |key: &str| -> Vec<Uuid> {
        v.get(key)
            .and_then(|val| val.as_array())
            .map(|arr| arr.iter().filter_map(|x| x.as_str()).filter_map(|s| Uuid::parse_str(s).ok()).collect())
            .unwrap_or_default()
    };
    let kind = match v.get("scope").and_then(|s| s.as_str()).unwrap_or("all_workspace") {
        "teams" => NotifyScopeKind::Teams,
        "specific_users" => NotifyScopeKind::SpecificUsers,
        _ => NotifyScopeKind::AllWorkspace,
    };
    NotifyScope {
        kind,
        team_ids: parse_uuid_array("team_ids"),
        user_ids: parse_uuid_array("user_ids"),
    }
}

/// Resolve the final recipient user ID list for a scope, deduplicated.
/// Only users that actually belong to `workspace_id` are kept (ensures a stale
/// config with removed members does not leak to users outside the workspace).
pub async fn resolve_scope_recipients(
    db: &DbSession,
    workspace_id: &Uuid,
    scope: &NotifyScope,
) -> Result<Vec<Uuid>, AppError> {
    let members = crate::services::workspace::list_members(db, workspace_id).await?;
    let workspace_user_ids: HashSet<Uuid> = members.iter().map(|m| m.user_id).collect();

    let mut recipients: HashSet<Uuid> = HashSet::new();
    match scope.kind {
        NotifyScopeKind::AllWorkspace => {
            recipients.extend(workspace_user_ids.iter().copied());
        }
        NotifyScopeKind::Teams => {
            for team_id in &scope.team_ids {
                if let Ok(team_members) =
                    crate::services::team::list_members(db, team_id).await
                {
                    for m in team_members {
                        if workspace_user_ids.contains(&m.user_id) {
                            recipients.insert(m.user_id);
                        }
                    }
                }
            }
        }
        NotifyScopeKind::SpecificUsers => {
            for uid in &scope.user_ids {
                if workspace_user_ids.contains(uid) {
                    recipients.insert(*uid);
                }
            }
        }
    }
    Ok(recipients.into_iter().collect())
}

/// Create a notification for each user in `recipients` (deduplication is the
/// caller's responsibility — `resolve_scope_recipients` already dedupes).
pub async fn notify_recipients(
    db: &DbSession,
    recipients: &[Uuid],
    assistant_id: Option<&Uuid>,
    integration_id: Option<&Uuid>,
    notification_type: &str,
    title: &str,
    message: &str,
) -> Result<(), AppError> {
    for user_id in recipients {
        let _ = create_notification(
            db,
            user_id,
            assistant_id,
            integration_id,
            notification_type,
            title,
            message,
        )
        .await;
    }
    Ok(())
}

pub async fn list_notifications(
    db: &DbSession,
    user_id: &Uuid,
) -> Result<Vec<Notification>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT user_id, id, assistant_id, integration_id, notification_type, title, message, is_read, created_at FROM inertial_eclipse.notifications WHERE user_id = ? LIMIT 50",
            (user_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut notifications = Vec::new();
    let rows = result.into_rows_result()?;
    for row in rows.rows::<NotificationRow>()? {
        let r = row.map_err(|e| AppError::DatabaseError(e.to_string()))?;
        notifications.push(row_to_notification(r));
    }

    Ok(notifications)
}

pub async fn mark_as_read(
    db: &DbSession,
    user_id: &Uuid,
    notification_id: &Uuid,
) -> Result<(), AppError> {
    db.query_unpaged(
        "UPDATE inertial_eclipse.notifications SET is_read = true WHERE user_id = ? AND id = ?",
        (user_id, notification_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

pub async fn mark_all_read(db: &DbSession, user_id: &Uuid) -> Result<(), AppError> {
    let notifications = list_notifications(db, user_id).await?;
    for n in notifications.iter().filter(|n| !n.is_read) {
        mark_as_read(db, user_id, &n.id).await?;
    }
    Ok(())
}

pub async fn delete_notification(
    db: &DbSession,
    user_id: &Uuid,
    notification_id: &Uuid,
) -> Result<(), AppError> {
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.notifications WHERE user_id = ? AND id = ?",
        (user_id, notification_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(())
}

pub async fn delete_all_notifications(db: &DbSession, user_id: &Uuid) -> Result<(), AppError> {
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.notifications WHERE user_id = ?",
        (user_id,),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(())
}
