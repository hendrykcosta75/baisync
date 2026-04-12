use axum::extract::{Extension, Path};
use axum::Json;
use rand::Rng;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::config::Config;
use crate::db::DbSession;
use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::services::{assistant, email};

fn generate_token() -> String {
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..24).map(|_| rng.gen::<u8>()).collect();
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

#[derive(Deserialize)]
pub struct SetShareTokenRequest {
    pub permissions: Option<Vec<String>>,
    pub email: Option<String>,
}

#[derive(Serialize)]
pub struct ShareTokenInfo {
    pub token: String,
    pub permissions: Vec<String>,
}

#[derive(Serialize)]
pub struct SharedAssistantInfo {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub permissions: Vec<String>,
    pub is_own: bool,
}

// GET /api/assistants/{id}/share-token
pub async fn get_share_token(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(assistant_id): Path<Uuid>,
) -> Result<Json<Option<ShareTokenInfo>>, AppError> {
    let asst = assistant::get_assistant(&db, &auth_user.workspace_id, &assistant_id).await?;
    if let Some(token) = asst.share_token {
        Ok(Json(Some(ShareTokenInfo {
            token,
            permissions: asst.share_permissions.unwrap_or_default(),
        })))
    } else {
        Ok(Json(None))
    }
}

// POST /api/assistants/{id}/share-token
pub async fn create_share_token(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(auth_user): Extension<AuthUser>,
    Path(assistant_id): Path<Uuid>,
    Json(req): Json<SetShareTokenRequest>,
) -> Result<Json<ShareTokenInfo>, AppError> {
    let asst = assistant::get_assistant(&db, &auth_user.workspace_id, &assistant_id).await?;
    let token = generate_token();
    let permissions = req.permissions.clone().unwrap_or_else(|| vec!["read".to_string()]);
    assistant::set_share_token(&db, &auth_user.workspace_id, &assistant_id, Some(token.clone()), Some(permissions.clone())).await?;

    if let Some(ref recipient) = req.email {
        let perm_label = permissions.join(", ");
        let body = format!(
            "<h2>Você recebeu acesso a um assistente de IA</h2>\
             <p>Você foi convidado a acessar o assistente <strong>{name}</strong>.</p>\
             <p>Use o token abaixo para importá-lo na plataforma Inertial Eclipse:</p>\
             <p style=\"font-family:monospace;font-size:18px;background:#f4f4f4;padding:12px;border-radius:6px;word-break:break-all\">{token}</p>\
             <p>Permissões concedidas: {perm_label}</p>",
            name = asst.name,
            token = token,
            perm_label = perm_label
        );
        let _ = email::send_email(&config, recipient, &format!("Acesso ao assistente {} - Inertial Eclipse", asst.name), &body).await;
    }

    Ok(Json(ShareTokenInfo { token, permissions }))
}

// DELETE /api/assistants/{id}/share-token
pub async fn revoke_share_token(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(assistant_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    assistant::get_assistant(&db, &auth_user.workspace_id, &assistant_id).await?;
    assistant::set_share_token(&db, &auth_user.workspace_id, &assistant_id, None, None).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// GET /api/shared/{token}
pub async fn get_shared_assistant(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(token): Path<String>,
) -> Result<Json<SharedAssistantInfo>, AppError> {
    let (asst, permissions) = assistant::get_by_any_token(&db, &token).await?;
    let is_own = asst.user_id == auth_user.workspace_id;
    Ok(Json(SharedAssistantInfo {
        id: asst.id.to_string(),
        name: asst.name,
        description: asst.description,
        permissions,
        is_own,
    }))
}

// ── Accepted Shares ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct AcceptShareRequest {
    pub token: String,
}

#[derive(Serialize)]
pub struct AcceptedShareInfo {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub permissions: Vec<String>,
    pub is_own: bool,
}

// POST /api/shares/accept
pub async fn accept_share(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<AcceptShareRequest>,
) -> Result<Json<AcceptedShareInfo>, AppError> {
    let (asst, permissions) = assistant::get_by_any_token(&db, &req.token).await?;
    let is_own = asst.user_id == auth_user.workspace_id;

    if !is_own {
        assistant::accept_share(
            &db,
            &auth_user.workspace_id,
            &asst.id,
            &req.token,
            &asst.name,
            asst.description.as_deref(),
            &permissions,
        )
        .await?;
    }

    Ok(Json(AcceptedShareInfo {
        id: asst.id.to_string(),
        name: asst.name,
        description: asst.description,
        permissions,
        is_own,
    }))
}

// GET /api/shares/accepted
pub async fn list_accepted_shares(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<Vec<assistant::AcceptedShare>>, AppError> {
    let shares = assistant::list_accepted_shares(&db, &auth_user.workspace_id).await?;
    Ok(Json(shares))
}

// DELETE /api/shares/accepted/{assistant_id}
pub async fn remove_accepted_share(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(assistant_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    assistant::remove_accepted_share(&db, &auth_user.workspace_id, &assistant_id).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
