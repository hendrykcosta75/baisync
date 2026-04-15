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
use crate::models::okr::{
    CreateCheckInRequest, CreateKeyResultRequest, CreateObjectiveRequest, OkrQueryParams,
    UpdateKeyResultRequest, UpdateObjectiveRequest,
};
use crate::services::events::{publish_global, SseEvent};
use crate::services::okr as okr_service;
use crate::services::workspace as ws_service;

#[derive(Debug, Deserialize)]
pub struct PaginationParams {
    pub cursor: Option<String>,
    pub limit: Option<i32>,
}

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

// ─── Objectives ───

pub async fn list_objectives(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(workspace_id): Path<Uuid>,
    Query(params): Query<OkrQueryParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    let _ = ws_service::get_member_role(&db, &workspace_id, &auth_user.user_id).await?;

    if let Some(cycle) = &params.cycle {
        let objectives = okr_service::list_objectives_by_cycle(&db, &workspace_id, cycle).await?;

        // Enrich each objective with key results
        let mut enriched = Vec::new();
        for obj in objectives {
            let krs = okr_service::list_key_results(&db, &obj.objective_id).await?;
            let mut val = serde_json::to_value(&obj).unwrap_or_default();
            val["key_results"] = serde_json::to_value(&krs).unwrap_or_default();
            enriched.push(val);
        }

        Ok(Json(json!({ "objectives": enriched })))
    } else {
        let objectives = okr_service::list_all_objectives(&db, &workspace_id).await?;

        let mut enriched = Vec::new();
        for mut obj in objectives {
            let krs = okr_service::list_key_results(&db, &obj.id).await?;
            obj.key_results = Some(krs);
            enriched.push(obj);
        }

        // Filter by team if specified (check both team_id and team_ids)
        let filtered: Vec<_> = if let Some(team_id) = params.team_id {
            enriched
                .into_iter()
                .filter(|o| {
                    o.team_id == Some(team_id)
                        || o.team_ids
                            .as_ref()
                            .is_some_and(|ids| ids.contains(&team_id))
                })
                .collect()
        } else {
            enriched
        };

        Ok(Json(json!({ "objectives": filtered })))
    }
}

pub async fn create_objective(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(workspace_id): Path<Uuid>,
    Json(body): Json<CreateObjectiveRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let role = ws_service::get_member_role(&db, &workspace_id, &auth_user.user_id).await?;
    if role != "owner" && role != "admin" {
        return Err(AppError::Forbidden(
            "Apenas administradores podem criar objetivos".into(),
        ));
    }

    let owner_id = body.owner_id.unwrap_or(auth_user.user_id);

    let objective = okr_service::create_objective(
        &db,
        &workspace_id,
        &body.title,
        body.description.as_deref(),
        &body.objective_type,
        &body.cycle,
        &owner_id,
        body.team_id.as_ref(),
        body.parent_objective_id.as_ref(),
        body.team_ids.as_ref(),
    )
    .await?;

    let data = serde_json::to_string(&json!({ "objective": &objective })).unwrap_or_default();
    publish_to_workspace(
        &db,
        &workspace_id,
        &auth_user.user_id,
        "okr_objective_created",
        &data,
    )
    .await;

    Ok(Json(json!({ "objective": objective })))
}

pub async fn get_objective(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(objective_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let obj = find_objective_and_verify(&db, &objective_id, &auth_user.user_id).await?;
    let krs = okr_service::list_key_results(&db, &obj.id).await?;

    let mut enriched = obj;
    enriched.key_results = Some(krs);

    Ok(Json(json!({ "objective": enriched })))
}

pub async fn update_objective(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(objective_id): Path<Uuid>,
    Json(body): Json<UpdateObjectiveRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let obj = find_objective_and_verify(&db, &objective_id, &auth_user.user_id).await?;
    let role = ws_service::get_member_role(&db, &obj.workspace_id, &auth_user.user_id).await?;
    if role != "owner" && role != "admin" {
        return Err(AppError::Forbidden(
            "Apenas administradores podem editar objetivos".into(),
        ));
    }

    okr_service::update_objective(
        &db,
        &obj.workspace_id,
        &objective_id,
        body.title.as_deref(),
        body.description.as_deref(),
        body.objective_type.as_deref(),
        body.cycle.as_deref(),
        body.status.as_deref(),
        body.owner_id.as_ref(),
        body.team_id.as_ref(),
        body.parent_objective_id.as_ref(),
        body.team_ids.as_ref(),
    )
    .await?;

    let updated = okr_service::get_objective(&db, &obj.workspace_id, &objective_id).await?;

    let data = serde_json::to_string(&json!({ "objective": &updated })).unwrap_or_default();
    publish_to_workspace(
        &db,
        &obj.workspace_id,
        &auth_user.user_id,
        "okr_objective_updated",
        &data,
    )
    .await;

    Ok(Json(json!({ "objective": updated })))
}

pub async fn delete_objective(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(objective_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let obj = find_objective_and_verify(&db, &objective_id, &auth_user.user_id).await?;
    let role = ws_service::get_member_role(&db, &obj.workspace_id, &auth_user.user_id).await?;
    if role != "owner" && role != "admin" {
        return Err(AppError::Forbidden(
            "Apenas administradores podem excluir objetivos".into(),
        ));
    }

    okr_service::delete_objective(&db, &obj.workspace_id, &objective_id).await?;

    let data = serde_json::to_string(&json!({ "objective_id": objective_id })).unwrap_or_default();
    publish_to_workspace(
        &db,
        &obj.workspace_id,
        &auth_user.user_id,
        "okr_objective_deleted",
        &data,
    )
    .await;

    Ok(Json(json!({ "success": true })))
}

pub async fn list_children(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(objective_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let _ = find_objective_and_verify(&db, &objective_id, &auth_user.user_id).await?;
    let children = okr_service::list_children(&db, &objective_id).await?;
    Ok(Json(json!({ "children": children })))
}

// ─── Key Results ───

pub async fn list_key_results(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(objective_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let _ = find_objective_and_verify(&db, &objective_id, &auth_user.user_id).await?;
    let krs = okr_service::list_key_results(&db, &objective_id).await?;
    Ok(Json(json!({ "key_results": krs })))
}

pub async fn create_key_result(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(objective_id): Path<Uuid>,
    Json(body): Json<CreateKeyResultRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let obj = find_objective_and_verify(&db, &objective_id, &auth_user.user_id).await?;
    let role = ws_service::get_member_role(&db, &obj.workspace_id, &auth_user.user_id).await?;
    if role != "owner" && role != "admin" {
        return Err(AppError::Forbidden(
            "Apenas administradores podem criar resultados-chave".into(),
        ));
    }

    let owner_id = body.owner_id.unwrap_or(auth_user.user_id);

    let kr = okr_service::create_key_result(
        &db,
        &objective_id,
        &body.title,
        &body.kr_type,
        body.start_value,
        body.target_value,
        body.unit.as_deref(),
        &owner_id,
    )
    .await?;

    Ok(Json(json!({ "key_result": kr })))
}

pub async fn update_key_result(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((objective_id, kr_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateKeyResultRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let obj = find_objective_and_verify(&db, &objective_id, &auth_user.user_id).await?;
    let role = ws_service::get_member_role(&db, &obj.workspace_id, &auth_user.user_id).await?;
    if role != "owner" && role != "admin" {
        return Err(AppError::Forbidden(
            "Apenas administradores podem editar resultados-chave".into(),
        ));
    }

    okr_service::update_key_result(
        &db,
        &objective_id,
        &kr_id,
        body.title.as_deref(),
        body.kr_type.as_deref(),
        body.start_value,
        body.target_value,
        body.current_value,
        body.unit.as_deref(),
        body.confidence,
        body.status.as_deref(),
        body.owner_id.as_ref(),
    )
    .await?;

    Ok(Json(json!({ "success": true })))
}

pub async fn delete_key_result(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((objective_id, kr_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let obj = find_objective_and_verify(&db, &objective_id, &auth_user.user_id).await?;
    let role = ws_service::get_member_role(&db, &obj.workspace_id, &auth_user.user_id).await?;
    if role != "owner" && role != "admin" {
        return Err(AppError::Forbidden(
            "Apenas administradores podem excluir resultados-chave".into(),
        ));
    }

    okr_service::delete_key_result(&db, &objective_id, &kr_id).await?;

    Ok(Json(json!({ "success": true })))
}

// ─── Check-Ins ───

pub async fn list_check_ins(
    Extension(db): Extension<DbSession>,
    Extension(_auth_user): Extension<AuthUser>,
    Path(kr_id): Path<Uuid>,
    Query(params): Query<PaginationParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    let limit = params.limit.unwrap_or(20);
    let (check_ins, next_cursor) =
        okr_service::list_check_ins(&db, &kr_id, params.cursor.as_deref(), limit).await?;
    Ok(Json(
        json!({ "check_ins": check_ins, "next_cursor": next_cursor }),
    ))
}

pub async fn create_check_in(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(kr_id): Path<Uuid>,
    Json(body): Json<CreateCheckInRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let user_name = get_user_name(&db, &auth_user.user_id).await;

    // Fetch the KR's current value before updating
    let previous_value = okr_service::get_kr_current_value(&db, &kr_id)
        .await
        .unwrap_or(body.new_value);

    let check_in = okr_service::create_check_in(
        &db,
        &kr_id,
        previous_value,
        body.new_value,
        body.confidence,
        body.note.as_deref(),
        body.blockers.as_deref(),
        &auth_user.user_id,
        &user_name,
    )
    .await?;

    Ok(Json(json!({ "check_in": check_in })))
}

// ─── Attachments ───

pub async fn upload_attachment(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((entity_type, entity_id)): Path<(String, Uuid)>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, AppError> {
    if entity_type != "key-results" && entity_type != "check-ins" && entity_type != "objectives" {
        return Err(AppError::BadRequest(
            "entity_type must be 'key-results', 'check-ins', or 'objectives'".into(),
        ));
    }

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
            mime_type = field
                .content_type()
                .unwrap_or("application/octet-stream")
                .to_string();
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

    // 10 MB limit
    if file_bytes.len() > 10 * 1024 * 1024 {
        return Err(AppError::BadRequest("File too large (max 10MB)".into()));
    }

    let db_entity_type = match entity_type.as_str() {
        "key-results" => "key_result",
        "objectives" => "objective",
        _ => "check_in",
    };

    let attachment = okr_service::create_attachment(
        &db,
        &entity_id,
        db_entity_type,
        &auth_user.workspace_id,
        &file_name,
        file_bytes.len() as i64,
        &mime_type,
        &file_bytes,
        &auth_user.user_id,
        &user_name,
    )
    .await?;

    Ok(Json(json!({ "attachment": attachment })))
}

pub async fn list_attachments(
    Extension(db): Extension<DbSession>,
    Extension(_auth_user): Extension<AuthUser>,
    Path((_entity_type, entity_id)): Path<(String, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let attachments = okr_service::list_attachments(&db, &entity_id).await?;
    Ok(Json(json!({ "attachments": attachments })))
}

pub async fn download_attachment(
    Extension(db): Extension<DbSession>,
    Extension(_auth_user): Extension<AuthUser>,
    Path((entity_id, attachment_id)): Path<(Uuid, Uuid)>,
) -> Result<Response, AppError> {
    let (file_name, mime_type, data) =
        okr_service::get_attachment_data(&db, &entity_id, &attachment_id).await?;

    let response = Response::builder()
        .header(header::CONTENT_TYPE, mime_type)
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{file_name}\""),
        )
        .body(Body::from(data))
        .map_err(|e| AppError::InternalError(e.to_string()))?;

    Ok(response)
}

pub async fn delete_attachment(
    Extension(db): Extension<DbSession>,
    Extension(_auth_user): Extension<AuthUser>,
    Path((entity_id, attachment_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    okr_service::delete_attachment(&db, &entity_id, &attachment_id).await?;
    Ok(Json(json!({ "success": true })))
}

// ─── Helpers ───

async fn find_objective_and_verify(
    db: &DbSession,
    objective_id: &Uuid,
    user_id: &Uuid,
) -> Result<crate::models::okr::OkrObjective, AppError> {
    let workspaces = ws_service::list_user_workspaces(db, user_id).await?;
    for ws in &workspaces {
        if let Ok(obj) = okr_service::get_objective(db, &ws.workspace_id, objective_id).await {
            let _ = ws_service::get_member_role(db, &ws.workspace_id, user_id).await?;
            return Ok(obj);
        }
    }
    Err(AppError::NotFound("Objective not found".into()))
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
