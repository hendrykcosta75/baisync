use axum::body::Bytes;
use axum::extract::{Extension, Path};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::config::Config;
use crate::db::DbSession;
use crate::errors::AppError;
use crate::services::encryption::EncryptionService;
use crate::services::webhook_dedup;

/// Stripe webhook handler for checkout.session.completed events.
///
/// Note: Signature verification requires the user's webhook signing secret.
/// Since each user has their own Stripe account, global verification is not possible.
/// We validate by checking that the session ID exists in our card_charges_by_provider_id table.
/// For real-time updates, the background poller (every 10s for 15min) is the primary mechanism.
/// This webhook endpoint is an optional accelerator if the user configures it in their Stripe dashboard.
pub async fn webhook_stripe(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(encryption): Extension<EncryptionService>,
    Extension(event_bus): Extension<crate::services::events::EventBus>,
    body: Bytes,
) -> impl IntoResponse {
    // Parse body as JSON — always return 200 to prevent Stripe retries
    let payload: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e, "Failed to parse Stripe webhook body");
            return (StatusCode::OK, Json(json!({"status": "parse_error"}))).into_response();
        }
    };

    tracing::info!(event_type = %payload.get("type").and_then(|v| v.as_str()).unwrap_or("unknown"), "Stripe webhook received");

    // I2 — shadow dedup. Stripe's top-level `id` (e.g. evt_...) is the unique event ID.
    let event_id = payload
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    match webhook_dedup::check_and_mark(&db, "stripe", &event_id).await {
        Ok(webhook_dedup::DedupResult::Applied) => {}
        Ok(webhook_dedup::DedupResult::Duplicate) => {
            // Only reached in Mode::Block (T1.4).
            return (StatusCode::OK, Json(json!({"status": "ok"}))).into_response();
        }
        Err(e) => {
            tracing::warn!(error = %e, "dedup check failed, continuing");
        }
    }

    // Validation: process_stripe_webhook verifies the session exists in our DB
    // (only charges we created will match), so spoofed events are harmlessly ignored.
    if let Err(e) = crate::services::card_payment::process_stripe_webhook(
        &db,
        &encryption,
        &config,
        &event_bus,
        &payload,
    )
    .await
    {
        tracing::error!(error = %e, "Failed to process Stripe webhook");
    }

    // Always return 200
    (StatusCode::OK, Json(json!({"status": "ok"}))).into_response()
}

/// Mercado Pago webhook handler for card payment notifications.
/// Separate endpoint from PIX to avoid disambiguation.
/// The background poller is the primary mechanism for status updates.
pub async fn webhook_mercadopago_card(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(encryption): Extension<EncryptionService>,
    Extension(event_bus): Extension<crate::services::events::EventBus>,
    Json(payload): Json<Value>,
) -> Json<Value> {
    tracing::info!(payload = %payload, "Mercado Pago card webhook received");

    let mp_id = payload
        .get("data")
        .and_then(|d| d.get("id"))
        .map(|id| {
            if let Some(s) = id.as_str() {
                s.to_string()
            } else if let Some(n) = id.as_i64() {
                n.to_string()
            } else {
                String::new()
            }
        })
        .unwrap_or_default();

    if mp_id.is_empty() {
        tracing::warn!("MP card webhook: no payment ID found");
        return Json(json!({"status": "ok"}));
    }

    // I2 — shadow dedup. Combine `type` + `data.id` to uniquely identify the event.
    let mp_type = payload
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let event_id = format!("{mp_type}:{mp_id}");
    match webhook_dedup::check_and_mark(&db, "mercadopago_card", &event_id).await {
        Ok(webhook_dedup::DedupResult::Applied) => {}
        Ok(webhook_dedup::DedupResult::Duplicate) => {
            // Only reached in Mode::Block (T1.4).
            return Json(json!({"status": "ok"}));
        }
        Err(e) => {
            tracing::warn!(error = %e, "dedup check failed, continuing");
        }
    }

    if let Err(e) = crate::services::card_payment::process_mp_card_webhook(
        &db,
        &config,
        &encryption,
        &event_bus,
        &mp_id,
    )
    .await
    {
        tracing::error!(error = %e, mp_payment_id = %mp_id, "Failed to process MP card webhook");
    }

    Json(json!({"status": "ok"}))
}

/// Public endpoint to fetch charge details for the payment page.
/// No auth required — customers access this via the payment link.
/// Returns charge info + provider public key for rendering embedded payment form.
pub async fn get_charge_info(
    Extension(db): Extension<DbSession>,
    Path(charge_id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let result = db.query_unpaged(
        "SELECT user_id, id, amount, description, checkout_url, status, customer_name, card_mode, provider_session_id, payment_type, installments FROM inertial_eclipse.card_charges WHERE id = ? ALLOW FILTERING",
        (&charge_id,),
    ).await.map_err(|e| AppError::DatabaseError(format!("Failed to query charge: {e}")))?;

    let row = result
        .into_rows_result()?
        .maybe_first_row::<(
            Uuid,
            Uuid,
            Option<f64>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<i32>,
        )>()?
        .ok_or_else(|| AppError::NotFound("Cobranca nao encontrada".into()))?;

    let user_id = row.0;
    let card_mode = row.7.clone().unwrap_or_else(|| "stripe".to_string());
    let status = row.5.clone().unwrap_or_else(|| "pending".to_string());
    let payment_type = row.9.clone().unwrap_or_else(|| "credit".to_string());
    let installments = row.10.unwrap_or(1);

    // Fetch user's public key for the payment provider
    let public_key = match card_mode.as_str() {
        "stripe" => crate::services::card_payment::get_user_stripe_public_key(&db, &user_id)
            .await
            .unwrap_or(None),
        "mercadopago" => crate::services::card_payment::get_user_mp_public_key(&db, &user_id)
            .await
            .unwrap_or(None),
        _ => None,
    };

    // checkout_url contains: client_secret (Stripe) or init_point URL (MP)
    let checkout_data = row.4.clone();

    Ok(Json(json!({
        "id": row.1,
        "amount": row.2.unwrap_or(0.0),
        "description": row.3.unwrap_or_default(),
        "clientSecret": if card_mode == "stripe" { checkout_data.clone() } else { None },
        "preferenceId": row.8,
        "checkoutUrl": if card_mode == "mercadopago" { checkout_data } else { None },
        "status": status,
        "customerName": row.6,
        "cardMode": card_mode,
        "publicKey": public_key,
        "paymentType": payment_type,
        "installments": installments,
    })))
}

/// Process a Mercado Pago card payment after client-side tokenization.
/// Called by the MP Bricks CardPayment form.
pub async fn process_mp_card_payment(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(encryption): Extension<EncryptionService>,
    Extension(event_bus): Extension<crate::services::events::EventBus>,
    Path(charge_id): Path<Uuid>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, AppError> {
    // Find the charge
    let result = db.query_unpaged(
        "SELECT user_id, id, amount, description, status, card_mode, payment_type, installments FROM inertial_eclipse.card_charges WHERE id = ? ALLOW FILTERING",
        (&charge_id,),
    ).await.map_err(|e| AppError::DatabaseError(format!("Failed to query charge: {e}")))?;

    let row = result
        .into_rows_result()?
        .maybe_first_row::<(
            Uuid,
            Uuid,
            Option<f64>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<i32>,
        )>()?
        .ok_or_else(|| AppError::NotFound("Cobranca nao encontrada".into()))?;

    let user_id = row.0;
    let amount = row.2.unwrap_or(0.0);
    let description = row.3.unwrap_or_default();
    let status = row.4.unwrap_or_else(|| "pending".to_string());
    let charge_installments = row.7.unwrap_or(1);

    if status != "pending" {
        return Err(AppError::BadRequest("Cobranca ja foi processada".into()));
    }

    // Get user's MP access token
    let token = crate::services::pix::get_user_mp_token(&db, &encryption, &user_id)
        .await?
        .ok_or_else(|| AppError::InternalError("Token MP nao encontrado".into()))?;

    tracing::info!(
        token_prefix = %&token[..token.len().min(15)],
        user_id = %user_id,
        request_body = %body,
        "Processing MP card payment with token"
    );

    // The Bricks CardPayment form sends formData with:
    // { token, issuer_id, payment_method_id, transaction_amount, installments, payer: { identification } }
    // Note: Bricks may NOT include payer.email — we must ensure it exists for the MP API.
    let mut mp_body = body.clone();
    mp_body["transaction_amount"] = serde_json::json!(amount);
    mp_body["description"] = serde_json::json!(description);
    // Force installments from the charge (defined by the AI agent), not from Bricks UI
    mp_body["installments"] = serde_json::json!(charge_installments);

    // Ensure required fields exist
    if body
        .get("token")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .is_empty()
    {
        return Err(AppError::BadRequest("Token do cartao nao fornecido".into()));
    }

    // Ensure payer.email exists (required by MP API, but Bricks doesn't always send it)
    if mp_body
        .get("payer")
        .and_then(|p| p.get("email"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .is_empty()
    {
        if mp_body.get("payer").is_none() {
            mp_body["payer"] = serde_json::json!({});
        }
        // Use the platform owner's email from the user record
        let user_email = crate::services::auth::get_user_by_id(&db, &user_id)
            .await
            .map(|u| u.email)
            .unwrap_or_else(|_| "pagamento@plataforma.com".to_string());
        mp_body["payer"]["email"] = serde_json::json!(user_email);
    }

    let client = reqwest::Client::new();

    let resp = client
        .post("https://api.mercadopago.com/v1/payments")
        .bearer_auth(&token)
        .header("X-Idempotency-Key", Uuid::new_v4().to_string())
        .json(&mp_body)
        .send()
        .await
        .map_err(|e| AppError::InternalError(format!("Failed to create MP payment: {e}")))?;

    let resp_status = resp.status();
    let resp_body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::InternalError(format!("Failed to parse MP response: {e}")))?;

    let mp_payment_status = resp_body
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("pending");
    let new_status = match mp_payment_status {
        "approved" => "approved",
        "pending" | "in_process" => "pending",
        "rejected" => "cancelled",
        _ => "pending",
    };

    let status_detail = resp_body
        .get("status_detail")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if !resp_status.is_success() && mp_payment_status != "rejected" {
        let msg = resp_body
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Erro desconhecido");
        tracing::error!(status = %resp_status, msg = %msg, detail = %status_detail, body = %resp_body, "MP card payment failed");
        return Ok(Json(json!({
            "status": "rejected",
            "statusDetail": if status_detail.is_empty() { "cc_rejected_other_reason".to_string() } else { status_detail },
            "error": msg,
        })));
    }

    // Update charge status
    let charge =
        crate::services::card_payment::check_charge_status(&db, &user_id, &charge_id, None).await?;
    crate::services::card_payment::update_charge_status(
        &db,
        &user_id,
        &charge_id,
        &charge.assistant_id,
        charge.created_at,
        new_status,
    )
    .await?;

    // Notify if approved
    if new_status == "approved" {
        let updated_charge =
            crate::services::card_payment::check_charge_status(&db, &user_id, &charge_id, None)
                .await?;
        crate::services::card_payment::notify_card_payment_confirmed(
            &db,
            &encryption,
            &config,
            &updated_charge,
        )
        .await;
    }

    // Publish SSE
    event_bus
        .publish(
            &user_id,
            crate::services::events::SseEvent {
                event_type: "card_status_changed".into(),
                data: serde_json::json!({
                    "chargeId": charge_id.to_string(),
                    "assistantId": charge.assistant_id.to_string(),
                    "status": new_status,
                })
                .to_string(),
            },
        )
        .await;

    Ok(Json(json!({
        "status": new_status,
        "statusDetail": status_detail,
    })))
}
