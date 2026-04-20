use axum::{Extension, Json};
use serde_json::{json, Value};

use crate::config::Config;
use crate::db::DbSession;
use crate::services::encryption::EncryptionService;
use crate::services::webhook_dedup;

pub async fn webhook_mercadopago(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(encryption): Extension<EncryptionService>,
    Extension(event_bus): Extension<crate::services::events::EventBus>,
    Json(payload): Json<Value>,
) -> Json<Value> {
    tracing::info!(payload = %payload, "Mercado Pago webhook received");

    // Extract payment ID (can be string or number)
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
        tracing::warn!("Mercado Pago webhook: no payment ID found");
        return Json(json!({"status": "ok"}));
    }

    // I2 — shadow dedup. Combine `type` + `data.id` to uniquely identify the event.
    let mp_type = payload
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let event_id = format!("{mp_type}:{mp_id}");
    match webhook_dedup::check_and_mark(&db, "mercadopago_pix", &event_id).await {
        Ok(webhook_dedup::DedupResult::Applied) => {}
        Ok(webhook_dedup::DedupResult::Duplicate) => {
            // Only reached in Mode::Block (T1.4).
            return Json(json!({"status": "ok"}));
        }
        Err(e) => {
            tracing::warn!(error = %e, "dedup check failed, continuing");
        }
    }

    if let Err(e) =
        crate::services::pix::process_webhook(&db, &config, &encryption, &event_bus, &mp_id).await
    {
        tracing::error!(error = %e, mp_payment_id = %mp_id, "Failed to process Mercado Pago webhook");
    }

    Json(json!({"status": "ok"}))
}
