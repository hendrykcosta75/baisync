use std::collections::HashSet;

use chrono::{DateTime, Utc};
use scylla::frame::value::{CqlTimestamp, CqlTimeuuid};
use uuid::Uuid;

use crate::db::{self, DbSession};
use crate::errors::AppError;
use crate::models::okr::{
    OkrAttachment, OkrCheckIn, OkrKeyResult, OkrObjective,
    OkrObjectiveByCycle, OkrObjectiveChild,
};

fn ts_now() -> CqlTimestamp {
    CqlTimestamp(Utc::now().timestamp_millis())
}

fn new_timeuuid() -> (Uuid, CqlTimeuuid) {
    let ts = uuid::timestamp::Timestamp::now(uuid::NoContext);
    let id = Uuid::new_v1(ts, &[0x01, 0x23, 0x45, 0x67, 0x89, 0xab]);
    (id, CqlTimeuuid::from(id))
}

// ─── Objectives ───

pub async fn create_objective(
    db: &DbSession,
    workspace_id: &Uuid,
    title: &str,
    description: Option<&str>,
    objective_type: &str,
    cycle: &str,
    owner_id: &Uuid,
    team_id: Option<&Uuid>,
    parent_objective_id: Option<&Uuid>,
    team_ids: Option<&Vec<Uuid>>,
) -> Result<OkrObjective, AppError> {
    let id = Uuid::new_v4();
    let now = ts_now();
    let desc = description.unwrap_or("");

    // Merge team_id into team_ids for backward compat
    let effective_team_ids: HashSet<Uuid> = {
        let mut set = HashSet::new();
        if let Some(ids) = team_ids {
            set.extend(ids.iter().copied());
        }
        if let Some(tid) = team_id {
            set.insert(*tid);
        }
        set
    };
    let team_ids_bind = if effective_team_ids.is_empty() { None } else { Some(&effective_team_ids) };

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.okr_objectives (workspace_id, id, title, description, objective_type, cycle, status, owner_id, team_id, team_ids, parent_objective_id, progress, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'on_track', ?, ?, ?, ?, 0.0, 0.5, ?, ?)",
        (workspace_id, &id, title, desc, objective_type, cycle, owner_id, &team_id, &team_ids_bind, &parent_objective_id, now, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Denormalized by-cycle table
    db.query_unpaged(
        "INSERT INTO inertial_eclipse.okr_objectives_by_cycle (workspace_id, cycle, objective_id, title, objective_type, status, progress, confidence, owner_id, team_id, team_ids) VALUES (?, ?, ?, ?, ?, 'on_track', 0.0, 0.5, ?, ?, ?)",
        (workspace_id, cycle, &id, title, objective_type, owner_id, &team_id, &team_ids_bind),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // If this objective has a parent, add to the children denormalized table
    if let Some(parent_id) = parent_objective_id {
        if let Err(e) = db.query_unpaged(
            "INSERT INTO inertial_eclipse.okr_objective_children (parent_objective_id, child_objective_id, workspace_id, child_title, child_progress, child_confidence, child_team_id) VALUES (?, ?, ?, ?, 0.0, 0.5, ?)",
            (parent_id, &id, workspace_id, title, &team_id),
        ).await {
            tracing::warn!("Failed to sync objective {} to children table: {}", id, e);
        }
    }

    let team_ids_vec: Vec<Uuid> = effective_team_ids.into_iter().collect();

    Ok(OkrObjective {
        workspace_id: *workspace_id,
        id,
        title: title.to_string(),
        description: description.map(String::from),
        objective_type: objective_type.to_string(),
        cycle: cycle.to_string(),
        status: "on_track".to_string(),
        owner_id: *owner_id,
        team_id: team_id.copied(),
        team_ids: if team_ids_vec.is_empty() { None } else { Some(team_ids_vec) },
        parent_objective_id: parent_objective_id.copied(),
        progress: 0.0,
        confidence: 0.5,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        key_results: None,
        owner_name: None,
        team_name: None,
        children: None,
    })
}

pub async fn list_objectives_by_cycle(
    db: &DbSession,
    workspace_id: &Uuid,
    cycle: &str,
) -> Result<Vec<OkrObjectiveByCycle>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT workspace_id, cycle, objective_id, title, objective_type, status, progress, confidence, owner_id, team_id, team_ids FROM inertial_eclipse.okr_objectives_by_cycle WHERE workspace_id = ? AND cycle = ?",
            (workspace_id, cycle),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    type CycleRow = (Uuid, Option<String>, Uuid, Option<String>, Option<String>, Option<String>, Option<f32>, Option<f32>, Option<Uuid>, Option<Uuid>, Option<HashSet<Uuid>>);

    let rows = result.into_rows_result()?;

    let mut objectives = Vec::new();
    for row in rows.rows::<CycleRow>()?.flatten() {
        let team_ids_vec: Option<Vec<Uuid>> = row.10.map(|s| s.into_iter().collect());
        objectives.push(OkrObjectiveByCycle {
            workspace_id: row.0,
            cycle: row.1.unwrap_or_default(),
            objective_id: row.2,
            title: row.3.unwrap_or_default(),
            objective_type: row.4.unwrap_or_else(|| "committed".to_string()),
            status: row.5.unwrap_or_else(|| "on_track".to_string()),
            progress: row.6.unwrap_or(0.0),
            confidence: row.7.unwrap_or(0.5),
            owner_id: row.8.unwrap_or(Uuid::nil()),
            team_id: row.9,
            team_ids: team_ids_vec,
        });
    }

    Ok(objectives)
}

pub async fn list_all_objectives(
    db: &DbSession,
    workspace_id: &Uuid,
) -> Result<Vec<OkrObjective>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT workspace_id, id, title, description, objective_type, cycle, status, owner_id, team_id, parent_objective_id, progress, confidence, created_at, updated_at, team_ids FROM inertial_eclipse.okr_objectives WHERE workspace_id = ?",
            (workspace_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;

    let mut objectives = Vec::new();
    for row in rows.rows::<ObjRow>()?.flatten() {
        objectives.push(row_to_objective(row));
    }

    Ok(objectives)
}

pub async fn get_objective(
    db: &DbSession,
    workspace_id: &Uuid,
    objective_id: &Uuid,
) -> Result<OkrObjective, AppError> {
    let result = db
        .query_unpaged(
            "SELECT workspace_id, id, title, description, objective_type, cycle, status, owner_id, team_id, parent_objective_id, progress, confidence, created_at, updated_at, team_ids FROM inertial_eclipse.okr_objectives WHERE workspace_id = ? AND id = ?",
            (workspace_id, objective_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let row = result
        .into_rows_result()?
        .single_row::<ObjRow>()?;

    Ok(row_to_objective(row))
}

pub async fn update_objective(
    db: &DbSession,
    workspace_id: &Uuid,
    objective_id: &Uuid,
    title: Option<&str>,
    description: Option<&str>,
    objective_type: Option<&str>,
    cycle: Option<&str>,
    status: Option<&str>,
    owner_id: Option<&Uuid>,
    team_id: Option<&Uuid>,
    parent_objective_id: Option<&Uuid>,
    team_ids: Option<&Vec<Uuid>>,
) -> Result<(), AppError> {
    let now = ts_now();

    // Get current objective for denormalized updates
    let current = get_objective(db, workspace_id, objective_id).await?;

    if let Some(v) = title {
        db.query_unpaged(
            "UPDATE inertial_eclipse.okr_objectives SET title = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
            (v, now, workspace_id, objective_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = description {
        db.query_unpaged(
            "UPDATE inertial_eclipse.okr_objectives SET description = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
            (v, now, workspace_id, objective_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = objective_type {
        db.query_unpaged(
            "UPDATE inertial_eclipse.okr_objectives SET objective_type = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
            (v, now, workspace_id, objective_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = status {
        db.query_unpaged(
            "UPDATE inertial_eclipse.okr_objectives SET status = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
            (v, now, workspace_id, objective_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = owner_id {
        db.query_unpaged(
            "UPDATE inertial_eclipse.okr_objectives SET owner_id = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
            (v, now, workspace_id, objective_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = team_id {
        db.query_unpaged(
            "UPDATE inertial_eclipse.okr_objectives SET team_id = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
            (v, now, workspace_id, objective_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(ids) = team_ids {
        let set: HashSet<Uuid> = ids.iter().copied().collect();
        let bind_set = if set.is_empty() { None } else { Some(&set) };
        db.query_unpaged(
            "UPDATE inertial_eclipse.okr_objectives SET team_ids = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
            (&bind_set, now, workspace_id, objective_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = parent_objective_id {
        // Remove from old parent's children if exists
        if let Some(old_parent) = current.parent_objective_id {
            let _ = db.query_unpaged(
                "DELETE FROM inertial_eclipse.okr_objective_children WHERE parent_objective_id = ? AND child_objective_id = ?",
                (&old_parent, objective_id),
            ).await;
        }
        // Add to new parent's children
        db.query_unpaged(
            "UPDATE inertial_eclipse.okr_objectives SET parent_objective_id = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
            (v, now, workspace_id, objective_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;

        let child_title = title.unwrap_or(&current.title);
        let child_team = team_id.or(current.team_id.as_ref());
        let _ = db.query_unpaged(
            "INSERT INTO inertial_eclipse.okr_objective_children (parent_objective_id, child_objective_id, workspace_id, child_title, child_progress, child_confidence, child_team_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (v, objective_id, workspace_id, child_title, current.progress, current.confidence, &child_team),
        ).await;
    }

    // Update denormalized by-cycle table
    let new_cycle = cycle.unwrap_or(&current.cycle);
    let new_title = title.unwrap_or(&current.title);
    let new_type = objective_type.unwrap_or(&current.objective_type);
    let new_status = status.unwrap_or(&current.status);
    let new_owner = owner_id.unwrap_or(&current.owner_id);
    let new_team = team_id.or(current.team_id.as_ref());

    // If cycle changed, delete old entry
    if cycle.is_some() && cycle.unwrap() != current.cycle {
        let _ = db.query_unpaged(
            "DELETE FROM inertial_eclipse.okr_objectives_by_cycle WHERE workspace_id = ? AND cycle = ? AND objective_id = ?",
            (workspace_id, &current.cycle as &str, objective_id),
        ).await;
    }

    let new_team_ids: Option<HashSet<Uuid>> = team_ids
        .map(|ids| ids.iter().copied().collect())
        .or_else(|| current.team_ids.as_ref().map(|v| v.iter().copied().collect()));

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.okr_objectives_by_cycle (workspace_id, cycle, objective_id, title, objective_type, status, progress, confidence, owner_id, team_id, team_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (workspace_id, new_cycle, objective_id, new_title, new_type, new_status, current.progress, current.confidence, new_owner, &new_team, &new_team_ids),
    ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

pub async fn delete_objective(
    db: &DbSession,
    workspace_id: &Uuid,
    objective_id: &Uuid,
) -> Result<(), AppError> {
    let obj = get_objective(db, workspace_id, objective_id).await?;

    // 1. Delete check-ins for each KR, plus KR lookup entries
    let krs = list_key_results(db, objective_id).await?;
    for kr in &krs {
        db.query_unpaged(
            "DELETE FROM inertial_eclipse.okr_check_ins WHERE key_result_id = ?",
            (&kr.id,),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;

        // Clean up KR lookup table
        if let Err(e) = db.query_unpaged(
            "DELETE FROM inertial_eclipse.okr_kr_objective_lookup WHERE key_result_id = ?",
            (&kr.id,),
        ).await {
            tracing::warn!("Failed to delete KR lookup for {}: {}", kr.id, e);
        }
    }

    // 2. Delete key results
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.okr_key_results WHERE objective_id = ?",
        (objective_id,),
    ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // 3. Delete from by-cycle
    let _ = db.query_unpaged(
        "DELETE FROM inertial_eclipse.okr_objectives_by_cycle WHERE workspace_id = ? AND cycle = ? AND objective_id = ?",
        (workspace_id, &obj.cycle as &str, objective_id),
    ).await;

    // 4. Clean up children table (this objective as parent)
    if let Err(e) = db.query_unpaged(
        "DELETE FROM inertial_eclipse.okr_objective_children WHERE parent_objective_id = ?",
        (objective_id,),
    ).await {
        tracing::warn!("Failed to delete children entries for objective {}: {}", objective_id, e);
    }

    // 5. If this objective was a child, remove it from the parent's children list
    if let Some(parent_id) = obj.parent_objective_id {
        if let Err(e) = db.query_unpaged(
            "DELETE FROM inertial_eclipse.okr_objective_children WHERE parent_objective_id = ? AND child_objective_id = ?",
            (&parent_id, objective_id),
        ).await {
            tracing::warn!("Failed to remove objective {} from parent's children: {}", objective_id, e);
        }
    }

    // 6. Delete objective
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.okr_objectives WHERE workspace_id = ? AND id = ?",
        (workspace_id, objective_id),
    ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

// ─── Key Results ───

pub async fn create_key_result(
    db: &DbSession,
    objective_id: &Uuid,
    title: &str,
    kr_type: &str,
    start_value: f32,
    target_value: f32,
    unit: Option<&str>,
    owner_id: &Uuid,
) -> Result<OkrKeyResult, AppError> {
    let id = Uuid::new_v4();
    let now = ts_now();

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.okr_key_results (objective_id, id, title, kr_type, start_value, target_value, current_value, unit, confidence, status, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0.5, 'on_track', ?, ?, ?)",
        (objective_id, &id, title, kr_type, start_value, target_value, start_value, &unit.unwrap_or(""), owner_id, now, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Populate reverse lookup table (KR -> objective + workspace)
    // Get workspace_id from the objective
    if let Ok(obj) = get_objective_by_id_scan(db, objective_id).await {
        let _ = db.query_unpaged(
            "INSERT INTO inertial_eclipse.okr_kr_objective_lookup (key_result_id, objective_id, workspace_id) VALUES (?, ?, ?)",
            (&id, objective_id, &obj.workspace_id),
        ).await;
    }

    Ok(OkrKeyResult {
        objective_id: *objective_id,
        id,
        title: title.to_string(),
        kr_type: kr_type.to_string(),
        start_value,
        target_value,
        current_value: start_value,
        unit: unit.map(String::from),
        confidence: 0.5,
        status: "on_track".to_string(),
        owner_id: *owner_id,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        owner_name: None,
        check_ins: None,
    })
}

pub async fn list_key_results(
    db: &DbSession,
    objective_id: &Uuid,
) -> Result<Vec<OkrKeyResult>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT objective_id, id, title, kr_type, start_value, target_value, current_value, unit, confidence, status, owner_id, created_at, updated_at FROM inertial_eclipse.okr_key_results WHERE objective_id = ?",
            (objective_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    type KrRow = (
        Uuid, Uuid, Option<String>, Option<String>, Option<f32>, Option<f32>,
        Option<f32>, Option<String>, Option<f32>, Option<String>, Option<Uuid>,
        Option<DateTime<Utc>>, Option<DateTime<Utc>>,
    );

    let rows = result.into_rows_result()?;

    let mut krs = Vec::new();
    for row in rows.rows::<KrRow>()?.flatten() {
        krs.push(OkrKeyResult {
            objective_id: row.0,
            id: row.1,
            title: row.2.unwrap_or_default(),
            kr_type: row.3.unwrap_or_else(|| "number".to_string()),
            start_value: row.4.unwrap_or(0.0),
            target_value: row.5.unwrap_or(100.0),
            current_value: row.6.unwrap_or(0.0),
            unit: row.7,
            confidence: row.8.unwrap_or(0.5),
            status: row.9.unwrap_or_else(|| "on_track".to_string()),
            owner_id: row.10.unwrap_or(Uuid::nil()),
            created_at: row.11.unwrap_or(Utc::now()),
            updated_at: row.12.unwrap_or(Utc::now()),
            owner_name: None,
            check_ins: None,
        });
    }

    Ok(krs)
}

pub async fn update_key_result(
    db: &DbSession,
    objective_id: &Uuid,
    kr_id: &Uuid,
    title: Option<&str>,
    kr_type: Option<&str>,
    start_value: Option<f32>,
    target_value: Option<f32>,
    current_value: Option<f32>,
    unit: Option<&str>,
    confidence: Option<f32>,
    status: Option<&str>,
    owner_id: Option<&Uuid>,
) -> Result<(), AppError> {
    let now = ts_now();

    if let Some(v) = title {
        db.query_unpaged(
            "UPDATE inertial_eclipse.okr_key_results SET title = ?, updated_at = ? WHERE objective_id = ? AND id = ?",
            (v, now, objective_id, kr_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = kr_type {
        db.query_unpaged(
            "UPDATE inertial_eclipse.okr_key_results SET kr_type = ?, updated_at = ? WHERE objective_id = ? AND id = ?",
            (v, now, objective_id, kr_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = start_value {
        db.query_unpaged(
            "UPDATE inertial_eclipse.okr_key_results SET start_value = ?, updated_at = ? WHERE objective_id = ? AND id = ?",
            (v, now, objective_id, kr_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = target_value {
        db.query_unpaged(
            "UPDATE inertial_eclipse.okr_key_results SET target_value = ?, updated_at = ? WHERE objective_id = ? AND id = ?",
            (v, now, objective_id, kr_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = current_value {
        db.query_unpaged(
            "UPDATE inertial_eclipse.okr_key_results SET current_value = ?, updated_at = ? WHERE objective_id = ? AND id = ?",
            (v, now, objective_id, kr_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = unit {
        db.query_unpaged(
            "UPDATE inertial_eclipse.okr_key_results SET unit = ?, updated_at = ? WHERE objective_id = ? AND id = ?",
            (v, now, objective_id, kr_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = confidence {
        db.query_unpaged(
            "UPDATE inertial_eclipse.okr_key_results SET confidence = ?, updated_at = ? WHERE objective_id = ? AND id = ?",
            (v, now, objective_id, kr_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = status {
        db.query_unpaged(
            "UPDATE inertial_eclipse.okr_key_results SET status = ?, updated_at = ? WHERE objective_id = ? AND id = ?",
            (v, now, objective_id, kr_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = owner_id {
        db.query_unpaged(
            "UPDATE inertial_eclipse.okr_key_results SET owner_id = ?, updated_at = ? WHERE objective_id = ? AND id = ?",
            (v, now, objective_id, kr_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }

    Ok(())
}

/// Update only the title of a key result, looking up objective_id via the lookup table.
pub async fn update_key_result_title(
    db: &DbSession,
    kr_id: &Uuid,
    title: &str,
) -> Result<(), AppError> {
    let objective_id = find_objective_for_kr(db, kr_id)
        .await
        .ok_or_else(|| AppError::NotFound("Key result not found".into()))?;
    let now = ts_now();
    db.query_unpaged(
        "UPDATE inertial_eclipse.okr_key_results SET title = ?, updated_at = ? WHERE objective_id = ? AND id = ?",
        (title, now, &objective_id, kr_id),
    ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(())
}

pub async fn delete_key_result(
    db: &DbSession,
    objective_id: &Uuid,
    kr_id: &Uuid,
) -> Result<(), AppError> {
    // Delete check-ins
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.okr_check_ins WHERE key_result_id = ?",
        (kr_id,),
    ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Delete KR
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.okr_key_results WHERE objective_id = ? AND id = ?",
        (objective_id, kr_id),
    ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Clean up lookup table
    let _ = db.query_unpaged(
        "DELETE FROM inertial_eclipse.okr_kr_objective_lookup WHERE key_result_id = ?",
        (kr_id,),
    ).await;

    // Recompute objective progress
    recompute_objective_progress(db, objective_id).await?;

    Ok(())
}

// ─── Check-Ins ───

pub async fn create_check_in(
    db: &DbSession,
    key_result_id: &Uuid,
    previous_value: f32,
    new_value: f32,
    confidence: f32,
    note: Option<&str>,
    blockers: Option<&str>,
    author_id: &Uuid,
    author_name: &str,
) -> Result<OkrCheckIn, AppError> {
    let now = ts_now();
    let (id, timeuuid) = new_timeuuid();

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.okr_check_ins (key_result_id, id, previous_value, new_value, confidence, note, blockers, author_id, author_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (key_result_id, &timeuuid, previous_value, new_value, confidence, &note.unwrap_or(""), &blockers.unwrap_or(""), author_id, author_name, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Find the objective_id for this KR (uses lookup table, falls back to scan)
    let objective_id = find_objective_for_kr(db, key_result_id).await;

    if let Some(obj_id) = objective_id {
        // Update KR directly with known objective_id
        db.query_unpaged(
            "UPDATE inertial_eclipse.okr_key_results SET current_value = ?, confidence = ?, updated_at = ? WHERE objective_id = ? AND id = ?",
            (new_value, confidence, now, &obj_id, key_result_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;

        // Determine KR status based on confidence
        let kr_status = if confidence >= 0.7 {
            "on_track"
        } else if confidence >= 0.4 {
            "at_risk"
        } else {
            "behind"
        };
        db.query_unpaged(
            "UPDATE inertial_eclipse.okr_key_results SET status = ? WHERE objective_id = ? AND id = ?",
            (kr_status, &obj_id, key_result_id),
        ).await.ok();

        // Recompute objective progress
        recompute_objective_progress(db, &obj_id).await?;
    }

    Ok(OkrCheckIn {
        key_result_id: *key_result_id,
        id,
        previous_value,
        new_value,
        confidence,
        note: note.map(String::from),
        blockers: blockers.map(String::from),
        author_id: *author_id,
        author_name: author_name.to_string(),
        created_at: Utc::now(),
    })
}

pub async fn list_check_ins(
    db: &DbSession,
    key_result_id: &Uuid,
    cursor: Option<&str>,
    limit: i32,
) -> Result<(Vec<OkrCheckIn>, Option<String>), AppError> {
    let (result, next_cursor) = db::query_paged(
        db,
        "SELECT key_result_id, id, previous_value, new_value, confidence, note, blockers, author_id, author_name, created_at FROM inertial_eclipse.okr_check_ins WHERE key_result_id = ?",
        (key_result_id,),
        limit,
        cursor,
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;

    let mut check_ins = Vec::new();
    for row in rows.rows::<(Uuid, CqlTimeuuid, Option<f32>, Option<f32>, Option<f32>, Option<String>, Option<String>, Option<Uuid>, Option<String>, Option<DateTime<Utc>>)>()?.flatten() {
        check_ins.push(OkrCheckIn {
            key_result_id: row.0,
            id: Uuid::from(row.1),
            previous_value: row.2.unwrap_or(0.0),
            new_value: row.3.unwrap_or(0.0),
            confidence: row.4.unwrap_or(0.5),
            note: row.5,
            blockers: row.6,
            author_id: row.7.unwrap_or(Uuid::nil()),
            author_name: row.8.unwrap_or_default(),
            created_at: row.9.unwrap_or(Utc::now()),
        });
    }

    Ok((check_ins, next_cursor))
}

// ─── Helpers ───

/// Recompute objective progress from KR values and update both tables.
async fn recompute_objective_progress(
    db: &DbSession,
    objective_id: &Uuid,
) -> Result<(), AppError> {
    let krs = list_key_results(db, objective_id).await?;

    if krs.is_empty() {
        return Ok(());
    }

    let mut total_progress = 0.0_f32;
    let mut total_confidence = 0.0_f32;

    for kr in &krs {
        let range = kr.target_value - kr.start_value;
        let kr_progress = if range.abs() < 0.0001 {
            if kr.kr_type == "binary" {
                if kr.current_value >= 1.0 { 1.0 } else { 0.0 }
            } else {
                0.0
            }
        } else {
            ((kr.current_value - kr.start_value) / range).clamp(0.0, 1.0)
        };
        total_progress += kr_progress;
        total_confidence += kr.confidence;
    }

    let count = krs.len() as f32;
    let progress = total_progress / count;
    let confidence = total_confidence / count;

    // Determine status based on confidence
    let status = if confidence >= 0.7 {
        "on_track"
    } else if confidence >= 0.4 {
        "at_risk"
    } else {
        "behind"
    };

    let now = ts_now();

    // Try lookup table to get workspace_id (from any KR belonging to this objective)
    let ws_info = {
        let mut info: Option<(Uuid, Option<String>)> = None;

        // Check lookup table for workspace_id
        for kr in &krs {
            if let Some(ws_id) = get_workspace_id_for_kr(db, &kr.id).await {
                // Get cycle from objective
                let obj_result = db
                    .query_unpaged(
                        "SELECT cycle FROM inertial_eclipse.okr_objectives WHERE workspace_id = ? AND id = ?",
                        (&ws_id, objective_id),
                    )
                    .await
                    .ok();
                let cycle = obj_result
                    .and_then(|r| r.into_rows_result().ok())
                    .and_then(|r| r.maybe_first_row::<(Option<String>,)>().ok().flatten())
                    .and_then(|r| r.0);
                info = Some((ws_id, cycle));
                break;
            }
        }

        // Fallback: scan (ALLOW FILTERING) — only for legacy data without lookup entries
        if info.is_none() {
            let ws_result = db
                .query_unpaged(
                    "SELECT workspace_id, cycle FROM inertial_eclipse.okr_objectives WHERE id = ? ALLOW FILTERING",
                    (objective_id,),
                )
                .await
                .ok();
            if let Some(r) = ws_result {
                if let Ok(rows) = r.into_rows_result() {
                    if let Ok(Some((ws_id, cycle_opt))) = rows.maybe_first_row::<(Uuid, Option<String>)>() {
                        info = Some((ws_id, cycle_opt));
                    }
                }
            }
        }

        info
    };

    if let Some((ws_id, cycle_opt)) = ws_info {
        db.query_unpaged(
            "UPDATE inertial_eclipse.okr_objectives SET progress = ?, confidence = ?, status = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
            (progress, confidence, status, now, &ws_id, objective_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;

        // Update denormalized by-cycle
        if let Some(cycle) = cycle_opt {
            db.query_unpaged(
                "UPDATE inertial_eclipse.okr_objectives_by_cycle SET progress = ?, confidence = ?, status = ? WHERE workspace_id = ? AND cycle = ? AND objective_id = ?",
                (progress, confidence, status, &ws_id, &cycle as &str, objective_id),
            ).await.ok();
        }
    }

    Ok(())
}

// ─── Attachments ───

pub async fn create_attachment(
    db: &DbSession,
    entity_id: &Uuid,
    entity_type: &str,
    workspace_id: &Uuid,
    file_name: &str,
    file_size: i64,
    mime_type: &str,
    file_data: &[u8],
    uploaded_by: &Uuid,
    uploader_name: &str,
) -> Result<OkrAttachment, AppError> {
    let id = Uuid::new_v4();
    let now = ts_now();

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.okr_attachments (entity_id, id, entity_type, workspace_id, file_name, file_size, mime_type, file_data, uploaded_by, uploader_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (entity_id, &id, entity_type, workspace_id, file_name, file_size, mime_type, file_data, uploaded_by, uploader_name, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(OkrAttachment {
        entity_id: *entity_id,
        id,
        entity_type: entity_type.to_string(),
        workspace_id: *workspace_id,
        file_name: file_name.to_string(),
        file_size,
        mime_type: mime_type.to_string(),
        uploaded_by: *uploaded_by,
        uploader_name: uploader_name.to_string(),
        created_at: Utc::now(),
    })
}

pub async fn list_attachments(
    db: &DbSession,
    entity_id: &Uuid,
) -> Result<Vec<OkrAttachment>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT entity_id, id, entity_type, workspace_id, file_name, file_size, mime_type, uploaded_by, uploader_name, created_at FROM inertial_eclipse.okr_attachments WHERE entity_id = ?",
            (entity_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;

    let mut attachments = Vec::new();
    for row in rows.rows::<(Uuid, Uuid, Option<String>, Option<Uuid>, Option<String>, Option<i64>, Option<String>, Option<Uuid>, Option<String>, Option<DateTime<Utc>>)>()?.flatten() {
        attachments.push(OkrAttachment {
            entity_id: row.0,
            id: row.1,
            entity_type: row.2.unwrap_or_default(),
            workspace_id: row.3.unwrap_or(Uuid::nil()),
            file_name: row.4.unwrap_or_default(),
            file_size: row.5.unwrap_or(0),
            mime_type: row.6.unwrap_or_default(),
            uploaded_by: row.7.unwrap_or(Uuid::nil()),
            uploader_name: row.8.unwrap_or_default(),
            created_at: row.9.unwrap_or(Utc::now()),
        });
    }

    Ok(attachments)
}

pub async fn get_attachment_data(
    db: &DbSession,
    entity_id: &Uuid,
    attachment_id: &Uuid,
) -> Result<(String, String, Vec<u8>), AppError> {
    let result = db
        .query_unpaged(
            "SELECT file_name, mime_type, file_data FROM inertial_eclipse.okr_attachments WHERE entity_id = ? AND id = ?",
            (entity_id, attachment_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let row = result
        .into_rows_result()?
        .single_row::<(Option<String>, Option<String>, Option<Vec<u8>>)>()?;

    Ok((
        row.0.unwrap_or_default(),
        row.1.unwrap_or("application/octet-stream".to_string()),
        row.2.unwrap_or_default(),
    ))
}

pub async fn delete_attachment(
    db: &DbSession,
    entity_id: &Uuid,
    attachment_id: &Uuid,
) -> Result<(), AppError> {
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.okr_attachments WHERE entity_id = ? AND id = ?",
        (entity_id, attachment_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

/// Get an objective by scanning (used when workspace_id is unknown, e.g. during KR creation).
async fn get_objective_by_id_scan(db: &DbSession, objective_id: &Uuid) -> Result<OkrObjective, AppError> {
    let result = db
        .query_unpaged(
            "SELECT workspace_id, id, title, description, objective_type, cycle, status, owner_id, team_id, parent_objective_id, progress, confidence, created_at, updated_at, team_ids FROM inertial_eclipse.okr_objectives WHERE id = ? ALLOW FILTERING",
            (objective_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let row = result
        .into_rows_result()?
        .single_row::<ObjRow>()?;

    Ok(row_to_objective(row))
}

/// Get the current_value of a key result by its ID.
/// Uses the lookup table first, falls back to ALLOW FILTERING scan.
pub async fn get_kr_current_value(db: &DbSession, kr_id: &Uuid) -> Option<f32> {
    // Try lookup table first
    let obj_id = get_objective_id_for_kr(db, kr_id).await;

    if let Some(oid) = obj_id {
        let result = db
            .query_unpaged(
                "SELECT current_value FROM inertial_eclipse.okr_key_results WHERE objective_id = ? AND id = ?",
                (&oid, kr_id),
            )
            .await
            .ok()?;
        return result.into_rows_result().ok()
            .and_then(|r| r.maybe_first_row::<(Option<f32>,)>().ok().flatten())
            .and_then(|r| r.0);
    }

    // Fallback: use find_objective_for_kr (ALLOW FILTERING)
    let obj_id = find_objective_for_kr(db, kr_id).await?;
    let result = db
        .query_unpaged(
            "SELECT current_value FROM inertial_eclipse.okr_key_results WHERE objective_id = ? AND id = ?",
            (&obj_id, kr_id),
        )
        .await
        .ok()?;
    result.into_rows_result().ok()
        .and_then(|r| r.maybe_first_row::<(Option<f32>,)>().ok().flatten())
        .and_then(|r| r.0)
}

/// Look up objective_id for a KR from the lookup table.
async fn get_objective_id_for_kr(db: &DbSession, kr_id: &Uuid) -> Option<Uuid> {
    let result = db
        .query_unpaged(
            "SELECT objective_id FROM inertial_eclipse.okr_kr_objective_lookup WHERE key_result_id = ?",
            (kr_id,),
        )
        .await
        .ok()?;
    result.into_rows_result().ok()
        .and_then(|r| r.maybe_first_row::<(Uuid,)>().ok().flatten())
        .map(|r| r.0)
}

/// Get workspace_id for a KR from the lookup table.
async fn get_workspace_id_for_kr(db: &DbSession, kr_id: &Uuid) -> Option<Uuid> {
    let result = db
        .query_unpaged(
            "SELECT workspace_id FROM inertial_eclipse.okr_kr_objective_lookup WHERE key_result_id = ?",
            (kr_id,),
        )
        .await
        .ok()?;
    result.into_rows_result().ok()
        .and_then(|r| r.maybe_first_row::<(Uuid,)>().ok().flatten())
        .map(|r| r.0)
}

/// Find the objective_id that contains a given key_result.
/// Prefers lookup table, falls back to ALLOW FILTERING for legacy data.
pub async fn find_objective_for_kr(db: &DbSession, kr_id: &Uuid) -> Option<Uuid> {
    // Try lookup table first
    if let Some(obj_id) = get_objective_id_for_kr(db, kr_id).await {
        return Some(obj_id);
    }

    // Fallback: ALLOW FILTERING scan (for KRs created before lookup table existed)
    let result = db
        .query_unpaged(
            "SELECT objective_id FROM inertial_eclipse.okr_key_results WHERE id = ? ALLOW FILTERING",
            (kr_id,),
        )
        .await
        .ok()?;

    result.into_rows_result().ok()
        .and_then(|r| r.maybe_first_row::<(Uuid,)>().ok().flatten())
        .map(|r| r.0)
}

type ObjRow = (
    Uuid, Uuid, Option<String>, Option<String>, Option<String>, Option<String>,
    Option<String>, Option<Uuid>, Option<Uuid>, Option<Uuid>, Option<f32>, Option<f32>,
    Option<DateTime<Utc>>, Option<DateTime<Utc>>, Option<HashSet<Uuid>>,
);

fn row_to_objective(row: ObjRow) -> OkrObjective {
    let team_ids_vec: Option<Vec<Uuid>> = row.14.map(|s| s.into_iter().collect());
    OkrObjective {
        workspace_id: row.0,
        id: row.1,
        title: row.2.unwrap_or_default(),
        description: row.3,
        objective_type: row.4.unwrap_or_else(|| "committed".to_string()),
        cycle: row.5.unwrap_or_default(),
        status: row.6.unwrap_or_else(|| "on_track".to_string()),
        owner_id: row.7.unwrap_or(Uuid::nil()),
        team_id: row.8,
        team_ids: team_ids_vec,
        parent_objective_id: row.9,
        progress: row.10.unwrap_or(0.0),
        confidence: row.11.unwrap_or(0.5),
        created_at: row.12.unwrap_or(Utc::now()),
        updated_at: row.13.unwrap_or(Utc::now()),
        key_results: None,
        owner_name: None,
        team_name: None,
        children: None,
    }
}

/// List child objectives for a given parent objective.
pub async fn list_children(
    db: &DbSession,
    parent_objective_id: &Uuid,
) -> Result<Vec<OkrObjectiveChild>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT parent_objective_id, child_objective_id, workspace_id, child_title, child_progress, child_confidence, child_team_id FROM inertial_eclipse.okr_objective_children WHERE parent_objective_id = ?",
            (parent_objective_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;

    let mut children = Vec::new();
    for row in rows.rows::<(Uuid, Uuid, Option<Uuid>, Option<String>, Option<f32>, Option<f32>, Option<Uuid>)>()?.flatten() {
        children.push(OkrObjectiveChild {
            parent_objective_id: row.0,
            child_objective_id: row.1,
            workspace_id: row.2.unwrap_or(Uuid::nil()),
            child_title: row.3.unwrap_or_default(),
            child_progress: row.4.unwrap_or(0.0),
            child_confidence: row.5.unwrap_or(0.5),
            child_team_id: row.6,
        });
    }

    Ok(children)
}
