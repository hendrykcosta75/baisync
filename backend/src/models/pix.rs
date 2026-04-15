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

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantFinancialOverview {
    pub assistant_id: Uuid,
    pub assistant_name: String,
    pub summary: FinancialSummary,
}

#[allow(dead_code)]
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
                return Err(
                    "Telefone deve ter entre 10 e 14 dígitos (com DDD e código do país)".into(),
                );
            }
        }
        "random" => {
            // Chave aleatória EVP é um UUID v4 (36 chars com hyphens, 32 sem)
            let clean: String = key
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
                .collect();
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

#[cfg(test)]
mod tests {
    use super::*;

    // ─── CPF ───

    #[test]
    fn valid_cpf_key() {
        assert!(validate_pix_key("123.456.789-00", "cpf").is_ok());
    }

    #[test]
    fn valid_cpf_digits_only() {
        assert!(validate_pix_key("12345678900", "cpf").is_ok());
    }

    #[test]
    fn cpf_wrong_length() {
        assert!(validate_pix_key("1234567890", "cpf").is_err());
        assert!(validate_pix_key("123456789001", "cpf").is_err());
    }

    // ─── CNPJ ───

    #[test]
    fn valid_cnpj_key() {
        assert!(validate_pix_key("12.345.678/0001-90", "cnpj").is_ok());
    }

    #[test]
    fn cnpj_wrong_length() {
        assert!(validate_pix_key("1234567890123", "cnpj").is_err());
    }

    // ─── Email ───

    #[test]
    fn valid_email_key() {
        assert!(validate_pix_key("user@example.com", "email").is_ok());
    }

    #[test]
    fn email_missing_at() {
        assert!(validate_pix_key("userexample.com", "email").is_err());
    }

    #[test]
    fn email_missing_dot() {
        assert!(validate_pix_key("user@examplecom", "email").is_err());
    }

    // ─── Phone ───

    #[test]
    fn valid_phone_key() {
        assert!(validate_pix_key("+5511999999999", "phone").is_ok());
    }

    #[test]
    fn phone_too_short() {
        assert!(validate_pix_key("123456789", "phone").is_err());
    }

    #[test]
    fn phone_too_long() {
        assert!(validate_pix_key("123456789012345", "phone").is_err());
    }

    // ─── Random (EVP) ───

    #[test]
    fn valid_random_key() {
        assert!(validate_pix_key("a1b2c3d4-e5f6-7890-abcd-ef1234567890", "random").is_ok());
    }

    #[test]
    fn random_key_too_short() {
        assert!(validate_pix_key("short", "random").is_err());
    }

    // ─── Invalid type ───

    #[test]
    fn invalid_key_type() {
        assert!(validate_pix_key("anything", "invalid_type").is_err());
    }

    // ─── Empty key ───

    #[test]
    fn empty_key_rejected() {
        assert!(validate_pix_key("", "cpf").is_err());
        assert!(validate_pix_key("   ", "cpf").is_err());
    }

    // ─── Serialization ───

    #[test]
    fn financial_summary_serializes_correctly() {
        let summary = FinancialSummary {
            total_revenue: 1500.50,
            total_charges: 10,
            paid_count: 7,
            unpaid_count: 2,
            pending_count: 1,
        };
        let json = serde_json::to_value(&summary).unwrap();
        assert_eq!(json["total_revenue"], 1500.50);
        assert_eq!(json["paid_count"], 7);
    }
}
