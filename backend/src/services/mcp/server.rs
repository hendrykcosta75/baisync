//! MCP server CRUD — one row per registered external MCP endpoint,
//! workspace-scoped.
//!
//! `auth_header_value` is stored AES-GCM encrypted (versioned, same
//! scheme as `workspace_api_keys` migration 101). Never logged, never
//! returned over the wire except at `tools/call` time (decrypted in
//! memory and immediately consumed).
//!
//! URL safety: `create` and `update` call `url_safety::validate_public_url`
//! to reject internal hostnames + private IPs at registration time. The
//! MCP client re-validates before every call to defend DNS rebinding.

use chrono::{DateTime, Utc};
use scylla::frame::value::CqlTimestamp;
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::models::mcp_server::{CreateMcpServerRequest, McpServer, UpdateMcpServerRequest};
use crate::services::encryption::EncryptionService;
use crate::services::skill::slugify;
use crate::services::url_safety::validate_public_url;

fn ts_now() -> CqlTimestamp {
    CqlTimestamp(Utc::now().timestamp_millis())
}

fn validate_transport(t: &str) -> Result<String, AppError> {
    match t {
        "http" | "sse" => Ok(t.to_string()),
        _ => Err(AppError::BadRequest(
            "transport deve ser 'http' ou 'sse'".into(),
        )),
    }
}

pub async fn create(
    db: &DbSession,
    encryption: &EncryptionService,
    workspace_id: &Uuid,
    created_by: &Uuid,
    req: CreateMcpServerRequest,
) -> Result<McpServer, AppError> {
    let name = req.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name vazio".into()));
    }
    let transport = validate_transport(req.transport.trim())?;

    validate_public_url(&req.url)
        .await
        .map_err(|e| AppError::BadRequest(format!("URL inválida: {e}")))?;

    let slug = unique_slug(db, workspace_id, &slugify(name), None).await?;
    let id = Uuid::new_v4();
    let now = ts_now();

    let (enc_value, key_version) = match req.auth_header_value.as_deref() {
        Some(v) if !v.is_empty() => {
            let (ct, ver) = encryption.encrypt_versioned(v)?;
            (Some(ct), Some(ver as i32))
        }
        _ => (None, None),
    };
    let header_name = req
        .auth_header_name
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.mcp_servers (workspace_id, id, slug, name, url, transport, auth_header_name, auth_header_value, key_version, tools_cache, tools_cached_at, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            workspace_id,
            &id,
            &slug,
            name,
            &req.url,
            &transport,
            &header_name,
            &enc_value,
            &key_version,
            &Option::<String>::None,
            &Option::<CqlTimestamp>::None,
            created_by,
            now,
            now,
        ),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(McpServer {
        workspace_id: *workspace_id,
        id,
        slug,
        name: name.to_string(),
        url: req.url,
        transport,
        auth_header_name: header_name,
        auth_header_value_encrypted: enc_value,
        key_version,
        tools_cache: None,
        tools_cached_at: None,
        last_error: None,
        last_error_at: None,
        created_by: *created_by,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    })
}

/// Record a failure from a cache refresh / tool invocation. Truncated to
/// 500 chars to bound log size. Never logged with the auth value attached.
pub async fn record_error(
    db: &DbSession,
    workspace_id: &Uuid,
    server_id: &Uuid,
    error: &str,
) -> Result<(), AppError> {
    let truncated: String = error.chars().take(500).collect();
    let now = ts_now();
    db.query_unpaged(
        "UPDATE inertial_eclipse.mcp_servers SET last_error = ?, last_error_at = ? WHERE workspace_id = ? AND id = ?",
        (&truncated, now, workspace_id, server_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(())
}

/// Clear a previously-recorded error. Called after a successful cache
/// refresh so the UI stops showing a stale red badge.
pub async fn clear_error(
    db: &DbSession,
    workspace_id: &Uuid,
    server_id: &Uuid,
) -> Result<(), AppError> {
    db.query_unpaged(
        "UPDATE inertial_eclipse.mcp_servers SET last_error = ?, last_error_at = ? WHERE workspace_id = ? AND id = ?",
        (&Option::<String>::None, &Option::<CqlTimestamp>::None, workspace_id, server_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(())
}

pub async fn list(
    db: &DbSession,
    workspace_id: &Uuid,
) -> Result<Vec<McpServer>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT workspace_id, id, slug, name, url, transport, auth_header_name, auth_header_value, key_version, tools_cache, tools_cached_at, last_error, last_error_at, created_by, created_at, updated_at FROM inertial_eclipse.mcp_servers WHERE workspace_id = ?",
            (workspace_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;
    let mut out = Vec::new();
    for row in rows
        .rows::<McpRow>()?
        .flatten()
    {
        out.push(row_to_server(row));
    }
    Ok(out)
}

pub async fn get(
    db: &DbSession,
    workspace_id: &Uuid,
    id: &Uuid,
) -> Result<Option<McpServer>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT workspace_id, id, slug, name, url, transport, auth_header_name, auth_header_value, key_version, tools_cache, tools_cached_at, last_error, last_error_at, created_by, created_at, updated_at FROM inertial_eclipse.mcp_servers WHERE workspace_id = ? AND id = ?",
            (workspace_id, id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;
    let row = rows.maybe_first_row::<McpRow>()?;
    Ok(row.map(row_to_server))
}

pub async fn update(
    db: &DbSession,
    encryption: &EncryptionService,
    workspace_id: &Uuid,
    id: &Uuid,
    req: UpdateMcpServerRequest,
) -> Result<McpServer, AppError> {
    let mut existing = get(db, workspace_id, id)
        .await?
        .ok_or_else(|| AppError::NotFound("servidor MCP não encontrado".into()))?;

    if let Some(name) = req.name.as_deref().map(str::trim) {
        if name.is_empty() {
            return Err(AppError::BadRequest("name vazio".into()));
        }
        let new_slug_base = slugify(name);
        if new_slug_base != existing.slug {
            let fresh = unique_slug(db, workspace_id, &new_slug_base, Some(id)).await?;
            existing.slug = fresh;
        }
        existing.name = name.to_string();
    }
    if let Some(url) = req.url.as_deref() {
        validate_public_url(url)
            .await
            .map_err(|e| AppError::BadRequest(format!("URL inválida: {e}")))?;
        existing.url = url.to_string();
    }
    if let Some(t) = req.transport.as_deref() {
        existing.transport = validate_transport(t.trim())?;
    }
    if let Some(hn) = req.auth_header_name {
        let trimmed = hn.trim();
        existing.auth_header_name = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        };
    }
    // `auth_header_value`: only re-encrypt if explicitly provided. Empty
    // string clears the credential; None leaves the existing ciphertext.
    if let Some(v) = req.auth_header_value.as_deref() {
        if v.is_empty() {
            existing.auth_header_value_encrypted = None;
            existing.key_version = None;
        } else {
            let (ct, ver) = encryption.encrypt_versioned(v)?;
            existing.auth_header_value_encrypted = Some(ct);
            existing.key_version = Some(ver as i32);
        }
        // Credential change invalidates any cached tools list — force refresh
        // next invocation so stale credentials surface immediately.
        existing.tools_cache = None;
        existing.tools_cached_at = None;
    }

    let now = ts_now();
    db.query_unpaged(
        "UPDATE inertial_eclipse.mcp_servers SET slug = ?, name = ?, url = ?, transport = ?, auth_header_name = ?, auth_header_value = ?, key_version = ?, tools_cache = ?, tools_cached_at = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
        (
            &existing.slug,
            &existing.name,
            &existing.url,
            &existing.transport,
            &existing.auth_header_name,
            &existing.auth_header_value_encrypted,
            &existing.key_version,
            &existing.tools_cache,
            &existing.tools_cached_at.map(|t| CqlTimestamp(t.timestamp_millis())),
            now,
            workspace_id,
            id,
        ),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    existing.updated_at = Utc::now();
    Ok(existing)
}

pub async fn delete(
    db: &DbSession,
    workspace_id: &Uuid,
    id: &Uuid,
) -> Result<(), AppError> {
    let result = db
        .query_unpaged(
            "SELECT assistant_id FROM inertial_eclipse.assistant_mcp_servers WHERE server_id = ? ALLOW FILTERING",
            (id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;
    for row in rows.rows::<(Uuid,)>()?.flatten() {
        let _ = db
            .query_unpaged(
                "DELETE FROM inertial_eclipse.assistant_mcp_servers WHERE assistant_id = ? AND workspace_id = ? AND server_id = ?",
                (&row.0, workspace_id, id),
            )
            .await;
    }

    db.query_unpaged(
        "DELETE FROM inertial_eclipse.mcp_servers WHERE workspace_id = ? AND id = ?",
        (workspace_id, id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(())
}

pub async fn link(
    db: &DbSession,
    workspace_id: &Uuid,
    assistant_id: &Uuid,
    server_id: &Uuid,
    linked_by: &Uuid,
) -> Result<(), AppError> {
    if get(db, workspace_id, server_id).await?.is_none() {
        return Err(AppError::NotFound("servidor MCP não encontrado".into()));
    }
    let now = ts_now();
    db.query_unpaged(
        "INSERT INTO inertial_eclipse.assistant_mcp_servers (assistant_id, workspace_id, server_id, linked_by, linked_at) VALUES (?, ?, ?, ?, ?)",
        (assistant_id, workspace_id, server_id, linked_by, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(())
}

pub async fn unlink(
    db: &DbSession,
    workspace_id: &Uuid,
    assistant_id: &Uuid,
    server_id: &Uuid,
) -> Result<(), AppError> {
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.assistant_mcp_servers WHERE assistant_id = ? AND workspace_id = ? AND server_id = ?",
        (assistant_id, workspace_id, server_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(())
}

pub async fn list_for_assistant(
    db: &DbSession,
    assistant_id: &Uuid,
    workspace_id: &Uuid,
) -> Result<Vec<McpServer>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT server_id FROM inertial_eclipse.assistant_mcp_servers WHERE assistant_id = ? AND workspace_id = ?",
            (assistant_id, workspace_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;
    let mut ids: Vec<Uuid> = Vec::new();
    for row in rows.rows::<(Uuid,)>()?.flatten() {
        ids.push(row.0);
    }

    let mut out = Vec::with_capacity(ids.len());
    for sid in &ids {
        if let Some(s) = get(db, workspace_id, sid).await? {
            out.push(s);
        }
    }
    Ok(out)
}

/// Decrypt `auth_header_value` using the row's `key_version`. Returns
/// `Ok(None)` for servers without auth. Caller must never log the
/// returned plaintext.
pub fn decrypt_auth_value(
    encryption: &EncryptionService,
    server: &McpServer,
) -> Result<Option<String>, AppError> {
    match (&server.auth_header_value_encrypted, server.key_version) {
        (None, _) => Ok(None),
        (Some(ct), Some(v)) => encryption.decrypt_versioned(ct, v as u32).map(Some),
        (Some(_), None) => Err(AppError::EncryptionError(
            "auth_header_value encrypted mas key_version ausente".into(),
        )),
    }
}

async fn unique_slug(
    db: &DbSession,
    workspace_id: &Uuid,
    base: &str,
    skip_id: Option<&Uuid>,
) -> Result<String, AppError> {
    let existing = list(db, workspace_id).await?;
    let taken: std::collections::HashSet<String> = existing
        .iter()
        .filter(|s| skip_id.is_none_or(|id| &s.id != id))
        .map(|s| s.slug.clone())
        .collect();

    if !taken.contains(base) {
        return Ok(base.to_string());
    }
    for n in 2..1000u32 {
        let candidate = format!("{base}_{n}");
        if !taken.contains(&candidate) {
            return Ok(candidate);
        }
    }
    Err(AppError::BadRequest(
        "impossível gerar slug único — renomeie o servidor".into(),
    ))
}

// ─── Row typing helpers ───

type McpRow = (
    Uuid,                    // workspace_id
    Uuid,                    // id
    Option<String>,          // slug
    Option<String>,          // name
    Option<String>,          // url
    Option<String>,          // transport
    Option<String>,          // auth_header_name
    Option<String>,          // auth_header_value
    Option<i32>,             // key_version
    Option<String>,          // tools_cache
    Option<DateTime<Utc>>,   // tools_cached_at
    Option<String>,          // last_error
    Option<DateTime<Utc>>,   // last_error_at
    Option<Uuid>,            // created_by
    Option<DateTime<Utc>>,   // created_at
    Option<DateTime<Utc>>,   // updated_at
);

fn row_to_server(row: McpRow) -> McpServer {
    McpServer {
        workspace_id: row.0,
        id: row.1,
        slug: row.2.unwrap_or_default(),
        name: row.3.unwrap_or_default(),
        url: row.4.unwrap_or_default(),
        transport: row.5.unwrap_or_else(|| "http".to_string()),
        auth_header_name: row.6,
        auth_header_value_encrypted: row.7,
        key_version: row.8,
        tools_cache: row.9,
        tools_cached_at: row.10,
        last_error: row.11,
        last_error_at: row.12,
        created_by: row.13.unwrap_or(Uuid::nil()),
        created_at: row.14.unwrap_or_else(Utc::now),
        updated_at: row.15.unwrap_or_else(Utc::now),
    }
}
