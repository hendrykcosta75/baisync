use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chrono::{DateTime, Utc};
use image::Luma;
use qrcode::QrCode;
use scylla::frame::value::CqlTimestamp;
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::models::pix::{FinancialSummary, PixCharge, PixChargeSummary};
use crate::services::encryption::EncryptionService;

fn ts_now() -> CqlTimestamp {
    CqlTimestamp(Utc::now().timestamp_millis())
}

// ─── PIX BR Code (EMV QR Code) Generation ───────────────────────────────────

/// Strip accents and non-ASCII characters from a string.
/// EMV QR Code only allows: A-Z a-z 0-9 and special chars $ % * + - . / : space
fn sanitize_emv(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
            'Á' | 'À' | 'Â' | 'Ã' | 'Ä' => 'A',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'É' | 'È' | 'Ê' | 'Ë' => 'E',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'Í' | 'Ì' | 'Î' | 'Ï' => 'I',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'Ó' | 'Ò' | 'Ô' | 'Õ' | 'Ö' => 'O',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'Ú' | 'Ù' | 'Û' | 'Ü' => 'U',
            'ç' => 'c',
            'Ç' => 'C',
            'ñ' => 'n',
            'Ñ' => 'N',
            c if c.is_ascii() => c,
            _ => ' ',
        })
        .collect()
}

/// Generate a PIX BR Code payload (copia-e-cola) following the EMV QR Code standard.
/// Generates a static PIX QR code that pays directly to the configured PIX key.
fn generate_pix_payload(pix_key: &str, amount: f64, description: &str, txid: &str) -> String {
    let mut payload = String::new();

    // Payload Format Indicator
    payload.push_str(&tlv("00", "01"));

    // Merchant Account Information (ID 26) — PIX specific
    let mut mai = String::new();
    mai.push_str(&tlv("00", "br.gov.bcb.pix")); // GUI
    mai.push_str(&tlv("01", pix_key)); // PIX key
    let desc_clean = sanitize_emv(description);
    if !desc_clean.is_empty() {
        let desc_truncated: String = desc_clean.chars().take(72).collect();
        mai.push_str(&tlv("02", &desc_truncated)); // infoAdicional (optional)
    }
    payload.push_str(&tlv("26", &mai));

    // Merchant Category Code
    payload.push_str(&tlv("52", "0000"));

    // Transaction Currency (986 = BRL)
    payload.push_str(&tlv("53", "986"));

    // Transaction Amount
    if amount > 0.0 {
        let amount_str = format!("{:.2}", amount);
        payload.push_str(&tlv("54", &amount_str));
    }

    // Country Code
    payload.push_str(&tlv("58", "BR"));

    // Merchant Name (max 25 chars, ASCII only)
    payload.push_str(&tlv("59", "Pagamento PIX"));

    // Merchant City (max 15 chars, ASCII only)
    payload.push_str(&tlv("60", "Brasil"));

    // Additional Data Field (ID 62)
    let txid_clean: String = txid
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(25)
        .collect();
    let additional = tlv(
        "05",
        if txid_clean.is_empty() {
            "***"
        } else {
            &txid_clean
        },
    );
    payload.push_str(&tlv("62", &additional));

    // CRC16 — append "6304" then compute CRC over entire payload including "6304"
    payload.push_str("6304");
    let crc = crc16_ccitt(payload.as_bytes());
    payload.push_str(&format!("{:04X}", crc));

    payload
}

/// TLV (Tag-Length-Value) encoding for EMV QR Code
fn tlv(tag: &str, value: &str) -> String {
    format!("{}{:02}{}", tag, value.len(), value)
}

/// CRC-16/CCITT-FALSE (polynomial 0x1021)
fn crc16_ccitt(data: &[u8]) -> u16 {
    let mut crc: u16 = 0xFFFF;
    for &byte in data {
        crc ^= (byte as u16) << 8;
        for _ in 0..8 {
            if crc & 0x8000 != 0 {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc <<= 1;
            }
        }
    }
    crc
}

/// Generate QR code image as base64-encoded PNG
fn generate_qr_base64(payload: &str) -> Result<String, AppError> {
    let code = QrCode::new(payload.as_bytes())
        .map_err(|e| AppError::InternalError(format!("Failed to generate QR code: {e}")))?;

    let image = code
        .render::<Luma<u8>>()
        .quiet_zone(true)
        .min_dimensions(400, 400)
        .build();

    let mut png_bytes: Vec<u8> = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut png_bytes);
    image
        .write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| AppError::InternalError(format!("Failed to encode QR as PNG: {e}")))?;

    Ok(BASE64.encode(&png_bytes))
}

// ─── Mercado Pago API ───────────────────────────────────────────────────────

/// Create a PIX payment via Mercado Pago API.
/// Returns (mp_payment_id, qr_code_base64, copia_e_cola).
async fn create_mp_payment(
    access_token: &str,
    amount: f64,
    description: &str,
    notification_url: Option<&str>,
) -> Result<(String, String, String), AppError> {
    let client = reqwest::Client::new();
    let idempotency_key = Uuid::new_v4().to_string();

    let mut body = serde_json::json!({
        "transaction_amount": amount,
        "description": description,
        "payment_method_id": "pix",
        "payer": {
            "email": "pagamento@plataforma.com"
        }
    });

    if let Some(url) = notification_url {
        body["notification_url"] = serde_json::json!(url);
    }

    let resp = client
        .post("https://api.mercadopago.com/v1/payments")
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
        return Err(AppError::InternalError(format!(
            "MP API error ({}): {}",
            status, msg
        )));
    }

    let mp_id = resp_body
        .get("id")
        .and_then(|v| v.as_i64())
        .map(|v| v.to_string())
        .or_else(|| {
            resp_body
                .get("id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .ok_or_else(|| AppError::InternalError("MP response missing payment id".into()))?;

    let qr_base64 = resp_body
        .pointer("/point_of_interaction/transaction_data/qr_code_base64")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let copia_e_cola = resp_body
        .pointer("/point_of_interaction/transaction_data/qr_code")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    Ok((mp_id, qr_base64, copia_e_cola))
}

/// Fetch payment status from Mercado Pago API using user's access token.
async fn fetch_mp_payment_status(
    access_token: &str,
    mp_payment_id: &str,
) -> Result<String, AppError> {
    let client = reqwest::Client::new();
    let resp = client
        .get(format!(
            "https://api.mercadopago.com/v1/payments/{}",
            mp_payment_id
        ))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| AppError::InternalError(format!("Failed to fetch MP payment: {e}")))?;

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::InternalError(format!("Failed to parse MP response: {e}")))?;

    let status = body
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("pending")
        .to_string();

    Ok(match status.as_str() {
        "approved" => "approved".to_string(),
        "pending" | "in_process" | "in_mediation" => "pending".to_string(),
        "rejected" | "cancelled" => "cancelled".to_string(),
        "refunded" | "charged_back" => "refunded".to_string(),
        other => other.to_string(),
    })
}

// ─── User MP Token Helper ───────────────────────────────────────────────────

/// Decrypt and return the workspace's Mercado Pago access token.
pub async fn get_user_mp_token(
    db: &DbSession,
    encryption: &EncryptionService,
    user_id: &Uuid,
) -> Result<Option<String>, AppError> {
    match crate::services::workspace::get_decrypted_api_key(db, encryption, user_id, "mercadopago")
        .await
    {
        Ok(key) => Ok(Some(key)),
        Err(_) => Ok(None),
    }
}

// ─── Stripe PIX API ─────────────────────────────────────────────────────────

/// Create a PIX payment via Stripe PaymentIntent API.
/// Returns (payment_intent_id, qr_code_base64, copia_e_cola).
async fn create_stripe_pix_payment(
    secret_key: &str,
    amount: f64,
    description: &str,
) -> Result<(String, String, String), AppError> {
    let client = reqwest::Client::new();
    let amount_cents = (amount * 100.0).round() as i64;

    let resp = client
        .post("https://api.stripe.com/v1/payment_intents")
        .basic_auth(secret_key, None::<&str>)
        .form(&[
            ("amount", amount_cents.to_string()),
            ("currency", "brl".to_string()),
            ("payment_method_types[]", "pix".to_string()),
            ("description", description.to_string()),
        ])
        .send()
        .await
        .map_err(|e| AppError::InternalError(format!("Failed to call Stripe API: {e}")))?;

    let status = resp.status();
    let resp_body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::InternalError(format!("Failed to parse Stripe response: {e}")))?;

    if !status.is_success() {
        let msg = resp_body
            .pointer("/error/message")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error");
        return Err(AppError::InternalError(format!(
            "Stripe API error ({}): {}",
            status, msg
        )));
    }

    let pi_id = resp_body
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::InternalError("Stripe response missing payment_intent id".into()))?
        .to_string();

    // Confirm the PaymentIntent to generate the PIX QR code
    let confirm_resp = client
        .post(format!(
            "https://api.stripe.com/v1/payment_intents/{}/confirm",
            pi_id
        ))
        .basic_auth(secret_key, None::<&str>)
        .form(&[
            ("payment_method_data[type]", "pix"),
            ("return_url", "https://example.com/return"),
        ])
        .send()
        .await
        .map_err(|e| {
            AppError::InternalError(format!("Failed to confirm Stripe PaymentIntent: {e}"))
        })?;

    let confirm_status = confirm_resp.status();
    let confirm_body: serde_json::Value = confirm_resp.json().await.map_err(|e| {
        AppError::InternalError(format!("Failed to parse Stripe confirm response: {e}"))
    })?;

    if !confirm_status.is_success() {
        let msg = confirm_body
            .pointer("/error/message")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error");
        return Err(AppError::InternalError(format!(
            "Stripe confirm error ({}): {}",
            confirm_status, msg
        )));
    }

    // Extract PIX QR code data from next_action
    let qr_code_url = confirm_body
        .pointer("/next_action/pix_display_qr_code/image_url_png")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let copia_e_cola = confirm_body
        .pointer("/next_action/pix_display_qr_code/data")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // Download QR code image and convert to base64
    let qr_base64 = if !qr_code_url.is_empty() {
        match client.get(&qr_code_url).send().await {
            Ok(img_resp) => {
                let bytes = img_resp.bytes().await.unwrap_or_default();
                if !bytes.is_empty() {
                    BASE64.encode(&bytes)
                } else {
                    String::new()
                }
            }
            Err(_) => String::new(),
        }
    } else {
        // Fallback: generate QR from copia_e_cola
        if !copia_e_cola.is_empty() {
            generate_qr_base64(&copia_e_cola).unwrap_or_default()
        } else {
            String::new()
        }
    };

    Ok((pi_id, qr_base64, copia_e_cola))
}

/// Fetch payment status from Stripe API.
async fn fetch_stripe_payment_status(
    secret_key: &str,
    payment_intent_id: &str,
) -> Result<String, AppError> {
    let client = reqwest::Client::new();
    let resp = client
        .get(format!(
            "https://api.stripe.com/v1/payment_intents/{}",
            payment_intent_id
        ))
        .basic_auth(secret_key, None::<&str>)
        .send()
        .await
        .map_err(|e| AppError::InternalError(format!("Failed to fetch Stripe payment: {e}")))?;

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::InternalError(format!("Failed to parse Stripe response: {e}")))?;

    let status = body
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("requires_action")
        .to_string();

    Ok(match status.as_str() {
        "succeeded" => "approved".to_string(),
        "requires_action" | "requires_payment_method" | "processing" => "pending".to_string(),
        "canceled" => "cancelled".to_string(),
        other => other.to_string(),
    })
}

// ─── User Stripe Token Helper ──────────────────────────────────────────────

/// Decrypt and return the workspace's Stripe secret key.
pub async fn get_user_stripe_token(
    db: &DbSession,
    encryption: &EncryptionService,
    user_id: &Uuid,
) -> Result<Option<String>, AppError> {
    match crate::services::workspace::get_decrypted_api_key(db, encryption, user_id, "stripe").await
    {
        Ok(key) => Ok(Some(key)),
        Err(_) => Ok(None),
    }
}

// ─── Charge CRUD ─────────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
pub async fn create_charge(
    db: &DbSession,
    user_id: &Uuid,
    assistant_id: &Uuid,
    conversation_id: Option<&Uuid>,
    contact_phone: &str,
    amount: f64,
    description: &str,
    pix_key: &str,
    pix_key_type: &str,
    _channel: &str,
    pix_mode: &str,
    mp_access_token: Option<&str>,
    customer_name: Option<&str>,
    customer_cpf: Option<&str>,
    notification_url: Option<&str>,
) -> Result<PixCharge, AppError> {
    if amount <= 0.0 {
        return Err(AppError::BadRequest("Valor deve ser maior que zero".into()));
    }

    let charge_id = Uuid::new_v4();
    let now = Utc::now();
    let now_ts = ts_now();

    let (mp_payment_id, qr_base64, copia_e_cola) = match pix_mode {
        "mercadopago" => {
            let token = mp_access_token
                .ok_or_else(|| AppError::BadRequest("Token Mercado Pago não configurado".into()))?;

            let (mp_id, qr_b64, copia) =
                create_mp_payment(token, amount, description, notification_url).await?;

            (Some(mp_id), Some(qr_b64), Some(copia))
        }
        "stripe" => {
            let token = mp_access_token
                .ok_or_else(|| AppError::BadRequest("Chave Stripe não configurada".into()))?;

            let (pi_id, qr_b64, copia) =
                create_stripe_pix_payment(token, amount, description).await?;

            (Some(pi_id), Some(qr_b64), Some(copia))
        }
        _ => {
            // Direct mode: generate BR Code locally
            if pix_key.is_empty() {
                return Err(AppError::BadRequest("Chave PIX não configurada".into()));
            }
            let txid = charge_id.to_string().replace('-', "")[..25].to_string();
            let pix_payload = generate_pix_payload(pix_key, amount, description, &txid);
            let qr_b64 = generate_qr_base64(&pix_payload)?;
            (None, Some(qr_b64), Some(pix_payload))
        }
    };

    let charge = PixCharge {
        user_id: *user_id,
        id: charge_id,
        assistant_id: *assistant_id,
        conversation_id: conversation_id.copied(),
        contact_phone: contact_phone.to_string(),
        amount,
        description: description.to_string(),
        pix_key: pix_key.to_string(),
        pix_key_type: pix_key_type.to_string(),
        mp_payment_id: mp_payment_id.clone(),
        mp_qr_code_base64: qr_base64,
        mp_copia_e_cola: copia_e_cola,
        status: "pending".to_string(),
        created_at: now,
        updated_at: now,
        expires_at: None,
        customer_name: customer_name.map(|s| s.to_string()),
        customer_cpf: customer_cpf.map(|s| s.to_string()),
        pix_mode: pix_mode.to_string(),
    };

    // Insert into main table (split into two queries to stay within 16-element tuple limit)
    db.query_unpaged(
        "INSERT INTO inertial_eclipse.pix_charges (user_id, id, assistant_id, conversation_id, contact_phone, amount, description, pix_key, pix_key_type, mp_payment_id, mp_qr_code_base64, mp_copia_e_cola, status, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (user_id, &charge_id, assistant_id, &conversation_id, &charge.contact_phone as &str, charge.amount, &charge.description as &str, &charge.pix_key as &str, &charge.pix_key_type as &str, &charge.mp_payment_id, &charge.mp_qr_code_base64, &charge.mp_copia_e_cola, "pending", now_ts, now_ts, &None::<CqlTimestamp>),
    ).await.map_err(|e| AppError::DatabaseError(format!("Failed to save pix charge: {e}")))?;

    // Set new fields via UPDATE
    db.query_unpaged(
        "UPDATE inertial_eclipse.pix_charges SET customer_name = ?, customer_cpf = ?, pix_mode = ? WHERE user_id = ? AND id = ?",
        (&charge.customer_name, &charge.customer_cpf, pix_mode, user_id, &charge_id),
    ).await.map_err(|e| AppError::DatabaseError(format!("Failed to update pix charge fields: {e}")))?;

    // Insert into by-assistant lookup
    db.query_unpaged(
        "INSERT INTO inertial_eclipse.pix_charges_by_assistant (assistant_id, created_at, id, user_id, amount, status, contact_phone, description, customer_name, customer_cpf, pix_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (assistant_id, now_ts, &charge_id, user_id, charge.amount, "pending", &charge.contact_phone as &str, &charge.description as &str, &charge.customer_name, &charge.customer_cpf, pix_mode),
    ).await.map_err(|e| AppError::DatabaseError(format!("Failed to save pix charge by assistant: {e}")))?;

    // For MP mode, save lookup by mp_payment_id for webhook resolution
    if let Some(ref mp_id) = charge.mp_payment_id {
        db.query_unpaged(
            "INSERT INTO inertial_eclipse.pix_charges_by_mp_id (mp_payment_id, user_id, charge_id, assistant_id) VALUES (?, ?, ?, ?)",
            (mp_id as &str, user_id, &charge_id, assistant_id),
        ).await.map_err(|e| AppError::DatabaseError(format!("Failed to save pix charge by mp_id: {e}")))?;
    }

    tracing::info!(charge_id = %charge_id, amount = %amount, pix_mode = %pix_mode, "PIX charge created");

    Ok(charge)
}

/// Spawn a background task that polls Mercado Pago for payment status every 10 seconds.
/// Stops when: payment is no longer pending, or 15 minutes have elapsed.
pub fn spawn_mp_payment_poller(
    db: DbSession,
    config: crate::config::Config,
    encryption: EncryptionService,
    event_bus: crate::services::events::EventBus,
    user_id: Uuid,
    charge_id: Uuid,
    assistant_id: Uuid,
    mp_payment_id: String,
) {
    tokio::spawn(async move {
        let max_attempts = 90; // 90 * 10s = 15 minutes
        for attempt in 0..max_attempts {
            tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;

            // Get user's MP token
            let token = match get_user_mp_token(&db, &encryption, &user_id).await {
                Ok(Some(t)) => t,
                _ => {
                    tracing::warn!(charge_id = %charge_id, "MP poller: no token, stopping");
                    return;
                }
            };

            // Check status with MP API
            let new_status = match fetch_mp_payment_status(&token, &mp_payment_id).await {
                Ok(s) => s,
                Err(e) => {
                    tracing::warn!(error = %e, attempt = attempt, "MP poller: failed to fetch status");
                    continue;
                }
            };

            if new_status == "pending" {
                continue;
            }

            // Status changed — update DB
            let charge_result = db.query_unpaged(
                "SELECT created_at FROM inertial_eclipse.pix_charges WHERE user_id = ? AND id = ?",
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
                tracing::error!(error = %e, "MP poller: failed to update status");
            }

            // Notify if approved
            if new_status == "approved" {
                if let Ok(charge) = check_charge_status(&db, &user_id, &charge_id, None).await {
                    notify_pix_payment_confirmed(&db, &encryption, &config, &charge).await;
                }
            }

            // Publish SSE event
            event_bus
                .publish(
                    &user_id,
                    crate::services::events::SseEvent {
                        event_type: "pix_status_changed".into(),
                        data: serde_json::json!({
                            "chargeId": charge_id.to_string(),
                            "assistantId": assistant_id.to_string(),
                            "status": new_status,
                        })
                        .to_string(),
                    },
                )
                .await;

            tracing::info!(charge_id = %charge_id, new_status = %new_status, attempt = attempt, "MP poller: status updated");
            return;
        }

        tracing::info!(charge_id = %charge_id, "MP poller: timed out after 15 minutes");
    });
}

/// Compact row for check_charge_status (excludes QR data to stay within 16-field tuple limit)
type ChargeStatusRow = (
    Uuid,           // user_id
    Uuid,           // id
    Uuid,           // assistant_id
    Option<Uuid>,   // conversation_id
    String,         // contact_phone
    f64,            // amount
    String,         // description
    String,         // pix_key
    String,         // pix_key_type
    Option<String>, // mp_payment_id
    String,         // status
    CqlTimestamp,   // created_at
    CqlTimestamp,   // updated_at
    Option<String>, // customer_name
    Option<String>, // customer_cpf
    Option<String>, // pix_mode
);

fn status_row_to_charge(r: ChargeStatusRow) -> PixCharge {
    PixCharge {
        user_id: r.0,
        id: r.1,
        assistant_id: r.2,
        conversation_id: r.3,
        contact_phone: r.4,
        amount: r.5,
        description: r.6,
        pix_key: r.7,
        pix_key_type: r.8,
        mp_payment_id: r.9,
        mp_qr_code_base64: None,
        mp_copia_e_cola: None,
        status: r.10,
        created_at: DateTime::from_timestamp_millis(r.11 .0).unwrap_or_default(),
        updated_at: DateTime::from_timestamp_millis(r.12 .0).unwrap_or_default(),
        expires_at: None,
        customer_name: r.13,
        customer_cpf: r.14,
        pix_mode: r.15.unwrap_or_else(|| "direct".to_string()),
    }
}

pub async fn check_charge_status(
    db: &DbSession,
    user_id: &Uuid,
    charge_id: &Uuid,
    conversation_id: Option<&Uuid>,
) -> Result<PixCharge, AppError> {
    let result = db.query_unpaged(
        "SELECT user_id, id, assistant_id, conversation_id, contact_phone, amount, description, pix_key, pix_key_type, mp_payment_id, status, created_at, updated_at, customer_name, customer_cpf, pix_mode FROM inertial_eclipse.pix_charges WHERE user_id = ? AND id = ?",
        (user_id, charge_id),
    ).await.map_err(|e| AppError::DatabaseError(format!("Failed to query pix charge: {e}")))?;

    let row = result
        .into_rows_result()
        .map_err(|_| AppError::NotFound("Cobrança não encontrada".into()))?
        .single_row::<ChargeStatusRow>()
        .map_err(|_| AppError::NotFound("Cobrança não encontrada".into()))?;

    let charge = status_row_to_charge(row);

    // Security filter: only allow access from the same conversation
    if let Some(cid) = conversation_id {
        if charge.conversation_id != Some(*cid) {
            return Err(AppError::NotFound("Cobrança não encontrada".into()));
        }
    }

    Ok(charge)
}

/// Like check_charge_status but actively polls Mercado Pago for pending MP charges.
/// Used by the AI agent's check_status action so it works even without webhooks (e.g. localhost).
pub async fn check_charge_status_live(
    db: &DbSession,
    encryption: &EncryptionService,
    config: &crate::config::Config,
    user_id: &Uuid,
    charge_id: &Uuid,
    conversation_id: Option<&Uuid>,
) -> Result<PixCharge, AppError> {
    let mut charge = check_charge_status(db, user_id, charge_id, conversation_id).await?;

    // For MP/Stripe charges that are still pending, actively check with provider API
    if charge.status == "pending" {
        if let Some(ref payment_id) = charge.mp_payment_id {
            let new_status_opt = match charge.pix_mode.as_str() {
                "mercadopago" => {
                    if let Ok(Some(token)) = get_user_mp_token(db, encryption, user_id).await {
                        fetch_mp_payment_status(&token, payment_id).await.ok()
                    } else {
                        None
                    }
                }
                "stripe" => {
                    if let Ok(Some(token)) = get_user_stripe_token(db, encryption, user_id).await {
                        fetch_stripe_payment_status(&token, payment_id).await.ok()
                    } else {
                        None
                    }
                }
                _ => None,
            };

            if let Some(new_status) = new_status_opt {
                if new_status != "pending" {
                    // Update in DB
                    let _ = update_charge_status(
                        db,
                        user_id,
                        charge_id,
                        &charge.assistant_id,
                        charge.created_at,
                        &new_status,
                    )
                    .await;

                    // Publish SSE event
                    crate::services::events::publish_global(
                        user_id,
                        crate::services::events::SseEvent {
                            event_type: "pix_status_changed".into(),
                            data: serde_json::json!({
                                "chargeId": charge_id.to_string(),
                                "assistantId": charge.assistant_id.to_string(),
                                "status": new_status,
                            })
                            .to_string(),
                        },
                    )
                    .await;

                    // Notify if approved
                    if new_status == "approved" {
                        charge.status = "approved".to_string();
                        notify_pix_payment_confirmed(db, encryption, config, &charge).await;
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
        "UPDATE inertial_eclipse.pix_charges SET status = ?, updated_at = ? WHERE user_id = ? AND id = ?",
        (new_status, now_ts, user_id, charge_id),
    ).await.map_err(|e| AppError::DatabaseError(format!("Failed to update charge status: {e}")))?;

    db.query_unpaged(
        "UPDATE inertial_eclipse.pix_charges_by_assistant SET status = ? WHERE assistant_id = ? AND created_at = ? AND id = ?",
        (new_status, assistant_id, created_ts, charge_id),
    ).await.map_err(|e| AppError::DatabaseError(format!("Failed to update charge by assistant: {e}")))?;

    Ok(())
}

/// Notify workspace members (in-app + email) and client (WhatsApp/Telegram)
/// that payment was confirmed. `charge.user_id` is the OWNING WORKSPACE id
/// (multi-tenancy is workspace-scoped — see project memory), so notifications
/// fan out to every member, gated by individual prefs.
pub async fn notify_pix_payment_confirmed(
    db: &DbSession,
    encryption: &crate::services::encryption::EncryptionService,
    config: &crate::config::Config,
    charge: &PixCharge,
) {
    let workspace_id = &charge.user_id;
    let assistant_id = &charge.assistant_id;

    // Get assistant name
    let assistant_name =
        match crate::services::assistant::get_assistant(db, workspace_id, assistant_id).await {
            Ok(a) => a.name,
            Err(_) => "Assistente".to_string(),
        };

    let customer_name = charge.customer_name.as_deref().unwrap_or("--");
    let customer_cpf = charge.customer_cpf.as_deref().unwrap_or("--");

    // 1. In-app notification — fan out to every workspace member
    let title = format!("Pagamento PIX Confirmado - R$ {:.2}", charge.amount);
    let message = format!(
        "Cliente: {} ({})\nDescricao: {}\nAssistente: {}",
        customer_name, charge.contact_phone, charge.description, assistant_name
    );
    if let Err(e) = crate::services::notification::notify_workspace_members(
        db,
        workspace_id,
        Some(assistant_id),
        None,
        "pix_payment_confirmed",
        &title,
        &message,
    )
    .await
    {
        tracing::error!(error = %e, "Failed to fan out PIX payment notification");
    }

    // 2. Email to each member, gated by per-user email-notification preference
    let members = crate::services::workspace::list_members(db, workspace_id)
        .await
        .unwrap_or_default();
    for member in members {
        if let Ok(user) = crate::services::auth::get_user_by_id(db, &member.user_id).await {
            if !user.notify_email || user.email.is_empty() {
                continue;
            }
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
                tracing::error!(error = %e, recipient = %user.email, "Failed to send PIX payment email");
            }
        }
    }

    // 3. Send confirmation to client via messaging provider
    if let Some(conversation_id) = &charge.conversation_id {
        // Find the conversation to get the channel
        let conv_result = db.query_unpaged(
            "SELECT channel FROM inertial_eclipse.conversations WHERE assistant_id = ? AND user_id = ? AND id = ?",
            (assistant_id, workspace_id, conversation_id),
        ).await;

        let channel = conv_result
            .ok()
            .and_then(|r| r.into_rows_result().ok())
            .and_then(|r| r.maybe_first_row::<(String,)>().ok().flatten())
            .map(|r| r.0)
            .unwrap_or_default();

        if !channel.is_empty() {
            // Find integration for this channel
            let integrations =
                crate::services::assistant::list_integrations(db, encryption, assistant_id, workspace_id)
                    .await
                    .unwrap_or_default();
            if let Some(integration) = integrations.into_iter().find(|i| i.channel == channel) {
                let confirm_msg = format!(
                    "Pagamento confirmado! ✅\n\nValor: R$ {:.2}\nDescricao: {}\n\nObrigado, {}!",
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
                    tracing::error!(error = %e, "Failed to send PIX confirmation to client");
                }
            }
        }
    }
}

pub async fn process_webhook(
    db: &DbSession,
    config: &crate::config::Config,
    encryption: &EncryptionService,
    event_bus: &crate::services::events::EventBus,
    mp_payment_id: &str,
) -> Result<(), AppError> {
    // Look up which charge this payment belongs to
    let result = db.query_unpaged(
        "SELECT mp_payment_id, user_id, charge_id, assistant_id FROM inertial_eclipse.pix_charges_by_mp_id WHERE mp_payment_id = ?",
        (mp_payment_id,),
    ).await.map_err(|e| AppError::DatabaseError(format!("Failed to lookup charge by mp_id: {e}")))?;

    let row = result
        .into_rows_result()
        .map_err(|_| {
            AppError::NotFound(format!(
                "Charge not found for mp_payment_id: {mp_payment_id}"
            ))
        })?
        .single_row::<(String, Uuid, Uuid, Uuid)>()
        .map_err(|_| {
            AppError::NotFound(format!(
                "Charge not found for mp_payment_id: {mp_payment_id}"
            ))
        })?;

    let user_id = row.1;
    let charge_id = row.2;
    let assistant_id = row.3;

    // Decrypt user's MP token to verify payment status
    let token = get_user_mp_token(db, encryption, &user_id)
        .await?
        .ok_or_else(|| AppError::InternalError("User MP token not found for webhook".into()))?;

    let new_status = fetch_mp_payment_status(&token, mp_payment_id).await?;

    let charge_result = db
        .query_unpaged(
            "SELECT created_at FROM inertial_eclipse.pix_charges WHERE user_id = ? AND id = ?",
            (&user_id, &charge_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(format!("Failed to get charge: {e}")))?;

    let created_at_ts = charge_result
        .into_rows_result()
        .ok()
        .and_then(|r| r.single_row::<(CqlTimestamp,)>().ok())
        .map(|r| r.0)
        .unwrap_or(CqlTimestamp(0));

    let created_at = DateTime::from_timestamp_millis(created_at_ts.0).unwrap_or_default();
    update_charge_status(
        db,
        &user_id,
        &charge_id,
        &assistant_id,
        created_at,
        &new_status,
    )
    .await?;

    // Notify user and client when payment is approved
    if new_status == "approved" {
        if let Ok(charge) = check_charge_status(db, &user_id, &charge_id, None).await {
            notify_pix_payment_confirmed(db, encryption, config, &charge).await;
        }
    }

    // Publish SSE event
    event_bus
        .publish(
            &user_id,
            crate::services::events::SseEvent {
                event_type: "pix_status_changed".into(),
                data: serde_json::json!({
                    "chargeId": charge_id.to_string(),
                    "assistantId": assistant_id.to_string(),
                    "status": new_status,
                })
                .to_string(),
            },
        )
        .await;

    tracing::info!(mp_payment_id = %mp_payment_id, new_status = %new_status, charge_id = %charge_id, "PIX webhook processed");
    Ok(())
}

// ─── Financial Dashboard Queries ─────────────────────────────────────────────

type ChargeSummaryRow = (
    Uuid,           // id
    f64,            // amount
    String,         // status
    String,         // description
    String,         // contact_phone
    CqlTimestamp,   // created_at
    Option<String>, // customer_name
    Option<String>, // customer_cpf
    Option<String>, // pix_mode
);

pub async fn list_charges_by_assistant(
    db: &DbSession,
    assistant_id: &Uuid,
    limit: i32,
) -> Result<Vec<PixChargeSummary>, AppError> {
    let query = format!(
        "SELECT id, amount, status, description, contact_phone, created_at, customer_name, customer_cpf, pix_mode FROM inertial_eclipse.pix_charges_by_assistant WHERE assistant_id = ? LIMIT {}",
        limit
    );
    let result = db
        .query_unpaged(query, (assistant_id,))
        .await
        .map_err(|e| AppError::DatabaseError(format!("Failed to list charges: {e}")))?;

    let rows = result.into_rows_result()?;

    let mut charges = Vec::new();
    for row in rows.rows::<ChargeSummaryRow>()? {
        let r = row.map_err(|e| AppError::DatabaseError(e.to_string()))?;
        charges.push(PixChargeSummary {
            id: r.0,
            amount: r.1,
            status: r.2,
            description: r.3,
            contact_phone: r.4,
            created_at: DateTime::from_timestamp_millis(r.5 .0).unwrap_or_default(),
            customer_name: r.6,
            customer_cpf: r.7,
            pix_mode: r.8,
        });
    }

    Ok(charges)
}

pub async fn get_assistant_financial_summary(
    db: &DbSession,
    assistant_id: &Uuid,
) -> Result<FinancialSummary, AppError> {
    let charges = list_charges_by_assistant(db, assistant_id, 10000).await?;

    let total_charges = charges.len() as i64;
    let paid_count = charges.iter().filter(|c| c.status == "approved").count() as i64;
    let pending_count = charges.iter().filter(|c| c.status == "pending").count() as i64;
    let unpaid_count = charges
        .iter()
        .filter(|c| c.status != "approved" && c.status != "pending")
        .count() as i64;
    let total_revenue: f64 = charges
        .iter()
        .filter(|c| c.status == "approved")
        .map(|c| c.amount)
        .sum();

    Ok(FinancialSummary {
        total_revenue,
        total_charges,
        paid_count,
        unpaid_count,
        pending_count,
    })
}

pub async fn get_user_financial_overview(
    db: &DbSession,
    user_id: &Uuid,
) -> Result<Vec<(Uuid, FinancialSummary)>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT id FROM inertial_eclipse.assistants WHERE user_id = ?",
            (user_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(format!("Failed to list assistants: {e}")))?;

    let rows = result.into_rows_result()?;

    let mut overviews = Vec::new();
    for row in rows.rows::<(Uuid,)>()? {
        if let Ok(r) = row {
            let summary = get_assistant_financial_summary(db, &r.0).await?;
            if summary.total_charges > 0 {
                overviews.push((r.0, summary));
            }
        }
    }

    Ok(overviews)
}
