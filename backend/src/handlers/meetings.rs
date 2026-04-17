use axum::extract::{Extension, Path};
use axum::Json;
use serde_json::json;
use uuid::Uuid;

use crate::config::Config;
use crate::db::DbSession;
use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::models::meeting::{
    CreateMeetingRequest, CreateMeetingResponse, GuestJoinRequest, GuestJoinResponse,
    GuestStatusResponse, JoinMeetingResponse, Meeting, MeetingMessage, MeetingParticipant,
    PublicMeetingInfo, SendMessageRequest,
};
use crate::services::events::{publish_global, SseEvent};
use crate::services::{auth as auth_service, livekit as livekit_service, meeting as meeting_service};
use crate::services::{workspace as workspace_service};

// ─── Helpers ────────────────────────────────────────────────────────────────

async fn ensure_host(
    db: &DbSession,
    workspace_id: &Uuid,
    meeting_id: &Uuid,
    user_id: &Uuid,
    app_url: &str,
) -> Result<Meeting, AppError> {
    let meeting = meeting_service::get_meeting(db, workspace_id, meeting_id, app_url).await?;
    if meeting.host_user_id != *user_id {
        return Err(AppError::Forbidden(
            "Somente o anfitrião pode executar esta ação".into(),
        ));
    }
    Ok(meeting)
}

async fn count_workspace_members(db: &DbSession, workspace_id: &Uuid) -> i32 {
    workspace_service::list_members(db, workspace_id)
        .await
        .map(|m| m.len() as i32)
        .unwrap_or(1)
}

async fn publish_to_workspace(
    db: &DbSession,
    workspace_id: &Uuid,
    event_type: &str,
    payload: &serde_json::Value,
) {
    if let Ok(members) = workspace_service::list_members(db, workspace_id).await {
        let data = payload.to_string();
        for member in members {
            publish_global(
                &member.user_id,
                SseEvent {
                    event_type: event_type.to_string(),
                    data: data.clone(),
                },
            )
            .await;
        }
    }
}

// ─── Protected handlers ─────────────────────────────────────────────────────

pub async fn list(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<Vec<Meeting>>, AppError> {
    let items = meeting_service::list_meetings(&db, &auth_user.workspace_id, &config.app_url).await?;
    Ok(Json(items))
}

pub async fn create(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<CreateMeetingRequest>,
) -> Result<Json<CreateMeetingResponse>, AppError> {
    meeting_service::check_and_increment_rate(&db, &auth_user.user_id).await?;

    let title = req
        .title
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("Reunião")
        .to_string();

    let participant_mode = req.participant_mode.unwrap_or_else(|| "workspace".into());
    let start_now = req.start_now.unwrap_or(false);

    let member_count = count_workspace_members(&db, &auth_user.workspace_id).await;

    let meeting = meeting_service::create_meeting(
        &db,
        meeting_service::CreateMeetingParams {
            workspace_id: &auth_user.workspace_id,
            created_by: &auth_user.user_id,
            title: title.clone(),
            participant_mode,
            scheduled_start: req.scheduled_start,
            link_expiry: req.link_expiry,
            start_now,
            workspace_member_count: member_count,
            app_url: &config.app_url,
        },
    )
    .await?;

    let host_identity = auth_user.user_id.to_string();
    let token = livekit_service::generate_token(
        &config.livekit_api_key,
        &config.livekit_api_secret,
        &meeting.livekit_room_name,
        &host_identity,
        &auth_user.email,
    )?;

    meeting_service::upsert_participant(
        &db,
        &meeting.id,
        &auth_user.user_id,
        Some(&auth_user.user_id),
        &auth_user.email,
        "host",
        "approved",
    )
    .await?;

    if start_now {
        let payload = json!({
            "meeting_id": meeting.id,
            "code": meeting.code,
            "title": meeting.title,
            "host_user_id": meeting.host_user_id,
        });
        publish_to_workspace(&db, &auth_user.workspace_id, "meeting_started", &payload).await;
    }

    Ok(Json(CreateMeetingResponse {
        meeting,
        token,
        livekit_url: config.livekit_url.clone(),
    }))
}

pub async fn get(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(auth_user): Extension<AuthUser>,
    Path(meeting_id): Path<Uuid>,
) -> Result<Json<Meeting>, AppError> {
    let meeting =
        meeting_service::get_meeting(&db, &auth_user.workspace_id, &meeting_id, &config.app_url)
            .await?;
    Ok(Json(meeting))
}

pub async fn end(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(auth_user): Extension<AuthUser>,
    Path(meeting_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let meeting = ensure_host(
        &db,
        &auth_user.workspace_id,
        &meeting_id,
        &auth_user.user_id,
        &config.app_url,
    )
    .await?;

    meeting_service::end_meeting(&db, &auth_user.workspace_id, &meeting_id).await?;

    let payload = json!({
        "meeting_id": meeting.id,
        "code": meeting.code,
    });
    publish_to_workspace(&db, &auth_user.workspace_id, "meeting_ended", &payload).await;

    Ok(Json(json!({ "message": "Meeting ended" })))
}

pub async fn delete(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(auth_user): Extension<AuthUser>,
    Path(meeting_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let meeting = ensure_host(
        &db,
        &auth_user.workspace_id,
        &meeting_id,
        &auth_user.user_id,
        &config.app_url,
    )
    .await?;

    if meeting.status == "active" {
        return Err(AppError::BadRequest(
            "Cancele a reunião antes de excluir — ainda há participantes".into(),
        ));
    }

    meeting_service::delete_meeting(&db, &auth_user.workspace_id, &meeting_id).await?;

    Ok(Json(json!({ "message": "Meeting deleted" })))
}

pub async fn join(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(auth_user): Extension<AuthUser>,
    Path(meeting_id): Path<Uuid>,
) -> Result<Json<JoinMeetingResponse>, AppError> {
    let meeting =
        meeting_service::get_meeting(&db, &auth_user.workspace_id, &meeting_id, &config.app_url)
            .await?;

    if meeting.status == "ended" {
        return Err(AppError::BadRequest("Reunião já encerrada".into()));
    }

    if meeting.status == "scheduled" {
        meeting_service::mark_active(&db, &auth_user.workspace_id, &meeting.id, &meeting.code)
            .await?;
        let payload = json!({
            "meeting_id": meeting.id,
            "code": meeting.code,
            "title": meeting.title,
            "host_user_id": meeting.host_user_id,
        });
        publish_to_workspace(&db, &auth_user.workspace_id, "meeting_started", &payload).await;
    }

    let role = if meeting.host_user_id == auth_user.user_id {
        "host"
    } else {
        "member"
    };

    meeting_service::upsert_participant(
        &db,
        &meeting.id,
        &auth_user.user_id,
        Some(&auth_user.user_id),
        &auth_user.email,
        role,
        "approved",
    )
    .await?;

    let token = livekit_service::generate_token(
        &config.livekit_api_key,
        &config.livekit_api_secret,
        &meeting.livekit_room_name,
        &auth_user.user_id.to_string(),
        &auth_user.email,
    )?;

    Ok(Json(JoinMeetingResponse {
        token,
        livekit_url: config.livekit_url.clone(),
        room: meeting.livekit_room_name,
        participant_id: auth_user.user_id,
        is_host: role == "host",
    }))
}

pub async fn participants(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(auth_user): Extension<AuthUser>,
    Path(meeting_id): Path<Uuid>,
) -> Result<Json<Vec<MeetingParticipant>>, AppError> {
    meeting_service::get_meeting(&db, &auth_user.workspace_id, &meeting_id, &config.app_url).await?;
    let items = meeting_service::list_participants(&db, &meeting_id).await?;
    Ok(Json(items))
}

pub async fn approve_guest(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(auth_user): Extension<AuthUser>,
    Path((meeting_id, participant_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let meeting = ensure_host(
        &db,
        &auth_user.workspace_id,
        &meeting_id,
        &auth_user.user_id,
        &config.app_url,
    )
    .await?;

    meeting_service::update_participant_status(&db, &meeting_id, &participant_id, "approved")
        .await?;

    publish_global(
        &auth_user.user_id,
        SseEvent {
            event_type: "meeting_join_approved".into(),
            data: json!({
                "meeting_id": meeting.id,
                "participant_id": participant_id,
            })
            .to_string(),
        },
    )
    .await;

    Ok(Json(json!({ "status": "approved" })))
}

pub async fn deny_guest(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(auth_user): Extension<AuthUser>,
    Path((meeting_id, participant_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    ensure_host(
        &db,
        &auth_user.workspace_id,
        &meeting_id,
        &auth_user.user_id,
        &config.app_url,
    )
    .await?;

    meeting_service::update_participant_status(&db, &meeting_id, &participant_id, "denied").await?;

    Ok(Json(json!({ "status": "denied" })))
}

pub async fn list_chat(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(auth_user): Extension<AuthUser>,
    Path(meeting_id): Path<Uuid>,
) -> Result<Json<Vec<MeetingMessage>>, AppError> {
    meeting_service::get_meeting(&db, &auth_user.workspace_id, &meeting_id, &config.app_url).await?;
    let items = meeting_service::list_messages(&db, &meeting_id).await?;
    Ok(Json(items))
}

pub async fn send_chat(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(auth_user): Extension<AuthUser>,
    Path(meeting_id): Path<Uuid>,
    Json(req): Json<SendMessageRequest>,
) -> Result<Json<MeetingMessage>, AppError> {
    let body = req.body.trim();
    if body.is_empty() {
        return Err(AppError::BadRequest("Mensagem vazia".into()));
    }
    if body.len() > 2000 {
        return Err(AppError::BadRequest("Mensagem muito longa".into()));
    }

    let meeting =
        meeting_service::get_meeting(&db, &auth_user.workspace_id, &meeting_id, &config.app_url)
            .await?;

    let display_name = auth_service::get_user_by_id(&db, &auth_user.user_id)
        .await
        .ok()
        .and_then(|u| {
            let trimmed = u.name.trim().to_string();
            if trimmed.is_empty() { None } else { Some(trimmed) }
        })
        .unwrap_or_else(|| auth_user.email.clone());

    let msg = meeting_service::insert_message(
        &db,
        &meeting_id,
        &auth_user.user_id,
        &display_name,
        body,
    )
    .await?;

    let payload = json!({
        "meeting_id": meeting.id,
        "code": meeting.code,
        "message": &msg,
    });

    if let Ok(participants) = meeting_service::list_participants(&db, &meeting_id).await {
        let data = payload.to_string();
        for p in participants {
            if let Some(uid) = p.user_id {
                if p.join_status == "approved" {
                    publish_global(
                        &uid,
                        SseEvent {
                            event_type: "meeting_chat_message".into(),
                            data: data.clone(),
                        },
                    )
                    .await;
                }
            }
        }
    }

    Ok(Json(msg))
}

// ─── Public handlers (guest flow) ───────────────────────────────────────────

pub async fn public_info(
    Extension(db): Extension<DbSession>,
    Path(code): Path<String>,
) -> Result<Json<PublicMeetingInfo>, AppError> {
    let record = meeting_service::lookup_by_code(&db, &code).await?;
    let knocking_required =
        record.participant_mode == "workspace" && record.workspace_member_count > 1;

    Ok(Json(PublicMeetingInfo {
        code: code.clone(),
        title: record.title,
        host_name: None,
        participant_mode: record.participant_mode,
        status: record.status,
        knocking_required,
    }))
}

pub async fn guest_join(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Path(code): Path<String>,
    Json(req): Json<GuestJoinRequest>,
) -> Result<Json<GuestJoinResponse>, AppError> {
    let display_name = meeting_service::sanitize_display_name(&req.display_name)?;
    let record = meeting_service::lookup_by_code(&db, &code).await?;

    let knocking_required =
        record.participant_mode == "workspace" && record.workspace_member_count > 1;

    let participant_id = Uuid::new_v4();

    if knocking_required {
        meeting_service::upsert_participant(
            &db,
            &record.meeting_id,
            &participant_id,
            None,
            &display_name,
            "guest",
            "pending",
        )
        .await?;

        publish_global(
            &record.host_user_id,
            SseEvent {
                event_type: "meeting_join_request".into(),
                data: json!({
                    "meeting_id": record.meeting_id,
                    "code": code,
                    "participant_id": participant_id,
                    "display_name": display_name,
                })
                .to_string(),
            },
        )
        .await;

        Ok(Json(GuestJoinResponse::Pending { participant_id }))
    } else {
        meeting_service::upsert_participant(
            &db,
            &record.meeting_id,
            &participant_id,
            None,
            &display_name,
            "guest",
            "approved",
        )
        .await?;

        let token = livekit_service::generate_token(
            &config.livekit_api_key,
            &config.livekit_api_secret,
            &record.livekit_room_name,
            &participant_id.to_string(),
            &display_name,
        )?;

        Ok(Json(GuestJoinResponse::Approved {
            token,
            livekit_url: config.livekit_url.clone(),
            room: record.livekit_room_name,
            participant_id,
        }))
    }
}

pub async fn guest_status(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Path((code, participant_id)): Path<(String, Uuid)>,
) -> Result<Json<GuestStatusResponse>, AppError> {
    let record = meeting_service::lookup_by_code(&db, &code).await?;
    let participant =
        meeting_service::get_participant(&db, &record.meeting_id, &participant_id).await?;

    match participant.join_status.as_str() {
        "approved" => {
            let token = livekit_service::generate_token(
                &config.livekit_api_key,
                &config.livekit_api_secret,
                &record.livekit_room_name,
                &participant_id.to_string(),
                &participant.display_name,
            )?;
            Ok(Json(GuestStatusResponse::Approved {
                token,
                livekit_url: config.livekit_url.clone(),
                room: record.livekit_room_name,
            }))
        }
        "denied" => Ok(Json(GuestStatusResponse::Denied)),
        _ => Ok(Json(GuestStatusResponse::Pending)),
    }
}
