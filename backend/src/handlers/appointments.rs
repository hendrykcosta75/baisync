use axum::extract::{Extension, Path, Query};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::models::appointment::{
    Appointment, AvailabilityConfig, CreateAppointmentRequest, UpdateAppointmentRequest,
    UpdateAvailabilityRequest,
};
use crate::services::appointment as appointment_service;
use crate::services::assistant as assistant_service;

use crate::handlers::assistants::ShareTokenQuery;

// ─── Appointments ────────────────────────────────────────────────────────────

pub async fn list(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<Vec<Appointment>>, AppError> {
    let appointments = appointment_service::list_appointments(&db, &auth_user.workspace_id).await?;
    Ok(Json(appointments))
}

pub async fn create(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<CreateAppointmentRequest>,
) -> Result<Json<Appointment>, AppError> {
    // Verify user owns the assistant (only if associated)
    if let Some(ref aid) = req.assistant_id {
        assistant_service::resolve_assistant_access(
            &db, &auth_user.workspace_id, aid, None, "write",
        ).await?;
    }
    let appointment = appointment_service::create_appointment(&db, &auth_user.workspace_id, req).await?;
    Ok(Json(appointment))
}

pub async fn get(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(appointment_id): Path<Uuid>,
) -> Result<Json<Appointment>, AppError> {
    let appointment = appointment_service::get_appointment(&db, &auth_user.workspace_id, &appointment_id).await?;
    Ok(Json(appointment))
}

pub async fn update(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(appointment_id): Path<Uuid>,
    Json(req): Json<UpdateAppointmentRequest>,
) -> Result<Json<Appointment>, AppError> {
    let appointment = appointment_service::update_appointment(&db, &auth_user.workspace_id, &appointment_id, req).await?;
    Ok(Json(appointment))
}

pub async fn cancel(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(appointment_id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    appointment_service::cancel_appointment(&db, &auth_user.workspace_id, &appointment_id).await?;
    Ok(Json(json!({"message": "Appointment cancelled"})))
}

pub async fn delete(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(appointment_id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    appointment_service::delete_appointment(&db, &auth_user.workspace_id, &appointment_id).await?;
    Ok(Json(json!({"message": "Appointment deleted"})))
}

// ─── Availability ────────────────────────────────────────────────────────────

pub async fn get_availability(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(assistant_id): Path<Uuid>,
    Query(query): Query<ShareTokenQuery>,
) -> Result<Json<Value>, AppError> {
    assistant_service::resolve_assistant_access(
        &db, &auth_user.workspace_id, &assistant_id, query.share_token.as_deref(), "read",
    ).await?;
    let avail = appointment_service::get_availability(&db, &assistant_id).await?;
    match avail {
        Some(config) => {
            let schedule_parsed = config.schedule_json
                .as_deref()
                .and_then(|s| serde_json::from_str::<Value>(s).ok())
                .unwrap_or(json!({}));
            Ok(Json(json!({
                "assistantId": config.assistant_id,
                "timezone": config.timezone,
                "defaultDurationMinutes": config.default_duration_minutes,
                "bufferMinutes": config.buffer_minutes,
                "maxPerDay": config.max_per_day,
                "blockedDates": config.blocked_dates,
                "schedule": schedule_parsed,
            })))
        }
        None => Ok(Json(json!(null))),
    }
}

pub async fn upsert_availability(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(assistant_id): Path<Uuid>,
    Query(query): Query<ShareTokenQuery>,
    Json(req): Json<UpdateAvailabilityRequest>,
) -> Result<Json<AvailabilityConfig>, AppError> {
    assistant_service::resolve_assistant_access(
        &db, &auth_user.workspace_id, &assistant_id, query.share_token.as_deref(), "admin",
    ).await?;
    let config = appointment_service::upsert_availability(&db, &assistant_id, &auth_user.workspace_id, req).await?;
    Ok(Json(config))
}

#[derive(Deserialize)]
pub struct SlotsQuery {
    pub date: String,
    pub share_token: Option<String>,
}

pub async fn available_slots(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(assistant_id): Path<Uuid>,
    Query(query): Query<SlotsQuery>,
) -> Result<Json<Vec<String>>, AppError> {
    assistant_service::resolve_assistant_access(
        &db, &auth_user.workspace_id, &assistant_id, query.share_token.as_deref(), "read",
    ).await?;
    let slots = appointment_service::get_available_slots(&db, &assistant_id, &query.date).await?;
    Ok(Json(slots))
}
