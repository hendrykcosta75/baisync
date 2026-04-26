use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub name: String,
    pub two_factor_enabled: bool,
    pub two_factor_secret: Option<String>,
    pub two_factor_secret_expires_at: Option<DateTime<Utc>>,
    pub api_key_openai: Option<String>,
    pub api_key_claude: Option<String>,
    pub api_key_gemini: Option<String>,
    pub api_key_elevenlabs: Option<String>,
    pub api_key_mercadopago: Option<String>,
    pub api_key_stripe: Option<String>,
    #[serde(default)]
    pub blocked: Option<bool>,
    #[serde(default = "default_true")]
    pub notify_email: bool,
    #[serde(default = "default_true")]
    pub notify_system: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user: UserPublic,
}

#[derive(Debug, Serialize)]
pub struct UserPublic {
    pub id: Uuid,
    pub email: String,
    pub name: String,
    pub two_factor_enabled: bool,
    pub has_avatar: bool,
    pub notify_email: bool,
    pub notify_system: bool,
    pub created_at: DateTime<Utc>,
}

impl From<User> for UserPublic {
    fn from(u: User) -> Self {
        Self {
            id: u.id,
            email: u.email,
            name: u.name,
            two_factor_enabled: u.two_factor_enabled,
            has_avatar: false,
            notify_email: u.notify_email,
            notify_system: u.notify_system,
            created_at: u.created_at,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct UpdateNotificationPrefsRequest {
    pub notify_email: Option<bool>,
    pub notify_system: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct ForgotPasswordRequest {
    pub email: String,
}

#[derive(Debug, Deserialize)]
pub struct ResetPasswordRequest {
    pub token: String,
    pub new_password: String,
}

#[derive(Debug, Deserialize)]
pub struct Verify2FARequest {
    pub code: String,
}

#[allow(dead_code)]
#[derive(Debug, Serialize)]
pub struct Enable2FAResponse {
    pub secret: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProfileRequest {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

#[derive(Debug, Deserialize)]
pub struct DeleteAccountRequest {
    pub password: String,
}

impl RegisterRequest {
    #[cfg(test)]
    pub fn validate(&self) -> Result<(), String> {
        if self.email.is_empty() || !self.email.contains('@') {
            return Err("Invalid email".into());
        }
        if self.password.len() < 8 {
            return Err("Password must be at least 8 characters".into());
        }
        if self.name.trim().is_empty() {
            return Err("Name cannot be empty".into());
        }
        Ok(())
    }
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize)]
pub struct ApiKeysRequest {
    pub openai: Option<String>,
    pub claude: Option<String>,
    pub gemini: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize)]
pub struct ApiKeysResponse {
    pub openai_configured: bool,
    pub claude_configured: bool,
    pub gemini_configured: bool,
    pub elevenlabs_configured: bool,
    pub mercadopago_configured: bool,
    pub stripe_configured: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn make_test_user() -> User {
        User {
            id: Uuid::new_v4(),
            email: "test@example.com".into(),
            password_hash: "$argon2hash".into(),
            name: "Test User".into(),
            two_factor_enabled: false,
            two_factor_secret: None,
            two_factor_secret_expires_at: None,
            api_key_openai: Some("sk-123".into()),
            api_key_claude: None,
            api_key_gemini: None,
            api_key_elevenlabs: None,
            api_key_mercadopago: None,
            api_key_stripe: None,
            blocked: None,
            notify_email: true,
            notify_system: true,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    // ─── UserPublic conversion ───

    #[test]
    fn user_public_from_user_copies_fields() {
        let user = make_test_user();
        let user_id = user.id;
        let public: UserPublic = user.into();
        assert_eq!(public.id, user_id);
        assert_eq!(public.email, "test@example.com");
        assert_eq!(public.name, "Test User");
        assert!(!public.two_factor_enabled);
    }

    // ─── Serialization: password_hash excluded ───

    #[test]
    fn user_serialization_excludes_password_hash() {
        let user = make_test_user();
        let json = serde_json::to_value(&user).unwrap();
        assert!(json.get("password_hash").is_none());
        assert!(json.get("email").is_some());
    }

    // ─── RegisterRequest validation ───

    #[test]
    fn valid_register_request() {
        let req = RegisterRequest {
            email: "user@test.com".into(),
            password: "StrongP@ss1".into(),
            name: "John".into(),
        };
        assert!(req.validate().is_ok());
    }

    #[test]
    fn register_empty_email_rejected() {
        let req = RegisterRequest {
            email: "".into(),
            password: "StrongP@ss1".into(),
            name: "John".into(),
        };
        assert!(req.validate().is_err());
    }

    #[test]
    fn register_email_without_at_rejected() {
        let req = RegisterRequest {
            email: "notanemail".into(),
            password: "StrongP@ss1".into(),
            name: "John".into(),
        };
        assert!(req.validate().is_err());
    }

    #[test]
    fn register_short_password_rejected() {
        let req = RegisterRequest {
            email: "user@test.com".into(),
            password: "short".into(),
            name: "John".into(),
        };
        assert!(req.validate().is_err());
    }

    #[test]
    fn register_empty_name_rejected() {
        let req = RegisterRequest {
            email: "user@test.com".into(),
            password: "StrongP@ss1".into(),
            name: "   ".into(),
        };
        assert!(req.validate().is_err());
    }

    // ─── Deserialization ───

    #[test]
    fn login_request_deserializes() {
        let json = r#"{"email":"a@b.com","password":"pass123"}"#;
        let req: LoginRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.email, "a@b.com");
        assert_eq!(req.password, "pass123");
    }

    #[test]
    fn forgot_password_request_deserializes() {
        let json = r#"{"email":"forgot@test.com"}"#;
        let req: ForgotPasswordRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.email, "forgot@test.com");
    }

    #[test]
    fn api_keys_response_serializes() {
        let resp = ApiKeysResponse {
            openai_configured: true,
            claude_configured: false,
            gemini_configured: false,
            elevenlabs_configured: false,
            mercadopago_configured: true,
            stripe_configured: false,
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["openai_configured"], true);
        assert_eq!(json["mercadopago_configured"], true);
        assert_eq!(json["claude_configured"], false);
    }
}
