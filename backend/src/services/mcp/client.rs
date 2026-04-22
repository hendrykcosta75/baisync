//! High-level MCP client — wraps `HttpTransport` into three operations
//! the rest of the codebase needs: `initialize`, `tools_list`, `tools_call`.
//!
//! Each op opens a fresh transport (V1 pragmatism — no session reuse
//! across HTTP calls). MCP protocol version negotiated: 2025-03-26.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::errors::AppError;
use crate::models::mcp_server::McpServer;
use crate::services::encryption::EncryptionService;
use crate::services::mcp::server as server_svc;
use crate::services::mcp::transport::HttpTransport;

const PROTOCOL_VERSION: &str = "2025-03-26";
const CLIENT_NAME: &str = "inertial-eclipse";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolSchema {
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub input_schema: Value,
}

#[derive(Debug, Clone)]
pub struct McpToolResult {
    pub content_text: String,
    pub is_error: bool,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct McpInitResult {
    pub protocol_version: String,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
}

fn build_transport(
    server: &McpServer,
    auth_header_value: Option<String>,
) -> Result<HttpTransport, AppError> {
    match server.transport.as_str() {
        "http" => HttpTransport::new(
            server.url.clone(),
            server.auth_header_name.clone(),
            auth_header_value,
        ),
        "sse" => Err(AppError::BadRequest(
            "Transport SSE ainda não implementado — use 'http' (streamable)".into(),
        )),
        other => Err(AppError::BadRequest(format!(
            "Transport desconhecido: {other}"
        ))),
    }
}

pub async fn initialize(transport: &HttpTransport) -> Result<McpInitResult, AppError> {
    let req = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {
                "name": CLIENT_NAME,
                "version": env!("CARGO_PKG_VERSION"),
            }
        }
    });
    let resp = transport.call(req).await?;
    if let Some(err) = resp.get("error") {
        return Err(AppError::InternalError(format!(
            "MCP initialize error: {err}"
        )));
    }
    let result = resp
        .get("result")
        .ok_or_else(|| AppError::InternalError("initialize sem 'result'".into()))?;
    // Fire-and-forget `notifications/initialized` per spec. Ignored if
    // server doesn't care. Don't block on it.
    let _ = transport
        .call(json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
        }))
        .await;
    Ok(McpInitResult {
        protocol_version: result["protocolVersion"]
            .as_str()
            .unwrap_or(PROTOCOL_VERSION)
            .to_string(),
        server_name: result["serverInfo"]["name"].as_str().map(String::from),
        server_version: result["serverInfo"]["version"].as_str().map(String::from),
    })
}

pub async fn tools_list(transport: &HttpTransport) -> Result<Vec<McpToolSchema>, AppError> {
    let req = json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list",
    });
    let resp = transport.call(req).await?;
    if let Some(err) = resp.get("error") {
        return Err(AppError::InternalError(format!(
            "MCP tools/list error: {err}"
        )));
    }
    let arr = resp["result"]["tools"]
        .as_array()
        .ok_or_else(|| AppError::InternalError("tools/list sem array 'tools'".into()))?;
    let mut out = Vec::with_capacity(arr.len());
    for t in arr {
        let Some(name) = t.get("name").and_then(|v| v.as_str()) else {
            continue;
        };
        out.push(McpToolSchema {
            name: name.to_string(),
            description: t
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            input_schema: t
                .get("inputSchema")
                .cloned()
                .unwrap_or_else(|| json!({"type": "object"})),
        });
    }
    Ok(out)
}

pub async fn tools_call(
    transport: &HttpTransport,
    name: &str,
    arguments: &Value,
) -> Result<McpToolResult, AppError> {
    let req = json!({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": { "name": name, "arguments": arguments },
    });
    let resp = transport.call(req).await?;
    if let Some(err) = resp.get("error") {
        return Err(AppError::InternalError(format!(
            "MCP tools/call error: {err}"
        )));
    }
    let result = &resp["result"];
    let is_error = result["isError"].as_bool().unwrap_or(false);
    let content_text = result["content"]
        .as_array()
        .map(|parts| {
            parts
                .iter()
                .filter_map(|p| p.get("text").and_then(|v| v.as_str()))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();
    Ok(McpToolResult {
        content_text,
        is_error,
    })
}

/// Initialize + tools/list in a single transport lifetime. Used by the
/// cache layer and `POST /api/mcp-servers/:id/test`.
pub async fn session_tools_list(
    server: &McpServer,
    encryption: &EncryptionService,
) -> Result<Vec<McpToolSchema>, AppError> {
    let auth = server_svc::decrypt_auth_value(encryption, server)?;
    let transport = build_transport(server, auth)?;
    initialize(&transport).await?;
    tools_list(&transport).await
}

/// Initialize + tools/call. Used by the LLM tool dispatcher.
pub async fn session_tools_call(
    server: &McpServer,
    encryption: &EncryptionService,
    tool_name: &str,
    arguments: &Value,
) -> Result<McpToolResult, AppError> {
    let auth = server_svc::decrypt_auth_value(encryption, server)?;
    let transport = build_transport(server, auth)?;
    initialize(&transport).await?;
    tools_call(&transport, tool_name, arguments).await
}
