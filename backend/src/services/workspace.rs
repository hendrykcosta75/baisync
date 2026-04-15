use chrono::{DateTime, Utc};
use scylla::frame::value::CqlTimestamp;
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::models::workspace::{
    UserWorkspace, Workspace, WorkspaceApiKeys, WorkspaceInvite, WorkspaceMember,
};
use crate::services::encryption::EncryptionService;

fn ts_now() -> CqlTimestamp {
    CqlTimestamp(Utc::now().timestamp_millis())
}

// ─── Workspace CRUD ───

pub async fn create_workspace(
    db: &DbSession,
    name: &str,
    workspace_type: &str,
    owner_id: &Uuid,
) -> Result<Workspace, AppError> {
    let id = Uuid::new_v4();
    let now = ts_now();

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.workspaces (id, name, type, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        (&id, name, workspace_type, owner_id, now, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Add owner as member
    add_member(db, &id, owner_id, "owner", None).await?;

    Ok(Workspace {
        id,
        name: name.to_string(),
        workspace_type: workspace_type.to_string(),
        owner_id: *owner_id,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    })
}

pub async fn ensure_personal_workspace(
    db: &DbSession,
    user_id: &Uuid,
    user_name: &str,
) -> Result<Workspace, AppError> {
    // Personal workspace has id = user_id
    let existing = get_workspace(db, user_id).await;
    if let Ok(ws) = existing {
        // Ensure denormalized user_workspaces entry exists (may be missing for older users)
        let user_ws = list_user_workspaces(db, user_id).await.unwrap_or_default();
        if !user_ws.iter().any(|w| w.workspace_id == *user_id) {
            let _ = add_member(db, user_id, user_id, "owner", None).await;
        }
        return Ok(ws);
    }

    let now = ts_now();
    let name = format!("Perfil de {}", user_name);

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.workspaces (id, name, type, owner_id, created_at, updated_at) VALUES (?, ?, 'personal', ?, ?, ?) IF NOT EXISTS",
        (user_id, &name as &str, user_id, now, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Add owner as member
    let _ = add_member(db, user_id, user_id, "owner", None).await;

    // Set active workspace
    db.query_unpaged(
        "UPDATE inertial_eclipse.users SET active_workspace_id = ? WHERE id = ?",
        (user_id, user_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(Workspace {
        id: *user_id,
        name,
        workspace_type: "personal".to_string(),
        owner_id: *user_id,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    })
}

pub async fn get_workspace(db: &DbSession, workspace_id: &Uuid) -> Result<Workspace, AppError> {
    let result = db
        .query_unpaged(
            "SELECT id, name, type, owner_id, created_at, updated_at FROM inertial_eclipse.workspaces WHERE id = ?",
            (workspace_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let (id, name, workspace_type, owner_id, created_at, updated_at) = result
        .into_rows_result()?
        .single_row::<(Uuid, String, String, Uuid, DateTime<Utc>, DateTime<Utc>)>()
        .map_err(|_| AppError::NotFound("Workspace not found".into()))?;

    Ok(Workspace {
        id,
        name,
        workspace_type,
        owner_id,
        created_at,
        updated_at,
    })
}

pub async fn update_workspace(
    db: &DbSession,
    workspace_id: &Uuid,
    name: &str,
) -> Result<(), AppError> {
    let now = ts_now();
    db.query_unpaged(
        "UPDATE inertial_eclipse.workspaces SET name = ?, updated_at = ? WHERE id = ?",
        (name, now, workspace_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Update denormalized name in user_workspaces
    let members = list_members(db, workspace_id).await?;
    for m in members {
        db.query_unpaged(
            "UPDATE inertial_eclipse.user_workspaces SET workspace_name = ? WHERE user_id = ? AND workspace_id = ?",
            (name, &m.user_id, workspace_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }

    Ok(())
}

pub async fn delete_workspace(db: &DbSession, workspace_id: &Uuid) -> Result<(), AppError> {
    // Remove all members and their denormalized entries
    let members = list_members(db, workspace_id).await?;
    for m in &members {
        remove_member(db, workspace_id, &m.user_id).await?;

        // Reset active workspace to personal if they were on this workspace
        let active = get_active_workspace_id(db, &m.user_id)
            .await
            .unwrap_or(m.user_id);
        if active == *workspace_id {
            let _ = db
                .query_unpaged(
                    "UPDATE inertial_eclipse.users SET active_workspace_id = ? WHERE id = ?",
                    (&m.user_id, &m.user_id),
                )
                .await;
        }
    }

    // Delete invites
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.workspace_invites WHERE workspace_id = ?",
        (workspace_id,),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Delete API keys
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.workspace_api_keys WHERE workspace_id = ?",
        (workspace_id,),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Delete the workspace itself
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.workspaces WHERE id = ?",
        (workspace_id,),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

pub async fn list_user_workspaces(
    db: &DbSession,
    user_id: &Uuid,
) -> Result<Vec<UserWorkspace>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT user_id, workspace_id, workspace_name, workspace_type, role, joined_at FROM inertial_eclipse.user_workspaces WHERE user_id = ?",
            (user_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;

    let mut workspaces = Vec::new();
    for row in rows
        .rows::<(
            Uuid,
            Uuid,
            Option<String>,
            Option<String>,
            Option<String>,
            DateTime<Utc>,
        )>()?
        .flatten()
    {
        workspaces.push(UserWorkspace {
            user_id: row.0,
            workspace_id: row.1,
            workspace_name: row.2.unwrap_or_default(),
            workspace_type: row.3.unwrap_or_else(|| "personal".to_string()),
            role: row.4.unwrap_or_else(|| "member".to_string()),
            joined_at: row.5,
        });
    }

    Ok(workspaces)
}

pub async fn switch_workspace(
    db: &DbSession,
    user_id: &Uuid,
    workspace_id: &Uuid,
) -> Result<(), AppError> {
    // Verify membership
    let _ = get_member_role(db, workspace_id, user_id).await?;

    db.query_unpaged(
        "UPDATE inertial_eclipse.users SET active_workspace_id = ? WHERE id = ?",
        (workspace_id, user_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

pub async fn get_active_workspace_id(db: &DbSession, user_id: &Uuid) -> Result<Uuid, AppError> {
    let result = db
        .query_unpaged(
            "SELECT active_workspace_id FROM inertial_eclipse.users WHERE id = ?",
            (user_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let (active_ws,) = result
        .into_rows_result()?
        .single_row::<(Option<Uuid>,)>()
        .map_err(|_| AppError::NotFound("User not found".into()))?;

    // Fallback to user_id if no active workspace set
    Ok(active_ws.unwrap_or(*user_id))
}

// ─── Members ───

pub async fn add_member(
    db: &DbSession,
    workspace_id: &Uuid,
    user_id: &Uuid,
    role: &str,
    invited_by: Option<&Uuid>,
) -> Result<(), AppError> {
    let now = ts_now();

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.workspace_members (workspace_id, user_id, role, invited_by, joined_at) VALUES (?, ?, ?, ?, ?)",
        (workspace_id, user_id, role, invited_by, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Denormalized table
    let ws = get_workspace(db, workspace_id).await?;
    db.query_unpaged(
        "INSERT INTO inertial_eclipse.user_workspaces (user_id, workspace_id, workspace_name, workspace_type, role, joined_at) VALUES (?, ?, ?, ?, ?, ?)",
        (user_id, workspace_id, &ws.name as &str, &ws.workspace_type as &str, role, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

pub async fn remove_member(
    db: &DbSession,
    workspace_id: &Uuid,
    user_id: &Uuid,
) -> Result<(), AppError> {
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.workspace_members WHERE workspace_id = ? AND user_id = ?",
        (workspace_id, user_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    db.query_unpaged(
        "DELETE FROM inertial_eclipse.user_workspaces WHERE user_id = ? AND workspace_id = ?",
        (user_id, workspace_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

pub async fn update_member_role(
    db: &DbSession,
    workspace_id: &Uuid,
    user_id: &Uuid,
    role: &str,
) -> Result<(), AppError> {
    db.query_unpaged(
        "UPDATE inertial_eclipse.workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?",
        (role, workspace_id, user_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    db.query_unpaged(
        "UPDATE inertial_eclipse.user_workspaces SET role = ? WHERE user_id = ? AND workspace_id = ?",
        (role, user_id, workspace_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

pub async fn list_members(
    db: &DbSession,
    workspace_id: &Uuid,
) -> Result<Vec<WorkspaceMember>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT workspace_id, user_id, role, invited_by, joined_at FROM inertial_eclipse.workspace_members WHERE workspace_id = ?",
            (workspace_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;

    let mut members = Vec::new();
    for row in rows
        .rows::<(Uuid, Uuid, String, Option<Uuid>, DateTime<Utc>)>()?
        .flatten()
    {
        // Fetch user name and email
        let user_info = db
            .query_unpaged(
                "SELECT name, email FROM inertial_eclipse.users WHERE id = ?",
                (&row.1,),
            )
            .await
            .ok()
            .and_then(|r| r.into_rows_result().ok())
            .and_then(|r| r.maybe_first_row::<(String, String)>().ok().flatten());

        let (user_name, user_email) = match user_info {
            Some((n, e)) => (Some(n), Some(e)),
            None => (None, None),
        };

        members.push(WorkspaceMember {
            workspace_id: row.0,
            user_id: row.1,
            role: row.2,
            invited_by: row.3,
            joined_at: row.4,
            user_name,
            user_email,
        });
    }

    Ok(members)
}

pub async fn get_member_role(
    db: &DbSession,
    workspace_id: &Uuid,
    user_id: &Uuid,
) -> Result<String, AppError> {
    let result = db
        .query_unpaged(
            "SELECT role FROM inertial_eclipse.workspace_members WHERE workspace_id = ? AND user_id = ?",
            (workspace_id, user_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let (role,) = result
        .into_rows_result()?
        .single_row::<(String,)>()
        .map_err(|_| AppError::Forbidden("Not a member of this workspace".into()))?;

    Ok(role)
}

/// Verify the user has owner or admin role in the workspace.
/// Returns Ok(()) or Err(Forbidden) for members without edit rights.
pub async fn require_editor_role(
    db: &DbSession,
    workspace_id: &Uuid,
    user_id: &Uuid,
) -> Result<(), AppError> {
    let role = get_member_role(db, workspace_id, user_id).await?;
    if role != "owner" && role != "admin" {
        return Err(AppError::Forbidden(
            "Apenas administradores podem realizar esta ação".into(),
        ));
    }
    Ok(())
}

// ─── Granular Permission Helpers ───

/// Can create/edit/delete strategic analyses (SWOT, PESTLE, VRIO, etc.)
#[allow(dead_code)]
pub fn can_edit_strategy(role: &str) -> bool {
    matches!(role, "owner" | "admin" | "strategist")
}

/// Can create/edit/delete OKRs (objectives, key results)
#[allow(dead_code)]
pub fn can_edit_okrs(role: &str) -> bool {
    matches!(role, "owner" | "admin" | "strategist")
}

/// Can add items to existing analyses (SWOT items, PESTLE factors, etc.)
#[allow(dead_code)]
pub fn can_add_items(role: &str) -> bool {
    matches!(role, "owner" | "admin" | "strategist" | "analyst")
}

/// Can perform check-ins on key results
#[allow(dead_code)]
pub fn can_checkin(role: &str) -> bool {
    matches!(
        role,
        "owner" | "admin" | "strategist" | "analyst" | "member"
    )
}

/// Can manage workspace settings, invite/remove members
#[allow(dead_code)]
pub fn can_manage_workspace(role: &str) -> bool {
    matches!(role, "owner" | "admin")
}

/// Can create/manage teams and assign tasks
#[allow(dead_code)]
pub fn can_manage_teams(role: &str) -> bool {
    matches!(role, "owner" | "admin" | "strategist")
}

// ─── Invites ───

pub async fn create_invite(
    db: &DbSession,
    workspace_id: &Uuid,
    email: &str,
    role: &str,
    invited_by: &Uuid,
) -> Result<WorkspaceInvite, AppError> {
    let id = Uuid::new_v4();
    let token = crate::services::auth::generate_reset_token();
    let now = ts_now();
    let expires_at = CqlTimestamp(
        Utc::now()
            .checked_add_signed(chrono::Duration::days(7))
            .expect("valid timestamp")
            .timestamp_millis(),
    );

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.workspace_invites (id, workspace_id, email, role, invited_by, \"token\", expires_at, accepted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, false, ?)",
        (&id, workspace_id, email, role, invited_by, &token as &str, expires_at, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(WorkspaceInvite {
        id,
        workspace_id: *workspace_id,
        email: email.to_string(),
        role: role.to_string(),
        invited_by: *invited_by,
        token,
        expires_at: Utc::now() + chrono::Duration::days(7),
        accepted: false,
        created_at: Utc::now(),
    })
}

pub async fn get_invite_by_token(db: &DbSession, token: &str) -> Result<WorkspaceInvite, AppError> {
    let result = db
        .query_unpaged(
            "SELECT id, workspace_id, email, role, invited_by, \"token\", expires_at, accepted, created_at FROM inertial_eclipse.workspace_invites WHERE \"token\" = ? ALLOW FILTERING",
            (token,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let (id, workspace_id, email, role, invited_by, tok, expires_at, accepted, created_at) = result
        .into_rows_result()?
        .single_row::<(
            Uuid,
            Uuid,
            String,
            String,
            Uuid,
            String,
            DateTime<Utc>,
            Option<bool>,
            DateTime<Utc>,
        )>()
        .map_err(|_| AppError::NotFound("Invite not found".into()))?;

    Ok(WorkspaceInvite {
        id,
        workspace_id,
        email,
        role,
        invited_by,
        token: tok,
        expires_at,
        accepted: accepted.unwrap_or(false),
        created_at,
    })
}

pub async fn accept_invite(
    db: &DbSession,
    invite: &WorkspaceInvite,
    user_id: &Uuid,
) -> Result<(), AppError> {
    if invite.accepted {
        return Err(AppError::BadRequest("Invite already accepted".into()));
    }
    if invite.expires_at < Utc::now() {
        return Err(AppError::BadRequest("Invite expired".into()));
    }

    // Mark as accepted
    db.query_unpaged(
        "UPDATE inertial_eclipse.workspace_invites SET accepted = true WHERE workspace_id = ? AND id = ?",
        (&invite.workspace_id, &invite.id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Add user as member
    add_member(
        db,
        &invite.workspace_id,
        user_id,
        &invite.role,
        Some(&invite.invited_by),
    )
    .await?;

    Ok(())
}

// ─── Workspace API Keys ───

pub async fn get_api_keys(
    db: &DbSession,
    workspace_id: &Uuid,
) -> Result<WorkspaceApiKeys, AppError> {
    let result = db
        .query_unpaged(
            "SELECT workspace_id, openai_api_key, claude_api_key, gemini_api_key, elevenlabs_api_key, mercadopago_access_token, mercadopago_public_key, stripe_secret_key, stripe_public_key, updated_at FROM inertial_eclipse.workspace_api_keys WHERE workspace_id = ?",
            (workspace_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    match result.into_rows_result()?.maybe_first_row::<(
        Uuid,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<DateTime<Utc>>,
    )>() {
        Ok(Some(row)) => Ok(WorkspaceApiKeys {
            workspace_id: row.0,
            openai_api_key: row.1,
            claude_api_key: row.2,
            gemini_api_key: row.3,
            elevenlabs_api_key: row.4,
            mercadopago_access_token: row.5,
            mercadopago_public_key: row.6,
            stripe_secret_key: row.7,
            stripe_public_key: row.8,
            updated_at: row.9,
        }),
        _ => Ok(WorkspaceApiKeys {
            workspace_id: *workspace_id,
            openai_api_key: None,
            claude_api_key: None,
            gemini_api_key: None,
            elevenlabs_api_key: None,
            mercadopago_access_token: None,
            mercadopago_public_key: None,
            stripe_secret_key: None,
            stripe_public_key: None,
            updated_at: None,
        }),
    }
}

pub async fn update_api_keys(
    db: &DbSession,
    workspace_id: &Uuid,
    encryption: &EncryptionService,
    updates: &serde_json::Value,
) -> Result<WorkspaceApiKeys, AppError> {
    let current = get_api_keys(db, workspace_id).await?;
    let now = ts_now();

    let encrypt_opt =
        |raw: Option<&str>, current: Option<String>| -> Result<Option<String>, AppError> {
            match raw {
                Some(key) if !key.is_empty() => Ok(Some(encryption.encrypt(key)?)),
                Some(_) => Ok(None), // empty string = clear
                None => Ok(current),
            }
        };

    let openai = encrypt_opt(updates["openai"].as_str(), current.openai_api_key)?;
    let claude = encrypt_opt(updates["claude"].as_str(), current.claude_api_key)?;
    let gemini = encrypt_opt(updates["gemini"].as_str(), current.gemini_api_key)?;
    let elevenlabs = encrypt_opt(updates["elevenlabs"].as_str(), current.elevenlabs_api_key)?;
    let mercadopago = encrypt_opt(
        updates["mercadopago"].as_str(),
        current.mercadopago_access_token,
    )?;
    let stripe = encrypt_opt(updates["stripe"].as_str(), current.stripe_secret_key)?;

    // Public keys (not encrypted)
    let mp_pk = match updates["mp_public_key"].as_str() {
        Some(k) if !k.is_empty() => Some(k.to_string()),
        Some(_) => None,
        None => current.mercadopago_public_key,
    };
    let stripe_pk = match updates["stripe_public_key"].as_str() {
        Some(k) if !k.is_empty() => Some(k.to_string()),
        Some(_) => None,
        None => current.stripe_public_key,
    };

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.workspace_api_keys (workspace_id, openai_api_key, claude_api_key, gemini_api_key, elevenlabs_api_key, mercadopago_access_token, mercadopago_public_key, stripe_secret_key, stripe_public_key, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (workspace_id, &openai, &claude, &gemini, &elevenlabs, &mercadopago, &mp_pk, &stripe, &stripe_pk, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(WorkspaceApiKeys {
        workspace_id: *workspace_id,
        openai_api_key: openai,
        claude_api_key: claude,
        gemini_api_key: gemini,
        elevenlabs_api_key: elevenlabs,
        mercadopago_access_token: mercadopago,
        mercadopago_public_key: mp_pk,
        stripe_secret_key: stripe,
        stripe_public_key: stripe_pk,
        updated_at: Some(Utc::now()),
    })
}

/// Get a single decrypted API key for a provider from the workspace_api_keys table.
/// Falls back to the user table if workspace_api_keys has no entry (migration safety).
pub async fn get_decrypted_api_key(
    db: &DbSession,
    encryption: &EncryptionService,
    workspace_id: &Uuid,
    provider: &str,
) -> Result<String, AppError> {
    let keys = get_api_keys(db, workspace_id).await?;

    let encrypted = match provider {
        "openai" => keys.openai_api_key,
        "claude" => keys.claude_api_key,
        "gemini" => keys.gemini_api_key,
        "elevenlabs" => keys.elevenlabs_api_key,
        "mercadopago" => keys.mercadopago_access_token,
        "stripe" => keys.stripe_secret_key,
        _ => None,
    };

    // If workspace has the key, decrypt and return
    if let Some(enc) = encrypted {
        return encryption.decrypt(&enc);
    }

    // Fallback: try the user table (for users who haven't migrated keys yet)
    // workspace_id == user_id for personal workspaces
    let user_result = db
        .query_unpaged(
            "SELECT api_key_openai, api_key_claude, api_key_gemini, api_key_elevenlabs, api_key_mercadopago, api_key_stripe FROM inertial_eclipse.users WHERE id = ?",
            (workspace_id,),
        )
        .await
        .ok()
        .and_then(|r| r.into_rows_result().ok())
        .and_then(|r| r.maybe_first_row::<(Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>)>().ok().flatten());

    if let Some((openai, claude, gemini, elevenlabs, mercadopago, stripe)) = user_result {
        let enc = match provider {
            "openai" => openai,
            "claude" => claude,
            "gemini" => gemini,
            "elevenlabs" => elevenlabs,
            "mercadopago" => mercadopago,
            "stripe" => stripe,
            _ => None,
        };
        if let Some(e) = enc {
            return encryption.decrypt(&e);
        }
    }

    Err(AppError::BadRequest(format!(
        "API key not configured for provider: {provider}"
    )))
}

/// Check which API keys are configured for a workspace (includes user fallback).
pub async fn get_api_keys_status(
    db: &DbSession,
    workspace_id: &Uuid,
) -> Result<crate::models::workspace::WorkspaceApiKeysResponse, AppError> {
    let keys = get_api_keys(db, workspace_id).await?;

    let mut resp = crate::models::workspace::WorkspaceApiKeysResponse {
        openai_configured: keys.openai_api_key.is_some(),
        claude_configured: keys.claude_api_key.is_some(),
        gemini_configured: keys.gemini_api_key.is_some(),
        elevenlabs_configured: keys.elevenlabs_api_key.is_some(),
        mercadopago_configured: keys.mercadopago_access_token.is_some(),
        stripe_configured: keys.stripe_secret_key.is_some(),
    };

    // Fallback: check user table if workspace has no keys
    if !resp.openai_configured && !resp.claude_configured && !resp.gemini_configured {
        let user_result = db
            .query_unpaged(
                "SELECT api_key_openai, api_key_claude, api_key_gemini, api_key_elevenlabs, api_key_mercadopago, api_key_stripe FROM inertial_eclipse.users WHERE id = ?",
                (workspace_id,),
            )
            .await
            .ok()
            .and_then(|r| r.into_rows_result().ok())
            .and_then(|r| r.maybe_first_row::<(Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>)>().ok().flatten());

        if let Some((openai, claude, gemini, elevenlabs, mercadopago, stripe)) = user_result {
            resp.openai_configured = resp.openai_configured || openai.is_some();
            resp.claude_configured = resp.claude_configured || claude.is_some();
            resp.gemini_configured = resp.gemini_configured || gemini.is_some();
            resp.elevenlabs_configured = resp.elevenlabs_configured || elevenlabs.is_some();
            resp.mercadopago_configured = resp.mercadopago_configured || mercadopago.is_some();
            resp.stripe_configured = resp.stripe_configured || stripe.is_some();
        }
    }

    Ok(resp)
}

/// Migrate API keys from user table to workspace_api_keys table.
/// Used during data migration for existing users.
#[allow(dead_code)]
pub async fn migrate_user_api_keys(
    db: &DbSession,
    user_id: &Uuid,
    workspace_id: &Uuid,
) -> Result<(), AppError> {
    let result = db
        .query_unpaged(
            "SELECT api_key_openai, api_key_claude, api_key_gemini, api_key_elevenlabs, api_key_mercadopago, api_key_stripe FROM inertial_eclipse.users WHERE id = ?",
            (user_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows_result = result.into_rows_result()?;
    if let Ok(Some((openai, claude, gemini, elevenlabs, mercadopago, stripe))) = rows_result
        .maybe_first_row::<(
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        )>()
    {
        // Also fetch public keys
        let pks = db
            .query_unpaged(
                "SELECT stripe_public_key, mp_public_key FROM inertial_eclipse.users WHERE id = ?",
                (user_id,),
            )
            .await
            .ok()
            .and_then(|r| r.into_rows_result().ok())
            .and_then(|r| {
                r.maybe_first_row::<(Option<String>, Option<String>)>()
                    .ok()
                    .flatten()
            });
        let (stripe_pk, mp_pk) = pks.unwrap_or((None, None));

        let now = ts_now();
        db.query_unpaged(
            "INSERT INTO inertial_eclipse.workspace_api_keys (workspace_id, openai_api_key, claude_api_key, gemini_api_key, elevenlabs_api_key, mercadopago_access_token, mercadopago_public_key, stripe_secret_key, stripe_public_key, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) IF NOT EXISTS",
            (workspace_id, &openai, &claude, &gemini, &elevenlabs, &mercadopago, &mp_pk, &stripe, &stripe_pk, now),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }

    Ok(())
}
