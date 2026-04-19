use chrono::{DateTime, Duration, Utc};
use rand::Rng;
use scylla::frame::value::{CqlTimestamp, CqlTimeuuid};
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::models::meeting::{Meeting, MeetingMessage, MeetingParticipant};

const RATE_LIMIT_PER_HOUR: i64 = 10;
const MAX_CODE_RETRIES: usize = 3;
const MAX_DISPLAY_NAME_LEN: usize = 50;

// ─── Helpers ────────────────────────────────────────────────────────────────

fn ts_now() -> CqlTimestamp {
    CqlTimestamp(Utc::now().timestamp_millis())
}

fn dt_to_ts(dt: &DateTime<Utc>) -> CqlTimestamp {
    CqlTimestamp(dt.timestamp_millis())
}

fn ts_to_dt(ts: CqlTimestamp) -> DateTime<Utc> {
    DateTime::<Utc>::from_timestamp_millis(ts.0).unwrap_or(Utc::now())
}

fn ts_opt_to_dt(ts: Option<CqlTimestamp>) -> Option<DateTime<Utc>> {
    ts.and_then(|t| DateTime::<Utc>::from_timestamp_millis(t.0))
}

fn new_timeuuid() -> (Uuid, CqlTimeuuid) {
    let ts = uuid::timestamp::Timestamp::now(uuid::NoContext);
    let id = Uuid::new_v1(ts, &[0x02, 0x34, 0x56, 0x78, 0x9a, 0xbc]);
    (id, CqlTimeuuid::from(id))
}

fn gen_code() -> String {
    let mut rng = rand::rng();
    let mut chunk = |n: usize| -> String {
        (0..n)
            .map(|_| {
                let i: u8 = rng.random_range(0..26);
                (b'a' + i) as char
            })
            .collect()
    };
    format!("{}-{}-{}", chunk(3), chunk(4), chunk(3))
}

pub fn sanitize_display_name(name: &str) -> Result<String, AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest("Nome é obrigatório".into()));
    }
    let cleaned: String = trimmed
        .chars()
        .filter(|c| !matches!(c, '<' | '>' | '\0' | '\n' | '\r'))
        .take(MAX_DISPLAY_NAME_LEN)
        .collect();
    if cleaned.is_empty() {
        return Err(AppError::BadRequest("Nome inválido".into()));
    }
    Ok(cleaned)
}

fn parse_expiry(kind: Option<&str>) -> Option<DateTime<Utc>> {
    match kind.unwrap_or("never") {
        "24h" => Some(Utc::now() + Duration::hours(24)),
        "7d" => Some(Utc::now() + Duration::days(7)),
        "single_use" | "never" | _ => None,
    }
}

fn uses_for_expiry(kind: Option<&str>) -> i32 {
    match kind.unwrap_or("never") {
        "single_use" => 1,
        _ => -1,
    }
}

// ─── Rate limiting ──────────────────────────────────────────────────────────

pub async fn check_and_increment_rate(db: &DbSession, user_id: &Uuid) -> Result<(), AppError> {
    let bucket = Utc::now().format("%Y%m%d%H").to_string();

    let result = db
        .query_unpaged(
            "SELECT count FROM inertial_eclipse.meeting_rate WHERE user_id = ? AND hour_bucket = ?",
            (user_id, &bucket),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let current: i64 = result
        .into_rows_result()
        .ok()
        .and_then(|r| r.rows::<(Option<i64>,)>().ok()?.next()?.ok())
        .and_then(|(c,)| c)
        .unwrap_or(0);

    if current >= RATE_LIMIT_PER_HOUR {
        return Err(AppError::RateLimitExceeded);
    }

    db.query_unpaged(
        "UPDATE inertial_eclipse.meeting_rate SET count = count + 1 WHERE user_id = ? AND hour_bucket = ?",
        (user_id, &bucket),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

// ─── Row types ──────────────────────────────────────────────────────────────

type MeetingRow = (
    Uuid,                  // workspace_id
    CqlTimeuuid,           // id
    Option<String>,        // code
    Option<String>,        // title
    Option<Uuid>,          // host_user_id
    Option<Uuid>,          // created_by
    Option<String>,        // participant_mode
    Option<String>,        // status
    Option<String>,        // livekit_room_name
    Option<CqlTimestamp>,  // scheduled_start
    Option<CqlTimestamp>,  // started_at
    Option<CqlTimestamp>,  // ended_at
    Option<CqlTimestamp>,  // expires_at
    Option<i32>,           // link_uses_remaining
    Option<CqlTimestamp>,  // created_at
    Option<CqlTimestamp>,  // updated_at
);

const MEETING_COLS: &str = "workspace_id, id, code, title, host_user_id, created_by, participant_mode, status, livekit_room_name, scheduled_start, started_at, ended_at, expires_at, link_uses_remaining, created_at, updated_at";

fn row_to_meeting(r: MeetingRow, app_url: &str) -> Meeting {
    let code = r.2.unwrap_or_default();
    let id: Uuid = r.1.into();
    Meeting {
        id,
        workspace_id: r.0,
        code: code.clone(),
        title: r.3.unwrap_or_default(),
        host_user_id: r.4.unwrap_or_default(),
        created_by: r.5.unwrap_or_default(),
        participant_mode: r.6.unwrap_or_else(|| "workspace".into()),
        status: r.7.unwrap_or_else(|| "scheduled".into()),
        livekit_room_name: r.8.unwrap_or_default(),
        scheduled_start: ts_opt_to_dt(r.9),
        started_at: ts_opt_to_dt(r.10),
        ended_at: ts_opt_to_dt(r.11),
        expires_at: ts_opt_to_dt(r.12),
        link_uses_remaining: r.13.unwrap_or(-1),
        created_at: r.14.map(ts_to_dt).unwrap_or_else(Utc::now),
        updated_at: r.15.map(ts_to_dt).unwrap_or_else(Utc::now),
        share_url: format!("{}/meet/{}", app_url.trim_end_matches('/'), code),
    }
}

// ─── Code generation ────────────────────────────────────────────────────────

async fn generate_unique_code(db: &DbSession) -> Result<String, AppError> {
    for _ in 0..MAX_CODE_RETRIES {
        let code = gen_code();
        let exists = db
            .query_unpaged(
                "SELECT code FROM inertial_eclipse.meetings_by_code WHERE code = ?",
                (&code,),
            )
            .await
            .map_err(|e| AppError::DatabaseError(e.to_string()))?
            .into_rows_result()
            .ok()
            .and_then(|r| r.rows::<(Option<String>,)>().ok()?.next())
            .is_some();

        if !exists {
            return Ok(code);
        }
    }
    Err(AppError::InternalError(
        "Falha ao gerar código único".into(),
    ))
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

pub struct CreateMeetingParams<'a> {
    pub workspace_id: &'a Uuid,
    pub created_by: &'a Uuid,
    pub title: String,
    pub participant_mode: String,
    pub scheduled_start: Option<DateTime<Utc>>,
    pub link_expiry: Option<String>,
    pub start_now: bool,
    pub workspace_member_count: i32,
    pub app_url: &'a str,
}

pub async fn create_meeting(
    db: &DbSession,
    p: CreateMeetingParams<'_>,
) -> Result<Meeting, AppError> {
    let (id, timeuuid) = new_timeuuid();
    let code = generate_unique_code(db).await?;
    let livekit_room_name = format!("mt-{}", id.simple());
    let now = Utc::now();
    let now_ts = dt_to_ts(&now);
    let status = if p.start_now { "active" } else { "scheduled" };
    let started_at = if p.start_now { Some(now_ts) } else { None };
    let expires_at_dt = parse_expiry(p.link_expiry.as_deref());
    let expires_at = expires_at_dt.map(|d| dt_to_ts(&d));
    let link_uses = uses_for_expiry(p.link_expiry.as_deref());
    let scheduled_ts = p.scheduled_start.map(|d| dt_to_ts(&d));

    db.query_unpaged(
        format!(
            "INSERT INTO inertial_eclipse.meetings ({MEETING_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ),
        (
            p.workspace_id,
            &timeuuid,
            &code,
            &p.title,
            p.created_by,
            p.created_by,
            &p.participant_mode,
            status,
            &livekit_room_name,
            scheduled_ts,
            started_at,
            None::<CqlTimestamp>,
            expires_at,
            link_uses,
            now_ts,
            now_ts,
        ),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.meetings_by_code (code, workspace_id, meeting_id, status, host_user_id, participant_mode, livekit_room_name, title, workspace_member_count, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            &code,
            p.workspace_id,
            &timeuuid,
            status,
            p.created_by,
            &p.participant_mode,
            &livekit_room_name,
            &p.title,
            p.workspace_member_count,
            expires_at,
        ),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(Meeting {
        id,
        workspace_id: *p.workspace_id,
        code: code.clone(),
        title: p.title,
        host_user_id: *p.created_by,
        created_by: *p.created_by,
        participant_mode: p.participant_mode,
        status: status.to_string(),
        livekit_room_name,
        scheduled_start: p.scheduled_start,
        started_at: if p.start_now { Some(now) } else { None },
        ended_at: None,
        expires_at: expires_at_dt,
        link_uses_remaining: link_uses,
        created_at: now,
        updated_at: now,
        share_url: format!("{}/meet/{}", p.app_url.trim_end_matches('/'), code),
    })
}

pub async fn list_meetings(
    db: &DbSession,
    workspace_id: &Uuid,
    app_url: &str,
) -> Result<Vec<Meeting>, AppError> {
    let result = db
        .query_unpaged(
            format!("SELECT {MEETING_COLS} FROM inertial_eclipse.meetings WHERE workspace_id = ? LIMIT 200"),
            (workspace_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut items = Vec::new();
    let rows = result.into_rows_result()?;
    for row in rows.rows::<MeetingRow>()? {
        let r = row.map_err(|e| AppError::DatabaseError(e.to_string()))?;
        items.push(row_to_meeting(r, app_url));
    }
    Ok(items)
}

pub async fn get_meeting(
    db: &DbSession,
    workspace_id: &Uuid,
    meeting_id: &Uuid,
    app_url: &str,
) -> Result<Meeting, AppError> {
    let timeuuid = CqlTimeuuid::from(*meeting_id);
    let result = db
        .query_unpaged(
            format!("SELECT {MEETING_COLS} FROM inertial_eclipse.meetings WHERE workspace_id = ? AND id = ?"),
            (workspace_id, &timeuuid),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;
    let row = rows
        .rows::<MeetingRow>()?
        .next()
        .ok_or_else(|| AppError::NotFound("Reunião não encontrada".into()))?
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(row_to_meeting(row, app_url))
}

pub struct ByCodeRecord {
    #[allow(dead_code)]
    pub workspace_id: Uuid,
    pub meeting_id: Uuid,
    pub status: String,
    pub host_user_id: Uuid,
    pub participant_mode: String,
    pub livekit_room_name: String,
    pub title: String,
    pub workspace_member_count: i32,
    #[allow(dead_code)]
    pub expires_at: Option<DateTime<Utc>>,
}

pub async fn lookup_by_code(db: &DbSession, code: &str) -> Result<ByCodeRecord, AppError> {
    type Row = (
        Option<String>,
        Option<Uuid>,
        Option<CqlTimeuuid>,
        Option<String>,
        Option<Uuid>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<i32>,
        Option<CqlTimestamp>,
    );

    let result = db
        .query_unpaged(
            "SELECT code, workspace_id, meeting_id, status, host_user_id, participant_mode, livekit_room_name, title, workspace_member_count, expires_at FROM inertial_eclipse.meetings_by_code WHERE code = ?",
            (code,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;
    let row = rows
        .rows::<Row>()?
        .next()
        .ok_or_else(|| AppError::NotFound("Reunião não encontrada".into()))?
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let expires_at = ts_opt_to_dt(row.9);
    if let Some(exp) = expires_at {
        if exp < Utc::now() {
            return Err(AppError::NotFound("Link da reunião expirou".into()));
        }
    }

    let status = row.3.unwrap_or_else(|| "scheduled".into());
    if status == "ended" {
        return Err(AppError::NotFound("Reunião encerrada".into()));
    }

    Ok(ByCodeRecord {
        workspace_id: row.1.unwrap_or_default(),
        meeting_id: row.2.map(Uuid::from).unwrap_or_default(),
        status,
        host_user_id: row.4.unwrap_or_default(),
        participant_mode: row.5.unwrap_or_else(|| "workspace".into()),
        livekit_room_name: row.6.unwrap_or_default(),
        title: row.7.unwrap_or_default(),
        workspace_member_count: row.8.unwrap_or(1),
        expires_at,
    })
}

pub async fn delete_meeting(
    db: &DbSession,
    workspace_id: &Uuid,
    meeting_id: &Uuid,
) -> Result<(), AppError> {
    let timeuuid = CqlTimeuuid::from(*meeting_id);
    let existing = get_meeting(db, workspace_id, meeting_id, "").await?;

    db.query_unpaged(
        "DELETE FROM inertial_eclipse.meetings WHERE workspace_id = ? AND id = ?",
        (workspace_id, &timeuuid),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    db.query_unpaged(
        "DELETE FROM inertial_eclipse.meetings_by_code WHERE code = ?",
        (&existing.code,),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    db.query_unpaged(
        "DELETE FROM inertial_eclipse.meeting_participants WHERE meeting_id = ?",
        (&timeuuid,),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    db.query_unpaged(
        "DELETE FROM inertial_eclipse.meeting_messages WHERE meeting_id = ?",
        (&timeuuid,),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

pub async fn end_meeting(
    db: &DbSession,
    workspace_id: &Uuid,
    meeting_id: &Uuid,
) -> Result<(), AppError> {
    let timeuuid = CqlTimeuuid::from(*meeting_id);
    let now = ts_now();

    let existing = get_meeting(db, workspace_id, meeting_id, "").await?;

    db.query_unpaged(
        "UPDATE inertial_eclipse.meetings SET status = 'ended', ended_at = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
        (now, now, workspace_id, &timeuuid),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    db.query_unpaged(
        "UPDATE inertial_eclipse.meetings_by_code SET status = 'ended' WHERE code = ?",
        (&existing.code,),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

pub async fn mark_active(
    db: &DbSession,
    workspace_id: &Uuid,
    meeting_id: &Uuid,
    code: &str,
) -> Result<(), AppError> {
    let timeuuid = CqlTimeuuid::from(*meeting_id);
    let now = ts_now();

    db.query_unpaged(
        "UPDATE inertial_eclipse.meetings SET status = 'active', started_at = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
        (now, now, workspace_id, &timeuuid),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    db.query_unpaged(
        "UPDATE inertial_eclipse.meetings_by_code SET status = 'active' WHERE code = ?",
        (code,),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

// ─── Participants ───────────────────────────────────────────────────────────

type ParticipantRow = (
    CqlTimeuuid,          // meeting_id
    Uuid,                 // participant_id
    Option<Uuid>,         // user_id
    Option<String>,       // display_name
    Option<String>,       // role
    Option<String>,       // join_status
    Option<CqlTimestamp>, // joined_at
    Option<CqlTimestamp>, // left_at
);

fn row_to_participant(r: ParticipantRow) -> MeetingParticipant {
    MeetingParticipant {
        meeting_id: r.0.into(),
        participant_id: r.1,
        user_id: r.2,
        display_name: r.3.unwrap_or_default(),
        role: r.4.unwrap_or_else(|| "guest".into()),
        join_status: r.5.unwrap_or_else(|| "pending".into()),
        joined_at: ts_opt_to_dt(r.6),
        left_at: ts_opt_to_dt(r.7),
    }
}

pub async fn upsert_participant(
    db: &DbSession,
    meeting_id: &Uuid,
    participant_id: &Uuid,
    user_id: Option<&Uuid>,
    display_name: &str,
    role: &str,
    join_status: &str,
) -> Result<MeetingParticipant, AppError> {
    let timeuuid = CqlTimeuuid::from(*meeting_id);
    let now_ts = if join_status == "approved" {
        Some(ts_now())
    } else {
        None
    };

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.meeting_participants (meeting_id, participant_id, user_id, display_name, role, join_status, joined_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            &timeuuid,
            participant_id,
            user_id,
            display_name,
            role,
            join_status,
            now_ts,
        ),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(MeetingParticipant {
        meeting_id: *meeting_id,
        participant_id: *participant_id,
        user_id: user_id.copied(),
        display_name: display_name.to_string(),
        role: role.to_string(),
        join_status: join_status.to_string(),
        joined_at: now_ts.map(ts_to_dt),
        left_at: None,
    })
}

pub async fn get_participant(
    db: &DbSession,
    meeting_id: &Uuid,
    participant_id: &Uuid,
) -> Result<MeetingParticipant, AppError> {
    let timeuuid = CqlTimeuuid::from(*meeting_id);
    let result = db
        .query_unpaged(
            "SELECT meeting_id, participant_id, user_id, display_name, role, join_status, joined_at, left_at FROM inertial_eclipse.meeting_participants WHERE meeting_id = ? AND participant_id = ?",
            (&timeuuid, participant_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;
    let row = rows
        .rows::<ParticipantRow>()?
        .next()
        .ok_or_else(|| AppError::NotFound("Participante não encontrado".into()))?
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(row_to_participant(row))
}

pub async fn list_participants(
    db: &DbSession,
    meeting_id: &Uuid,
) -> Result<Vec<MeetingParticipant>, AppError> {
    let timeuuid = CqlTimeuuid::from(*meeting_id);
    let result = db
        .query_unpaged(
            "SELECT meeting_id, participant_id, user_id, display_name, role, join_status, joined_at, left_at FROM inertial_eclipse.meeting_participants WHERE meeting_id = ?",
            (&timeuuid,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut items = Vec::new();
    let rows = result.into_rows_result()?;
    for row in rows.rows::<ParticipantRow>()? {
        let r = row.map_err(|e| AppError::DatabaseError(e.to_string()))?;
        items.push(row_to_participant(r));
    }
    Ok(items)
}

pub async fn update_participant_status(
    db: &DbSession,
    meeting_id: &Uuid,
    participant_id: &Uuid,
    join_status: &str,
) -> Result<(), AppError> {
    let timeuuid = CqlTimeuuid::from(*meeting_id);
    let joined_at = if join_status == "approved" {
        Some(ts_now())
    } else {
        None
    };

    db.query_unpaged(
        "UPDATE inertial_eclipse.meeting_participants SET join_status = ?, joined_at = ? WHERE meeting_id = ? AND participant_id = ?",
        (join_status, joined_at, &timeuuid, participant_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

// ─── Chat messages ──────────────────────────────────────────────────────────

type MessageRow = (
    CqlTimeuuid,          // meeting_id
    CqlTimeuuid,          // id
    Option<Uuid>,         // participant_id
    Option<String>,       // display_name
    Option<String>,       // body
    Option<CqlTimestamp>, // created_at
);

fn row_to_message(r: MessageRow) -> MeetingMessage {
    let id: Uuid = r.1.into();
    MeetingMessage {
        id,
        meeting_id: r.0.into(),
        participant_id: r.2.unwrap_or_default(),
        display_name: r.3.unwrap_or_default(),
        body: r.4.unwrap_or_default(),
        created_at: r.5.map(ts_to_dt).unwrap_or_else(Utc::now),
    }
}

pub async fn insert_message(
    db: &DbSession,
    meeting_id: &Uuid,
    participant_id: &Uuid,
    display_name: &str,
    body: &str,
) -> Result<MeetingMessage, AppError> {
    let (id, id_tu) = new_timeuuid();
    let m_tu = CqlTimeuuid::from(*meeting_id);
    let now = Utc::now();
    let now_ts = dt_to_ts(&now);

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.meeting_messages (meeting_id, id, participant_id, display_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (&m_tu, &id_tu, participant_id, display_name, body, now_ts),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(MeetingMessage {
        id,
        meeting_id: *meeting_id,
        participant_id: *participant_id,
        display_name: display_name.to_string(),
        body: body.to_string(),
        created_at: now,
    })
}

pub async fn list_messages(
    db: &DbSession,
    meeting_id: &Uuid,
) -> Result<Vec<MeetingMessage>, AppError> {
    let m_tu = CqlTimeuuid::from(*meeting_id);
    let result = db
        .query_unpaged(
            "SELECT meeting_id, id, participant_id, display_name, body, created_at FROM inertial_eclipse.meeting_messages WHERE meeting_id = ? LIMIT 500",
            (&m_tu,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut items = Vec::new();
    let rows = result.into_rows_result()?;
    for row in rows.rows::<MessageRow>()? {
        let r = row.map_err(|e| AppError::DatabaseError(e.to_string()))?;
        items.push(row_to_message(r));
    }
    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_has_expected_format() {
        let code = gen_code();
        let parts: Vec<&str> = code.split('-').collect();
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0].len(), 3);
        assert_eq!(parts[1].len(), 4);
        assert_eq!(parts[2].len(), 3);
        for p in parts {
            for c in p.chars() {
                assert!(c.is_ascii_lowercase());
            }
        }
    }

    #[test]
    fn sanitize_strips_angle_brackets() {
        let n = sanitize_display_name("  Alice<script>  ").unwrap();
        assert_eq!(n, "Alicescript");
    }

    #[test]
    fn sanitize_truncates() {
        let long: String = "x".repeat(200);
        let n = sanitize_display_name(&long).unwrap();
        assert_eq!(n.len(), MAX_DISPLAY_NAME_LEN);
    }

    #[test]
    fn sanitize_rejects_empty() {
        assert!(sanitize_display_name("   ").is_err());
        assert!(sanitize_display_name("").is_err());
    }

    #[test]
    fn parse_expiry_maps_variants() {
        assert!(parse_expiry(Some("never")).is_none());
        assert!(parse_expiry(Some("single_use")).is_none());
        assert!(parse_expiry(Some("24h")).is_some());
        assert!(parse_expiry(Some("7d")).is_some());
        assert!(parse_expiry(None).is_none());
    }

    #[test]
    fn uses_for_single_use_is_one() {
        assert_eq!(uses_for_expiry(Some("single_use")), 1);
        assert_eq!(uses_for_expiry(Some("24h")), -1);
        assert_eq!(uses_for_expiry(Some("never")), -1);
        assert_eq!(uses_for_expiry(None), -1);
    }
}
