//! HTTP handlers for the MCP server library.
//!
//! Auth/authz model identical to skills: editor role required for
//! writes, workspace-scoped reads. Responses return `McpServerSummary`
//! (never exposes `auth_header_value` — even encrypted form is hidden).
//! `/test` does a live `initialize` + `tools/list` against the remote
//! endpoint. `/refresh-tools` forces a cache miss on the next invocation.

use axum::extract::{Extension, Path};
use axum::Json;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::models::mcp_server::{
    CreateMcpServerRequest, McpServerSummary, UpdateMcpServerRequest,
};
use crate::services::assistant as assistant_service;
use crate::services::encryption::EncryptionService;
use crate::services::mcp::{cache, client, server as mcp_service};
use crate::services::workspace as ws_service;

pub async fn list(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<Vec<McpServerSummary>>, AppError> {
    let servers = mcp_service::list(&db, &auth_user.workspace_id).await?;
    Ok(Json(servers.iter().map(McpServerSummary::from).collect()))
}

pub async fn create(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Extension(encryption): Extension<EncryptionService>,
    Json(req): Json<CreateMcpServerRequest>,
) -> Result<Json<McpServerSummary>, AppError> {
    ws_service::require_editor_role(&db, &auth_user.workspace_id, &auth_user.user_id).await?;
    let server = mcp_service::create(
        &db,
        &encryption,
        &auth_user.workspace_id,
        &auth_user.user_id,
        req,
    )
    .await?;
    Ok(Json(McpServerSummary::from(&server)))
}

pub async fn get(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<McpServerSummary>, AppError> {
    let server = mcp_service::get(&db, &auth_user.workspace_id, &id)
        .await?
        .ok_or_else(|| AppError::NotFound("servidor MCP não encontrado".into()))?;
    Ok(Json(McpServerSummary::from(&server)))
}

pub async fn update(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Extension(encryption): Extension<EncryptionService>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateMcpServerRequest>,
) -> Result<Json<McpServerSummary>, AppError> {
    ws_service::require_editor_role(&db, &auth_user.workspace_id, &auth_user.user_id).await?;
    let server =
        mcp_service::update(&db, &encryption, &auth_user.workspace_id, &id, req).await?;
    Ok(Json(McpServerSummary::from(&server)))
}

pub async fn delete(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    ws_service::require_editor_role(&db, &auth_user.workspace_id, &auth_user.user_id).await?;
    mcp_service::delete(&db, &auth_user.workspace_id, &id).await?;
    Ok(Json(json!({"message": "servidor MCP deletado"})))
}

/// Live test — opens a fresh transport, runs `initialize` + `tools/list`,
/// returns the discovered tool names. Useful for the "Test connection"
/// button in the dashboard UI. Never caches the result (caller should
/// call `/refresh-tools` explicitly after to persist).
pub async fn test_connection(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Extension(encryption): Extension<EncryptionService>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let server = mcp_service::get(&db, &auth_user.workspace_id, &id)
        .await?
        .ok_or_else(|| AppError::NotFound("servidor MCP não encontrado".into()))?;
    match client::session_tools_list(&server, &encryption).await {
        Ok(tools) => Ok(Json(json!({
            "ok": true,
            "tools_count": tools.len(),
            "tools": tools.iter().map(|t| json!({
                "name": t.name,
                "description": t.description,
            })).collect::<Vec<_>>(),
        }))),
        Err(e) => Ok(Json(json!({
            "ok": false,
            "error": e.to_string(),
        }))),
    }
}

/// Force cache refresh. Calls `tools/list`, persists, returns count.
pub async fn refresh_tools(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Extension(encryption): Extension<EncryptionService>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    ws_service::require_editor_role(&db, &auth_user.workspace_id, &auth_user.user_id).await?;
    let mut server = mcp_service::get(&db, &auth_user.workspace_id, &id)
        .await?
        .ok_or_else(|| AppError::NotFound("servidor MCP não encontrado".into()))?;
    // Force miss by clearing local copy before ensure_tools_cached
    server.tools_cache = None;
    server.tools_cached_at = None;
    let tools = cache::ensure_tools_cached(&db, &encryption, &server).await?;
    Ok(Json(json!({
        "tools_count": tools.len(),
    })))
}

pub async fn list_for_assistant(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(assistant_id): Path<Uuid>,
) -> Result<Json<Vec<McpServerSummary>>, AppError> {
    assistant_service::get_assistant(&db, &auth_user.workspace_id, &assistant_id).await?;
    let servers =
        mcp_service::list_for_assistant(&db, &assistant_id, &auth_user.workspace_id).await?;
    Ok(Json(servers.iter().map(McpServerSummary::from).collect()))
}

pub async fn link(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((assistant_id, server_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>, AppError> {
    ws_service::require_editor_role(&db, &auth_user.workspace_id, &auth_user.user_id).await?;
    assistant_service::get_assistant(&db, &auth_user.workspace_id, &assistant_id).await?;
    mcp_service::link(
        &db,
        &auth_user.workspace_id,
        &assistant_id,
        &server_id,
        &auth_user.user_id,
    )
    .await?;
    Ok(Json(json!({"message": "servidor MCP vinculado"})))
}

pub async fn unlink(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((assistant_id, server_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>, AppError> {
    ws_service::require_editor_role(&db, &auth_user.workspace_id, &auth_user.user_id).await?;
    assistant_service::get_assistant(&db, &auth_user.workspace_id, &assistant_id).await?;
    mcp_service::unlink(&db, &auth_user.workspace_id, &assistant_id, &server_id).await?;
    Ok(Json(json!({"message": "servidor MCP desvinculado"})))
}
