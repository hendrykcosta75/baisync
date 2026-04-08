use axum::extract::Path;
use axum::extract::Query;
use axum::{Extension, Json};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::middleware::auth::AuthUser;

#[derive(Debug, Deserialize)]
pub struct ChargesQuery {
    pub limit: Option<i32>,
}

pub async fn overview(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<Value>, AppError> {
    let overviews = crate::services::pix::get_user_financial_overview(&db, &auth_user.user_id).await?;

    let data: Vec<Value> = overviews.into_iter().map(|(assistant_id, summary)| {
        json!({
            "assistantId": assistant_id,
            "totalRevenue": summary.total_revenue,
            "totalCharges": summary.total_charges,
            "paidCount": summary.paid_count,
            "unpaidCount": summary.unpaid_count,
            "pendingCount": summary.pending_count,
        })
    }).collect();

    Ok(Json(json!(data)))
}

pub async fn summary(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(assistant_id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let _ = crate::services::assistant::get_assistant(&db, &auth_user.user_id, &assistant_id).await?;

    let summary = crate::services::pix::get_assistant_financial_summary(&db, &assistant_id).await?;

    Ok(Json(json!({
        "totalRevenue": summary.total_revenue,
        "totalCharges": summary.total_charges,
        "paidCount": summary.paid_count,
        "unpaidCount": summary.unpaid_count,
        "pendingCount": summary.pending_count,
    })))
}

pub async fn charges(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(assistant_id): Path<Uuid>,
    Query(query): Query<ChargesQuery>,
) -> Result<Json<Value>, AppError> {
    let _ = crate::services::assistant::get_assistant(&db, &auth_user.user_id, &assistant_id).await?;

    let limit = query.limit.unwrap_or(50).min(500);
    let charges = crate::services::pix::list_charges_by_assistant(&db, &assistant_id, limit).await?;

    let data: Vec<Value> = charges.into_iter().map(|c| {
        json!({
            "id": c.id,
            "amount": c.amount,
            "status": c.status,
            "description": c.description,
            "contactPhone": c.contact_phone,
            "createdAt": c.created_at.to_rfc3339(),
            "customerName": c.customer_name,
            "customerCpf": c.customer_cpf,
            "pixMode": c.pix_mode,
        })
    }).collect();

    Ok(Json(json!(data)))
}

pub async fn update_charge_status_handler(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<crate::config::Config>,
    Extension(event_bus): Extension<crate::services::events::EventBus>,
    Extension(auth_user): Extension<AuthUser>,
    Path((assistant_id, charge_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, AppError> {
    // Verify assistant ownership
    let _ = crate::services::assistant::get_assistant(&db, &auth_user.user_id, &assistant_id).await?;

    let new_status = body.get("status")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::BadRequest("Campo 'status' é obrigatório".into()))?;

    // Only allow approved or cancelled
    if new_status != "approved" && new_status != "cancelled" {
        return Err(AppError::BadRequest("Status deve ser 'approved' ou 'cancelled'".into()));
    }

    // Fetch the charge to verify it exists
    let charge = crate::services::pix::check_charge_status(
        &db, &auth_user.user_id, &charge_id, None,
    ).await?;

    // Only direct mode charges can be manually approved; cancellation is allowed for any mode
    if new_status == "approved" && charge.pix_mode != "direct" {
        return Err(AppError::BadRequest(
            "Apenas cobranças PIX direto podem ser confirmadas manualmente".into()
        ));
    }

    if charge.assistant_id != assistant_id {
        return Err(AppError::NotFound("Cobrança não pertence a este assistente".into()));
    }

    crate::services::pix::update_charge_status(
        &db, &auth_user.user_id, &charge_id, &assistant_id, charge.created_at, new_status,
    ).await?;

    // Notify user and client when payment is confirmed
    if new_status == "approved" {
        crate::services::pix::notify_pix_payment_confirmed(&db, &config, &charge).await;
    }

    // Publish SSE event
    event_bus.publish(&auth_user.user_id, crate::services::events::SseEvent {
        event_type: "pix_status_changed".into(),
        data: serde_json::json!({
            "chargeId": charge_id.to_string(),
            "assistantId": assistant_id.to_string(),
            "status": new_status,
            "amount": charge.amount,
        }).to_string(),
    }).await;

    Ok(Json(json!({"status": new_status})))
}
