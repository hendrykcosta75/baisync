use axum::extract::{Extension, Path};
use axum::Json;

use crate::config::Config;
use crate::db::DbSession;
use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::models::workspace::{
    CreateWorkspaceRequest, InviteMemberRequest, UpdateMemberRoleRequest, UpdateWorkspaceRequest,
    WorkspaceApiKeysResponse,
};
use crate::services::encryption::EncryptionService;
use crate::services::workspace as ws_service;

// ─── Workspace CRUD ───

pub async fn list(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<serde_json::Value>, AppError> {
    let workspaces = ws_service::list_user_workspaces(&db, &auth_user.user_id).await?;
    Ok(Json(serde_json::json!({
        "workspaces": workspaces,
        "active_workspace_id": auth_user.workspace_id,
    })))
}

pub async fn create(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Json(body): Json<CreateWorkspaceRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let ws = ws_service::create_workspace(&db, &body.name, "company", &auth_user.user_id).await?;

    // Create #geral channel automatically
    crate::services::channel::create_channel(
        &db,
        &ws.id,
        "geral",
        Some("Canal geral do workspace"),
        "public",
        &auth_user.user_id,
    )
    .await?;

    Ok(Json(serde_json::json!({ "workspace": ws })))
}

pub async fn get(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(id): Path<uuid::Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Verify membership
    let _ = ws_service::get_member_role(&db, &id, &auth_user.user_id).await?;
    let ws = ws_service::get_workspace(&db, &id).await?;
    Ok(Json(serde_json::json!({ "workspace": ws })))
}

pub async fn update(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(id): Path<uuid::Uuid>,
    Json(body): Json<UpdateWorkspaceRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let role = ws_service::get_member_role(&db, &id, &auth_user.user_id).await?;
    if role != "owner" && role != "admin" {
        return Err(AppError::Forbidden(
            "Only owners and admins can update workspace".into(),
        ));
    }
    ws_service::update_workspace(&db, &id, &body.name).await?;
    let ws = ws_service::get_workspace(&db, &id).await?;
    Ok(Json(serde_json::json!({ "workspace": ws })))
}

pub async fn delete(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Extension(jwt_secret): Extension<String>,
    Path(id): Path<uuid::Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let role = ws_service::get_member_role(&db, &id, &auth_user.user_id).await?;
    if role != "owner" {
        return Err(AppError::Forbidden(
            "Only the owner can delete a workspace".into(),
        ));
    }

    let ws = ws_service::get_workspace(&db, &id).await?;
    if ws.workspace_type == "personal" {
        return Err(AppError::BadRequest(
            "Cannot delete personal workspace".into(),
        ));
    }

    ws_service::delete_workspace(&db, &id).await?;

    // Switch caller back to personal workspace and issue new token
    ws_service::switch_workspace(&db, &auth_user.user_id, &auth_user.user_id).await?;
    let token = crate::services::auth::create_jwt_with_workspace(
        &auth_user.user_id,
        &auth_user.email,
        &auth_user.user_id,
        &jwt_secret,
    )?;

    Ok(Json(
        serde_json::json!({ "success": true, "token": token, "workspace_id": auth_user.user_id }),
    ))
}

pub async fn switch(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(id): Path<uuid::Uuid>,
    Extension(jwt_secret): Extension<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    ws_service::switch_workspace(&db, &auth_user.user_id, &id).await?;
    // Create new JWT with updated workspace_id
    let token = crate::services::auth::create_jwt_with_workspace(
        &auth_user.user_id,
        &auth_user.email,
        &id,
        &jwt_secret,
    )?;
    Ok(Json(
        serde_json::json!({ "token": token, "workspace_id": id }),
    ))
}

// ─── Members ───

pub async fn list_members(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(id): Path<uuid::Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let _ = ws_service::get_member_role(&db, &id, &auth_user.user_id).await?;
    let members = ws_service::list_members(&db, &id).await?;
    Ok(Json(serde_json::json!({ "members": members })))
}

pub async fn invite_member(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Extension(config): Extension<Config>,
    Path(id): Path<uuid::Uuid>,
    Json(body): Json<InviteMemberRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let role = ws_service::get_member_role(&db, &id, &auth_user.user_id).await?;
    if role != "owner" && role != "admin" {
        return Err(AppError::Forbidden(
            "Only owners and admins can invite members".into(),
        ));
    }

    let ws = ws_service::get_workspace(&db, &id).await?;
    if ws.workspace_type == "personal" {
        return Err(AppError::BadRequest(
            "Cannot invite members to personal workspace".into(),
        ));
    }

    let invite =
        ws_service::create_invite(&db, &id, &body.email, &body.role, &auth_user.user_id).await?;

    // Send invite email
    let invite_url = format!("{}/workspace-invite?token={}", config.app_url, invite.token);
    let subject = format!("Convite para {} - Baisync", ws.name);
    let body_html =
        crate::services::email::wrap_invite_email(&config, &ws.name, &invite.role, &invite_url);

    let config_clone = config.clone();
    let email = invite.email.clone();
    tokio::spawn(async move {
        let _ =
            crate::services::email::send_email(&config_clone, &email, &subject, &body_html).await;
    });

    Ok(Json(serde_json::json!({ "invite": invite })))
}

pub async fn remove_member(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((workspace_id, user_id)): Path<(uuid::Uuid, uuid::Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let role = ws_service::get_member_role(&db, &workspace_id, &auth_user.user_id).await?;
    if role != "owner" && role != "admin" {
        return Err(AppError::Forbidden(
            "Only owners and admins can remove members".into(),
        ));
    }

    let ws = ws_service::get_workspace(&db, &workspace_id).await?;
    if ws.owner_id == user_id {
        return Err(AppError::BadRequest(
            "Cannot remove the workspace owner".into(),
        ));
    }

    ws_service::remove_member(&db, &workspace_id, &user_id).await?;

    // Reset removed user's active workspace to their personal workspace
    let active_ws = ws_service::get_active_workspace_id(&db, &user_id)
        .await
        .unwrap_or(user_id);
    if active_ws == workspace_id {
        let _ = db
            .query_unpaged(
                "UPDATE inertial_eclipse.users SET active_workspace_id = ? WHERE id = ?",
                (&user_id, &user_id),
            )
            .await;
    }

    // Notify the removed user via SSE so their frontend redirects immediately
    crate::services::events::publish_global(
        &user_id,
        crate::services::events::SseEvent {
            event_type: "workspace_member_removed".into(),
            data: serde_json::json!({
                "workspace_id": workspace_id.to_string(),
                "workspace_name": ws.name,
            })
            .to_string(),
        },
    )
    .await;

    Ok(Json(serde_json::json!({ "success": true })))
}

pub async fn update_member_role(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((workspace_id, user_id)): Path<(uuid::Uuid, uuid::Uuid)>,
    Json(body): Json<UpdateMemberRoleRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let role = ws_service::get_member_role(&db, &workspace_id, &auth_user.user_id).await?;
    if role != "owner" {
        return Err(AppError::Forbidden(
            "Only the owner can change roles".into(),
        ));
    }

    if body.role != "admin" && body.role != "member" {
        return Err(AppError::BadRequest(
            "Role must be 'admin' or 'member'".into(),
        ));
    }

    ws_service::update_member_role(&db, &workspace_id, &user_id, &body.role).await?;
    Ok(Json(serde_json::json!({ "success": true })))
}

// ─── Invite acceptance (public-ish, but requires auth) ───

pub async fn accept_invite(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Extension(jwt_secret): Extension<String>,
    Path(token): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let invite = ws_service::get_invite_by_token(&db, &token).await?;

    // Verify email matches
    if invite.email != auth_user.email {
        return Err(AppError::Forbidden(
            "Invite email does not match your account".into(),
        ));
    }

    ws_service::accept_invite(&db, &invite, &auth_user.user_id).await?;

    // Add user to #geral channel if exists
    let channels = crate::services::channel::list_channels(&db, &invite.workspace_id).await?;
    for ch in &channels {
        if ch.name == "geral" && ch.channel_type == "public" {
            let _ = crate::services::channel::add_member(
                &db,
                &ch.id,
                &auth_user.user_id,
                &invite.workspace_id,
                "member",
            )
            .await;
        }
    }

    // Auto-switch to the invited workspace so subsequent requests use it
    ws_service::switch_workspace(&db, &auth_user.user_id, &invite.workspace_id).await?;
    let new_token = crate::services::auth::create_jwt_with_workspace(
        &auth_user.user_id,
        &auth_user.email,
        &invite.workspace_id,
        &jwt_secret,
    )?;

    let ws = ws_service::get_workspace(&db, &invite.workspace_id).await?;
    Ok(Json(
        serde_json::json!({ "workspace": ws, "token": new_token, "workspace_id": invite.workspace_id }),
    ))
}

// ─── API Keys ───

pub async fn get_api_keys(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(id): Path<uuid::Uuid>,
) -> Result<Json<WorkspaceApiKeysResponse>, AppError> {
    let _ = ws_service::get_member_role(&db, &id, &auth_user.user_id).await?;
    let keys = ws_service::get_api_keys(&db, &id).await?;
    Ok(Json(WorkspaceApiKeysResponse {
        openai_configured: keys.openai_api_key.is_some(),
        claude_configured: keys.claude_api_key.is_some(),
        gemini_configured: keys.gemini_api_key.is_some(),
        elevenlabs_configured: keys.elevenlabs_api_key.is_some(),
        grok_configured: keys.grok_api_key.is_some(),
        deepseek_configured: keys.deepseek_api_key.is_some(),
        mercadopago_configured: keys.mercadopago_access_token.is_some(),
        stripe_configured: keys.stripe_secret_key.is_some(),
    }))
}

pub async fn update_api_keys(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Extension(encryption): Extension<EncryptionService>,
    Path(id): Path<uuid::Uuid>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<WorkspaceApiKeysResponse>, AppError> {
    let role = ws_service::get_member_role(&db, &id, &auth_user.user_id).await?;
    if role != "owner" && role != "admin" {
        return Err(AppError::Forbidden(
            "Only owners and admins can update API keys".into(),
        ));
    }

    let keys = ws_service::update_api_keys(&db, &id, &encryption, &body).await?;
    Ok(Json(WorkspaceApiKeysResponse {
        openai_configured: keys.openai_api_key.is_some(),
        claude_configured: keys.claude_api_key.is_some(),
        gemini_configured: keys.gemini_api_key.is_some(),
        elevenlabs_configured: keys.elevenlabs_api_key.is_some(),
        grok_configured: keys.grok_api_key.is_some(),
        deepseek_configured: keys.deepseek_api_key.is_some(),
        mercadopago_configured: keys.mercadopago_access_token.is_some(),
        stripe_configured: keys.stripe_secret_key.is_some(),
    }))
}
