use axum::extract::{Extension, Path, Query};
use axum::Json;
use serde::Deserialize;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::models::channel::{
    CreateChannelRequest, CreateDmRequest, CreateNoteRequest, EditMessageRequest,
    SendMessageRequest, UpdateChannelRequest, UpdateNoteRequest,
};
use crate::services::channel as ch_service;
use crate::services::events::{publish_global, SseEvent};
use crate::services::workspace as ws_service;

/// Publish an SSE event to all channel members except the actor.
async fn publish_to_channel(
    db: &DbSession,
    channel_id: &uuid::Uuid,
    exclude_user: &uuid::Uuid,
    event_type: &str,
    data: &str,
) {
    if let Ok(members) = ch_service::list_members(db, channel_id).await {
        for m in &members {
            if m.user_id != *exclude_user {
                publish_global(
                    &m.user_id,
                    SseEvent {
                        event_type: event_type.to_string(),
                        data: data.to_string(),
                    },
                )
                .await;
            }
        }
    }
}

/// Publish an SSE event to a specific user.
async fn publish_to_user(user_id: &uuid::Uuid, event_type: &str, data: &str) {
    publish_global(
        user_id,
        SseEvent {
            event_type: event_type.to_string(),
            data: data.to_string(),
        },
    )
    .await;
}

#[derive(Debug, Deserialize)]
pub struct PaginationParams {
    pub cursor: Option<String>,
    pub limit: Option<i32>,
}

// ─── Channels ───

pub async fn list_channels(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(workspace_id): Path<uuid::Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let _ = ws_service::get_member_role(&db, &workspace_id, &auth_user.user_id).await?;

    let all_channels = ch_service::list_channels(&db, &workspace_id).await?;

    // Get user's channel memberships with unread counts
    let user_channels = ch_service::list_user_channels(&db, &auth_user.user_id, &workspace_id).await?;
    let unread_map: std::collections::HashMap<uuid::Uuid, i32> = user_channels
        .iter()
        .map(|uc| (uc.channel_id, uc.unread_count))
        .collect();

    // Only return channels the user is a member of
    let channels_with_unread: Vec<serde_json::Value> = all_channels
        .iter()
        .filter(|ch| unread_map.contains_key(&ch.id))
        .map(|ch| {
            let mut val = serde_json::to_value(ch).unwrap_or_default();
            val["unread_count"] = serde_json::json!(unread_map.get(&ch.id).unwrap_or(&0));
            val
        })
        .collect();

    Ok(Json(serde_json::json!({ "channels": channels_with_unread })))
}

pub async fn create_channel(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(workspace_id): Path<uuid::Uuid>,
    Json(body): Json<CreateChannelRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let _ = ws_service::get_member_role(&db, &workspace_id, &auth_user.user_id).await?;

    let channel = ch_service::create_channel(
        &db,
        &workspace_id,
        &body.name,
        body.description.as_deref(),
        &body.channel_type,
        &auth_user.user_id,
    )
    .await?;

    Ok(Json(serde_json::json!({ "channel": channel })))
}

pub async fn get_channel(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(channel_id): Path<uuid::Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Find channel's workspace by checking membership
    if !ch_service::is_member(&db, &channel_id, &auth_user.user_id).await? {
        return Err(AppError::Forbidden("Not a member of this channel".into()));
    }

    // We need workspace_id to query - get it from channel_members
    let members = ch_service::list_members(&db, &channel_id).await?;
    let workspace_id = members
        .first()
        .map(|m| m.workspace_id)
        .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;

    let channel = ch_service::get_channel(&db, &workspace_id, &channel_id).await?;
    Ok(Json(serde_json::json!({ "channel": channel })))
}

pub async fn update_channel(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(channel_id): Path<uuid::Uuid>,
    Json(body): Json<UpdateChannelRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !ch_service::is_member(&db, &channel_id, &auth_user.user_id).await? {
        return Err(AppError::Forbidden("Not a member of this channel".into()));
    }

    let members = ch_service::list_members(&db, &channel_id).await?;
    let workspace_id = members
        .first()
        .map(|m| m.workspace_id)
        .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;

    ch_service::update_channel(
        &db,
        &workspace_id,
        &channel_id,
        body.name.as_deref(),
        body.description.as_deref(),
    )
    .await?;

    let channel = ch_service::get_channel(&db, &workspace_id, &channel_id).await?;
    Ok(Json(serde_json::json!({ "channel": channel })))
}

pub async fn delete_channel(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(channel_id): Path<uuid::Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let members = ch_service::list_members(&db, &channel_id).await?;
    let workspace_id = members
        .first()
        .map(|m| m.workspace_id)
        .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;

    // Only workspace owner/admin or channel owner can delete
    let ws_role = ws_service::get_member_role(&db, &workspace_id, &auth_user.user_id).await?;
    if ws_role != "owner" && ws_role != "admin" {
        return Err(AppError::Forbidden("Only workspace admins can delete channels".into()));
    }

    ch_service::delete_channel(&db, &workspace_id, &channel_id).await?;
    Ok(Json(serde_json::json!({ "success": true })))
}

// ─── Channel Members ───

pub async fn list_channel_members(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(channel_id): Path<uuid::Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !ch_service::is_member(&db, &channel_id, &auth_user.user_id).await? {
        return Err(AppError::Forbidden("Not a member of this channel".into()));
    }

    let members = ch_service::list_members(&db, &channel_id).await?;
    Ok(Json(serde_json::json!({ "members": members })))
}

pub async fn add_channel_member(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(channel_id): Path<uuid::Uuid>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, AppError> {
    let members = ch_service::list_members(&db, &channel_id).await?;
    let workspace_id = members
        .first()
        .map(|m| m.workspace_id)
        .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;

    // Verify requester is workspace member
    let _ = ws_service::get_member_role(&db, &workspace_id, &auth_user.user_id).await?;

    let user_id: uuid::Uuid = body["user_id"]
        .as_str()
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| AppError::BadRequest("user_id required".into()))?;

    ch_service::add_member(&db, &channel_id, &user_id, &workspace_id, "member").await?;

    let event_data = serde_json::json!({ "channel_id": channel_id, "user_id": user_id }).to_string();
    publish_to_channel(&db, &channel_id, &auth_user.user_id, "channel_member_added", &event_data).await;

    Ok(Json(serde_json::json!({ "success": true })))
}

pub async fn remove_channel_member(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((channel_id, user_id)): Path<(uuid::Uuid, uuid::Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let members = ch_service::list_members(&db, &channel_id).await?;
    let workspace_id = members
        .first()
        .map(|m| m.workspace_id)
        .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;

    let ws_role = ws_service::get_member_role(&db, &workspace_id, &auth_user.user_id).await?;
    if ws_role != "owner" && ws_role != "admin" && auth_user.user_id != user_id {
        return Err(AppError::Forbidden("Cannot remove this member".into()));
    }

    ch_service::remove_member(&db, &channel_id, &user_id, &workspace_id).await?;

    // Notify remaining members
    let event_data = serde_json::json!({ "channel_id": channel_id, "user_id": user_id }).to_string();
    publish_to_channel(&db, &channel_id, &auth_user.user_id, "channel_member_removed", &event_data).await;
    // Also notify the removed user so their UI updates
    publish_to_user(&user_id, "channel_member_removed", &event_data).await;

    Ok(Json(serde_json::json!({ "success": true })))
}

// ─── Messages ───

pub async fn list_messages(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(channel_id): Path<uuid::Uuid>,
    Query(params): Query<PaginationParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !ch_service::is_member(&db, &channel_id, &auth_user.user_id).await? {
        return Err(AppError::Forbidden("Not a member of this channel".into()));
    }

    let limit = params.limit.unwrap_or(50).min(100);
    let (messages, next_cursor) =
        ch_service::list_messages(&db, &channel_id, limit, params.cursor.as_deref()).await?;

    Ok(Json(serde_json::json!({
        "messages": messages,
        "next_cursor": next_cursor
    })))
}

pub async fn send_message(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(channel_id): Path<uuid::Uuid>,
    Json(body): Json<SendMessageRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !ch_service::is_member(&db, &channel_id, &auth_user.user_id).await? {
        return Err(AppError::Forbidden("Not a member of this channel".into()));
    }

    // Get sender name
    let user = crate::services::auth::get_user_by_id(&db, &auth_user.user_id).await?;

    let message = ch_service::send_message(
        &db,
        &channel_id,
        &auth_user.user_id,
        &user.name,
        &body.content,
        "text",
    )
    .await?;

    // Publish SSE event to all channel members
    let event_data = serde_json::to_string(&message).unwrap_or_default();
    publish_to_channel(&db, &channel_id, &auth_user.user_id, "channel_message", &event_data).await;

    Ok(Json(serde_json::json!({ "message": message })))
}

pub async fn edit_message(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((channel_id, message_id)): Path<(uuid::Uuid, uuid::Uuid)>,
    Json(body): Json<EditMessageRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !ch_service::is_member(&db, &channel_id, &auth_user.user_id).await? {
        return Err(AppError::Forbidden("Not a member of this channel".into()));
    }

    ch_service::edit_message(&db, &channel_id, &message_id, &body.content).await?;
    Ok(Json(serde_json::json!({ "success": true })))
}

pub async fn delete_message(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((channel_id, message_id)): Path<(uuid::Uuid, uuid::Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !ch_service::is_member(&db, &channel_id, &auth_user.user_id).await? {
        return Err(AppError::Forbidden("Not a member of this channel".into()));
    }

    ch_service::delete_message(&db, &channel_id, &message_id).await?;
    Ok(Json(serde_json::json!({ "success": true })))
}

pub async fn mark_read(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(channel_id): Path<uuid::Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    ch_service::mark_read(&db, &channel_id, &auth_user.user_id).await?;
    Ok(Json(serde_json::json!({ "success": true })))
}

// ─── Notes ───

pub async fn list_notes(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(channel_id): Path<uuid::Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !ch_service::is_member(&db, &channel_id, &auth_user.user_id).await? {
        return Err(AppError::Forbidden("Not a member of this channel".into()));
    }

    let notes = ch_service::list_notes(&db, &channel_id).await?;
    Ok(Json(serde_json::json!({ "notes": notes })))
}

pub async fn create_note(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(channel_id): Path<uuid::Uuid>,
    Json(body): Json<CreateNoteRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !ch_service::is_member(&db, &channel_id, &auth_user.user_id).await? {
        return Err(AppError::Forbidden("Not a member of this channel".into()));
    }

    let note = ch_service::create_note(&db, &channel_id, &body.title, &auth_user.user_id).await?;

    let event_data = serde_json::to_string(&note).unwrap_or_default();
    publish_to_channel(&db, &channel_id, &auth_user.user_id, "channel_note_created", &event_data).await;

    Ok(Json(serde_json::json!({ "note": note })))
}

pub async fn get_note(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((channel_id, note_id)): Path<(uuid::Uuid, uuid::Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !ch_service::is_member(&db, &channel_id, &auth_user.user_id).await? {
        return Err(AppError::Forbidden("Not a member of this channel".into()));
    }

    let note = ch_service::get_note(&db, &channel_id, &note_id).await?;
    Ok(Json(serde_json::json!({ "note": note })))
}

pub async fn update_note(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((channel_id, note_id)): Path<(uuid::Uuid, uuid::Uuid)>,
    Json(body): Json<UpdateNoteRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !ch_service::is_member(&db, &channel_id, &auth_user.user_id).await? {
        return Err(AppError::Forbidden("Not a member of this channel".into()));
    }

    ch_service::update_note(
        &db,
        &channel_id,
        &note_id,
        body.title.as_deref(),
        body.content.as_deref(),
        &auth_user.user_id,
    )
    .await?;

    let note = ch_service::get_note(&db, &channel_id, &note_id).await?;

    let event_data = serde_json::to_string(&note).unwrap_or_default();
    publish_to_channel(&db, &channel_id, &auth_user.user_id, "channel_note_updated", &event_data).await;

    Ok(Json(serde_json::json!({ "note": note })))
}

pub async fn delete_note(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((channel_id, note_id)): Path<(uuid::Uuid, uuid::Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !ch_service::is_member(&db, &channel_id, &auth_user.user_id).await? {
        return Err(AppError::Forbidden("Not a member of this channel".into()));
    }

    ch_service::delete_note(&db, &channel_id, &note_id).await?;

    let event_data = serde_json::json!({ "channel_id": channel_id, "note_id": note_id }).to_string();
    publish_to_channel(&db, &channel_id, &auth_user.user_id, "channel_note_deleted", &event_data).await;

    Ok(Json(serde_json::json!({ "success": true })))
}

// ─── DMs ───

pub async fn list_dms(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(workspace_id): Path<uuid::Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let _ = ws_service::get_member_role(&db, &workspace_id, &auth_user.user_id).await?;

    let channels = ch_service::list_channels(&db, &workspace_id).await?;
    let mut dms = Vec::new();

    for ch in channels {
        if ch.channel_type == "dm" {
            let members = ch_service::list_members(&db, &ch.id).await?;
            let is_member = members.iter().any(|m| m.user_id == auth_user.user_id);
            if is_member {
                let other = members
                    .iter()
                    .find(|m| m.user_id != auth_user.user_id);
                let mut val = serde_json::to_value(&ch).unwrap_or_default();
                if let Some(o) = other {
                    val["other_user"] = serde_json::json!({
                        "id": o.user_id,
                        "name": o.user_name,
                        "email": o.user_email,
                    });
                }
                dms.push(val);
            }
        }
    }

    Ok(Json(serde_json::json!({ "dms": dms })))
}

pub async fn create_dm(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(workspace_id): Path<uuid::Uuid>,
    Json(body): Json<CreateDmRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let _ = ws_service::get_member_role(&db, &workspace_id, &auth_user.user_id).await?;
    let _ = ws_service::get_member_role(&db, &workspace_id, &body.user_id).await?;

    let user_a = crate::services::auth::get_user_by_id(&db, &auth_user.user_id).await?;
    let user_b = crate::services::auth::get_user_by_id(&db, &body.user_id).await?;

    let dm = ch_service::find_or_create_dm(
        &db,
        &workspace_id,
        &auth_user.user_id,
        &body.user_id,
        &user_a.name,
        &user_b.name,
    )
    .await?;

    Ok(Json(serde_json::json!({ "channel": dm })))
}
