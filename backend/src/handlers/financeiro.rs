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
    pub offset: Option<usize>,
    pub status: Option<String>,
}

pub async fn overview(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<Value>, AppError> {
    let overviews =
        crate::services::pix::get_user_financial_overview(&db, &auth_user.workspace_id).await?;

    let data: Vec<Value> = overviews
        .into_iter()
        .map(|(assistant_id, summary)| {
            json!({
                "assistantId": assistant_id,
                "totalRevenue": summary.total_revenue,
                "totalCharges": summary.total_charges,
                "paidCount": summary.paid_count,
                "unpaidCount": summary.unpaid_count,
                "pendingCount": summary.pending_count,
            })
        })
        .collect();

    Ok(Json(json!(data)))
}

pub async fn summary(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(assistant_id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let _ = crate::services::assistant::get_assistant(&db, &auth_user.workspace_id, &assistant_id)
        .await?;

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
    let _ = crate::services::assistant::get_assistant(&db, &auth_user.workspace_id, &assistant_id)
        .await?;

    let limit = query.limit.unwrap_or(50).min(500);

    // Fetch PIX charges
    let pix_charges =
        crate::services::pix::list_charges_by_assistant(&db, &assistant_id, limit).await?;
    let mut data: Vec<Value> = pix_charges
        .into_iter()
        .map(|c| {
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
                "paymentType": "pix",
            })
        })
        .collect();

    // Fetch card charges
    let card_charges =
        crate::services::card_payment::list_charges_by_assistant(&db, &assistant_id, limit).await?;
    let card_data: Vec<Value> = card_charges
        .into_iter()
        .map(|c| {
            json!({
                "id": c.id,
                "amount": c.amount,
                "status": c.status,
                "description": c.description,
                "contactPhone": c.contact_phone,
                "createdAt": c.created_at.to_rfc3339(),
                "customerName": c.customer_name,
                "customerCpf": c.customer_cpf,
                "pixMode": c.card_mode,
                "paymentType": "card",
            })
        })
        .collect();
    data.extend(card_data);

    // Filter by status if provided
    if let Some(ref status_filter) = query.status {
        if !status_filter.is_empty() {
            data.retain(|item| {
                item.get("status").and_then(|v| v.as_str()).unwrap_or("") == status_filter.as_str()
            });
        }
    }

    // Sort by createdAt descending
    data.sort_by(|a, b| {
        let a_date = a.get("createdAt").and_then(|v| v.as_str()).unwrap_or("");
        let b_date = b.get("createdAt").and_then(|v| v.as_str()).unwrap_or("");
        b_date.cmp(a_date)
    });

    // Apply offset-based pagination
    let offset = query.offset.unwrap_or(0);
    let page: Vec<Value> = data.into_iter().skip(offset).take(limit as usize).collect();
    let has_more = page.len() == limit as usize;

    Ok(Json(json!({
        "items": page,
        "nextOffset": if has_more { Some(offset + limit as usize) } else { None },
    })))
}

pub async fn update_charge_status_handler(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<crate::config::Config>,
    Extension(encryption): Extension<crate::services::encryption::EncryptionService>,
    Extension(event_bus): Extension<crate::services::events::EventBus>,
    Extension(auth_user): Extension<AuthUser>,
    Path((assistant_id, charge_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, AppError> {
    // Verify assistant ownership
    let _ = crate::services::assistant::get_assistant(&db, &auth_user.workspace_id, &assistant_id)
        .await?;

    let new_status = body
        .get("status")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::BadRequest("Campo 'status' é obrigatório".into()))?;

    // Only allow approved or cancelled
    if new_status != "approved" && new_status != "cancelled" {
        return Err(AppError::BadRequest(
            "Status deve ser 'approved' ou 'cancelled'".into(),
        ));
    }

    // Try PIX charges first, then card charges
    let pix_charge =
        crate::services::pix::check_charge_status(&db, &auth_user.workspace_id, &charge_id, None)
            .await;

    if let Ok(charge) = pix_charge {
        // PIX charge found
        if new_status == "approved" && charge.pix_mode != "direct" {
            return Err(AppError::BadRequest(
                "Apenas cobranças PIX direto podem ser confirmadas manualmente".into(),
            ));
        }
        if charge.assistant_id != assistant_id {
            return Err(AppError::NotFound(
                "Cobrança não pertence a este assistente".into(),
            ));
        }

        crate::services::pix::update_charge_status(
            &db,
            &auth_user.workspace_id,
            &charge_id,
            &assistant_id,
            charge.created_at,
            new_status,
        )
        .await?;

        if new_status == "approved" {
            crate::services::pix::notify_pix_payment_confirmed(
                &db,
                &encryption,
                &config,
                &charge,
            )
            .await;
        }

        event_bus
            .publish(
                &auth_user.user_id,
                crate::services::events::SseEvent {
                    event_type: "pix_status_changed".into(),
                    data: serde_json::json!({
                        "chargeId": charge_id.to_string(),
                        "assistantId": assistant_id.to_string(),
                        "status": new_status,
                        "amount": charge.amount,
                    })
                    .to_string(),
                },
            )
            .await;

        return Ok(Json(json!({"status": new_status})));
    }

    // Try card charges
    let card_charge = crate::services::card_payment::check_charge_status(
        &db,
        &auth_user.workspace_id,
        &charge_id,
        None,
    )
    .await?;

    if card_charge.assistant_id != assistant_id {
        return Err(AppError::NotFound(
            "Cobrança não pertence a este assistente".into(),
        ));
    }

    // Card charges cannot be manually approved (processed by provider)
    if new_status == "approved" {
        return Err(AppError::BadRequest(
            "Cobranças por cartão não podem ser confirmadas manualmente".into(),
        ));
    }

    crate::services::card_payment::update_charge_status(
        &db,
        &auth_user.workspace_id,
        &charge_id,
        &assistant_id,
        card_charge.created_at,
        new_status,
    )
    .await?;

    event_bus
        .publish(
            &auth_user.user_id,
            crate::services::events::SseEvent {
                event_type: "card_status_changed".into(),
                data: serde_json::json!({
                    "chargeId": charge_id.to_string(),
                    "assistantId": assistant_id.to_string(),
                    "status": new_status,
                    "amount": card_charge.amount,
                })
                .to_string(),
            },
        )
        .await;

    Ok(Json(json!({"status": new_status})))
}
