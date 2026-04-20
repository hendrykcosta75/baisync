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

const BLOCKED_HOSTS: &[&str] = &[
    "baileys",
    "cassandra",
    "redis",
    "livekit",
    "backend",
    "frontend",
    "localhost",
    "host.docker.internal",
];

fn is_blocked_ip(ip: &std::net::IpAddr) -> bool {
    use std::net::IpAddr;
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_multicast()
                || v4.is_unspecified()
                || v4.is_broadcast()
                // CGNAT 100.64.0.0/10 (RFC 6598)
                || (o[0] == 100 && (64..=127).contains(&o[1]))
                // Reserved 240.0.0.0/4
                || o[0] >= 240
        }
        IpAddr::V6(v6) => {
            if v6.is_loopback() || v6.is_unspecified() || v6.is_multicast() {
                return true;
            }
            // IPv4-mapped IPv6 — apply IPv4 checks to the embedded address
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_blocked_ip(&IpAddr::V4(v4));
            }
            let s = v6.segments()[0];
            // fc00::/7 (unique-local) OR fe80::/10 (link-local)
            (s & 0xfe00) == 0xfc00 || (s & 0xffc0) == 0xfe80
        }
    }
}

/// Validate that `raw` is a publicly reachable http(s) URL. Rejects internal
/// hostnames, non-http(s) schemes, and URLs whose DNS resolves to any
/// loopback/private/link-local/CGNAT/reserved address (IPv4 and IPv6).
async fn validate_public_url(raw: &str) -> Result<reqwest::Url, &'static str> {
    let url = reqwest::Url::parse(raw).map_err(|_| "URL inválida")?;
    match url.scheme() {
        "http" | "https" => {}
        _ => return Err("esquema não suportado"),
    }
    let host = url.host_str().ok_or("sem host")?.to_lowercase();
    if BLOCKED_HOSTS.iter().any(|h| host == *h) {
        return Err("host interno");
    }
    let port = url.port_or_known_default().ok_or("porta inválida")?;
    let addrs: Vec<std::net::SocketAddr> = tokio::net::lookup_host((host.as_str(), port))
        .await
        .map_err(|_| "DNS falhou")?
        .collect();
    if addrs.is_empty() {
        return Err("DNS vazio");
    }
    if addrs.iter().any(|a| is_blocked_ip(&a.ip())) {
        return Err("endereço bloqueado");
    }
    Ok(url)
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
    Extension(_auth_user): Extension<AuthUser>,
    Json(req): Json<TestUrlRequest>,
) -> Json<TestUrlResponse> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn reject_invalid_scheme() {
        assert!(validate_public_url("file:///etc/passwd").await.is_err());
        assert!(validate_public_url("ftp://example.com/").await.is_err());
        assert!(validate_public_url("gopher://example.com/").await.is_err());
    }

    #[tokio::test]
    async fn reject_blocked_hostnames() {
        assert!(validate_public_url("http://localhost/").await.is_err());
        assert!(validate_public_url("http://cassandra:9042/").await.is_err());
        assert!(validate_public_url("http://baileys:3025/").await.is_err());
        assert!(validate_public_url("http://redis/").await.is_err());
        assert!(validate_public_url("http://host.docker.internal/").await.is_err());
    }

    #[tokio::test]
    async fn reject_loopback_ip() {
        assert!(validate_public_url("http://127.0.0.1/").await.is_err());
        assert!(validate_public_url("http://127.1.2.3/").await.is_err());
    }

    #[tokio::test]
    async fn reject_private_ipv4() {
        assert!(validate_public_url("http://10.0.0.1/").await.is_err());
        assert!(validate_public_url("http://192.168.1.1/").await.is_err());
        assert!(validate_public_url("http://172.16.0.1/").await.is_err());
    }

    #[tokio::test]
    async fn reject_link_local_ip() {
        // AWS/GCP instance metadata — the canonical SSRF target
        assert!(validate_public_url("http://169.254.169.254/").await.is_err());
    }

    #[tokio::test]
    async fn reject_cgnat_ip() {
        assert!(validate_public_url("http://100.64.1.1/").await.is_err());
        assert!(validate_public_url("http://100.127.255.255/").await.is_err());
    }

    #[tokio::test]
    async fn reject_reserved_ipv4() {
        assert!(validate_public_url("http://240.0.0.1/").await.is_err());
    }

    #[tokio::test]
    async fn reject_ipv6_loopback_and_ula() {
        assert!(validate_public_url("http://[::1]/").await.is_err());
        assert!(validate_public_url("http://[fc00::1]/").await.is_err());
        assert!(validate_public_url("http://[fe80::1]/").await.is_err());
    }

    #[tokio::test]
    async fn accept_public_ipv4() {
        // 1.1.1.1 is Cloudflare DNS — public, not in any blocked range
        assert!(validate_public_url("http://1.1.1.1/").await.is_ok());
    }
}
