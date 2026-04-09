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
    pub api_key_openai: Option<String>,
    pub api_key_claude: Option<String>,
    pub api_key_gemini: Option<String>,
    pub api_key_elevenlabs: Option<String>,
    pub api_key_mercadopago: Option<String>,
    pub api_key_stripe: Option<String>,
    #[serde(default)]
    pub blocked: Option<bool>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
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
    pub created_at: DateTime<Utc>,
}

impl From<User> for UserPublic {
    fn from(u: User) -> Self {
        Self {
            id: u.id,
            email: u.email,
            name: u.name,
            two_factor_enabled: u.two_factor_enabled,
            created_at: u.created_at,
        }
    }
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

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiKeysRequest {
    pub openai: Option<String>,
    pub claude: Option<String>,
    pub gemini: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ApiKeysResponse {
    pub openai_configured: bool,
    pub claude_configured: bool,
    pub gemini_configured: bool,
    pub elevenlabs_configured: bool,
    pub mercadopago_configured: bool,
    pub stripe_configured: bool,
}
