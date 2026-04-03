use axum::extract::{Extension, Path, Query};
use axum::Json;
use serde::{Deserialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::models::assistant::{Assistant, CreateAssistantRequest, UpdateAssistantRequest};
use crate::services::assistant as assistant_service;

#[derive(Deserialize)]
pub struct ShareTokenQuery {
    pub share_token: Option<String>,
}

#[derive(Deserialize)]
pub struct OwnerResolveQuery {
    pub assistant_id: Option<Uuid>,
    pub share_token: Option<String>,
}

pub async fn list(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<Vec<Assistant>>, AppError> {
    let assistants = assistant_service::list_assistants(&db, &auth_user.user_id).await?;
    Ok(Json(assistants))
}

pub async fn create(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<CreateAssistantRequest>,
) -> Result<Json<Assistant>, AppError> {
    let assistant = assistant_service::create_assistant(&db, &auth_user.user_id, req).await?;
    Ok(Json(assistant))
}

pub async fn get(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Query(query): Query<ShareTokenQuery>,
) -> Result<Json<Assistant>, AppError> {
    // Try ownership first
    if let Ok(asst) = assistant_service::get_assistant(&db, &auth_user.user_id, &id).await {
        return Ok(Json(asst));
    }
    // Fall back to any token (share_token field or access_tokens table)
    if let Some(ref token) = query.share_token {
        let (asst, _perms) = assistant_service::get_by_any_token(&db, token).await?;
        if asst.id == id {
            return Ok(Json(asst));
        }
    }
    Err(AppError::NotFound("Assistant not found".into()))
}

pub async fn update(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Query(query): Query<ShareTokenQuery>,
    Json(req): Json<UpdateAssistantRequest>,
) -> Result<Json<Assistant>, AppError> {
    // Try ownership first
    if let Ok(assistant) =
        assistant_service::update_assistant(&db, &auth_user.user_id, &id, req.clone()).await
    {
        return Ok(Json(assistant));
    }
    // Fall back to share token with write/admin permission
    if let Some(ref token) = query.share_token {
        let (asst, perms) = assistant_service::get_by_any_token(&db, token).await?;
        if asst.id != id {
            return Err(AppError::NotFound("Assistant not found".into()));
        }
        let can_write = perms.iter().any(|p| p == "write" || p == "admin");
        if !can_write {
            return Err(AppError::Unauthorized(
                "Permissão insuficiente para editar este assistente".into(),
            ));
        }
        let assistant = assistant_service::update_assistant(
            &db,
            &asst.user_id,
            &id,
            req,
        )
        .await?;
        return Ok(Json(assistant));
    }
    Err(AppError::NotFound("Assistant not found".into()))
}

pub async fn delete(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    assistant_service::delete_assistant(&db, &auth_user.user_id, &id).await?;
    Ok(Json(json!({"message": "Assistant deleted"})))
}
