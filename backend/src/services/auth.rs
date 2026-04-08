use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::{DateTime, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use scylla::frame::value::CqlTimestamp;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::models::user::{AuthResponse, User, UserPublic};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String,
    pub email: String,
    pub exp: usize,
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
    let expiration = Utc::now()
        .checked_add_signed(chrono::Duration::hours(24))
        .expect("valid timestamp")
        .timestamp() as usize;

    let claims = Claims {
        sub: user_id.to_string(),
        email: email.to_string(),
        exp: expiration,
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
    .map_err(|e| AppError::Unauthorized(format!("Invalid token: {e}")))
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

    if existing.maybe_first_row_typed::<(Uuid,)>().map_err(|e| AppError::DatabaseError(e.to_string()))?.is_some() {
        return Err(AppError::BadRequest("Email already registered".into()));
    }

    let id = Uuid::new_v4();
    let password_hash = hash_password(password)?;
    let now = ts_now();

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.users (id, email, password_hash, name, two_factor_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, false, ?, ?)",
        (id, email, &password_hash as &str, name, now, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let token = create_jwt(&id, email, jwt_secret)?;
    Ok(AuthResponse {
        token,
        user: UserPublic {
            id,
            email: email.to_string(),
            name: name.to_string(),
            two_factor_enabled: false,
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
            "SELECT id, email, password_hash, name, two_factor_enabled, created_at FROM inertial_eclipse.users WHERE email = ?",
            (email,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let (id, email, password_hash, name, two_factor_enabled, created_at) = result
        .single_row_typed::<(Uuid, String, String, String, Option<bool>, DateTime<Utc>)>()
        .map_err(|_| AppError::Unauthorized("Invalid email or password".into()))?;

    if !verify_password(password, &password_hash)? {
        return Err(AppError::Unauthorized("Invalid email or password".into()));
    }

    let token = create_jwt(&id, &email, jwt_secret)?;
    Ok(AuthResponse {
        token,
        user: UserPublic {
            id,
            email,
            name,
            two_factor_enabled: two_factor_enabled.unwrap_or(false),
            created_at: ts_to_dt(created_at),
        },
    })
}

pub async fn get_user_by_id(db: &DbSession, user_id: &Uuid) -> Result<User, AppError> {
    let result = db
        .query_unpaged(
            "SELECT id, email, password_hash, name, two_factor_enabled, two_factor_secret, api_key_openai, api_key_claude, api_key_gemini, api_key_elevenlabs, api_key_mercadopago, created_at, updated_at FROM inertial_eclipse.users WHERE id = ?",
            (user_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let (id, email, password_hash, name, two_factor_enabled, two_factor_secret, api_key_openai, api_key_claude, api_key_gemini, api_key_elevenlabs, api_key_mercadopago, created_at, updated_at) = result
        .single_row_typed::<(Uuid, String, String, String, Option<bool>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, DateTime<Utc>, DateTime<Utc>)>()
        .map_err(|_| AppError::NotFound("User not found".into()))?;

    Ok(User {
        id,
        email,
        password_hash,
        name,
        two_factor_enabled: two_factor_enabled.unwrap_or(false),
        two_factor_secret,
        api_key_openai,
        api_key_claude,
        api_key_gemini,
        api_key_elevenlabs,
        api_key_mercadopago,
        created_at,
        updated_at,
    })
}

pub fn generate_2fa_code() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    format!("{:06}", rng.gen_range(0..1_000_000))
}

pub async fn enable_2fa(db: &DbSession, user_id: &Uuid) -> Result<String, AppError> {
    let code = generate_2fa_code();

    db.query_unpaged(
        "UPDATE inertial_eclipse.users SET two_factor_secret = ? WHERE id = ?",
        (&code as &str, user_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(code)
}

pub async fn verify_2fa(db: &DbSession, user_id: &Uuid, code: &str) -> Result<(), AppError> {
    let user = get_user_by_id(db, user_id).await?;
    let secret = user
        .two_factor_secret
        .ok_or_else(|| AppError::BadRequest("2FA not enabled".into()))?;

    if secret != code {
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

    let user = get_user_by_id(db, user_id).await?;
    Ok(user.into())
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

    if let Ok(rows) = assistants.rows_typed::<(Uuid,)>() {
        for row in rows.flatten() {
            let assistant_id = row.0;
            // Delete related data
            let _ = db.query_unpaged("DELETE FROM inertial_eclipse.assistant_tools WHERE assistant_id = ?", (&assistant_id,)).await;
            let _ = db.query_unpaged("DELETE FROM inertial_eclipse.assistant_files WHERE assistant_id = ?", (&assistant_id,)).await;
            let _ = db.query_unpaged("DELETE FROM inertial_eclipse.integrations WHERE assistant_id = ?", (&assistant_id,)).await;
            let _ = db.query_unpaged("DELETE FROM inertial_eclipse.conversations WHERE assistant_id = ?", (&assistant_id,)).await;
        }
        let _ = db.query_unpaged("DELETE FROM inertial_eclipse.assistants WHERE user_id = ?", (user_id,)).await;
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
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..32).map(|_| rng.gen()).collect();
    base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, &bytes)
}

pub async fn save_reset_token(
    db: &DbSession,
    user_id: &Uuid,
    token: &str,
) -> Result<(), AppError> {
    let val = format!("reset:{token}");
    db.query_unpaged(
        "UPDATE inertial_eclipse.users SET two_factor_secret = ? WHERE id = ?",
        (&val as &str, user_id),
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
    let search_val = format!("reset:{token}");
    let result = db
        .query_unpaged(
            "SELECT id FROM inertial_eclipse.users WHERE two_factor_secret = ? ALLOW FILTERING",
            (&search_val as &str,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let (user_id,) = result
        .single_row_typed::<(Uuid,)>()
        .map_err(|_| AppError::BadRequest("Invalid or expired reset token".into()))?;

    let password_hash = hash_password(new_password)?;
    let now = ts_now();
    let null_str: Option<&str> = None;

    db.query_unpaged(
        "UPDATE inertial_eclipse.users SET password_hash = ?, two_factor_secret = ?, updated_at = ? WHERE id = ?",
        (&password_hash as &str, null_str, now, &user_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}
