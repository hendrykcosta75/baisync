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
        std::time::UNIX_EPOCH + std::time::Duration::from_millis(r.8.0 as u64),
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
    crate::services::events::publish_global(user_id, crate::services::events::SseEvent {
        event_type: "notification_created".into(),
        data: serde_json::json!({
            "id": id.to_string(),
            "title": title,
            "type": notification_type,
        }).to_string(),
    }).await;

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
    for row in result
        .rows_typed::<NotificationRow>()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?
    {
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
