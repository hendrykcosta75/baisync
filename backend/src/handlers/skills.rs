//! HTTP handlers for the skill library.
//!
//! Writes (`create`, `update`, `delete`, `link`, `unlink`) require
//! workspace editor role (owner/admin). Reads are open to any member.
//! Every query filters on `auth_user.workspace_id` — cross-workspace
//! access returns NotFound (404) rather than Forbidden to avoid
//! leaking existence.

use axum::extract::{Extension, Path};
use axum::Json;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::models::skill::{CreateSkillRequest, Skill, UpdateSkillRequest};
use crate::services::assistant as assistant_service;
use crate::services::skill as skill_service;
use crate::services::workspace as ws_service;

pub async fn list(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<Vec<Skill>>, AppError> {
    Ok(Json(skill_service::list(&db, &auth_user.workspace_id).await?))
}

pub async fn create(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<CreateSkillRequest>,
) -> Result<Json<Skill>, AppError> {
    ws_service::require_editor_role(&db, &auth_user.workspace_id, &auth_user.user_id).await?;
    let skill =
        skill_service::create(&db, &auth_user.workspace_id, &auth_user.user_id, req).await?;
    Ok(Json(skill))
}

pub async fn get(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Skill>, AppError> {
    let skill = skill_service::get(&db, &auth_user.workspace_id, &id)
        .await?
        .ok_or_else(|| AppError::NotFound("skill não encontrada".into()))?;
    Ok(Json(skill))
}

pub async fn update(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateSkillRequest>,
) -> Result<Json<Skill>, AppError> {
    ws_service::require_editor_role(&db, &auth_user.workspace_id, &auth_user.user_id).await?;
    let skill = skill_service::update(&db, &auth_user.workspace_id, &id, req).await?;
    Ok(Json(skill))
}

pub async fn delete(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    ws_service::require_editor_role(&db, &auth_user.workspace_id, &auth_user.user_id).await?;
    skill_service::delete(&db, &auth_user.workspace_id, &id).await?;
    Ok(Json(json!({"message": "skill deletada"})))
}

pub async fn list_for_assistant(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(assistant_id): Path<Uuid>,
) -> Result<Json<Vec<Skill>>, AppError> {
    // Validate that the assistant belongs to the requester's workspace.
    // NB: `assistant_service::get_assistant` signature takes `user_id: &Uuid`
    // but — per legacy column naming (migration 003) — that column stores
    // the workspace_id. `handlers/assistants.rs:50` uses the same pattern.
    assistant_service::get_assistant(&db, &auth_user.workspace_id, &assistant_id).await?;
    let skills =
        skill_service::list_for_assistant(&db, &assistant_id, &auth_user.workspace_id).await?;
    Ok(Json(skills))
}

pub async fn link(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((assistant_id, skill_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>, AppError> {
    ws_service::require_editor_role(&db, &auth_user.workspace_id, &auth_user.user_id).await?;
    assistant_service::get_assistant(&db, &auth_user.workspace_id, &assistant_id).await?;
    skill_service::link(
        &db,
        &auth_user.workspace_id,
        &assistant_id,
        &skill_id,
        &auth_user.user_id,
    )
    .await?;
    Ok(Json(json!({"message": "skill vinculada"})))
}

pub async fn unlink(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((assistant_id, skill_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>, AppError> {
    ws_service::require_editor_role(&db, &auth_user.workspace_id, &auth_user.user_id).await?;
    assistant_service::get_assistant(&db, &auth_user.workspace_id, &assistant_id).await?;
    skill_service::unlink(&db, &auth_user.workspace_id, &assistant_id, &skill_id).await?;
    Ok(Json(json!({"message": "skill desvinculada"})))
}
