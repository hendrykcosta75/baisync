use axum::extract::{Extension, Path, Query};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::models::assistant::{AssistantTool, CreateToolRequest, ToolCallLog, UpdateToolRequest};
use crate::services::assistant as assistant_service;
use crate::services::workspace as ws_service;

use crate::handlers::assistants::ShareTokenQuery;

pub async fn list(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(assistant_id): Path<Uuid>,
    Query(query): Query<ShareTokenQuery>,
) -> Result<Json<Vec<AssistantTool>>, AppError> {
    assistant_service::resolve_assistant_access(
        &db, &auth_user.workspace_id, &assistant_id, query.share_token.as_deref(), "read",
    ).await?;
    let tools = assistant_service::list_tools(&db, &assistant_id).await?;
    Ok(Json(tools))
}

pub async fn create(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(assistant_id): Path<Uuid>,
    Query(query): Query<ShareTokenQuery>,
    Json(req): Json<CreateToolRequest>,
) -> Result<Json<AssistantTool>, AppError> {
    if query.share_token.is_none() {
        ws_service::require_editor_role(&db, &auth_user.workspace_id, &auth_user.user_id).await?;
    }
    assistant_service::resolve_assistant_access(
        &db, &auth_user.workspace_id, &assistant_id, query.share_token.as_deref(), "admin",
    ).await?;
    let tool = assistant_service::create_tool(&db, &assistant_id, req).await?;
    Ok(Json(tool))
}

pub async fn update(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((assistant_id, tool_id)): Path<(Uuid, Uuid)>,
    Query(query): Query<ShareTokenQuery>,
    Json(req): Json<UpdateToolRequest>,
) -> Result<Json<AssistantTool>, AppError> {
    if query.share_token.is_none() {
        ws_service::require_editor_role(&db, &auth_user.workspace_id, &auth_user.user_id).await?;
    }
    assistant_service::resolve_assistant_access(
        &db, &auth_user.workspace_id, &assistant_id, query.share_token.as_deref(), "admin",
    ).await?;
    let tool = assistant_service::update_tool(&db, &assistant_id, &tool_id, req).await?;
    Ok(Json(tool))
}

pub async fn delete(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((assistant_id, tool_id)): Path<(Uuid, Uuid)>,
    Query(query): Query<ShareTokenQuery>,
) -> Result<Json<Value>, AppError> {
    if query.share_token.is_none() {
        ws_service::require_editor_role(&db, &auth_user.workspace_id, &auth_user.user_id).await?;
    }
    assistant_service::resolve_assistant_access(
        &db, &auth_user.workspace_id, &assistant_id, query.share_token.as_deref(), "admin",
    ).await?;
    assistant_service::delete_tool(&db, &assistant_id, &tool_id).await?;
    Ok(Json(json!({"message": "Tool deleted"})))
}

#[derive(Deserialize)]
pub struct CallLogsQuery {
    pub limit: Option<i32>,
    pub cursor: Option<String>,
    pub share_token: Option<String>,
}

pub async fn list_calls(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((assistant_id, tool_id)): Path<(Uuid, Uuid)>,
    Query(query): Query<CallLogsQuery>,
) -> Result<Json<crate::models::pagination::PaginatedResponse<ToolCallLog>>, AppError> {
    assistant_service::resolve_assistant_access(
        &db, &auth_user.workspace_id, &assistant_id, query.share_token.as_deref(), "read",
    ).await?;
    let limit = query.limit.unwrap_or(50).min(200);
    let paginated = assistant_service::list_tool_call_logs_paged(&db, &assistant_id, &tool_id, limit, query.cursor.as_deref()).await?;
    Ok(Json(paginated))
}

// ─── POST /api/tools/test-url ────────────────────────────────────────────────
// Tests if the server can fetch a URL (HEAD request) and returns metadata.

#[derive(Deserialize)]
pub struct TestUrlRequest {
    pub url: String,
}

#[derive(Serialize)]
pub struct TestUrlResponse {
    pub ok: bool,
    pub status: u16,
    pub content_type: Option<String>,
    pub content_length: Option<u64>,
    pub error: Option<String>,
}

pub async fn test_url(
    Extension(_auth_user): Extension<AuthUser>,
    Json(req): Json<TestUrlRequest>,
) -> Json<TestUrlResponse> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_default();

    // Try HEAD first, fall back to GET
    let result = match client.head(&req.url).send().await {
        Ok(resp) if resp.status().is_success() || resp.status().is_redirection() => Ok(resp),
        _ => client.get(&req.url).send().await,
    };

    match result {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let content_type = resp.headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());
            let content_length = resp.headers()
                .get("content-length")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok());

            Json(TestUrlResponse {
                ok: resp.status().is_success(),
                status,
                content_type,
                content_length,
                error: None,
            })
        }
        Err(e) => {
            Json(TestUrlResponse {
                ok: false,
                status: 0,
                content_type: None,
                content_length: None,
                error: Some(e.to_string()),
            })
        }
    }
}
