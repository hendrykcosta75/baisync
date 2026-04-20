use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use scylla::frame::value::CqlTimestamp;
use sha2::Sha256;
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::models::card_charge::{CardCharge, CardChargeSummary};
use crate::services::encryption::EncryptionService;

fn ts_now() -> CqlTimestamp {
    CqlTimestamp(Utc::now().timestamp_millis())
}

// ─── User Public Key Helpers ────────────────────────────────────────────────

/// Get user's Stripe publishable key (plain text, not encrypted).
pub async fn get_user_stripe_public_key(
    db: &DbSession,
    user_id: &Uuid,
) -> Result<Option<String>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT stripe_public_key FROM inertial_eclipse.users WHERE id = ?",
            (user_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(result
        .into_rows_result()?
        .maybe_first_row::<(Option<String>,)>()?
        .and_then(|r| r.0))
}

/// Get user's Mercado Pago public key (plain text, not encrypted).
pub async fn get_user_mp_public_key(
    db: &DbSession,
    user_id: &Uuid,
) -> Result<Option<String>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT mp_public_key FROM inertial_eclipse.users WHERE id = ?",
            (user_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(result
        .into_rows_result()?
        .maybe_first_row::<(Option<String>,)>()?
        .and_then(|r| r.0))
}

// ─── Stripe PaymentIntent ───────────────────────────────────────────────────

/// Create a Stripe PaymentIntent for a card payment.
/// Returns (payment_intent_id, client_secret).
async fn create_stripe_payment_intent(
    secret_key: &str,
    amount: f64,
    description: &str,
    charge_id: &Uuid,
) -> Result<(String, String), AppError> {
    let client = reqwest::Client::new();
    let amount_cents = (amount * 100.0).round() as i64;

    let amount_str = amount_cents.to_string();
    let charge_id_str = charge_id.to_string();
    let desc = description.to_string();
    let resp = client
        .post("https://api.stripe.com/v1/payment_intents")
        .basic_auth(secret_key, None::<&str>)
        .form(&[
            ("amount", amount_str.as_str()),
            ("currency", "brl"),
            ("payment_method_types[]", "card"),
            ("description", desc.as_str()),
            ("metadata[charge_id]", charge_id_str.as_str()),
        ])
        .send()
        .await
        .map_err(|e| AppError::InternalError(format!("Failed to call Stripe API: {e}")))?;

    let status = resp.status();
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::InternalError(format!("Failed to parse Stripe response: {e}")))?;

    if !status.is_success() {
        let msg = body
            .pointer("/error/message")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error");
        tracing::error!(status = %status, msg = %msg, "Stripe PaymentIntent creation failed");
        return Err(AppError::InternalError(
            "Falha ao criar pagamento Stripe".into(),
        ));
    }

    let pi_id = body
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::InternalError("Stripe response missing payment intent id".into()))?
        .to_string();

    let client_secret = body
        .get("client_secret")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::InternalError("Stripe response missing client_secret".into()))?
        .to_string();

    Ok((pi_id, client_secret))
}

/// Fetch Stripe PaymentIntent status.
async fn fetch_stripe_payment_status(secret_key: &str, pi_id: &str) -> Result<String, AppError> {
    let client = reqwest::Client::new();
    let resp = client
        .get(format!(
            "https://api.stripe.com/v1/payment_intents/{}",
            pi_id
        ))
        .basic_auth(secret_key, None::<&str>)
        .send()
        .await
        .map_err(|e| {
            AppError::InternalError(format!("Failed to fetch Stripe PaymentIntent: {e}"))
        })?;

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::InternalError(format!("Failed to parse Stripe response: {e}")))?;

    let status = body
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("requires_payment_method");

    Ok(match status {
        "succeeded" => "approved".to_string(),
        "canceled" => "cancelled".to_string(),
        "requires_payment_method" | "requires_confirmation" | "requires_action" | "processing" => {
            "pending".to_string()
        }
        _ => "pending".to_string(),
    })
}

// ─── Mercado Pago Checkout Pro ──────────────────────────────────────────────

/// Create a Mercado Pago Checkout Pro preference for card payments.
/// Returns (preference_id, init_point checkout URL).
async fn create_mp_checkout_preference(
    access_token: &str,
    amount: f64,
    description: &str,
    charge_id: &Uuid,
    notification_url: Option<&str>,
    success_url: &str,
    cancel_url: &str,
) -> Result<(String, String), AppError> {
    let client = reqwest::Client::new();
    let idempotency_key = Uuid::new_v4().to_string();

    let mut body = serde_json::json!({
        "items": [{
            "title": description,
            "quantity": 1,
            "unit_price": amount,
            "currency_id": "BRL"
        }],
        "payment_methods": {
            "excluded_payment_types": [
                {"id": "ticket"},
                {"id": "bank_transfer"}
            ]
        },
        "external_reference": charge_id.to_string()
    });

    // MP requires HTTPS back_urls; skip them for localhost/HTTP
    if success_url.starts_with("https://") {
        body["back_urls"] = serde_json::json!({
            "success": success_url,
            "failure": cancel_url,
            "pending": success_url
        });
        body["auto_return"] = serde_json::json!("approved");
    }

    if let Some(url) = notification_url {
        body["notification_url"] = serde_json::json!(url);
    }

    let resp = client
        .post("https://api.mercadopago.com/checkout/preferences")
        .bearer_auth(access_token)
        .header("X-Idempotency-Key", &idempotency_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::InternalError(format!("Failed to call MP API: {e}")))?;

    let status = resp.status();
    let resp_body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::InternalError(format!("Failed to parse MP response: {e}")))?;

    if !status.is_success() {
        let msg = resp_body
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error");
        tracing::error!(status = %status, msg = %msg, "MP Checkout Pro preference creation failed");
        return Err(AppError::InternalError(
            "Falha ao criar preferencia de pagamento Mercado Pago".into(),
        ));
    }

    let preference_id = resp_body
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::InternalError("MP response missing preference id".into()))?
        .to_string();

    let init_point = resp_body
        .get("init_point")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::InternalError("MP response missing init_point URL".into()))?
        .to_string();

    Ok((preference_id, init_point))
}

/// Fetch payment status from Mercado Pago using external_reference (charge_id).
async fn fetch_mp_card_payment_status(
    access_token: &str,
    external_reference: &str,
) -> Result<(String, Option<String>), AppError> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.mercadopago.com/v1/payments/search")
        .bearer_auth(access_token)
        .query(&[
            ("external_reference", external_reference),
            ("sort", "date_created"),
            ("criteria", "desc"),
        ])
        .send()
        .await
        .map_err(|e| AppError::InternalError(format!("Failed to search MP payments: {e}")))?;

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::InternalError(format!("Failed to parse MP response: {e}")))?;

    let results = body
        .get("results")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    if results.is_empty() {
        return Ok(("pending".to_string(), None));
    }

    // Take the most recent payment
    let payment = &results[0];
    let mp_id = payment
        .get("id")
        .and_then(|v| v.as_i64())
        .map(|v| v.to_string());

    let status = payment
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("pending");

    let mapped = match status {
        "approved" => "approved",
        "pending" | "in_process" | "in_mediation" => "pending",
        "rejected" | "cancelled" => "cancelled",
        "refunded" | "charged_back" => "refunded",
        other => other,
    };

    Ok((mapped.to_string(), mp_id))
}

// ─── Charge CRUD ────────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
pub async fn create_charge(
    db: &DbSession,
    user_id: &Uuid,
    assistant_id: &Uuid,
    conversation_id: Option<&Uuid>,
    contact_phone: &str,
    amount: f64,
    description: &str,
    card_mode: &str,
    provider_token: &str,
    customer_name: Option<&str>,
    customer_cpf: Option<&str>,
    payment_type: &str,
    installments: i32,
    app_url: &str,
    notification_url: Option<&str>,
) -> Result<CardCharge, AppError> {
    if amount <= 0.0 {
        return Err(AppError::BadRequest("Valor deve ser maior que zero".into()));
    }
    if amount > 100_000.0 {
        return Err(AppError::BadRequest(
            "Valor maximo permitido e R$ 100.000,00".into(),
        ));
    }

    let charge_id = Uuid::new_v4();
    let now = Utc::now();
    let now_ts = ts_now();

    let success_url = format!("{}/pay/success", app_url);
    let cancel_url = format!("{}/pay/cancel", app_url);

    // For Stripe: create PaymentIntent → returns (id, client_secret)
    // For MP: create Checkout Pro preference → returns (preference_id, init_point)
    // We store: provider_session_id = PI id or preference id
    //           checkout_url = client_secret (Stripe) or init_point (MP)
    let (session_id, checkout_url) = match card_mode {
        "stripe" => {
            let (pi_id, client_secret) =
                create_stripe_payment_intent(provider_token, amount, description, &charge_id)
                    .await?;
            // Store client_secret in checkout_url field for the payment page
            (pi_id, client_secret)
        }
        "mercadopago" => {
            create_mp_checkout_preference(
                provider_token,
                amount,
                description,
                &charge_id,
                notification_url,
                &success_url,
                &cancel_url,
            )
            .await?
        }
        _ => {
            return Err(AppError::BadRequest(format!(
                "Modo de cartão inválido: {}",
                card_mode
            )))
        }
    };

    let charge = CardCharge {
        user_id: *user_id,
        id: charge_id,
        assistant_id: *assistant_id,
        conversation_id: conversation_id.copied(),
        contact_phone: contact_phone.to_string(),
        amount,
        description: description.to_string(),
        card_mode: card_mode.to_string(),
        provider_session_id: Some(session_id.clone()),
        checkout_url: Some(checkout_url.clone()),
        status: "pending".to_string(),
        customer_name: customer_name.map(|s| s.to_string()),
        customer_cpf: customer_cpf.map(|s| s.to_string()),
        payment_type: payment_type.to_string(),
        installments: if payment_type == "debit" {
            1
        } else {
            installments.clamp(1, 12)
        },
        created_at: now,
        updated_at: now,
    };

    // Insert into main table
    db.query_unpaged(
        "INSERT INTO inertial_eclipse.card_charges (user_id, id, assistant_id, conversation_id, contact_phone, amount, description, card_mode, provider_session_id, checkout_url, status, customer_name, customer_cpf, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (user_id, &charge_id, assistant_id, &conversation_id, &charge.contact_phone as &str, charge.amount, &charge.description as &str, card_mode, &charge.provider_session_id, &charge.checkout_url, "pending", &charge.customer_name, &charge.customer_cpf, now_ts, now_ts),
    ).await.map_err(|e| AppError::DatabaseError(format!("Failed to save card charge: {e}")))?;

    // Set payment_type and installments via UPDATE (to stay within 16-element tuple limit)
    db.query_unpaged(
        "UPDATE inertial_eclipse.card_charges SET payment_type = ?, installments = ? WHERE user_id = ? AND id = ?",
        (payment_type, charge.installments, user_id, &charge_id),
    ).await.map_err(|e| AppError::DatabaseError(format!("Failed to update card charge payment options: {e}")))?;

    // Insert into by-assistant lookup
    db.query_unpaged(
        "INSERT INTO inertial_eclipse.card_charges_by_assistant (assistant_id, created_at, id, user_id, amount, status, contact_phone, description, customer_name, customer_cpf, card_mode, payment_type, installments) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (assistant_id, now_ts, &charge_id, user_id, charge.amount, "pending", &charge.contact_phone as &str, &charge.description as &str, &charge.customer_name, &charge.customer_cpf, card_mode, payment_type, charge.installments),
    ).await.map_err(|e| AppError::DatabaseError(format!("Failed to save card charge by assistant: {e}")))?;

    // Insert into provider lookup
    db.query_unpaged(
        "INSERT INTO inertial_eclipse.card_charges_by_provider_id (provider_session_id, user_id, charge_id, assistant_id, card_mode) VALUES (?, ?, ?, ?, ?)",
        (&session_id as &str, user_id, &charge_id, assistant_id, card_mode),
    ).await.map_err(|e| AppError::DatabaseError(format!("Failed to save card charge by provider id: {e}")))?;

    tracing::info!(charge_id = %charge_id, amount = %amount, card_mode = %card_mode, "Card charge created");

    Ok(charge)
}

// ─── Status Checking ────────────────────────────────────────────────────────

type ChargeStatusRow = (
    Uuid,           // user_id
    Uuid,           // id
    Uuid,           // assistant_id
    Option<Uuid>,   // conversation_id
    Option<String>, // contact_phone
    Option<f64>,    // amount
    Option<String>, // description
    Option<String>, // card_mode
    Option<String>, // provider_session_id
    Option<String>, // checkout_url
    Option<String>, // status
    CqlTimestamp,   // created_at
    CqlTimestamp,   // updated_at
    Option<String>, // customer_name
    Option<String>, // customer_cpf
);

fn status_row_to_charge(r: ChargeStatusRow, payment_type: String, installments: i32) -> CardCharge {
    CardCharge {
        user_id: r.0,
        id: r.1,
        assistant_id: r.2,
        conversation_id: r.3,
        contact_phone: r.4.unwrap_or_default(),
        amount: r.5.unwrap_or(0.0),
        description: r.6.unwrap_or_default(),
        card_mode: r.7.unwrap_or_else(|| "stripe".to_string()),
        provider_session_id: r.8,
        checkout_url: r.9,
        status: r.10.unwrap_or_else(|| "pending".to_string()),
        created_at: DateTime::from_timestamp_millis(r.11 .0).unwrap_or_default(),
        updated_at: DateTime::from_timestamp_millis(r.12 .0).unwrap_or_default(),
        customer_name: r.13,
        customer_cpf: r.14,
        payment_type,
        installments,
    }
}

pub async fn check_charge_status(
    db: &DbSession,
    user_id: &Uuid,
    charge_id: &Uuid,
    conversation_id: Option<&Uuid>,
) -> Result<CardCharge, AppError> {
    let result = db.query_unpaged(
        "SELECT user_id, id, assistant_id, conversation_id, contact_phone, amount, description, card_mode, provider_session_id, checkout_url, status, created_at, updated_at, customer_name, customer_cpf FROM inertial_eclipse.card_charges WHERE user_id = ? AND id = ?",
        (user_id, charge_id),
    ).await.map_err(|e| AppError::DatabaseError(format!("Failed to query card charge: {e}")))?;

    let row = result
        .into_rows_result()?
        .single_row::<ChargeStatusRow>()
        .map_err(|_| AppError::NotFound("Cobrança não encontrada".into()))?;

    // Fetch payment options separately (to stay within 16-element tuple limit)
    let opts_result = db.query_unpaged(
        "SELECT payment_type, installments FROM inertial_eclipse.card_charges WHERE user_id = ? AND id = ?",
        (user_id, charge_id),
    ).await.ok();
    let (pt, inst) = opts_result
        .and_then(|r| r.into_rows_result().ok())
        .and_then(|r| {
            r.maybe_first_row::<(Option<String>, Option<i32>)>()
                .ok()
                .flatten()
        })
        .unwrap_or((None, None));

    let charge = status_row_to_charge(
        row,
        pt.unwrap_or_else(|| "credit".to_string()),
        inst.unwrap_or(1),
    );

    if let Some(cid) = conversation_id {
        if charge.conversation_id != Some(*cid) {
            return Err(AppError::NotFound("Cobrança não encontrada".into()));
        }
    }

    Ok(charge)
}

/// Like check_charge_status but actively polls provider API for pending charges.
pub async fn check_charge_status_live(
    db: &DbSession,
    encryption: &EncryptionService,
    config: &crate::config::Config,
    user_id: &Uuid,
    charge_id: &Uuid,
    conversation_id: Option<&Uuid>,
) -> Result<CardCharge, AppError> {
    let mut charge = check_charge_status(db, user_id, charge_id, conversation_id).await?;

    if charge.status == "pending" {
        if let Some(ref session_id) = charge.provider_session_id {
            let new_status_opt = match charge.card_mode.as_str() {
                "stripe" => {
                    if let Ok(Some(token)) =
                        crate::services::pix::get_user_stripe_token(db, encryption, user_id).await
                    {
                        fetch_stripe_payment_status(&token, session_id).await.ok()
                    } else {
                        None
                    }
                }
                "mercadopago" => {
                    if let Ok(Some(token)) =
                        crate::services::pix::get_user_mp_token(db, encryption, user_id).await
                    {
                        fetch_mp_card_payment_status(&token, &charge_id.to_string())
                            .await
                            .ok()
                            .map(|(s, _)| s)
                    } else {
                        None
                    }
                }
                _ => None,
            };

            if let Some(new_status) = new_status_opt {
                if new_status != "pending" {
                    let _ = update_charge_status(
                        db,
                        user_id,
                        charge_id,
                        &charge.assistant_id,
                        charge.created_at,
                        &new_status,
                    )
                    .await;

                    crate::services::events::publish_global(
                        user_id,
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

                    if new_status == "approved" {
                        charge.status = "approved".to_string();
                        notify_card_payment_confirmed(db, encryption, config, &charge).await;
                    } else {
                        charge.status = new_status;
                    }
                }
            }
        }
    }

    Ok(charge)
}

pub async fn update_charge_status(
    db: &DbSession,
    user_id: &Uuid,
    charge_id: &Uuid,
    assistant_id: &Uuid,
    created_at: DateTime<Utc>,
    new_status: &str,
) -> Result<(), AppError> {
    let now_ts = ts_now();
    let created_ts = CqlTimestamp(created_at.timestamp_millis());

    db.query_unpaged(
        "UPDATE inertial_eclipse.card_charges SET status = ?, updated_at = ? WHERE user_id = ? AND id = ?",
        (new_status, now_ts, user_id, charge_id),
    ).await.map_err(|e| AppError::DatabaseError(format!("Failed to update card charge status: {e}")))?;

    db.query_unpaged(
        "UPDATE inertial_eclipse.card_charges_by_assistant SET status = ? WHERE assistant_id = ? AND created_at = ? AND id = ?",
        (new_status, assistant_id, created_ts, charge_id),
    ).await.map_err(|e| AppError::DatabaseError(format!("Failed to update card charge by assistant: {e}")))?;

    Ok(())
}

// ─── Background Poller ──────────────────────────────────────────────────────

pub fn spawn_card_payment_poller(
    db: DbSession,
    config: crate::config::Config,
    encryption: EncryptionService,
    event_bus: crate::services::events::EventBus,
    user_id: Uuid,
    charge_id: Uuid,
    assistant_id: Uuid,
    provider_session_id: String,
    card_mode: String,
) {
    tokio::spawn(async move {
        let max_attempts = 90; // 90 * 10s = 15 minutes
        for attempt in 0..max_attempts {
            tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;

            let new_status = match card_mode.as_str() {
                "stripe" => {
                    match crate::services::pix::get_user_stripe_token(&db, &encryption, &user_id)
                        .await
                    {
                        Ok(Some(token)) => {
                            fetch_stripe_payment_status(&token, &provider_session_id)
                                .await
                                .ok()
                        }
                        _ => {
                            tracing::warn!(charge_id = %charge_id, "Card poller: no Stripe token, stopping");
                            return;
                        }
                    }
                }
                "mercadopago" => {
                    match crate::services::pix::get_user_mp_token(&db, &encryption, &user_id).await
                    {
                        Ok(Some(token)) => {
                            fetch_mp_card_payment_status(&token, &charge_id.to_string())
                                .await
                                .ok()
                                .map(|(s, _)| s)
                        }
                        _ => {
                            tracing::warn!(charge_id = %charge_id, "Card poller: no MP token, stopping");
                            return;
                        }
                    }
                }
                _ => None,
            };

            let new_status = match new_status {
                Some(s) => s,
                None => continue,
            };

            if new_status == "pending" {
                continue;
            }

            // Status changed — update DB
            let charge_result = db.query_unpaged(
                "SELECT created_at FROM inertial_eclipse.card_charges WHERE user_id = ? AND id = ?",
                (&user_id, &charge_id),
            ).await;

            let created_at = charge_result
                .ok()
                .and_then(|r| r.into_rows_result().ok())
                .and_then(|r| r.maybe_first_row::<(CqlTimestamp,)>().ok().flatten())
                .map(|r| DateTime::from_timestamp_millis(r.0 .0).unwrap_or_default())
                .unwrap_or_default();

            if let Err(e) = update_charge_status(
                &db,
                &user_id,
                &charge_id,
                &assistant_id,
                created_at,
                &new_status,
            )
            .await
            {
                tracing::error!(error = %e, "Card poller: failed to update status");
            }

            if new_status == "approved" {
                if let Ok(charge) = check_charge_status(&db, &user_id, &charge_id, None).await {
                    notify_card_payment_confirmed(&db, &encryption, &config, &charge).await;
                }
            }

            event_bus
                .publish(
                    &user_id,
                    crate::services::events::SseEvent {
                        event_type: "card_status_changed".into(),
                        data: serde_json::json!({
                            "chargeId": charge_id.to_string(),
                            "assistantId": assistant_id.to_string(),
                            "status": new_status,
                        })
                        .to_string(),
                    },
                )
                .await;

            tracing::info!(charge_id = %charge_id, new_status = %new_status, attempt = attempt, "Card poller: status updated");
            return;
        }

        tracing::info!(charge_id = %charge_id, "Card poller: timed out after 15 minutes");
    });
}

// ─── Notification ───────────────────────────────────────────────────────────

pub async fn notify_card_payment_confirmed(
    db: &DbSession,
    encryption: &crate::services::encryption::EncryptionService,
    config: &crate::config::Config,
    charge: &CardCharge,
) {
    let user_id = &charge.user_id;
    let assistant_id = &charge.assistant_id;

    let assistant_name =
        match crate::services::assistant::get_assistant(db, user_id, assistant_id).await {
            Ok(a) => a.name,
            Err(_) => "Assistente".to_string(),
        };

    let customer_name = charge.customer_name.as_deref().unwrap_or("--");
    let customer_cpf = charge.customer_cpf.as_deref().unwrap_or("--");

    // 1. In-app notification
    let title = format!("Pagamento por Cartao Confirmado - R$ {:.2}", charge.amount);
    let message = format!(
        "Cliente: {} ({})\nDescricao: {}\nAssistente: {}",
        customer_name, charge.contact_phone, charge.description, assistant_name
    );
    if let Err(e) = crate::services::notification::create_notification(
        db,
        user_id,
        Some(assistant_id),
        None,
        "card_payment_confirmed",
        &title,
        &message,
    )
    .await
    {
        tracing::error!(error = %e, "Failed to create card payment notification");
    }

    // 2. Email to user
    if let Ok(user) = crate::services::auth::get_user_by_id(db, user_id).await {
        if let Err(e) = crate::services::email::send_pix_payment_confirmed_email(
            config,
            &user.email,
            &assistant_name,
            charge.amount,
            &charge.description,
            customer_name,
            customer_cpf,
            &charge.contact_phone,
        )
        .await
        {
            tracing::error!(error = %e, "Failed to send card payment email");
        }
    }

    // 3. Send confirmation to client via messaging provider
    if let Some(conversation_id) = &charge.conversation_id {
        let conv_result = db.query_unpaged(
            "SELECT channel FROM inertial_eclipse.conversations WHERE assistant_id = ? AND user_id = ? AND id = ?",
            (assistant_id, user_id, conversation_id),
        ).await;

        let channel = conv_result
            .ok()
            .and_then(|r| r.into_rows_result().ok())
            .and_then(|r| r.maybe_first_row::<(String,)>().ok().flatten())
            .map(|r| r.0)
            .unwrap_or_default();

        if !channel.is_empty() {
            let integrations =
                crate::services::assistant::list_integrations(db, encryption, assistant_id, user_id)
                    .await
                    .unwrap_or_default();
            if let Some(integration) = integrations.into_iter().find(|i| i.channel == channel) {
                let confirm_msg = format!(
                    "Pagamento confirmado! \u{2705}\n\nValor: R$ {:.2}\nDescricao: {}\n\nObrigado, {}!",
                    charge.amount, charge.description, customer_name
                );
                if let Err(e) = crate::services::messaging::send_message_via_provider_public(
                    config,
                    &integration,
                    &charge.contact_phone,
                    &confirm_msg,
                )
                .await
                {
                    tracing::error!(error = %e, "Failed to send card payment confirmation to client");
                }
            }
        }
    }
}

// ─── Webhook Processing ────────────────────────────────────────────────────

/// Verify Stripe webhook signature.
#[allow(dead_code)]
pub fn verify_stripe_signature(
    payload: &[u8],
    sig_header: &str,
    secret: &str,
) -> Result<(), AppError> {
    if secret.is_empty() {
        tracing::warn!("Stripe webhook secret not configured, skipping signature verification");
        return Ok(());
    }

    let mut timestamp = "";
    let mut signature = "";

    for part in sig_header.split(',') {
        let part = part.trim();
        if let Some(t) = part.strip_prefix("t=") {
            timestamp = t;
        } else if let Some(v1) = part.strip_prefix("v1=") {
            signature = v1;
        }
    }

    if timestamp.is_empty() || signature.is_empty() {
        return Err(AppError::Unauthorized(
            "Invalid Stripe signature format".into(),
        ));
    }

    let payload_str = std::str::from_utf8(payload)
        .map_err(|_| AppError::Unauthorized("Invalid webhook payload encoding".into()))?;
    let signed_payload = format!("{}.{}", timestamp, payload_str);

    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())
        .map_err(|_| AppError::InternalError("Failed to create HMAC".into()))?;
    mac.update(signed_payload.as_bytes());

    let expected = hex::encode(mac.finalize().into_bytes());

    if !bool::from(subtle::ConstantTimeEq::ct_eq(
        expected.as_bytes(),
        signature.as_bytes(),
    )) {
        return Err(AppError::Unauthorized(
            "Invalid Stripe webhook signature".into(),
        ));
    }

    Ok(())
}

/// Process a Stripe webhook for checkout.session.completed.
pub async fn process_stripe_webhook(
    db: &DbSession,
    encryption: &crate::services::encryption::EncryptionService,
    config: &crate::config::Config,
    event_bus: &crate::services::events::EventBus,
    body: &serde_json::Value,
) -> Result<(), AppError> {
    let event_type = body.get("type").and_then(|v| v.as_str()).unwrap_or("");

    if event_type != "checkout.session.completed" {
        tracing::debug!(event_type = %event_type, "Ignoring Stripe event");
        return Ok(());
    }

    let session = body
        .get("data")
        .and_then(|d| d.get("object"))
        .ok_or_else(|| AppError::BadRequest("Missing session object in Stripe event".into()))?;

    let session_id = session.get("id").and_then(|v| v.as_str()).unwrap_or("");

    let payment_status = session
        .get("payment_status")
        .and_then(|v| v.as_str())
        .unwrap_or("unpaid");

    if session_id.is_empty() {
        return Err(AppError::BadRequest(
            "Missing session id in Stripe event".into(),
        ));
    }

    // Look up charge by provider session ID
    let result = db.query_unpaged(
        "SELECT provider_session_id, user_id, charge_id, assistant_id, card_mode FROM inertial_eclipse.card_charges_by_provider_id WHERE provider_session_id = ?",
        (session_id,),
    ).await.map_err(|e| AppError::DatabaseError(format!("Failed to lookup card charge: {e}")))?;

    let row = result
        .into_rows_result()?
        .single_row::<(String, Uuid, Uuid, Uuid, Option<String>)>()
        .map_err(|_| {
            AppError::NotFound(format!("Card charge not found for session: {session_id}"))
        })?;

    let user_id = row.1;
    let charge_id = row.2;
    let assistant_id = row.3;

    let new_status = if payment_status == "paid" {
        "approved"
    } else {
        "pending"
    };

    if new_status == "approved" {
        let charge_result = db
            .query_unpaged(
                "SELECT created_at FROM inertial_eclipse.card_charges WHERE user_id = ? AND id = ?",
                (&user_id, &charge_id),
            )
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to get charge: {e}")))?;

        let created_at = charge_result
            .into_rows_result()
            .ok()
            .and_then(|r| r.single_row::<(CqlTimestamp,)>().ok())
            .map(|r| DateTime::from_timestamp_millis(r.0 .0).unwrap_or_default())
            .unwrap_or_default();

        update_charge_status(
            db,
            &user_id,
            &charge_id,
            &assistant_id,
            created_at,
            new_status,
        )
        .await?;

        if let Ok(charge) = check_charge_status(db, &user_id, &charge_id, None).await {
            notify_card_payment_confirmed(db, encryption, config, &charge).await;
        }
    }

    event_bus
        .publish(
            &user_id,
            crate::services::events::SseEvent {
                event_type: "card_status_changed".into(),
                data: serde_json::json!({
                    "chargeId": charge_id.to_string(),
                    "assistantId": assistant_id.to_string(),
                    "status": new_status,
                })
                .to_string(),
            },
        )
        .await;

    tracing::info!(session_id = %session_id, new_status = %new_status, charge_id = %charge_id, "Stripe card webhook processed");
    Ok(())
}

/// Process a Mercado Pago webhook for card charges.
pub async fn process_mp_card_webhook(
    db: &DbSession,
    config: &crate::config::Config,
    encryption: &EncryptionService,
    event_bus: &crate::services::events::EventBus,
    mp_payment_id: &str,
) -> Result<(), AppError> {
    // MP sends the payment ID; we need to find it by searching payments with external_reference
    // First, we try to find any card charge whose external_reference matches
    // Since MP webhooks send payment IDs not preference IDs, we need to find the user first
    // We'll search all card charges for this payment, so we fetch payment details from MP

    // Try to get the payment from MP to extract external_reference
    // We need a token - but we don't know the user yet. So we look up by iterating.
    // Alternative: store mp_payment_id in the lookup table when the first payment event comes.

    // For MP card webhooks, the flow is different from PIX:
    // 1. Customer pays on Checkout Pro
    // 2. MP creates a payment and sends us a webhook with payment_id
    // 3. We need to find which charge it belongs to

    // Since we stored the preference_id as provider_session_id, and MP webhook sends payment_id,
    // we need to query MP to get the external_reference (our charge_id) from the payment.
    // But we need a token to do that...

    // Solution: Try to find a charge that matches by querying each user's MP payments.
    // This is not ideal but works for small scale. For production, we should store a mapping.

    // Simpler approach: MP IPN notifications include the external_reference in some cases.
    // Actually, for preferences, the notification includes topic=payment and data.id=payment_id.
    // We can fetch the payment details using any valid MP token since the payment is public
    // to the receiving merchant.

    // For now, log and return OK - the background poller will catch it.
    tracing::info!(mp_payment_id = %mp_payment_id, "MP card webhook received, relying on poller for status update");
    let _ = (db, config, encryption, event_bus);
    Ok(())
}

// ─── Financial Dashboard Queries ────────────────────────────────────────────

pub async fn list_charges_by_assistant(
    db: &DbSession,
    assistant_id: &Uuid,
    limit: i32,
) -> Result<Vec<CardChargeSummary>, AppError> {
    let result = db.query_unpaged(
        "SELECT id, amount, status, description, contact_phone, created_at, customer_name, customer_cpf, card_mode FROM inertial_eclipse.card_charges_by_assistant WHERE assistant_id = ? LIMIT ?",
        (assistant_id, limit),
    ).await.map_err(|e| AppError::DatabaseError(format!("Failed to list card charges: {e}")))?;

    let rows = result.into_rows_result()?;
    let charges: Vec<CardChargeSummary> = rows
        .rows::<(
            Uuid,
            Option<f64>,
            Option<String>,
            Option<String>,
            Option<String>,
            CqlTimestamp,
            Option<String>,
            Option<String>,
            Option<String>,
        )>()?
        .filter_map(|r| r.ok())
        .map(|r| CardChargeSummary {
            id: r.0,
            amount: r.1.unwrap_or(0.0),
            status: r.2.unwrap_or_else(|| "pending".to_string()),
            description: r.3.unwrap_or_default(),
            contact_phone: r.4.unwrap_or_default(),
            created_at: DateTime::from_timestamp_millis(r.5 .0).unwrap_or_default(),
            customer_name: r.6,
            customer_cpf: r.7,
            card_mode: r.8,
        })
        .collect();

    Ok(charges)
}
