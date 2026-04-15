use chrono::{DateTime, Datelike, NaiveDate, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;
use scylla::frame::value::CqlTimestamp;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::models::appointment::{
    Appointment, AvailabilityConfig, CreateAppointmentRequest, UpdateAppointmentRequest,
    UpdateAvailabilityRequest,
};

// ─── Row types ───────────────────────────────────────────────────────────────

type AppointmentRow = (
    Uuid,              // user_id
    Uuid,              // id
    Option<Uuid>,      // assistant_id
    Option<String>,    // client_name
    Option<String>,    // client_email
    Option<String>,    // client_phone
    CqlTimestamp,      // date_time
    Option<i32>,       // duration_minutes
    Option<String>,    // appointment_type
    Option<String>,    // notes
    Option<String>,    // origin_channel
    Option<String>,    // status
    Option<Uuid>,      // conversation_id
    Option<bool>,      // is_manual
    CqlTimestamp,      // created_at
    CqlTimestamp,      // updated_at
);

type ByAssistantRow = (
    Uuid,           // assistant_id
    CqlTimestamp,   // date_time
    Uuid,           // id
    Option<Uuid>,   // user_id
    Option<String>, // client_name
    Option<String>, // client_phone
    Option<i32>,    // duration_minutes
    Option<String>, // status
);

type AvailabilityRow = (
    Uuid,                      // assistant_id
    Option<Uuid>,              // user_id
    Option<String>,            // timezone
    Option<i32>,               // default_duration_minutes
    Option<i32>,               // buffer_minutes
    Option<i32>,               // max_per_day
    Option<Vec<String>>,       // blocked_dates
    Option<String>,            // schedule_json
);

fn ts_to_dt(ts: CqlTimestamp) -> DateTime<Utc> {
    DateTime::<Utc>::from(std::time::UNIX_EPOCH + std::time::Duration::from_millis(ts.0 as u64))
}

fn dt_to_ts(dt: &DateTime<Utc>) -> CqlTimestamp {
    CqlTimestamp(dt.timestamp_millis())
}

/// Parse a datetime string, interpreting naive (no timezone) values in the given timezone.
/// Supports RFC 3339, ISO 8601 with seconds, and ISO 8601 without seconds.
pub fn parse_datetime_in_tz(date_time_str: &str, tz: &Tz) -> Option<DateTime<Utc>> {
    // Try RFC 3339 first (has timezone offset) — respect as-is
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(date_time_str) {
        return Some(dt.with_timezone(&Utc));
    }
    // Try naive formats — interpret in the assistant's timezone
    let naive = chrono::NaiveDateTime::parse_from_str(date_time_str, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(date_time_str, "%Y-%m-%dT%H:%M"))
        .ok()?;
    tz.from_local_datetime(&naive).earliest().map(|dt| dt.with_timezone(&Utc))
}

/// Resolve the timezone for an assistant from its availability config (or default to São Paulo).
pub async fn resolve_assistant_tz(db: &DbSession, assistant_id: &uuid::Uuid) -> Tz {
    match get_availability(db, assistant_id).await {
        Ok(Some(avail)) => avail.timezone.parse().unwrap_or(chrono_tz::America::Sao_Paulo),
        _ => chrono_tz::America::Sao_Paulo,
    }
}

fn row_to_appointment(r: AppointmentRow) -> Appointment {
    Appointment {
        user_id: r.0,
        id: r.1,
        assistant_id: r.2,  // already Option<Uuid>
        client_name: r.3.unwrap_or_default(),
        client_email: r.4,
        client_phone: r.5.unwrap_or_default(),
        date_time: ts_to_dt(r.6),
        duration_minutes: r.7.unwrap_or(30),
        appointment_type: r.8,
        notes: r.9,
        origin_channel: r.10,
        status: r.11.unwrap_or_else(|| "pending".into()),
        conversation_id: r.12,
        is_manual: r.13.unwrap_or(false),
        created_at: ts_to_dt(r.14),
        updated_at: ts_to_dt(r.15),
    }
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

const APPOINTMENT_COLS: &str = "user_id, id, assistant_id, client_name, client_email, client_phone, date_time, duration_minutes, appointment_type, notes, origin_channel, status, conversation_id, is_manual, created_at, updated_at";

pub async fn create_appointment(
    db: &DbSession,
    user_id: &Uuid,
    req: CreateAppointmentRequest,
) -> Result<Appointment, AppError> {
    let id = Uuid::new_v4();
    let now = Utc::now();
    let now_ts = dt_to_ts(&now);
    let dt_ts = dt_to_ts(&req.date_time);
    let duration = req.duration_minutes.unwrap_or(30);
    let status = "confirmed".to_string();
    let is_manual = req.is_manual.unwrap_or(false);

    // Validate (only if associated with an assistant)
    if let Some(ref aid) = req.assistant_id {
        let errors = validate_appointment(db, aid, &req.date_time, duration, None).await?;
        if !errors.is_empty() {
            return Err(AppError::BadRequest(errors.join("; ")));
        }
    } else if req.date_time < Utc::now() {
        return Err(AppError::BadRequest("Não é possível agendar em datas passadas".into()));
    }

    // Insert into appointments
    db.query_unpaged(
        format!(
            "INSERT INTO inertial_eclipse.appointments ({APPOINTMENT_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ),
        (
            user_id, &id, &req.assistant_id,
            &req.client_name, &req.client_email, &req.client_phone,
            dt_ts, duration,
            &req.appointment_type, &req.notes, &req.origin_channel,
            &status, &req.conversation_id, is_manual,
            now_ts, now_ts,
        ),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Insert into appointments_by_assistant (denormalized) — only if associated
    if let Some(ref aid) = req.assistant_id {
        db.query_unpaged(
            "INSERT INTO inertial_eclipse.appointments_by_assistant (assistant_id, date_time, id, user_id, client_name, client_phone, duration_minutes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (aid, dt_ts, &id, user_id, &req.client_name, &req.client_phone, duration, &status),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }

    Ok(Appointment {
        user_id: *user_id,
        id,
        assistant_id: req.assistant_id,
        client_name: req.client_name,
        client_email: req.client_email,
        client_phone: req.client_phone,
        date_time: req.date_time,
        duration_minutes: duration,
        appointment_type: req.appointment_type,
        notes: req.notes,
        origin_channel: req.origin_channel,
        status,
        conversation_id: req.conversation_id,
        is_manual,
        created_at: now,
        updated_at: now,
    })
}

pub async fn get_appointment(
    db: &DbSession,
    user_id: &Uuid,
    appointment_id: &Uuid,
) -> Result<Appointment, AppError> {
    let result = db
        .query_unpaged(
            format!("SELECT {APPOINTMENT_COLS} FROM inertial_eclipse.appointments WHERE user_id = ? AND id = ?"),
            (user_id, appointment_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;
    let row = rows
        .rows::<AppointmentRow>()?
        .next()
        .ok_or_else(|| AppError::NotFound("Appointment not found".into()))?
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(row_to_appointment(row))
}

pub async fn list_appointments(
    db: &DbSession,
    user_id: &Uuid,
) -> Result<Vec<Appointment>, AppError> {
    let result = db
        .query_unpaged(
            format!("SELECT {APPOINTMENT_COLS} FROM inertial_eclipse.appointments WHERE user_id = ? LIMIT 500"),
            (user_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut appointments = Vec::new();
    let rows = result.into_rows_result()?;
    for row in rows.rows::<AppointmentRow>()? {
        let r = row.map_err(|e| AppError::DatabaseError(e.to_string()))?;
        appointments.push(row_to_appointment(r));
    }
    Ok(appointments)
}

pub async fn update_appointment(
    db: &DbSession,
    user_id: &Uuid,
    appointment_id: &Uuid,
    req: UpdateAppointmentRequest,
) -> Result<Appointment, AppError> {
    let existing = get_appointment(db, user_id, appointment_id).await?;
    let now = Utc::now();
    let now_ts = dt_to_ts(&now);

    let new_status = req.status.unwrap_or(existing.status.clone());
    let new_date_time = req.date_time.unwrap_or(existing.date_time);
    let new_duration = req.duration_minutes.unwrap_or(existing.duration_minutes);
    let new_notes = req.notes.or(existing.notes.clone());
    let new_type = req.appointment_type.or(existing.appointment_type.clone());

    // If rescheduling, validate new time (only if associated with assistant)
    if req.date_time.is_some() {
        if let Some(ref aid) = existing.assistant_id {
            let errors = validate_appointment(
                db, aid, &new_date_time, new_duration, Some(appointment_id),
            ).await?;
            if !errors.is_empty() {
                return Err(AppError::BadRequest(errors.join("; ")));
            }
        } else if new_date_time < Utc::now() {
            return Err(AppError::BadRequest("Não é possível agendar em datas passadas".into()));
        }
    }

    let new_dt_ts = dt_to_ts(&new_date_time);

    // Update main table
    db.query_unpaged(
        "UPDATE inertial_eclipse.appointments SET status = ?, date_time = ?, duration_minutes = ?, notes = ?, appointment_type = ?, updated_at = ? WHERE user_id = ? AND id = ?",
        (&new_status, new_dt_ts, new_duration, &new_notes, &new_type, now_ts, user_id, appointment_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Update denormalized table — only if associated with assistant
    if let Some(ref aid) = existing.assistant_id {
        let old_dt_ts = dt_to_ts(&existing.date_time);
        db.query_unpaged(
            "DELETE FROM inertial_eclipse.appointments_by_assistant WHERE assistant_id = ? AND date_time = ? AND id = ?",
            (aid, old_dt_ts, appointment_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

        db.query_unpaged(
            "INSERT INTO inertial_eclipse.appointments_by_assistant (assistant_id, date_time, id, user_id, client_name, client_phone, duration_minutes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (aid, new_dt_ts, appointment_id, user_id, &existing.client_name, &existing.client_phone, new_duration, &new_status),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }

    Ok(Appointment {
        status: new_status,
        date_time: new_date_time,
        duration_minutes: new_duration,
        notes: new_notes,
        appointment_type: new_type,
        updated_at: now,
        ..existing
    })
}

pub async fn cancel_appointment(
    db: &DbSession,
    user_id: &Uuid,
    appointment_id: &Uuid,
) -> Result<Appointment, AppError> {
    update_appointment(
        db,
        user_id,
        appointment_id,
        UpdateAppointmentRequest {
            status: Some("cancelled".into()),
            date_time: None,
            notes: None,
            duration_minutes: None,
            appointment_type: None,
        },
    )
    .await
}

pub async fn delete_appointment(
    db: &DbSession,
    user_id: &Uuid,
    appointment_id: &Uuid,
) -> Result<(), AppError> {
    let existing = get_appointment(db, user_id, appointment_id).await?;

    // Delete from main table
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.appointments WHERE user_id = ? AND id = ?",
        (user_id, appointment_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Delete from denormalized table
    if let Some(ref aid) = existing.assistant_id {
        let dt_ts = dt_to_ts(&existing.date_time);
        db.query_unpaged(
            "DELETE FROM inertial_eclipse.appointments_by_assistant WHERE assistant_id = ? AND date_time = ? AND id = ?",
            (aid, dt_ts, appointment_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }

    Ok(())
}

// ─── Conflict checking ──────────────────────────────────────────────────────

pub async fn list_by_assistant_range(
    db: &DbSession,
    assistant_id: &Uuid,
    from: &DateTime<Utc>,
    to: &DateTime<Utc>,
) -> Result<Vec<(Uuid, DateTime<Utc>, i32, String)>, AppError> {
    let from_ts = dt_to_ts(from);
    let to_ts = dt_to_ts(to);

    let result = db
        .query_unpaged(
            "SELECT assistant_id, date_time, id, user_id, client_name, client_phone, duration_minutes, status FROM inertial_eclipse.appointments_by_assistant WHERE assistant_id = ? AND date_time >= ? AND date_time <= ?",
            (assistant_id, from_ts, to_ts),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut items = Vec::new();
    let rows = result.into_rows_result()?;
    for row in rows.rows::<ByAssistantRow>()? {
        let r = row.map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let status = r.7.unwrap_or_default();
        if status == "cancelled" {
            continue;
        }
        items.push((r.2, ts_to_dt(r.1), r.6.unwrap_or(30), status));
    }
    Ok(items)
}

pub async fn check_conflicts(
    db: &DbSession,
    assistant_id: &Uuid,
    date_time: &DateTime<Utc>,
    duration_minutes: i32,
    exclude_id: Option<&Uuid>,
) -> Result<bool, AppError> {
    // Check a wide window around the requested time
    let window_start = *date_time - chrono::Duration::hours(12);
    let window_end = *date_time + chrono::Duration::hours(12);

    let existing = list_by_assistant_range(db, assistant_id, &window_start, &window_end).await?;

    let req_start = date_time.timestamp();
    let req_end = req_start + (duration_minutes as i64) * 60;

    for (id, dt, dur, _status) in &existing {
        if let Some(exc) = exclude_id {
            if id == exc {
                continue;
            }
        }
        let ex_start = dt.timestamp();
        let ex_end = ex_start + (*dur as i64) * 60;
        // Overlap check
        if req_start < ex_end && req_end > ex_start {
            return Ok(true);
        }
    }
    Ok(false)
}

pub async fn validate_appointment(
    db: &DbSession,
    assistant_id: &Uuid,
    date_time: &DateTime<Utc>,
    duration_minutes: i32,
    exclude_id: Option<&Uuid>,
) -> Result<Vec<String>, AppError> {
    let mut errors = Vec::new();

    // No past dates
    if *date_time < Utc::now() {
        errors.push("Não é possível agendar em datas passadas".to_string());
    }

    // Conflict check
    if check_conflicts(db, assistant_id, date_time, duration_minutes, exclude_id).await? {
        errors.push("Já existe um agendamento neste horário".to_string());
    }

    // Availability check (if configured)
    if let Some(avail) = get_availability(db, assistant_id).await? {
        let tz: Tz = avail.timezone.parse().unwrap_or(chrono_tz::America::Sao_Paulo);
        let local_dt = date_time.with_timezone(&tz);
        let local_date_str = local_dt.format("%Y-%m-%d").to_string();

        // Blocked date check
        if avail.blocked_dates.contains(&local_date_str) {
            errors.push("Esta data está bloqueada".to_string());
        }

        // Day of week + time slot check (empty schedule = open, no restrictions)
        if let Some(ref schedule_str) = avail.schedule_json {
            if let Ok(schedule) = serde_json::from_str::<Value>(schedule_str) {
                let is_empty_schedule = schedule.as_object().map(|o| o.is_empty()).unwrap_or(true);
                if is_empty_schedule {
                    // No days configured → treat as open schedule (no day/time restrictions)
                } else {
                let day_name = match local_dt.weekday() {
                    chrono::Weekday::Mon => "monday",
                    chrono::Weekday::Tue => "tuesday",
                    chrono::Weekday::Wed => "wednesday",
                    chrono::Weekday::Thu => "thursday",
                    chrono::Weekday::Fri => "friday",
                    chrono::Weekday::Sat => "saturday",
                    chrono::Weekday::Sun => "sunday",
                };

                if let Some(slots) = schedule.get(day_name).and_then(|v| v.as_array()) {
                    if slots.is_empty() {
                        errors.push(format!("Não há disponibilidade neste dia da semana ({day_name})"));
                    } else {
                        let local_time = local_dt.time();
                        let appt_end_time = local_time + chrono::Duration::minutes(duration_minutes as i64);
                        let in_slot = slots.iter().any(|slot| {
                            let start_str = slot.get("start").and_then(|v| v.as_str()).unwrap_or("00:00");
                            let end_str = slot.get("end").and_then(|v| v.as_str()).unwrap_or("23:59");
                            let slot_start = NaiveTime::parse_from_str(start_str, "%H:%M").unwrap_or(NaiveTime::MIN);
                            let slot_end = NaiveTime::parse_from_str(end_str, "%H:%M").unwrap_or(NaiveTime::from_hms_opt(23, 59, 0).unwrap());
                            local_time >= slot_start && appt_end_time <= slot_end
                        });
                        if !in_slot {
                            errors.push("O horário solicitado está fora da disponibilidade configurada".to_string());
                        }
                    }
                } else {
                    errors.push(format!("Não há disponibilidade neste dia da semana ({day_name})"));
                }
                } // close else (non-empty schedule)
            }
        }

        // Max per day check
        if avail.max_per_day > 0 {
            let day_start = tz
                .from_local_datetime(&local_dt.date_naive().and_hms_opt(0, 0, 0).unwrap())
                .earliest()
                .map(|d| d.with_timezone(&Utc))
                .unwrap_or(*date_time);
            let day_end = tz
                .from_local_datetime(&local_dt.date_naive().and_hms_opt(23, 59, 59).unwrap())
                .latest()
                .map(|d| d.with_timezone(&Utc))
                .unwrap_or(*date_time);

            let existing = list_by_assistant_range(db, assistant_id, &day_start, &day_end).await?;
            let count = existing.iter().filter(|(id, _, _, _)| {
                if let Some(exc) = exclude_id { id != exc } else { true }
            }).count();
            if count as i32 >= avail.max_per_day {
                errors.push(format!("Limite de {} agendamentos por dia atingido", avail.max_per_day));
            }
        }

        // Buffer time check
        if avail.buffer_minutes > 0 {
            let buffer = chrono::Duration::minutes(avail.buffer_minutes as i64);
            let window_start = *date_time - buffer;
            let window_end = *date_time + chrono::Duration::minutes(duration_minutes as i64) + buffer;

            let nearby = list_by_assistant_range(db, assistant_id, &window_start, &window_end).await?;
            for (id, dt, dur, _) in &nearby {
                if let Some(exc) = exclude_id {
                    if id == exc { continue; }
                }
                let ex_start = *dt - buffer;
                let ex_end = *dt + chrono::Duration::minutes(*dur as i64) + buffer;
                let req_start_ts = date_time.timestamp();
                let req_end_ts = req_start_ts + (duration_minutes as i64) * 60;
                if req_start_ts < ex_end.timestamp() && req_end_ts > ex_start.timestamp() {
                    errors.push(format!(
                        "É necessário um intervalo de {} minutos entre agendamentos",
                        avail.buffer_minutes
                    ));
                    break;
                }
            }
        }
    }

    Ok(errors)
}

// ─── Availability config ────────────────────────────────────────────────────

pub async fn get_availability(
    db: &DbSession,
    assistant_id: &Uuid,
) -> Result<Option<AvailabilityConfig>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT assistant_id, user_id, timezone, default_duration_minutes, buffer_minutes, max_per_day, blocked_dates, schedule_json FROM inertial_eclipse.assistant_availability WHERE assistant_id = ?",
            (assistant_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;
    let row = rows
        .rows::<AvailabilityRow>()?
        .next();

    match row {
        Some(Ok(r)) => Ok(Some(AvailabilityConfig {
            assistant_id: r.0,
            user_id: r.1.unwrap_or_default(),
            timezone: r.2.unwrap_or_else(|| "America/Sao_Paulo".into()),
            default_duration_minutes: r.3.unwrap_or(30),
            buffer_minutes: r.4.unwrap_or(0),
            max_per_day: r.5.unwrap_or(0),
            blocked_dates: r.6.unwrap_or_default(),
            schedule_json: r.7,
        })),
        Some(Err(e)) => Err(AppError::DatabaseError(e.to_string())),
        None => Ok(None),
    }
}

pub async fn upsert_availability(
    db: &DbSession,
    assistant_id: &Uuid,
    user_id: &Uuid,
    req: UpdateAvailabilityRequest,
) -> Result<AvailabilityConfig, AppError> {
    let existing = get_availability(db, assistant_id).await?.unwrap_or(AvailabilityConfig {
        assistant_id: *assistant_id,
        user_id: *user_id,
        timezone: "America/Sao_Paulo".into(),
        default_duration_minutes: 30,
        buffer_minutes: 0,
        max_per_day: 0,
        blocked_dates: vec![],
        schedule_json: None,
    });

    let timezone = req.timezone.unwrap_or(existing.timezone);
    let default_duration = req.default_duration_minutes.unwrap_or(existing.default_duration_minutes);
    let buffer = req.buffer_minutes.unwrap_or(existing.buffer_minutes);
    let max_per_day = req.max_per_day.unwrap_or(existing.max_per_day);
    let blocked_dates = req.blocked_dates.unwrap_or(existing.blocked_dates);
    let schedule_json = req.schedule.map(|v| v.to_string()).or(existing.schedule_json);

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.assistant_availability (assistant_id, user_id, timezone, default_duration_minutes, buffer_minutes, max_per_day, blocked_dates, schedule_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (assistant_id, user_id, &timezone, default_duration, buffer, max_per_day, &blocked_dates, &schedule_json),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(AvailabilityConfig {
        assistant_id: *assistant_id,
        user_id: *user_id,
        timezone,
        default_duration_minutes: default_duration,
        buffer_minutes: buffer,
        max_per_day,
        blocked_dates,
        schedule_json,
    })
}

// ─── Available slots ─────────────────────────────────────────────────────────

pub async fn get_available_slots(
    db: &DbSession,
    assistant_id: &Uuid,
    date_str: &str,
) -> Result<Vec<String>, AppError> {
    let avail = get_availability(db, assistant_id).await?;
    let tz: Tz = avail
        .as_ref()
        .map(|a| a.timezone.parse().unwrap_or(chrono_tz::America::Sao_Paulo))
        .unwrap_or(chrono_tz::America::Sao_Paulo);

    let date = NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("Data inválida. Use o formato YYYY-MM-DD".into()))?;

    let duration = avail.as_ref().map(|a| a.default_duration_minutes).unwrap_or(30);
    let buffer = avail.as_ref().map(|a| a.buffer_minutes).unwrap_or(0);

    // Check blocked dates
    if let Some(ref a) = avail {
        if a.blocked_dates.contains(&date_str.to_string()) {
            return Ok(vec![]);
        }
    }

    // Get time slots for this day of week
    let day_name = match date.weekday() {
        chrono::Weekday::Mon => "monday",
        chrono::Weekday::Tue => "tuesday",
        chrono::Weekday::Wed => "wednesday",
        chrono::Weekday::Thu => "thursday",
        chrono::Weekday::Fri => "friday",
        chrono::Weekday::Sat => "saturday",
        chrono::Weekday::Sun => "sunday",
    };

    let default_open = vec![(NaiveTime::from_hms_opt(8, 0, 0).unwrap(), NaiveTime::from_hms_opt(18, 0, 0).unwrap())];
    let time_slots: Vec<(NaiveTime, NaiveTime)> = if let Some(ref a) = avail {
        if let Some(ref sj) = a.schedule_json {
            if let Ok(schedule) = serde_json::from_str::<Value>(sj) {
                let is_empty = schedule.as_object().map(|o| o.is_empty()).unwrap_or(true);
                if is_empty {
                    // Empty schedule {} → open (no day restrictions)
                    default_open.clone()
                } else if let Some(slots) = schedule.get(day_name).and_then(|v| v.as_array()) {
                    slots
                        .iter()
                        .filter_map(|s| {
                            let start = NaiveTime::parse_from_str(
                                s.get("start")?.as_str()?, "%H:%M",
                            ).ok()?;
                            let end = NaiveTime::parse_from_str(
                                s.get("end")?.as_str()?, "%H:%M",
                            ).ok()?;
                            Some((start, end))
                        })
                        .collect()
                } else {
                    // Day not in schedule → no availability for this day
                    return Ok(vec![]);
                }
            } else {
                default_open.clone()
            }
        } else {
            // No schedule configured — open schedule
            default_open.clone()
        }
    } else {
        // No availability configured — open schedule, default 8-18
        default_open
    };

    // Get existing appointments for this day
    let day_start_local = date.and_hms_opt(0, 0, 0).unwrap();
    let day_end_local = date.and_hms_opt(23, 59, 59).unwrap();
    let day_start_utc = tz.from_local_datetime(&day_start_local).earliest()
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(Utc::now);
    let day_end_utc = tz.from_local_datetime(&day_end_local).latest()
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(Utc::now);

    let existing = list_by_assistant_range(db, assistant_id, &day_start_utc, &day_end_utc).await?;

    // Generate available slots
    let step = duration + buffer;
    let mut slots = Vec::new();

    for (slot_start, slot_end) in &time_slots {
        let mut current = *slot_start;
        while current + chrono::Duration::minutes(duration as i64) <= *slot_end {
            let slot_dt_local = date.and_time(current);
            if let Some(slot_dt_utc) = tz.from_local_datetime(&slot_dt_local).earliest() {
                let slot_utc = slot_dt_utc.with_timezone(&Utc);

                // Skip past slots
                if slot_utc < Utc::now() {
                    current = current + chrono::Duration::minutes(step as i64);
                    continue;
                }

                // Check conflict with existing
                let slot_start_ts = slot_utc.timestamp();
                let slot_end_ts = slot_start_ts + (duration as i64) * 60;
                let has_conflict = existing.iter().any(|(_, dt, dur, _)| {
                    let ex_start = dt.timestamp() - (buffer as i64) * 60;
                    let ex_end = dt.timestamp() + (*dur as i64) * 60 + (buffer as i64) * 60;
                    slot_start_ts < ex_end && slot_end_ts > ex_start
                });

                if !has_conflict {
                    slots.push(current.format("%H:%M").to_string());
                }
            }
            current = current + chrono::Duration::minutes(step as i64);
        }
    }

    // Check max per day
    if let Some(ref a) = avail {
        if a.max_per_day > 0 {
            let current_count = existing.len() as i32;
            let remaining = (a.max_per_day - current_count).max(0) as usize;
            slots.truncate(remaining);
        }
    }

    Ok(slots)
}

// ─── Available days (week summary) ──────────────────────────────────────────

pub async fn get_available_days(
    db: &DbSession,
    assistant_id: &Uuid,
    week_start_str: &str,
) -> Result<Vec<Value>, AppError> {
    let start_date = NaiveDate::parse_from_str(week_start_str, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("Data inválida. Use o formato YYYY-MM-DD".into()))?;

    let mut result = Vec::new();
    for i in 0..7 {
        let date = start_date + chrono::Duration::days(i);
        let date_str = date.format("%Y-%m-%d").to_string();
        let slots = get_available_slots(db, assistant_id, &date_str).await?;
        result.push(json!({
            "date": date_str,
            "weekday": match date.weekday() {
                chrono::Weekday::Mon => "segunda",
                chrono::Weekday::Tue => "terça",
                chrono::Weekday::Wed => "quarta",
                chrono::Weekday::Thu => "quinta",
                chrono::Weekday::Fri => "sexta",
                chrono::Weekday::Sat => "sábado",
                chrono::Weekday::Sun => "domingo",
            },
            "available_slots_count": slots.len(),
            "has_availability": !slots.is_empty(),
        }));
    }
    Ok(result)
}
