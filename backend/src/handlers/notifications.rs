use axum::extract::{Extension, Path};
use axum::Json;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::models::notification::Notification;
use crate::services::notification as notification_service;

pub async fn list(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<Vec<Notification>>, AppError> {
    let notifications = notification_service::list_notifications(&db, &auth_user.user_id).await?;
    Ok(Json(notifications))
}

pub async fn mark_read(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(notification_id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    notification_service::mark_as_read(&db, &auth_user.user_id, &notification_id).await?;
    Ok(Json(json!({"message": "Marked as read"})))
}

pub async fn mark_all_read(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<Value>, AppError> {
    notification_service::mark_all_read(&db, &auth_user.user_id).await?;
    Ok(Json(json!({"message": "All notifications marked as read"})))
}

pub async fn delete(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(notification_id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    notification_service::delete_notification(&db, &auth_user.user_id, &notification_id).await?;
    Ok(Json(json!({"message": "Notification deleted"})))
}

pub async fn delete_all(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<Value>, AppError> {
    notification_service::delete_all_notifications(&db, &auth_user.user_id).await?;
    Ok(Json(json!({"message": "All notifications deleted"})))
}
