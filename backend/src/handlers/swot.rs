use axum::extract::{Extension, Path};
use axum::Json;
use serde_json::json;
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::models::swot::{
    CreateSwotItemRequest, CreateSwotRequest, UpdateSwotItemRequest, UpdateSwotRequest,
};
use crate::services::swot as swot_service;
use crate::services::workspace as ws_service;

pub async fn list_analyses(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(workspace_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let _ = ws_service::get_member_role(&db, &workspace_id, &auth_user.user_id).await?;
    let analyses = swot_service::list_analyses(&db, &workspace_id).await?;
    Ok(Json(json!({ "analyses": analyses })))
}

pub async fn create_analysis(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(workspace_id): Path<Uuid>,
    Json(body): Json<CreateSwotRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let role = ws_service::get_member_role(&db, &workspace_id, &auth_user.user_id).await?;
    if role != "owner" && role != "admin" {
        return Err(AppError::Forbidden(
            "Apenas administradores podem criar análises SWOT".into(),
        ));
    }

    let analysis = swot_service::create_analysis(
        &db,
        &workspace_id,
        &body.title,
        body.description.as_deref(),
        body.cycle.as_deref(),
        &auth_user.user_id,
    )
    .await?;

    Ok(Json(json!({ "analysis": analysis })))
}

pub async fn get_analysis(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((workspace_id, analysis_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let _ = ws_service::get_member_role(&db, &workspace_id, &auth_user.user_id).await?;
    let analysis = swot_service::get_analysis(&db, &workspace_id, &analysis_id).await?;
    Ok(Json(json!({ "analysis": analysis })))
}

pub async fn update_analysis(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((workspace_id, analysis_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateSwotRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let role = ws_service::get_member_role(&db, &workspace_id, &auth_user.user_id).await?;
    if role != "owner" && role != "admin" {
        return Err(AppError::Forbidden(
            "Apenas administradores podem editar análises SWOT".into(),
        ));
    }

    let now = scylla::frame::value::CqlTimestamp(chrono::Utc::now().timestamp_millis());
    if let Some(v) = &body.title {
        let _ = db.query_unpaged(
            "UPDATE inertial_eclipse.swot_analyses SET title = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
            (v.as_str(), now, &workspace_id, &analysis_id),
        ).await;
    }
    if let Some(v) = &body.description {
        let _ = db.query_unpaged(
            "UPDATE inertial_eclipse.swot_analyses SET description = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
            (v.as_str(), now, &workspace_id, &analysis_id),
        ).await;
    }

    let updated = swot_service::get_analysis(&db, &workspace_id, &analysis_id).await?;
    Ok(Json(json!({ "analysis": updated })))
}

pub async fn delete_analysis(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((workspace_id, analysis_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let role = ws_service::get_member_role(&db, &workspace_id, &auth_user.user_id).await?;
    if role != "owner" && role != "admin" {
        return Err(AppError::Forbidden(
            "Apenas administradores podem excluir análises SWOT".into(),
        ));
    }

    swot_service::delete_analysis(&db, &workspace_id, &analysis_id).await?;
    Ok(Json(json!({ "success": true })))
}

// ─── Items ───

pub async fn create_item(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(analysis_id): Path<Uuid>,
    Json(body): Json<CreateSwotItemRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let item = swot_service::create_item(
        &db,
        &analysis_id,
        &body.quadrant,
        &body.content,
        body.priority,
        body.linked_objective_id.as_ref(),
        &auth_user.user_id,
    )
    .await?;

    Ok(Json(json!({ "item": item })))
}

pub async fn update_item(
    Extension(db): Extension<DbSession>,
    Extension(_auth_user): Extension<AuthUser>,
    Path((analysis_id, item_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateSwotItemRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    swot_service::update_item(
        &db,
        &analysis_id,
        &item_id,
        body.content.as_deref(),
        body.priority,
        body.quadrant.as_deref(),
        body.linked_objective_id.as_ref(),
        body.position,
    )
    .await?;

    Ok(Json(json!({ "success": true })))
}

pub async fn delete_item(
    Extension(db): Extension<DbSession>,
    Extension(_auth_user): Extension<AuthUser>,
    Path((analysis_id, item_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    swot_service::delete_item(&db, &analysis_id, &item_id).await?;
    Ok(Json(json!({ "success": true })))
}
