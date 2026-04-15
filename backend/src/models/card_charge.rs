use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardCharge {
    pub user_id: Uuid,
    pub id: Uuid,
    pub assistant_id: Uuid,
    pub conversation_id: Option<Uuid>,
    pub contact_phone: String,
    pub amount: f64,
    pub description: String,
    pub card_mode: String,
    pub provider_session_id: Option<String>,
    pub checkout_url: Option<String>,
    pub status: String,
    pub customer_name: Option<String>,
    pub customer_cpf: Option<String>,
    pub payment_type: String, // "credit" or "debit"
    pub installments: i32,    // 1 for debit, 1-12 for credit
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardChargeSummary {
    pub id: Uuid,
    pub amount: f64,
    pub status: String,
    pub description: String,
    pub contact_phone: String,
    pub created_at: DateTime<Utc>,
    pub customer_name: Option<String>,
    pub customer_cpf: Option<String>,
    pub card_mode: Option<String>,
}
