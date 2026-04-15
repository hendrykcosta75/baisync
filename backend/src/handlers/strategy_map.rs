use axum::extract::{Extension, Path};
use axum::Json;
use chrono::Datelike;
use serde_json::json;
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::models::strategy_map::{
    BatchUpdatePositionsRequest, CreateEdgeRequest, CreateNodeRequest, UpdateNodeRequest,
};
use crate::services::okr as okr_service;
use crate::services::strategy_map as map_service;
use crate::services::workspace as ws_service;

pub async fn get_map(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(workspace_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let _ = ws_service::get_member_role(&db, &workspace_id, &auth_user.user_id).await?;

    let nodes = map_service::list_nodes(&db, &workspace_id).await?;
    let edges = map_service::list_edges(&db, &workspace_id).await?;

    Ok(Json(json!({ "nodes": nodes, "edges": edges })))
}

pub async fn sync_map(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(workspace_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let _ = ws_service::get_member_role(&db, &workspace_id, &auth_user.user_id).await?;

    let (new_nodes, new_edges) = map_service::sync_from_okr_data(&db, &workspace_id).await?;

    // Return the full map after sync
    let nodes = map_service::list_nodes(&db, &workspace_id).await?;
    let edges = map_service::list_edges(&db, &workspace_id).await?;

    Ok(Json(json!({
        "nodes": nodes,
        "edges": edges,
        "synced_nodes": new_nodes.len(),
        "synced_edges": new_edges.len(),
    })))
}

pub async fn create_node(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(workspace_id): Path<Uuid>,
    Json(body): Json<CreateNodeRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let role = ws_service::get_member_role(&db, &workspace_id, &auth_user.user_id).await?;
    if role != "owner" && role != "admin" {
        return Err(AppError::Forbidden("Apenas administradores podem editar o mapa".into()));
    }

    let mut entity_id = body.entity_id;

    // If creating an objective node without entity_id, also create the OKR objective
    if body.node_type == "objective" && entity_id.is_none() {
        let now = chrono::Utc::now();
        let quarter = ((now.month() - 1) / 3) + 1;
        let cycle = format!("{}-Q{}", now.year(), quarter);

        let obj = okr_service::create_objective(
            &db, &workspace_id, &body.label, None,
            "committed", &cycle, &auth_user.user_id, None, None, None,
        ).await?;
        entity_id = Some(obj.id);
    }

    let node = map_service::create_node(
        &db, &workspace_id, &body.node_type, entity_id.as_ref(),
        &body.label, body.position_x, body.position_y, body.width, body.height,
        body.style_data.as_deref(), body.bsc_perspective.as_deref(),
    ).await?;

    Ok(Json(json!({ "node": node })))
}

pub async fn update_node(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((workspace_id, node_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateNodeRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let role = ws_service::get_member_role(&db, &workspace_id, &auth_user.user_id).await?;
    if role != "owner" && role != "admin" {
        return Err(AppError::Forbidden("Apenas administradores podem editar o mapa".into()));
    }

    // If label changed, sync to linked entity
    if let Some(new_label) = &body.label {
        let nodes = map_service::list_nodes(&db, &workspace_id).await?;
        if let Some(node) = nodes.iter().find(|n| n.id == node_id) {
            if let Some(entity_id) = node.entity_id {
                match node.node_type.as_str() {
                    "objective" => {
                        if let Err(e) = okr_service::update_objective(
                            &db, &workspace_id, &entity_id,
                            Some(new_label.as_str()), None, None, None, None, None, None, None, None,
                        ).await {
                            tracing::warn!("Failed to sync label to objective {}: {}", entity_id, e);
                        }
                    }
                    "key_result" => {
                        if let Err(e) = okr_service::update_key_result_title(&db, &entity_id, new_label).await {
                            tracing::warn!("Failed to sync label to KR {}: {}", entity_id, e);
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    map_service::update_node(
        &db, &workspace_id, &node_id,
        body.label.as_deref(), body.position_x, body.position_y,
        body.width, body.height, body.style_data.as_deref(), body.bsc_perspective.as_deref(),
    ).await?;

    Ok(Json(json!({ "success": true })))
}

pub async fn delete_node(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((workspace_id, node_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let role = ws_service::get_member_role(&db, &workspace_id, &auth_user.user_id).await?;
    if role != "owner" && role != "admin" {
        return Err(AppError::Forbidden("Apenas administradores podem editar o mapa".into()));
    }

    // If the node is linked to an OKR entity, delete that entity too
    let nodes = map_service::list_nodes(&db, &workspace_id).await?;
    if let Some(node) = nodes.iter().find(|n| n.id == node_id) {
        if let Some(entity_id) = node.entity_id {
            match node.node_type.as_str() {
                "objective" => {
                    if let Err(e) = okr_service::delete_objective(&db, &workspace_id, &entity_id).await {
                        tracing::warn!("Failed to delete linked objective {}: {}", entity_id, e);
                    }
                }
                "key_result" => {
                    if let Some(obj_id) = okr_service::find_objective_for_kr(&db, &entity_id).await {
                        if let Err(e) = okr_service::delete_key_result(&db, &obj_id, &entity_id).await {
                            tracing::warn!("Failed to delete linked KR {}: {}", entity_id, e);
                        }
                    }
                }
                _ => {}
            }
        }
    }

    map_service::delete_node(&db, &workspace_id, &node_id).await?;

    Ok(Json(json!({ "success": true })))
}

pub async fn batch_update_positions(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(workspace_id): Path<Uuid>,
    Json(body): Json<BatchUpdatePositionsRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let role = ws_service::get_member_role(&db, &workspace_id, &auth_user.user_id).await?;
    if role != "owner" && role != "admin" {
        return Err(AppError::Forbidden("Apenas administradores podem editar o mapa".into()));
    }

    let updates: Vec<(Uuid, f32, f32)> = body.nodes.iter()
        .map(|n| (n.id, n.position_x, n.position_y))
        .collect();

    map_service::batch_update_positions(&db, &workspace_id, &updates).await?;

    Ok(Json(json!({ "success": true })))
}

pub async fn create_edge(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(workspace_id): Path<Uuid>,
    Json(body): Json<CreateEdgeRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let role = ws_service::get_member_role(&db, &workspace_id, &auth_user.user_id).await?;
    if role != "owner" && role != "admin" {
        return Err(AppError::Forbidden("Apenas administradores podem editar o mapa".into()));
    }

    let edge = map_service::create_edge(
        &db, &workspace_id, &body.source_node_id, &body.target_node_id,
        &body.edge_type, body.label.as_deref(), body.style_data.as_deref(),
    ).await?;

    Ok(Json(json!({ "edge": edge })))
}

pub async fn delete_edge(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((workspace_id, edge_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let role = ws_service::get_member_role(&db, &workspace_id, &auth_user.user_id).await?;
    if role != "owner" && role != "admin" {
        return Err(AppError::Forbidden("Apenas administradores podem editar o mapa".into()));
    }

    map_service::delete_edge(&db, &workspace_id, &edge_id).await?;

    Ok(Json(json!({ "success": true })))
}
