use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServer {
    pub workspace_id: Uuid,
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub url: String,
    pub transport: String,
    pub auth_header_name: Option<String>,
    #[serde(skip_serializing)]
    pub auth_header_value_encrypted: Option<String>,
    #[serde(skip_serializing)]
    pub key_version: Option<i32>,
    #[serde(skip_serializing)]
    pub tools_cache: Option<String>,
    pub tools_cached_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    pub last_error_at: Option<DateTime<Utc>>,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct McpServerSummary {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub url: String,
    pub transport: String,
    pub auth_header_name: Option<String>,
    pub has_auth_header: bool,
    pub tools_count: Option<usize>,
    pub tools_cached_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    pub last_error_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<&McpServer> for McpServerSummary {
    fn from(s: &McpServer) -> Self {
        let tools_count = s
            .tools_cache
            .as_deref()
            .and_then(|c| serde_json::from_str::<serde_json::Value>(c).ok())
            .and_then(|v| v.as_array().map(|a| a.len()));
        Self {
            id: s.id,
            slug: s.slug.clone(),
            name: s.name.clone(),
            url: s.url.clone(),
            transport: s.transport.clone(),
            auth_header_name: s.auth_header_name.clone(),
            has_auth_header: s.auth_header_value_encrypted.is_some(),
            tools_count,
            tools_cached_at: s.tools_cached_at,
            last_error: s.last_error.clone(),
            last_error_at: s.last_error_at,
            created_at: s.created_at,
            updated_at: s.updated_at,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct CreateMcpServerRequest {
    pub name: String,
    pub url: String,
    pub transport: String,
    pub auth_header_name: Option<String>,
    pub auth_header_value: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateMcpServerRequest {
    pub name: Option<String>,
    pub url: Option<String>,
    pub transport: Option<String>,
    pub auth_header_name: Option<String>,
    pub auth_header_value: Option<String>,
}
