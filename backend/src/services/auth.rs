use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::{DateTime, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use scylla::frame::value::CqlTimestamp;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use subtle::ConstantTimeEq;
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::models::user::{AuthResponse, User, UserPublic};

/// In-memory rate limiter for 2FA verification attempts. Keyed by user_id,
/// value is (attempt_count, window_start). Limit: 5 attempts per 15 minutes.
/// Resets across process restarts — acceptable for anti-bruteforce.
static VERIFY_2FA_ATTEMPTS: LazyLock<Mutex<HashMap<Uuid, (u32, DateTime<Utc>)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

const VERIFY_2FA_MAX_ATTEMPTS: u32 = 5;
const VERIFY_2FA_WINDOW_MIN: i64 = 15;

fn check_2fa_rate_limit(user_id: &Uuid) -> Result<(), AppError> {
    let mut map = VERIFY_2FA_ATTEMPTS.lock().unwrap_or_else(|p| p.into_inner());
    let now = Utc::now();
    let entry = map.entry(*user_id).or_insert((0, now));
    if now.signed_duration_since(entry.1).num_minutes() >= VERIFY_2FA_WINDOW_MIN {
        *entry = (0, now);
    }
    if entry.0 >= VERIFY_2FA_MAX_ATTEMPTS {
        return Err(AppError::RateLimitExceeded);
    }
    entry.0 += 1;
    Ok(())
}

fn hash_reset_token(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String,
    pub email: String,
    pub exp: usize,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub workspace_id: Option<String>,
}

pub fn hash_password(password: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    argon2
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| AppError::InternalError(format!("Failed to hash password: {e}")))
}

pub fn verify_password(password: &str, hash: &str) -> Result<bool, AppError> {
    let parsed_hash = PasswordHash::new(hash)
        .map_err(|e| AppError::InternalError(format!("Invalid password hash: {e}")))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok())
}

pub fn create_jwt(user_id: &Uuid, email: &str, secret: &str) -> Result<String, AppError> {
    // Default: workspace_id = user_id (personal workspace)
    create_jwt_with_workspace(user_id, email, user_id, secret)
}

pub fn create_jwt_with_workspace(
    user_id: &Uuid,
    email: &str,
    workspace_id: &Uuid,
    secret: &str,
) -> Result<String, AppError> {
    let expiration = Utc::now()
        .checked_add_signed(chrono::Duration::hours(24))
        .expect("valid timestamp")
        .timestamp() as usize;

    let claims = Claims {
        sub: user_id.to_string(),
        email: email.to_string(),
        exp: expiration,
        role: None,
        workspace_id: Some(workspace_id.to_string()),
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| AppError::InternalError(format!("Failed to create JWT: {e}")))
}

pub fn decode_jwt(token: &str, secret: &str) -> Result<Claims, AppError> {
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map(|data| data.claims)
    .map_err(|e| {
        tracing::debug!("JWT decode error: {e}");
        AppError::Unauthorized("Invalid token".into())
    })
}

pub fn create_admin_jwt(secret: &str) -> Result<String, AppError> {
    let expiration = Utc::now()
        .checked_add_signed(chrono::Duration::hours(8))
        .expect("valid timestamp")
        .timestamp() as usize;

    let claims = Claims {
        sub: Uuid::nil().to_string(),
        email: "admin".to_string(),
        exp: expiration,
        role: Some("admin".to_string()),
        workspace_id: None,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| AppError::InternalError(format!("Failed to create admin JWT: {e}")))
}

fn ts_now() -> CqlTimestamp {
    CqlTimestamp(Utc::now().timestamp_millis())
}

fn ts_to_dt(ts: DateTime<Utc>) -> DateTime<Utc> {
    ts
}

pub async fn register_user(
    db: &DbSession,
    email: &str,
    password: &str,
    name: &str,
    jwt_secret: &str,
) -> Result<AuthResponse, AppError> {
    // Check if user exists
    let existing = db
        .query_unpaged(
            "SELECT id FROM inertial_eclipse.users WHERE email = ?",
            (email,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    if existing
        .into_rows_result()?
        .maybe_first_row::<(Uuid,)>()?
        .is_some()
    {
        return Err(AppError::BadRequest("Email already registered".into()));
    }

    let id = Uuid::new_v4();
    let password_hash = hash_password(password)?;
    let now = ts_now();

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.users (id, email, password_hash, name, two_factor_enabled, active_workspace_id, created_at, updated_at) VALUES (?, ?, ?, ?, false, ?, ?, ?)",
        (id, email, &password_hash as &str, name, id, now, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Create personal workspace (workspace_id = user_id)
    crate::services::workspace::ensure_personal_workspace(db, &id, name).await?;

    let token = create_jwt(&id, email, jwt_secret)?;
    Ok(AuthResponse {
        token,
        user: UserPublic {
            id,
            email: email.to_string(),
            name: name.to_string(),
            two_factor_enabled: false,
            has_avatar: false,
            created_at: Utc::now(),
        },
    })
}

pub async fn login_user(
    db: &DbSession,
    email: &str,
    password: &str,
    jwt_secret: &str,
) -> Result<AuthResponse, AppError> {
    let result = db
        .query_unpaged(
            "SELECT id, email, password_hash, name, two_factor_enabled, blocked, created_at FROM inertial_eclipse.users WHERE email = ?",
            (email,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let (id, email, password_hash, name, two_factor_enabled, blocked, created_at) = result
        .into_rows_result()?
        .single_row::<(
            Uuid,
            String,
            String,
            String,
            Option<bool>,
            Option<bool>,
            DateTime<Utc>,
        )>()
        .map_err(|_| AppError::Unauthorized("Invalid email or password".into()))?;

    if blocked.unwrap_or(false) {
        return Err(AppError::Unauthorized("Conta bloqueada".into()));
    }

    if !verify_password(password, &password_hash)? {
        return Err(AppError::Unauthorized("Invalid email or password".into()));
    }

    // Ensure personal workspace exists (migration safety)
    let _ = crate::services::workspace::ensure_personal_workspace(db, &id, &name).await;

    // Get active workspace_id (defaults to user_id)
    let active_ws = crate::services::workspace::get_active_workspace_id(db, &id)
        .await
        .unwrap_or(id);

    let token = create_jwt_with_workspace(&id, &email, &active_ws, jwt_secret)?;
    Ok(AuthResponse {
        token,
        user: UserPublic {
            id,
            email,
            name,
            two_factor_enabled: two_factor_enabled.unwrap_or(false),
            has_avatar: has_avatar(db, &id).await,
            created_at: ts_to_dt(created_at),
        },
    })
}

pub async fn get_user_by_id(db: &DbSession, user_id: &Uuid) -> Result<User, AppError> {
    let result = db
        .query_unpaged(
            "SELECT id, email, password_hash, name, two_factor_enabled, two_factor_secret, two_factor_secret_expires_at, api_key_openai, api_key_claude, api_key_gemini, api_key_elevenlabs, api_key_mercadopago, api_key_stripe, blocked, created_at, updated_at FROM inertial_eclipse.users WHERE id = ?",
            (user_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let (
        id,
        email,
        password_hash,
        name,
        two_factor_enabled,
        two_factor_secret,
        two_factor_secret_expires_at,
        api_key_openai,
        api_key_claude,
        api_key_gemini,
        api_key_elevenlabs,
        api_key_mercadopago,
        api_key_stripe,
        blocked,
        created_at,
        updated_at,
    ) = result
        .into_rows_result()?
        .single_row::<(
            Uuid,
            String,
            String,
            String,
            Option<bool>,
            Option<String>,
            Option<DateTime<Utc>>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<bool>,
            DateTime<Utc>,
            DateTime<Utc>,
        )>()
        .map_err(|_| AppError::NotFound("User not found".into()))?;

    Ok(User {
        id,
        email,
        password_hash,
        name,
        two_factor_enabled: two_factor_enabled.unwrap_or(false),
        two_factor_secret,
        two_factor_secret_expires_at,
        api_key_openai,
        api_key_claude,
        api_key_gemini,
        api_key_elevenlabs,
        api_key_mercadopago,
        api_key_stripe,
        blocked,
        created_at,
        updated_at,
    })
}

pub fn generate_2fa_code() -> String {
    use rand::Rng;
    let mut rng = rand::rng();
    format!("{:06}", rng.random_range(0..1_000_000))
}

pub async fn enable_2fa(db: &DbSession, user_id: &Uuid) -> Result<String, AppError> {
    let code = generate_2fa_code();
    let now = Utc::now();
    let expires_at = CqlTimestamp(
        (now + chrono::Duration::minutes(10)).timestamp_millis(),
    );

    db.query_unpaged(
        "UPDATE inertial_eclipse.users SET two_factor_secret = ?, two_factor_secret_expires_at = ? WHERE id = ?",
        (&code as &str, expires_at, user_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(code)
}

pub async fn verify_2fa(db: &DbSession, user_id: &Uuid, code: &str) -> Result<(), AppError> {
    check_2fa_rate_limit(user_id)?;

    let user = get_user_by_id(db, user_id).await?;
    let secret = user
        .two_factor_secret
        .ok_or_else(|| AppError::BadRequest("2FA not enabled".into()))?;
    let expires_at = user
        .two_factor_secret_expires_at
        .ok_or_else(|| AppError::BadRequest("2FA code expired".into()))?;
    if Utc::now() > expires_at {
        return Err(AppError::BadRequest("2FA code expired".into()));
    }

    // Constant-time comparison to avoid timing side-channel. ct_eq on
    // slices of different lengths returns 0, so length mismatch is safe.
    if secret
        .as_bytes()
        .ct_eq(code.as_bytes())
        .unwrap_u8()
        != 1
    {
        return Err(AppError::Unauthorized("Invalid 2FA code".into()));
    }

    db.query_unpaged(
        "UPDATE inertial_eclipse.users SET two_factor_enabled = true WHERE id = ?",
        (user_id,),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

pub async fn update_profile(
    db: &DbSession,
    user_id: &Uuid,
    name: &str,
) -> Result<UserPublic, AppError> {
    let now = ts_now();

    db.query_unpaged(
        "UPDATE inertial_eclipse.users SET name = ?, updated_at = ? WHERE id = ?",
        (name, now, user_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    get_user_public_with_avatar(db, user_id).await
}

pub async fn change_password(
    db: &DbSession,
    user_id: &Uuid,
    current_password: &str,
    new_password: &str,
) -> Result<(), AppError> {
    let user = get_user_by_id(db, user_id).await?;

    if !verify_password(current_password, &user.password_hash)? {
        return Err(AppError::Unauthorized("Senha atual incorreta".into()));
    }

    let new_hash = hash_password(new_password)?;
    let now = ts_now();

    db.query_unpaged(
        "UPDATE inertial_eclipse.users SET password_hash = ?, updated_at = ? WHERE id = ?",
        (&new_hash as &str, now, user_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

pub async fn delete_account(
    db: &DbSession,
    user_id: &Uuid,
    password: &str,
) -> Result<(), AppError> {
    let user = get_user_by_id(db, user_id).await?;

    if !verify_password(password, &user.password_hash)? {
        return Err(AppError::Unauthorized("Senha incorreta".into()));
    }

    // Delete user's assistants first
    let assistants = db
        .query_unpaged(
            "SELECT id FROM inertial_eclipse.assistants WHERE user_id = ?",
            (user_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    if let Ok(rows) = assistants.into_rows_result() {
        for row in rows.rows::<(Uuid,)>().into_iter().flatten().flatten() {
            let assistant_id = row.0;
            // Delete related data
            let _ = db
                .query_unpaged(
                    "DELETE FROM inertial_eclipse.assistant_tools WHERE assistant_id = ?",
                    (&assistant_id,),
                )
                .await;
            let _ = db
                .query_unpaged(
                    "DELETE FROM inertial_eclipse.assistant_files WHERE assistant_id = ?",
                    (&assistant_id,),
                )
                .await;
            let _ = db
                .query_unpaged(
                    "DELETE FROM inertial_eclipse.integrations WHERE assistant_id = ?",
                    (&assistant_id,),
                )
                .await;
            // allow-filter: user-cascade delete — missing user_id here is
            // acceptable because we iterate all of THIS user's assistants above
            // and the assistant_id is already tenant-scoped.
            let _ = db
                .query_unpaged(
                    "DELETE FROM inertial_eclipse.conversations WHERE assistant_id = ?",
                    (&assistant_id,),
                )
                .await;
        }
        let _ = db
            .query_unpaged(
                "DELETE FROM inertial_eclipse.assistants WHERE user_id = ?",
                (user_id,),
            )
            .await;
    }

    // Delete user
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.users WHERE id = ?",
        (user_id,),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

pub fn generate_reset_token() -> String {
    use rand::Rng;
    let mut rng = rand::rng();
    let bytes: Vec<u8> = (0..32).map(|_| rng.random()).collect();
    base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, &bytes)
}

pub async fn save_reset_token(db: &DbSession, user_id: &Uuid, token: &str) -> Result<(), AppError> {
    // Store only SHA-256(token); the raw token is sent in the reset email and never persisted.
    let token_hash = hash_reset_token(token);
    let now = Utc::now();
    let now_cql = CqlTimestamp(now.timestamp_millis());
    let expires_cql = CqlTimestamp(
        (now + chrono::Duration::minutes(30)).timestamp_millis(),
    );

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.password_reset_tokens (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
        (&token_hash as &str, user_id, expires_cql, now_cql),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

pub async fn reset_password(
    db: &DbSession,
    token: &str,
    new_password: &str,
) -> Result<(), AppError> {
    let token_hash = hash_reset_token(token);

    // Lookup by token_hash is a PK read — no ALLOW FILTERING.
    let result = db
        .query_unpaged(
            "SELECT user_id, expires_at FROM inertial_eclipse.password_reset_tokens WHERE token_hash = ?",
            (&token_hash as &str,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let (user_id, expires_at) = result
        .into_rows_result()?
        .single_row::<(Uuid, DateTime<Utc>)>()
        .map_err(|_| AppError::BadRequest("Invalid or expired reset token".into()))?;

    if Utc::now() > expires_at {
        // Expired — clean it up and surface the generic error.
        let _ = db
            .query_unpaged(
                "DELETE FROM inertial_eclipse.password_reset_tokens WHERE token_hash = ?",
                (&token_hash as &str,),
            )
            .await;
        return Err(AppError::BadRequest("Invalid or expired reset token".into()));
    }

    let password_hash = hash_password(new_password)?;
    let now = ts_now();

    db.query_unpaged(
        "UPDATE inertial_eclipse.users SET password_hash = ?, updated_at = ? WHERE id = ?",
        (&password_hash as &str, now, &user_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Single-use: delete the token so it can't be replayed.
    let _ = db
        .query_unpaged(
            "DELETE FROM inertial_eclipse.password_reset_tokens WHERE token_hash = ?",
            (&token_hash as &str,),
        )
        .await;

    Ok(())
}

// ─── Avatar ───

pub async fn has_avatar(db: &DbSession, user_id: &Uuid) -> bool {
    let result = db
        .query_unpaged(
            "SELECT avatar_mime FROM inertial_eclipse.users WHERE id = ?",
            (user_id,),
        )
        .await
        .ok();

    if let Some(r) = result {
        if let Ok(rows) = r.into_rows_result() {
            if let Ok(Some((mime,))) = rows.maybe_first_row::<(Option<String>,)>() {
                return mime.is_some_and(|m| !m.is_empty());
            }
        }
    }
    false
}

pub async fn upload_avatar(
    db: &DbSession,
    user_id: &Uuid,
    data: &[u8],
    mime_type: &str,
) -> Result<(), AppError> {
    let now = ts_now();
    db.query_unpaged(
        "UPDATE inertial_eclipse.users SET avatar_data = ?, avatar_mime = ?, updated_at = ? WHERE id = ?",
        (data, mime_type, now, user_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

pub async fn delete_avatar(db: &DbSession, user_id: &Uuid) -> Result<(), AppError> {
    let now = ts_now();
    let empty: Option<&[u8]> = None;
    let empty_mime: Option<&str> = None;
    db.query_unpaged(
        "UPDATE inertial_eclipse.users SET avatar_data = ?, avatar_mime = ?, updated_at = ? WHERE id = ?",
        (&empty, &empty_mime, now, user_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(())
}

pub async fn get_avatar(db: &DbSession, user_id: &Uuid) -> Result<(String, Vec<u8>), AppError> {
    let result = db
        .query_unpaged(
            "SELECT avatar_mime, avatar_data FROM inertial_eclipse.users WHERE id = ?",
            (user_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let row = result
        .into_rows_result()?
        .single_row::<(Option<String>, Option<Vec<u8>>)>()
        .map_err(|_| AppError::NotFound("User not found".into()))?;

    let mime = row
        .0
        .ok_or_else(|| AppError::NotFound("No avatar".into()))?;
    let data = row
        .1
        .ok_or_else(|| AppError::NotFound("No avatar data".into()))?;

    if mime.is_empty() || data.is_empty() {
        return Err(AppError::NotFound("No avatar".into()));
    }

    Ok((mime, data))
}

pub async fn get_user_public_with_avatar(
    db: &DbSession,
    user_id: &Uuid,
) -> Result<UserPublic, AppError> {
    let user = get_user_by_id(db, user_id).await?;
    let avatar = has_avatar(db, user_id).await;
    Ok(UserPublic {
        id: user.id,
        email: user.email,
        name: user.name,
        two_factor_enabled: user.two_factor_enabled,
        has_avatar: avatar,
        created_at: user.created_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_and_verify_password() {
        let password = "MyStr0ngP@ss!";
        let hash = hash_password(password).unwrap();
        assert!(verify_password(password, &hash).unwrap());
    }

    #[test]
    fn test_verify_wrong_password() {
        let hash = hash_password("correct").unwrap();
        assert!(!verify_password("wrong", &hash).unwrap());
    }

    #[test]
    fn test_create_and_decode_jwt() {
        let user_id = Uuid::new_v4();
        let email = "test@example.com";
        let secret = "test-secret-key";

        let token = create_jwt(&user_id, email, secret).unwrap();
        let claims = decode_jwt(&token, secret).unwrap();

        assert_eq!(claims.sub, user_id.to_string());
        assert_eq!(claims.email, email);
        assert!(claims.workspace_id.is_some());
    }

    #[test]
    fn test_decode_jwt_wrong_secret() {
        let user_id = Uuid::new_v4();
        let token = create_jwt(&user_id, "test@test.com", "secret1").unwrap();
        let result = decode_jwt(&token, "secret2");
        assert!(result.is_err());
    }

    #[test]
    fn test_create_admin_jwt_has_admin_role() {
        let secret = "admin-secret";
        let token = create_admin_jwt(secret).unwrap();
        let claims = decode_jwt(&token, secret).unwrap();
        assert_eq!(claims.role, Some("admin".to_string()));
        assert_eq!(claims.email, "admin");
    }

    #[test]
    fn test_jwt_with_workspace_id() {
        let user_id = Uuid::new_v4();
        let workspace_id = Uuid::new_v4();
        let secret = "ws-secret";

        let token = create_jwt_with_workspace(&user_id, "u@e.com", &workspace_id, secret).unwrap();
        let claims = decode_jwt(&token, secret).unwrap();

        assert_eq!(claims.workspace_id, Some(workspace_id.to_string()));
    }

    #[test]
    fn test_generate_reset_token_uniqueness() {
        let t1 = generate_reset_token();
        let t2 = generate_reset_token();
        assert_ne!(t1, t2);
        assert!(!t1.is_empty());
    }

    #[test]
    fn test_generate_2fa_code_format() {
        let code = generate_2fa_code();
        assert_eq!(code.len(), 6);
        assert!(code.chars().all(|c| c.is_ascii_digit()));
    }
}
