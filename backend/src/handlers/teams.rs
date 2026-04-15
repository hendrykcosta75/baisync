use axum::body::Body;
use axum::extract::{Extension, Multipart, Path, Query};
use axum::http::header;
use axum::response::Response;
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::models::team::{
    AddTeamMemberRequest, CreateTaskCommentRequest, CreateTaskRequest, CreateTeamRequest,
    MoveTaskRequest, UpdateTaskRequest, UpdateTeamRequest,
};
use crate::services::events::{publish_global, SseEvent};
use crate::services::team as team_service;
use crate::services::workspace as ws_service;

#[derive(Debug, Deserialize)]
pub struct PaginationParams {
    pub cursor: Option<String>,
    pub limit: Option<i32>,
}

/// Publish SSE to all workspace members except the actor.
async fn publish_to_workspace(
    db: &DbSession,
    workspace_id: &Uuid,
    exclude_user: &Uuid,
    event_type: &str,
    data: &str,
) {
    if let Ok(members) = ws_service::list_members(db, workspace_id).await {
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

// ─── Teams ───

pub async fn list(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(workspace_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let _ = ws_service::get_member_role(&db, &workspace_id, &auth_user.user_id).await?;

    let teams = team_service::list_teams(&db, &workspace_id).await?;
    let mut teams_with_stats = Vec::new();
    for team in teams {
        let stats = team_service::get_team_with_stats(&db, team).await?;
        teams_with_stats.push(stats);
    }

    Ok(Json(json!({ "teams": teams_with_stats })))
}

pub async fn create(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(workspace_id): Path<Uuid>,
    Json(body): Json<CreateTeamRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let role = ws_service::get_member_role(&db, &workspace_id, &auth_user.user_id).await?;
    if role != "owner" && role != "admin" {
        return Err(AppError::Forbidden("Apenas administradores podem criar equipes".into()));
    }

    let team = team_service::create_team(
        &db,
        &workspace_id,
        &body.name,
        body.description.as_deref(),
        body.color.as_deref(),
        &auth_user.user_id,
    )
    .await?;

    // Log activity
    let user_name = get_user_name(&db, &auth_user.user_id).await;
    team_service::log_activity(
        &db, &team.id, &auth_user.user_id, &user_name,
        "team_created", "team", Some(&team.id), Some(&team.name), None,
    ).await.ok();

    let data = serde_json::to_string(&json!({ "team": &team })).unwrap_or_default();
    publish_to_workspace(&db, &workspace_id, &auth_user.user_id, "team_created", &data).await;

    Ok(Json(json!({ "team": team })))
}

pub async fn get(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(team_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let team = find_team_and_verify(&db, &team_id, &auth_user.user_id).await?;
    let stats = team_service::get_team_with_stats(&db, team).await?;
    Ok(Json(json!({ "team": stats })))
}

pub async fn update(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(team_id): Path<Uuid>,
    Json(body): Json<UpdateTeamRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let team = find_team_and_verify(&db, &team_id, &auth_user.user_id).await?;
    let role = ws_service::get_member_role(&db, &team.workspace_id, &auth_user.user_id).await?;
    if role != "owner" && role != "admin" {
        return Err(AppError::Forbidden("Apenas administradores podem editar equipes".into()));
    }

    team_service::update_team(
        &db, &team.workspace_id, &team_id,
        body.name.as_deref(), body.description.as_deref(), body.color.as_deref(),
    ).await?;

    let updated = team_service::get_team(&db, &team.workspace_id, &team_id).await?;

    let data = serde_json::to_string(&json!({ "team": &updated })).unwrap_or_default();
    publish_to_workspace(&db, &team.workspace_id, &auth_user.user_id, "team_updated", &data).await;

    Ok(Json(json!({ "team": updated })))
}

pub async fn delete(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(team_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let team = find_team_and_verify(&db, &team_id, &auth_user.user_id).await?;
    let role = ws_service::get_member_role(&db, &team.workspace_id, &auth_user.user_id).await?;
    if role != "owner" && role != "admin" {
        return Err(AppError::Forbidden("Apenas administradores podem excluir equipes".into()));
    }

    team_service::delete_team(&db, &team.workspace_id, &team_id).await?;

    let data = serde_json::to_string(&json!({ "team_id": team_id })).unwrap_or_default();
    publish_to_workspace(&db, &team.workspace_id, &auth_user.user_id, "team_deleted", &data).await;

    Ok(Json(json!({ "success": true })))
}

// ─── Team Members ───

pub async fn list_members(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(team_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let team = find_team_and_verify(&db, &team_id, &auth_user.user_id).await?;
    let members = team_service::list_members(&db, &team.id).await?;

    // Enrich with task counts per member
    let tasks = team_service::list_tasks(&db, &team.id).await?;
    let members_with_load: Vec<serde_json::Value> = members
        .iter()
        .map(|m| {
            let assigned = tasks.iter().filter(|t| t.assignee_id == Some(m.user_id)).count();
            let done = tasks.iter().filter(|t| t.assignee_id == Some(m.user_id) && t.status == "done").count();
            let open = assigned - done;
            let mut val = serde_json::to_value(m).unwrap_or_default();
            val["task_count"] = json!({ "assigned": assigned, "open": open, "done": done });
            val
        })
        .collect();

    Ok(Json(json!({ "members": members_with_load })))
}

pub async fn add_member(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(team_id): Path<Uuid>,
    Json(body): Json<AddTeamMemberRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let team = find_team_and_verify(&db, &team_id, &auth_user.user_id).await?;
    let role = ws_service::get_member_role(&db, &team.workspace_id, &auth_user.user_id).await?;
    if role != "owner" && role != "admin" {
        return Err(AppError::Forbidden("Apenas administradores podem gerenciar membros".into()));
    }

    // Verify the user is a workspace member
    let _ = ws_service::get_member_role(&db, &team.workspace_id, &body.user_id).await?;

    team_service::add_member(&db, &team.id, &body.user_id, &team.workspace_id, &body.role, &team.name).await?;

    let user_name = get_user_name(&db, &auth_user.user_id).await;
    team_service::log_activity(
        &db, &team.id, &auth_user.user_id, &user_name,
        "member_added", "member", Some(&body.user_id), None, None,
    ).await.ok();

    let data = serde_json::to_string(&json!({ "team_id": team_id, "user_id": body.user_id })).unwrap_or_default();
    publish_to_workspace(&db, &team.workspace_id, &auth_user.user_id, "team_member_added", &data).await;

    Ok(Json(json!({ "success": true })))
}

pub async fn remove_member(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((team_id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let team = find_team_and_verify(&db, &team_id, &auth_user.user_id).await?;
    let role = ws_service::get_member_role(&db, &team.workspace_id, &auth_user.user_id).await?;
    if role != "owner" && role != "admin" {
        return Err(AppError::Forbidden("Apenas administradores podem gerenciar membros".into()));
    }

    team_service::remove_member(&db, &team.id, &user_id, &team.workspace_id).await?;

    let user_name = get_user_name(&db, &auth_user.user_id).await;
    team_service::log_activity(
        &db, &team.id, &auth_user.user_id, &user_name,
        "member_removed", "member", Some(&user_id), None, None,
    ).await.ok();

    let data = serde_json::to_string(&json!({ "team_id": team_id, "user_id": user_id })).unwrap_or_default();
    publish_to_workspace(&db, &team.workspace_id, &auth_user.user_id, "team_member_removed", &data).await;

    Ok(Json(json!({ "success": true })))
}

// ─── Tasks ───

pub async fn list_tasks(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(team_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let _ = find_team_and_verify(&db, &team_id, &auth_user.user_id).await?;
    let tasks = team_service::list_tasks(&db, &team_id).await?;
    Ok(Json(json!({ "tasks": tasks })))
}

pub async fn create_task(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(team_id): Path<Uuid>,
    Json(body): Json<CreateTaskRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let team = find_team_and_verify(&db, &team_id, &auth_user.user_id).await?;

    let due_date = body.due_date.map(|d| scylla::frame::value::CqlTimestamp(d.timestamp_millis()));

    let task = team_service::create_task(
        &db, &team.id, &body.title, body.description.as_deref(),
        &body.status, &body.priority, body.assignee_id.as_ref(),
        &auth_user.user_id, due_date, &body.tags,
        body.okr_objective_id.as_ref(), body.okr_key_result_id.as_ref(),
    ).await?;

    let user_name = get_user_name(&db, &auth_user.user_id).await;
    team_service::log_activity(
        &db, &team.id, &auth_user.user_id, &user_name,
        "task_created", "task", Some(&task.id), Some(&task.title), None,
    ).await.ok();

    let data = serde_json::to_string(&json!({ "task": &task, "team_id": team_id })).unwrap_or_default();
    publish_to_workspace(&db, &team.workspace_id, &auth_user.user_id, "team_task_created", &data).await;

    Ok(Json(json!({ "task": task })))
}

pub async fn get_task(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((team_id, task_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let _ = find_team_and_verify(&db, &team_id, &auth_user.user_id).await?;
    let task = team_service::get_task(&db, &team_id, &task_id).await?;
    Ok(Json(json!({ "task": task })))
}

pub async fn update_task(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((team_id, task_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateTaskRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let team = find_team_and_verify(&db, &team_id, &auth_user.user_id).await?;

    let due_date = body.due_date.map(|d| scylla::frame::value::CqlTimestamp(d.timestamp_millis()));

    team_service::update_task(
        &db, &team_id, &task_id,
        body.title.as_deref(), body.description.as_deref(),
        body.status.as_deref(), body.priority.as_deref(),
        body.assignee_id.as_ref(), due_date,
        body.tags.as_deref(), body.checklist_total, body.checklist_done,
        body.okr_objective_id.as_ref(), body.okr_key_result_id.as_ref(),
    ).await?;

    let updated = team_service::get_task(&db, &team_id, &task_id).await?;

    let user_name = get_user_name(&db, &auth_user.user_id).await;
    team_service::log_activity(
        &db, &team.id, &auth_user.user_id, &user_name,
        "task_updated", "task", Some(&task_id), Some(&updated.title), None,
    ).await.ok();

    let data = serde_json::to_string(&json!({ "task": &updated, "team_id": team_id })).unwrap_or_default();
    publish_to_workspace(&db, &team.workspace_id, &auth_user.user_id, "team_task_updated", &data).await;

    Ok(Json(json!({ "task": updated })))
}

pub async fn move_task(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((team_id, task_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<MoveTaskRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let team = find_team_and_verify(&db, &team_id, &auth_user.user_id).await?;

    let old_task = team_service::get_task(&db, &team_id, &task_id).await?;
    team_service::move_task(&db, &team_id, &task_id, &body.status, body.position).await?;

    let user_name = get_user_name(&db, &auth_user.user_id).await;
    let details = format!("{} → {}", old_task.status, body.status);
    team_service::log_activity(
        &db, &team.id, &auth_user.user_id, &user_name,
        "task_moved", "task", Some(&task_id), Some(&old_task.title), Some(&details),
    ).await.ok();

    let data = serde_json::to_string(&json!({
        "task_id": task_id, "team_id": team_id,
        "old_status": old_task.status, "new_status": body.status,
        "position": body.position
    })).unwrap_or_default();
    publish_to_workspace(&db, &team.workspace_id, &auth_user.user_id, "team_task_moved", &data).await;

    Ok(Json(json!({ "success": true })))
}

pub async fn delete_task(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((team_id, task_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let team = find_team_and_verify(&db, &team_id, &auth_user.user_id).await?;
    let role = ws_service::get_member_role(&db, &team.workspace_id, &auth_user.user_id).await?;
    if role != "owner" && role != "admin" {
        return Err(AppError::Forbidden("Apenas administradores podem excluir tarefas".into()));
    }

    let task = team_service::get_task(&db, &team_id, &task_id).await?;
    team_service::delete_task(&db, &team_id, &task_id).await?;

    let user_name = get_user_name(&db, &auth_user.user_id).await;
    team_service::log_activity(
        &db, &team.id, &auth_user.user_id, &user_name,
        "task_deleted", "task", Some(&task_id), Some(&task.title), None,
    ).await.ok();

    let data = serde_json::to_string(&json!({ "task_id": task_id, "team_id": team_id })).unwrap_or_default();
    publish_to_workspace(&db, &team.workspace_id, &auth_user.user_id, "team_task_deleted", &data).await;

    Ok(Json(json!({ "success": true })))
}

// ─── Task Comments ───

pub async fn list_comments(
    Extension(db): Extension<DbSession>,
    Extension(_auth_user): Extension<AuthUser>,
    Path(task_id): Path<Uuid>,
    Query(params): Query<PaginationParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    let limit = params.limit.unwrap_or(20);
    let page = team_service::list_comments(&db, &task_id, params.cursor.as_deref(), limit).await?;
    Ok(Json(json!(page)))
}

pub async fn create_comment(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(task_id): Path<Uuid>,
    Json(body): Json<CreateTaskCommentRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let user_name = get_user_name(&db, &auth_user.user_id).await;

    let comment = team_service::create_comment(
        &db, &task_id, &auth_user.user_id, &user_name, &body.content,
    ).await?;

    Ok(Json(json!({ "comment": comment })))
}

// ─── Activity ───

pub async fn list_activity(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(team_id): Path<Uuid>,
    Query(params): Query<PaginationParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    let _ = find_team_and_verify(&db, &team_id, &auth_user.user_id).await?;
    let limit = params.limit.unwrap_or(20);
    let page = team_service::list_activity(&db, &team_id, params.cursor.as_deref(), limit).await?;
    Ok(Json(json!(page)))
}

// ─── Helpers ───

/// Find a team by its ID (scanning all workspaces the user belongs to) and verify access.
async fn find_team_and_verify(
    db: &DbSession,
    team_id: &Uuid,
    user_id: &Uuid,
) -> Result<crate::models::team::Team, AppError> {
    // Get user's workspaces and check each one for this team
    let workspaces = ws_service::list_user_workspaces(db, user_id).await?;
    for ws in &workspaces {
        if let Ok(team) = team_service::get_team(db, &ws.workspace_id, team_id).await {
            // Verify workspace membership
            let _ = ws_service::get_member_role(db, &ws.workspace_id, user_id).await?;
            return Ok(team);
        }
    }
    Err(AppError::NotFound("Team not found".into()))
}

async fn get_user_name(db: &DbSession, user_id: &Uuid) -> String {
    let result = db
        .query_unpaged(
            "SELECT name FROM inertial_eclipse.users WHERE id = ?",
            (user_id,),
        )
        .await
        .ok();

    if let Some(r) = result {
        if let Ok(rows) = r.into_rows_result() {
            if let Ok(Some((name,))) = rows.maybe_first_row::<(Option<String>,)>() {
                return name.unwrap_or_else(|| "Usuário".to_string());
            }
        }
    }
    "Usuário".to_string()
}

// ─── Task Attachments ───

pub async fn upload_task_attachment(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((team_id, task_id)): Path<(Uuid, Uuid)>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, AppError> {
    let user_name = get_user_name(&db, &auth_user.user_id).await;

    let mut file_name = String::new();
    let mut file_bytes = Vec::new();
    let mut mime_type = "application/octet-stream".to_string();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("Multipart error: {e}")))?
    {
        if field.name() == Some("file") {
            file_name = field.file_name().unwrap_or("unnamed").to_string();
            mime_type = field.content_type().unwrap_or("application/octet-stream").to_string();
            file_bytes = field
                .bytes()
                .await
                .map_err(|e| AppError::BadRequest(format!("Failed to read file: {e}")))?
                .to_vec();
        }
    }

    if file_bytes.is_empty() {
        return Err(AppError::BadRequest("No file uploaded".into()));
    }

    if file_bytes.len() > 10 * 1024 * 1024 {
        return Err(AppError::BadRequest("File too large (max 10MB)".into()));
    }

    let attachment = team_service::create_task_attachment(
        &db, &task_id, &team_id,
        &file_name, file_bytes.len() as i64, &mime_type, &file_bytes,
        &auth_user.user_id, &user_name,
    ).await?;

    Ok(Json(json!({ "attachment": attachment })))
}

pub async fn list_task_attachments(
    Extension(db): Extension<DbSession>,
    Extension(_auth_user): Extension<AuthUser>,
    Path((_team_id, task_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let attachments = team_service::list_task_attachments(&db, &task_id).await?;
    Ok(Json(json!({ "attachments": attachments })))
}

pub async fn download_task_attachment(
    Extension(db): Extension<DbSession>,
    Extension(_auth_user): Extension<AuthUser>,
    Path((_team_id, task_id, attachment_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Response, AppError> {
    let (file_name, mime_type, data) = team_service::get_task_attachment_data(&db, &task_id, &attachment_id).await?;

    let response = Response::builder()
        .header(header::CONTENT_TYPE, mime_type)
        .header(header::CONTENT_DISPOSITION, format!("attachment; filename=\"{file_name}\""))
        .body(Body::from(data))
        .map_err(|e| AppError::InternalError(e.to_string()))?;

    Ok(response)
}

pub async fn delete_task_attachment(
    Extension(db): Extension<DbSession>,
    Extension(_auth_user): Extension<AuthUser>,
    Path((_team_id, task_id, attachment_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    team_service::delete_task_attachment(&db, &task_id, &attachment_id).await?;
    Ok(Json(json!({ "success": true })))
}
