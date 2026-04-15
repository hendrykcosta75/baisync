use axum::extract::{Extension, Path};
use axum::Json;
use chrono::Utc;
use rand::Rng;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::config::Config;
use crate::db::DbSession;
use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::services::{assistant, email};

// ─── Models ───────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct AccessToken {
    pub id: String,
    pub name: String,
    pub token: String,
    pub permission_level: String,
    pub email: Option<String>,
    pub expires_at: Option<String>,
    pub created_at: String,
    pub is_revoked: bool,
}

#[derive(Deserialize)]
pub struct CreateTokenRequest {
    pub name: String,
    /// "read" | "write" | "admin"
    pub permission_level: String,
    /// If set, token is bound to this email address
    pub email: Option<String>,
    /// Optional expiry in days from now
    pub expires_in_days: Option<i64>,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn generate_token() -> String {
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..32).map(|_| rng.gen::<u8>()).collect();
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn channel_label(channel: &str) -> &str {
    match channel {
        "read" => "Visualização",
        "write" => "Operação",
        "admin" => "Administração",
        other => other,
    }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

// GET /api/assistants/{id}/access-tokens
pub async fn list_tokens(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(assistant_id): Path<Uuid>,
) -> Result<Json<Vec<AccessToken>>, AppError> {
    assistant::get_assistant(&db, &auth_user.workspace_id, &assistant_id).await?;

    let result = db
        .query_unpaged(
            "SELECT id, name, \"token\", permission_level, email, expires_at, created_at, is_revoked \
             FROM inertial_eclipse.access_tokens \
             WHERE user_id = ? AND assistant_id = ?",
            (&auth_user.workspace_id, &assistant_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut tokens = Vec::new();
    let rows = result.into_rows_result()?;
    for row in rows
        .rows::<(
            Uuid,
            String,
            String,
            String,
            Option<String>,
            Option<chrono::DateTime<Utc>>,
            chrono::DateTime<Utc>,
            bool,
        )>()?
        .flatten()
    {
        let (id, name, token, permission_level, email, expires_at, created_at, is_revoked) = row;
        tokens.push(AccessToken {
            id: id.to_string(),
            name,
            token,
            permission_level,
            email,
            expires_at: expires_at.map(|t| t.to_rfc3339()),
            created_at: created_at.to_rfc3339(),
            is_revoked,
        });
    }

    Ok(Json(tokens))
}

// POST /api/assistants/{id}/access-tokens
pub async fn create_token(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(auth_user): Extension<AuthUser>,
    Path(assistant_id): Path<Uuid>,
    Json(req): Json<CreateTokenRequest>,
) -> Result<Json<AccessToken>, AppError> {
    assistant::get_assistant(&db, &auth_user.workspace_id, &assistant_id).await?;

    let id = Uuid::new_v4();
    let token = generate_token();
    let now = Utc::now();
    let expires_at: Option<chrono::DateTime<Utc>> =
        req.expires_in_days.map(|d| now + chrono::Duration::days(d));

    let is_revoked = false;
    db.query_unpaged(
        "INSERT INTO inertial_eclipse.access_tokens \
         (user_id, assistant_id, id, name, \"token\", permission_level, email, expires_at, created_at, is_revoked) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            &auth_user.workspace_id,
            &assistant_id,
            &id,
            &req.name,
            &token,
            &req.permission_level,
            &req.email,
            &expires_at,
            &now,
            &is_revoked,
        ),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // If email provided, send the token via email
    if let Some(ref recipient) = req.email {
        let level_label = channel_label(&req.permission_level);
        let body = format!(
            "<h2>Você recebeu um token de acesso</h2>\
             <p>O token a seguir foi criado para dar acesso a um assistente de IA com nível <strong>{level_label}</strong>.</p>\
             <p style=\"font-family:monospace;font-size:18px;background:#f4f4f4;padding:12px;border-radius:6px\">{token}</p>\
             <p>Guarde-o em segurança — ele é pessoal e intransferível.</p>",
            level_label = level_label,
            token = token
        );
        let _ = email::send_email(
            &config,
            recipient,
            "Seu token de acesso - Inertial Eclipse",
            &body,
        )
        .await;
    }

    Ok(Json(AccessToken {
        id: id.to_string(),
        name: req.name,
        token,
        permission_level: req.permission_level,
        email: req.email,
        expires_at: expires_at.map(|t| t.to_rfc3339()),
        created_at: now.to_rfc3339(),
        is_revoked: false,
    }))
}

// DELETE /api/assistants/{id}/access-tokens/{token_id}
pub async fn delete_token(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((assistant_id, token_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    assistant::get_assistant(&db, &auth_user.workspace_id, &assistant_id).await?;

    db.query_unpaged(
        "DELETE FROM inertial_eclipse.access_tokens \
         WHERE user_id = ? AND assistant_id = ? AND id = ?",
        (&auth_user.workspace_id, &assistant_id, &token_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

// GET /api/assistants/{id}/token-users
pub async fn token_users(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(assistant_id): Path<Uuid>,
) -> Result<Json<Vec<TokenUserResponse>>, AppError> {
    // Verify ownership
    assistant::get_assistant(&db, &auth_user.workspace_id, &assistant_id).await?;

    let users = assistant::list_token_users(&db, &assistant_id).await?;
    let result: Vec<TokenUserResponse> = users
        .into_iter()
        .map(|u| TokenUserResponse {
            user_id: u.user_id.to_string(),
            user_email: u.user_email,
            user_name: u.user_name,
            share_token: u.share_token,
            permissions: u.permissions,
            accepted_at: u.accepted_at.to_rfc3339(),
        })
        .collect();

    Ok(Json(result))
}

#[derive(Serialize)]
pub struct TokenUserResponse {
    pub user_id: String,
    pub user_email: String,
    pub user_name: String,
    pub share_token: String,
    pub permissions: Vec<String>,
    pub accepted_at: String,
}

// PATCH /api/assistants/{id}/access-tokens/{token_id}/revoke
pub async fn revoke_token(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((assistant_id, token_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    assistant::get_assistant(&db, &auth_user.workspace_id, &assistant_id).await?;

    db.query_unpaged(
        "UPDATE inertial_eclipse.access_tokens SET is_revoked = true \
         WHERE user_id = ? AND assistant_id = ? AND id = ?",
        (&auth_user.workspace_id, &assistant_id, &token_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(Json(serde_json::json!({ "ok": true })))
}
