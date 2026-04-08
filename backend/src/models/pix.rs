use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PixCharge {
    pub user_id: Uuid,
    pub id: Uuid,
    pub assistant_id: Uuid,
    pub conversation_id: Option<Uuid>,
    pub contact_phone: String,
    pub amount: f64,
    pub description: String,
    pub pix_key: String,
    pub pix_key_type: String,
    pub mp_payment_id: Option<String>,
    pub mp_qr_code_base64: Option<String>,
    pub mp_copia_e_cola: Option<String>,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub customer_name: Option<String>,
    pub customer_cpf: Option<String>,
    pub pix_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PixChargeSummary {
    pub id: Uuid,
    pub amount: f64,
    pub status: String,
    pub description: String,
    pub contact_phone: String,
    pub created_at: DateTime<Utc>,
    pub customer_name: Option<String>,
    pub customer_cpf: Option<String>,
    pub pix_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinancialSummary {
    pub total_revenue: f64,
    pub total_charges: i64,
    pub paid_count: i64,
    pub unpaid_count: i64,
    pub pending_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantFinancialOverview {
    pub assistant_id: Uuid,
    pub assistant_name: String,
    pub summary: FinancialSummary,
}

pub fn validate_pix_key(key: &str, key_type: &str) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("Chave PIX não pode ser vazia".into());
    }

    match key_type {
        "cpf" => {
            let digits: String = key.chars().filter(|c| c.is_ascii_digit()).collect();
            if digits.len() != 11 {
                return Err("CPF deve ter 11 dígitos".into());
            }
        }
        "cnpj" => {
            let digits: String = key.chars().filter(|c| c.is_ascii_digit()).collect();
            if digits.len() != 14 {
                return Err("CNPJ deve ter 14 dígitos".into());
            }
        }
        "email" => {
            if !key.contains('@') || !key.contains('.') {
                return Err("Email inválido".into());
            }
        }
        "phone" => {
            let clean: String = key.chars().filter(|c| c.is_ascii_digit()).collect();
            if clean.len() < 10 || clean.len() > 14 {
                return Err("Telefone deve ter entre 10 e 14 dígitos (com DDD e código do país)".into());
            }
        }
        "random" => {
            // Chave aleatória EVP é um UUID v4 (36 chars com hyphens, 32 sem)
            let clean: String = key.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
            if clean.len() < 32 {
                return Err("Chave aleatória deve ter pelo menos 32 caracteres".into());
            }
        }
        _ => {
            return Err(format!("Tipo de chave PIX inválido: {}", key_type));
        }
    }

    Ok(())
}
