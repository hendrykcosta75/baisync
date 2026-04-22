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
use crate::services::url_safety::validate_public_url;
use crate::services::workspace as ws_service;

use crate::handlers::assistants::ShareTokenQuery;

pub async fn list(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(assistant_id): Path<Uuid>,
    Query(query): Query<ShareTokenQuery>,
) -> Result<Json<Vec<AssistantTool>>, AppError> {
    assistant_service::resolve_assistant_access(
        &db,
        &auth_user.workspace_id,
        &assistant_id,
        query.share_token.as_deref(),
        "read",
    )
    .await?;
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
        &db,
        &auth_user.workspace_id,
        &assistant_id,
        query.share_token.as_deref(),
        "admin",
    )
    .await?;
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
        &db,
        &auth_user.workspace_id,
        &assistant_id,
        query.share_token.as_deref(),
        "admin",
    )
    .await?;
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
        &db,
        &auth_user.workspace_id,
        &assistant_id,
        query.share_token.as_deref(),
        "admin",
    )
    .await?;
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
        &db,
        &auth_user.workspace_id,
        &assistant_id,
        query.share_token.as_deref(),
        "read",
    )
    .await?;
    let limit = query.limit.unwrap_or(50).min(200);
    let paginated = assistant_service::list_tool_call_logs_paged(
        &db,
        &assistant_id,
        &tool_id,
        limit,
        query.cursor.as_deref(),
    )
    .await?;
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

// 30 requests per minute per user. Rate-limit check runs BEFORE URL
// validation so SSRF attempts also consume the attacker's budget.
const TEST_URL_RATE_LIMIT_PER_MIN: i64 = 30;

fn current_minute_bucket() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M").to_string()
}

async fn get_test_url_count(db: &DbSession, user_id: &Uuid) -> i64 {
    let bucket = current_minute_bucket();
    let result = db
        .query_unpaged(
            "SELECT count FROM inertial_eclipse.tools_test_url_rate_limits WHERE user_id = ? AND minute_bucket = ?",
            (user_id, &bucket as &str),
        )
        .await;

    match result {
        Ok(res) => {
            if let Ok(rows) = res.into_rows_result() {
                if let Ok(Some((count,))) = rows.maybe_first_row::<(i64,)>() {
                    count
                } else {
                    0
                }
            } else {
                0
            }
        }
        Err(_) => 0,
    }
}

async fn increment_test_url_count(db: &DbSession, user_id: &Uuid) {
    let bucket = current_minute_bucket();
    let _ = db
        .query_unpaged(
            "UPDATE inertial_eclipse.tools_test_url_rate_limits SET count = count + 1 WHERE user_id = ? AND minute_bucket = ?",
            (user_id, &bucket as &str),
        )
        .await;
}

fn url_error_response() -> TestUrlResponse {
    TestUrlResponse {
        ok: false,
        status: 0,
        content_type: None,
        content_length: None,
        error: Some("URL bloqueada: endereço interno ou esquema inválido".into()),
    }
}

pub async fn test_url(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<TestUrlRequest>,
) -> Json<TestUrlResponse> {
    // Rate limit check FIRST — even invalid URLs consume budget so that
    // an attacker probing internal hosts can't hammer the endpoint for free.
    let used = get_test_url_count(&db, &auth_user.user_id).await;
    if used >= TEST_URL_RATE_LIMIT_PER_MIN {
        return Json(TestUrlResponse {
            ok: false,
            status: 0,
            content_type: None,
            content_length: None,
            error: Some("Muitas requisições. Tente novamente em 1 minuto.".into()),
        });
    }
    increment_test_url_count(&db, &auth_user.user_id).await;

    let url = match validate_public_url(&req.url).await {
        Ok(u) => u,
        Err(_) => return Json(url_error_response()),
    };

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return Json(TestUrlResponse {
                ok: false,
                status: 0,
                content_type: None,
                content_length: None,
                error: Some(e.to_string()),
            })
        }
    };

    // Try HEAD first, fall back to GET for servers that don't accept HEAD
    let first = match client.head(url.as_str()).send().await {
        Ok(r) if r.status().is_success() || r.status().is_redirection() => Ok(r),
        _ => client.get(url.as_str()).send().await,
    };

    let resp = match first {
        Ok(r) if r.status().is_redirection() => {
            let next = r
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .and_then(|s| url.join(s).ok());
            match next {
                Some(next_url) => match validate_public_url(next_url.as_str()).await {
                    Ok(valid) => match client.get(valid.as_str()).send().await {
                        Ok(r2) => r2,
                        // Preserve the original redirect response on second-hop failure
                        Err(_) => r,
                    },
                    // Redirect pointed somewhere internal — reject generically
                    Err(_) => return Json(url_error_response()),
                },
                None => r,
            }
        }
        Ok(r) => r,
        Err(e) => {
            return Json(TestUrlResponse {
                ok: false,
                status: 0,
                content_type: None,
                content_length: None,
                error: Some(e.to_string()),
            })
        }
    };

    let status = resp.status().as_u16();
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let content_length = resp
        .headers()
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

// URL-safety tests migrated to `services/url_safety.rs`.
