//! MCP tools/list cache. First LLM turn to reach an assistant populates
//! the cache; subsequent turns within 10 minutes reuse it. Credential or
//! URL changes invalidate the cache (cleared inline in `server::update`).
//!
//! The cache lives on the `mcp_servers` row itself (`tools_cache` +
//! `tools_cached_at`) rather than in an in-process HashMap — that way
//! restarts don't trigger a stampede of `tools/list` calls across every
//! assistant's first LLM turn post-deploy.

use chrono::Utc;
use scylla::frame::value::CqlTimestamp;
use serde_json::json;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::models::mcp_server::McpServer;
use crate::services::encryption::EncryptionService;
use crate::services::llm::LlmTool;
use crate::services::mcp::client::{self, McpToolSchema};
use crate::services::mcp::server as server_svc;

const CACHE_TTL_SECONDS: i64 = 600;

/// Return the LLM-facing tool list for this server, using the cached
/// `tools/list` result when fresh (≤10 min old). On cache miss or
/// expiry, re-fetch, persist, and return. Never fails the whole request
/// if the server is temporarily unreachable — returns empty vec so the
/// LLM just doesn't see this server's tools this turn.
pub async fn ensure_tools_cached(
    db: &DbSession,
    encryption: &EncryptionService,
    server: &McpServer,
) -> Result<Vec<LlmTool>, AppError> {
    if is_fresh(server) {
        if let Some(cache) = &server.tools_cache {
            if let Ok(schemas) = serde_json::from_str::<Vec<McpToolSchema>>(cache) {
                return Ok(schemas_to_llm_tools(server, &schemas));
            }
        }
    }

    match client::session_tools_list(server, encryption).await {
        Ok(schemas) => {
            persist_cache(db, server, &schemas).await.ok();
            // Clear any previously-recorded error so the UI drops the red badge.
            let _ = server_svc::clear_error(db, &server.workspace_id, &server.id).await;
            Ok(schemas_to_llm_tools(server, &schemas))
        }
        Err(e) => {
            let msg = e.to_string();
            tracing::warn!(
                server_id = %server.id,
                workspace_id = %server.workspace_id,
                error = %msg,
                "mcp.tools_list failed; skipping this server for this turn"
            );
            // Persist the last error so the UI can surface it with a red
            // badge instead of the LLM silently seeing zero tools.
            let _ =
                server_svc::record_error(db, &server.workspace_id, &server.id, &msg).await;
            Ok(Vec::new())
        }
    }
}

fn is_fresh(server: &McpServer) -> bool {
    match server.tools_cached_at {
        Some(ts) => (Utc::now() - ts).num_seconds() < CACHE_TTL_SECONDS,
        None => false,
    }
}

async fn persist_cache(
    db: &DbSession,
    server: &McpServer,
    schemas: &[McpToolSchema],
) -> Result<(), AppError> {
    let serialized = serde_json::to_string(schemas)
        .map_err(|e| AppError::InternalError(e.to_string()))?;
    let now = CqlTimestamp(Utc::now().timestamp_millis());
    db.query_unpaged(
        "UPDATE inertial_eclipse.mcp_servers SET tools_cache = ?, tools_cached_at = ? WHERE workspace_id = ? AND id = ?",
        (&serialized, now, &server.workspace_id, &server.id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(())
}

/// Convert MCP tool schemas → LLM-facing tools with `<slug>__<tool>`
/// prefix so two servers exposing `search` can coexist. `body_content`
/// carries the server id so the dispatcher can resolve back to the
/// server without re-parsing the prefix.
pub fn schemas_to_llm_tools(server: &McpServer, schemas: &[McpToolSchema]) -> Vec<LlmTool> {
    schemas
        .iter()
        .map(|s| LlmTool {
            id: None,
            name: format!("{}__{}", server.slug, s.name),
            description: s.description.clone(),
            parameters: if s.input_schema.is_object() {
                s.input_schema.clone()
            } else {
                json!({"type": "object", "properties": {}})
            },
            endpoint: String::new(),
            method: String::new(),
            headers: None,
            auth: None,
            query_params: None,
            body_content_type: Some(server.id.to_string()),
            body_content: Some(s.name.clone()),
            tool_type: "mcp".to_string(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;
    use uuid::Uuid;

    fn stub_server(cached_at: Option<chrono::DateTime<Utc>>) -> McpServer {
        McpServer {
            workspace_id: Uuid::nil(),
            id: Uuid::nil(),
            slug: "test".into(),
            name: "Test".into(),
            url: "https://example.com/mcp".into(),
            transport: "http".into(),
            auth_header_name: None,
            auth_header_value_encrypted: None,
            key_version: None,
            tools_cache: None,
            tools_cached_at: cached_at,
            last_error: None,
            last_error_at: None,
            created_by: Uuid::nil(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn cache_null_is_stale() {
        assert!(!is_fresh(&stub_server(None)));
    }

    #[test]
    fn cache_just_fetched_is_fresh() {
        assert!(is_fresh(&stub_server(Some(Utc::now()))));
    }

    #[test]
    fn cache_older_than_ttl_is_stale() {
        let old = Utc::now() - Duration::seconds(CACHE_TTL_SECONDS + 1);
        assert!(!is_fresh(&stub_server(Some(old))));
    }

    #[test]
    fn schemas_to_llm_tools_prefixes_names() {
        let server = stub_server(None);
        let schemas = vec![
            McpToolSchema {
                name: "search".into(),
                description: "Busca".into(),
                input_schema: json!({"type": "object"}),
            },
            McpToolSchema {
                name: "write".into(),
                description: "Escreve".into(),
                input_schema: json!({"type": "object"}),
            },
        ];
        let tools = schemas_to_llm_tools(&server, &schemas);
        assert_eq!(tools[0].name, "test__search");
        assert_eq!(tools[1].name, "test__write");
        assert_eq!(tools[0].tool_type, "mcp");
    }
}
