use std::collections::{HashMap, HashSet};
use chrono::{DateTime, Utc};
use scylla::frame::value::{CqlTimestamp, CqlTimeuuid};
use uuid::Uuid;

use crate::db::{self, DbSession};
use crate::errors::AppError;
use crate::models::team::{
    ActivityPage, CommentsPage, Task, TaskAttachment, TaskComment, TaskCounts, Team,
    TeamActivityEntry, TeamMember, TeamWithStats, UserTeam,
};

fn ts_now() -> CqlTimestamp {
    CqlTimestamp(Utc::now().timestamp_millis())
}

fn new_timeuuid() -> (Uuid, CqlTimeuuid) {
    let ts = uuid::timestamp::Timestamp::now(uuid::NoContext);
    let id = Uuid::new_v1(ts, &[0x01, 0x23, 0x45, 0x67, 0x89, 0xab]);
    (id, CqlTimeuuid::from(id))
}

// ─── Team CRUD ───

pub async fn create_team(
    db: &DbSession,
    workspace_id: &Uuid,
    name: &str,
    description: Option<&str>,
    color: Option<&str>,
    created_by: &Uuid,
) -> Result<Team, AppError> {
    let id = Uuid::new_v4();
    let now = ts_now();
    let desc = description.unwrap_or("");
    let col = color.unwrap_or("#ff6b2c");

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.teams (workspace_id, id, name, description, color, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (workspace_id, &id, name, desc, col, created_by, now, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Add creator as team leader
    add_member(db, &id, created_by, workspace_id, "leader", name).await?;

    Ok(Team {
        workspace_id: *workspace_id,
        id,
        name: name.to_string(),
        description: description.map(String::from),
        color: Some(col.to_string()),
        created_by: *created_by,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    })
}

pub async fn list_teams(
    db: &DbSession,
    workspace_id: &Uuid,
) -> Result<Vec<Team>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT workspace_id, id, name, description, color, created_by, created_at, updated_at FROM inertial_eclipse.teams WHERE workspace_id = ?",
            (workspace_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;

    let mut teams = Vec::new();
    for row in rows.rows::<(Uuid, Uuid, Option<String>, Option<String>, Option<String>, Option<Uuid>, Option<DateTime<Utc>>, Option<DateTime<Utc>>)>()?.flatten() {
        teams.push(Team {
            workspace_id: row.0,
            id: row.1,
            name: row.2.unwrap_or_default(),
            description: row.3,
            color: row.4,
            created_by: row.5.unwrap_or(Uuid::nil()),
            created_at: row.6.unwrap_or(Utc::now()),
            updated_at: row.7.unwrap_or(Utc::now()),
        });
    }

    Ok(teams)
}

pub async fn get_team(
    db: &DbSession,
    workspace_id: &Uuid,
    team_id: &Uuid,
) -> Result<Team, AppError> {
    let result = db
        .query_unpaged(
            "SELECT workspace_id, id, name, description, color, created_by, created_at, updated_at FROM inertial_eclipse.teams WHERE workspace_id = ? AND id = ?",
            (workspace_id, team_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let row = result
        .into_rows_result()?
        .single_row::<(Uuid, Uuid, Option<String>, Option<String>, Option<String>, Option<Uuid>, Option<DateTime<Utc>>, Option<DateTime<Utc>>)>()?;

    Ok(Team {
        workspace_id: row.0,
        id: row.1,
        name: row.2.unwrap_or_default(),
        description: row.3,
        color: row.4,
        created_by: row.5.unwrap_or(Uuid::nil()),
        created_at: row.6.unwrap_or(Utc::now()),
        updated_at: row.7.unwrap_or(Utc::now()),
    })
}

pub async fn update_team(
    db: &DbSession,
    workspace_id: &Uuid,
    team_id: &Uuid,
    name: Option<&str>,
    description: Option<&str>,
    color: Option<&str>,
) -> Result<(), AppError> {
    let now = ts_now();
    if let Some(n) = name {
        db.query_unpaged(
            "UPDATE inertial_eclipse.teams SET name = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
            (n, now, workspace_id, team_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

        // Update denormalized user_teams name
        let members = list_members(db, team_id).await?;
        for m in &members {
            let _ = db.query_unpaged(
                "UPDATE inertial_eclipse.user_teams SET team_name = ? WHERE user_id = ? AND workspace_id = ? AND team_id = ?",
                (n, &m.user_id, workspace_id, team_id),
            ).await;
        }
    }
    if let Some(d) = description {
        db.query_unpaged(
            "UPDATE inertial_eclipse.teams SET description = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
            (d, now, workspace_id, team_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(c) = color {
        db.query_unpaged(
            "UPDATE inertial_eclipse.teams SET color = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
            (c, now, workspace_id, team_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    Ok(())
}

pub async fn delete_team(
    db: &DbSession,
    workspace_id: &Uuid,
    team_id: &Uuid,
) -> Result<(), AppError> {
    // 1. Delete tasks and their comments
    let tasks = list_tasks(db, team_id).await?;
    for task in &tasks {
        db.query_unpaged(
            "DELETE FROM inertial_eclipse.task_comments WHERE task_id = ?",
            (&task.id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.tasks WHERE team_id = ?",
        (team_id,),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // 2. Delete activity log
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.team_activity_log WHERE team_id = ?",
        (team_id,),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // 3. Remove all members (both tables)
    let members = list_members(db, team_id).await?;
    for m in &members {
        let _ = db.query_unpaged(
            "DELETE FROM inertial_eclipse.user_teams WHERE user_id = ? AND workspace_id = ? AND team_id = ?",
            (&m.user_id, workspace_id, team_id),
        ).await;
    }
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.team_members WHERE team_id = ?",
        (team_id,),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // 4. Delete team
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.teams WHERE workspace_id = ? AND id = ?",
        (workspace_id, team_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

// ─── Team Members ───

pub async fn add_member(
    db: &DbSession,
    team_id: &Uuid,
    user_id: &Uuid,
    workspace_id: &Uuid,
    role: &str,
    team_name: &str,
) -> Result<(), AppError> {
    let now = ts_now();

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.team_members (team_id, user_id, workspace_id, role, joined_at) VALUES (?, ?, ?, ?, ?)",
        (team_id, user_id, workspace_id, role, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Denormalized user_teams
    db.query_unpaged(
        "INSERT INTO inertial_eclipse.user_teams (user_id, workspace_id, team_id, team_name, role, joined_at) VALUES (?, ?, ?, ?, ?, ?)",
        (user_id, workspace_id, team_id, team_name, role, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

pub async fn remove_member(
    db: &DbSession,
    team_id: &Uuid,
    user_id: &Uuid,
    workspace_id: &Uuid,
) -> Result<(), AppError> {
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.user_teams WHERE user_id = ? AND workspace_id = ? AND team_id = ?",
        (user_id, workspace_id, team_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    db.query_unpaged(
        "DELETE FROM inertial_eclipse.team_members WHERE team_id = ? AND user_id = ?",
        (team_id, user_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

pub async fn list_members(
    db: &DbSession,
    team_id: &Uuid,
) -> Result<Vec<TeamMember>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT team_id, user_id, workspace_id, role, joined_at FROM inertial_eclipse.team_members WHERE team_id = ?",
            (team_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;

    let mut members = Vec::new();
    for row in rows.rows::<(Uuid, Uuid, Option<Uuid>, Option<String>, Option<DateTime<Utc>>)>()?.flatten() {
        // Enrich with user info
        let (user_name, user_email) = get_user_info(db, &row.1).await;
        members.push(TeamMember {
            team_id: row.0,
            user_id: row.1,
            workspace_id: row.2.unwrap_or(Uuid::nil()),
            role: row.3.unwrap_or_else(|| "member".to_string()),
            joined_at: row.4.unwrap_or(Utc::now()),
            user_name,
            user_email,
        });
    }

    Ok(members)
}

#[allow(dead_code)]
pub async fn list_user_teams(
    db: &DbSession,
    user_id: &Uuid,
    workspace_id: &Uuid,
) -> Result<Vec<UserTeam>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT user_id, workspace_id, team_id, team_name, role, joined_at FROM inertial_eclipse.user_teams WHERE user_id = ? AND workspace_id = ?",
            (user_id, workspace_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;

    let mut teams = Vec::new();
    for row in rows.rows::<(Uuid, Uuid, Uuid, Option<String>, Option<String>, Option<DateTime<Utc>>)>()?.flatten() {
        teams.push(UserTeam {
            user_id: row.0,
            workspace_id: row.1,
            team_id: row.2,
            team_name: row.3.unwrap_or_default(),
            role: row.4.unwrap_or_else(|| "member".to_string()),
            joined_at: row.5.unwrap_or(Utc::now()),
        });
    }

    Ok(teams)
}

// ─── Tasks ───

pub async fn create_task(
    db: &DbSession,
    team_id: &Uuid,
    title: &str,
    description: Option<&str>,
    status: &str,
    priority: &str,
    assignee_id: Option<&Uuid>,
    created_by: &Uuid,
    due_date: Option<CqlTimestamp>,
    tags: &[String],
    okr_objective_id: Option<&Uuid>,
    okr_key_result_id: Option<&Uuid>,
) -> Result<Task, AppError> {
    let id = Uuid::new_v4();
    let now = ts_now();
    let desc = description.unwrap_or("");

    // Calculate position: count tasks in the same column * 1000
    let existing = list_tasks(db, team_id).await?;
    let count = existing.iter().filter(|t| t.status == status).count() as i32;
    let position = count * 1000;

    let tag_set: Vec<&str> = tags.iter().map(|s| s.as_str()).collect();

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.tasks (team_id, id, title, description, status, priority, assignee_id, created_by, due_date, tags, checklist_total, checklist_done, okr_objective_id, okr_key_result_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)",
        (team_id, &id, title, desc, status, priority, &assignee_id, created_by, &due_date, &tag_set, &okr_objective_id, &okr_key_result_id, position, now, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(Task {
        team_id: *team_id,
        id,
        title: title.to_string(),
        description: Some(desc.to_string()),
        status: status.to_string(),
        priority: priority.to_string(),
        assignee_id: assignee_id.copied(),
        created_by: *created_by,
        due_date: due_date.map(|d| {
            DateTime::from_timestamp_millis(d.0).unwrap_or(Utc::now())
        }),
        tags: tags.to_vec(),
        checklist_total: 0,
        checklist_done: 0,
        okr_objective_id: okr_objective_id.copied(),
        okr_key_result_id: okr_key_result_id.copied(),
        position,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        assignee_name: None,
    })
}

pub async fn list_tasks(
    db: &DbSession,
    team_id: &Uuid,
) -> Result<Vec<Task>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT team_id, id, title, description, status, priority, assignee_id, due_date, tags, checklist_total, checklist_done, okr_objective_id, okr_key_result_id, position, created_at, updated_at FROM inertial_eclipse.tasks WHERE team_id = ?",
            (team_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // ScyllaDB FromRow supports max 16 tuple elements.
    // We select 16 columns (omit created_by, fetch separately if needed).
    type TaskRow = (
        Uuid, Uuid, Option<String>, Option<String>, Option<String>, Option<String>,
        Option<Uuid>, Option<DateTime<Utc>>, Option<Vec<String>>,
        Option<i32>, Option<i32>, Option<Uuid>, Option<Uuid>, Option<i32>,
        Option<DateTime<Utc>>, Option<DateTime<Utc>>,
    );

    let rows = result.into_rows_result()?;

    // Collect all rows first, then batch-fetch user info
    let raw_rows: Vec<_> = rows.rows::<TaskRow>()?.flatten().collect();

    // Gather unique assignee IDs
    let assignee_ids: HashSet<Uuid> = raw_rows.iter()
        .filter_map(|row| row.6)
        .collect();

    // Batch fetch user info
    let mut user_cache: HashMap<Uuid, Option<String>> = HashMap::new();
    for uid in assignee_ids {
        let (name, _) = get_user_info(db, &uid).await;
        user_cache.insert(uid, name);
    }

    let mut tasks = Vec::new();
    for row in raw_rows {
        let assignee_name = row.6.and_then(|aid| user_cache.get(&aid).cloned().flatten());
        tasks.push(task_from_row(row, assignee_name));
    }

    Ok(tasks)
}

fn task_from_row(
    row: (
        Uuid, Uuid, Option<String>, Option<String>, Option<String>, Option<String>,
        Option<Uuid>, Option<DateTime<Utc>>, Option<Vec<String>>,
        Option<i32>, Option<i32>, Option<Uuid>, Option<Uuid>, Option<i32>,
        Option<DateTime<Utc>>, Option<DateTime<Utc>>,
    ),
    assignee_name: Option<String>,
) -> Task {
    Task {
        team_id: row.0,
        id: row.1,
        title: row.2.unwrap_or_default(),
        description: row.3,
        status: row.4.unwrap_or_else(|| "backlog".to_string()),
        priority: row.5.unwrap_or_else(|| "medium".to_string()),
        assignee_id: row.6,
        created_by: Uuid::nil(), // Not selected in list query for tuple size limit
        due_date: row.7,
        tags: row.8.unwrap_or_default(),
        checklist_total: row.9.unwrap_or(0),
        checklist_done: row.10.unwrap_or(0),
        okr_objective_id: row.11,
        okr_key_result_id: row.12,
        position: row.13.unwrap_or(0),
        created_at: row.14.unwrap_or(Utc::now()),
        updated_at: row.15.unwrap_or(Utc::now()),
        assignee_name,
    }
}

pub async fn get_task(
    db: &DbSession,
    team_id: &Uuid,
    task_id: &Uuid,
) -> Result<Task, AppError> {
    let result = db
        .query_unpaged(
            "SELECT team_id, id, title, description, status, priority, assignee_id, due_date, tags, checklist_total, checklist_done, okr_objective_id, okr_key_result_id, position, created_at, updated_at FROM inertial_eclipse.tasks WHERE team_id = ? AND id = ?",
            (team_id, task_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // ScyllaDB FromRow supports max 16 tuple elements.
    // We select 16 columns (omit created_by, fetch separately if needed).
    type TaskRow = (
        Uuid, Uuid, Option<String>, Option<String>, Option<String>, Option<String>,
        Option<Uuid>, Option<DateTime<Utc>>, Option<Vec<String>>,
        Option<i32>, Option<i32>, Option<Uuid>, Option<Uuid>, Option<i32>,
        Option<DateTime<Utc>>, Option<DateTime<Utc>>,
    );

    let row = result
        .into_rows_result()?
        .single_row::<TaskRow>()?;

    let assignee_name = if let Some(ref aid) = row.6 {
        let (name, _) = get_user_info(db, aid).await;
        name
    } else {
        None
    };

    Ok(task_from_row(row, assignee_name))
}

pub async fn update_task(
    db: &DbSession,
    team_id: &Uuid,
    task_id: &Uuid,
    title: Option<&str>,
    description: Option<&str>,
    status: Option<&str>,
    priority: Option<&str>,
    assignee_id: Option<&Uuid>,
    due_date: Option<CqlTimestamp>,
    tags: Option<&[String]>,
    checklist_total: Option<i32>,
    checklist_done: Option<i32>,
    okr_objective_id: Option<&Uuid>,
    okr_key_result_id: Option<&Uuid>,
) -> Result<(), AppError> {
    let now = ts_now();

    if let Some(v) = title {
        db.query_unpaged(
            "UPDATE inertial_eclipse.tasks SET title = ?, updated_at = ? WHERE team_id = ? AND id = ?",
            (v, now, team_id, task_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = description {
        db.query_unpaged(
            "UPDATE inertial_eclipse.tasks SET description = ?, updated_at = ? WHERE team_id = ? AND id = ?",
            (v, now, team_id, task_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = status {
        db.query_unpaged(
            "UPDATE inertial_eclipse.tasks SET status = ?, updated_at = ? WHERE team_id = ? AND id = ?",
            (v, now, team_id, task_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = priority {
        db.query_unpaged(
            "UPDATE inertial_eclipse.tasks SET priority = ?, updated_at = ? WHERE team_id = ? AND id = ?",
            (v, now, team_id, task_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = assignee_id {
        db.query_unpaged(
            "UPDATE inertial_eclipse.tasks SET assignee_id = ?, updated_at = ? WHERE team_id = ? AND id = ?",
            (v, now, team_id, task_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = due_date {
        db.query_unpaged(
            "UPDATE inertial_eclipse.tasks SET due_date = ?, updated_at = ? WHERE team_id = ? AND id = ?",
            (v, now, team_id, task_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(t) = tags {
        let tag_refs: Vec<&str> = t.iter().map(|s| s.as_str()).collect();
        db.query_unpaged(
            "UPDATE inertial_eclipse.tasks SET tags = ?, updated_at = ? WHERE team_id = ? AND id = ?",
            (&tag_refs, now, team_id, task_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = checklist_total {
        db.query_unpaged(
            "UPDATE inertial_eclipse.tasks SET checklist_total = ?, updated_at = ? WHERE team_id = ? AND id = ?",
            (v, now, team_id, task_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = checklist_done {
        db.query_unpaged(
            "UPDATE inertial_eclipse.tasks SET checklist_done = ?, updated_at = ? WHERE team_id = ? AND id = ?",
            (v, now, team_id, task_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = okr_objective_id {
        db.query_unpaged(
            "UPDATE inertial_eclipse.tasks SET okr_objective_id = ?, updated_at = ? WHERE team_id = ? AND id = ?",
            (v, now, team_id, task_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = okr_key_result_id {
        db.query_unpaged(
            "UPDATE inertial_eclipse.tasks SET okr_key_result_id = ?, updated_at = ? WHERE team_id = ? AND id = ?",
            (v, now, team_id, task_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }

    Ok(())
}

pub async fn move_task(
    db: &DbSession,
    team_id: &Uuid,
    task_id: &Uuid,
    new_status: &str,
    new_position: i32,
) -> Result<(), AppError> {
    let now = ts_now();
    db.query_unpaged(
        "UPDATE inertial_eclipse.tasks SET status = ?, position = ?, updated_at = ? WHERE team_id = ? AND id = ?",
        (new_status, new_position, now, team_id, task_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

pub async fn delete_task(
    db: &DbSession,
    team_id: &Uuid,
    task_id: &Uuid,
) -> Result<(), AppError> {
    // Delete comments first
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.task_comments WHERE task_id = ?",
        (task_id,),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    db.query_unpaged(
        "DELETE FROM inertial_eclipse.tasks WHERE team_id = ? AND id = ?",
        (team_id, task_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

// ─── Task Comments ───

pub async fn create_comment(
    db: &DbSession,
    task_id: &Uuid,
    author_id: &Uuid,
    author_name: &str,
    content: &str,
) -> Result<TaskComment, AppError> {
    let now = ts_now();
    let (id, timeuuid) = new_timeuuid();

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.task_comments (task_id, id, author_id, author_name, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (task_id, &timeuuid, author_id, author_name, content, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(TaskComment {
        task_id: *task_id,
        id,
        author_id: *author_id,
        author_name: author_name.to_string(),
        content: content.to_string(),
        created_at: Utc::now(),
    })
}

pub async fn list_comments(
    db: &DbSession,
    task_id: &Uuid,
    cursor: Option<&str>,
    limit: i32,
) -> Result<CommentsPage, AppError> {
    let (result, next_cursor) = db::query_paged(
        db,
        "SELECT task_id, id, author_id, author_name, content, created_at FROM inertial_eclipse.task_comments WHERE task_id = ?",
        (task_id,),
        limit,
        cursor,
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;

    let mut comments = Vec::new();
    for row in rows.rows::<(Uuid, CqlTimeuuid, Option<Uuid>, Option<String>, Option<String>, Option<DateTime<Utc>>)>()?.flatten() {
        comments.push(TaskComment {
            task_id: row.0,
            id: Uuid::from(row.1),
            author_id: row.2.unwrap_or(Uuid::nil()),
            author_name: row.3.unwrap_or_default(),
            content: row.4.unwrap_or_default(),
            created_at: row.5.unwrap_or(Utc::now()),
        });
    }

    Ok(CommentsPage {
        comments,
        next_cursor,
    })
}

// ─── Activity Log ───

pub async fn log_activity(
    db: &DbSession,
    team_id: &Uuid,
    actor_id: &Uuid,
    actor_name: &str,
    action: &str,
    entity_type: &str,
    entity_id: Option<&Uuid>,
    entity_name: Option<&str>,
    details: Option<&str>,
) -> Result<(), AppError> {
    let now = ts_now();
    let (_, timeuuid) = new_timeuuid();

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.team_activity_log (team_id, id, actor_id, actor_name, action, entity_type, entity_id, entity_name, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (team_id, &timeuuid, actor_id, actor_name, action, entity_type, &entity_id, &entity_name.unwrap_or(""), &details.unwrap_or(""), now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

pub async fn list_activity(
    db: &DbSession,
    team_id: &Uuid,
    cursor: Option<&str>,
    limit: i32,
) -> Result<ActivityPage, AppError> {
    let (result, next_cursor) = db::query_paged(
        db,
        "SELECT team_id, id, actor_id, actor_name, action, entity_type, entity_id, entity_name, details, created_at FROM inertial_eclipse.team_activity_log WHERE team_id = ?",
        (team_id,),
        limit,
        cursor,
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;

    let mut entries = Vec::new();
    for row in rows.rows::<(Uuid, CqlTimeuuid, Option<Uuid>, Option<String>, Option<String>, Option<String>, Option<Uuid>, Option<String>, Option<String>, Option<DateTime<Utc>>)>()?.flatten() {
        entries.push(TeamActivityEntry {
            team_id: row.0,
            id: Uuid::from(row.1),
            actor_id: row.2.unwrap_or(Uuid::nil()),
            actor_name: row.3.unwrap_or_default(),
            action: row.4.unwrap_or_default(),
            entity_type: row.5.unwrap_or_default(),
            entity_id: row.6,
            entity_name: row.7,
            details: row.8,
            created_at: row.9.unwrap_or(Utc::now()),
        });
    }

    Ok(ActivityPage {
        entries,
        next_cursor,
    })
}

// ─── Stats Helpers ───

pub async fn get_team_with_stats(
    db: &DbSession,
    team: Team,
) -> Result<TeamWithStats, AppError> {
    let members = list_members(db, &team.id).await?;
    let tasks = list_tasks(db, &team.id).await?;

    let open = tasks.iter().filter(|t| t.status == "backlog" || t.status == "todo").count() as i32;
    let in_progress = tasks.iter().filter(|t| t.status == "in_progress" || t.status == "in_review").count() as i32;
    let done = tasks.iter().filter(|t| t.status == "done").count() as i32;

    Ok(TeamWithStats {
        team,
        member_count: members.len() as i32,
        task_counts: TaskCounts { open, in_progress, done },
        okr_progress: None,
    })
}

// ─── Helpers ───

async fn get_user_info(db: &DbSession, user_id: &Uuid) -> (Option<String>, Option<String>) {
    let result = db
        .query_unpaged(
            "SELECT name, email FROM inertial_eclipse.users WHERE id = ?",
            (user_id,),
        )
        .await
        .ok();

    if let Some(r) = result {
        if let Ok(rows) = r.into_rows_result() {
            if let Ok(Some(row)) = rows.maybe_first_row::<(Option<String>, Option<String>)>() {
                return (row.0, row.1);
            }
        }
    }
    (None, None)
}

// ─── Task Attachments ───

pub async fn create_task_attachment(
    db: &DbSession,
    task_id: &Uuid,
    team_id: &Uuid,
    file_name: &str,
    file_size: i64,
    mime_type: &str,
    file_data: &[u8],
    uploaded_by: &Uuid,
    uploader_name: &str,
) -> Result<TaskAttachment, AppError> {
    let id = Uuid::new_v4();
    let now = ts_now();

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.task_attachments (task_id, id, team_id, file_name, file_size, mime_type, file_data, uploaded_by, uploader_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (task_id, &id, team_id, file_name, file_size, mime_type, file_data, uploaded_by, uploader_name, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(TaskAttachment {
        task_id: *task_id,
        id,
        team_id: *team_id,
        file_name: file_name.to_string(),
        file_size,
        mime_type: mime_type.to_string(),
        uploaded_by: *uploaded_by,
        uploader_name: uploader_name.to_string(),
        created_at: Utc::now(),
    })
}

pub async fn list_task_attachments(
    db: &DbSession,
    task_id: &Uuid,
) -> Result<Vec<TaskAttachment>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT task_id, id, team_id, file_name, file_size, mime_type, uploaded_by, uploader_name, created_at FROM inertial_eclipse.task_attachments WHERE task_id = ?",
            (task_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;

    let mut attachments = Vec::new();
    for row in rows.rows::<(Uuid, Uuid, Option<Uuid>, Option<String>, Option<i64>, Option<String>, Option<Uuid>, Option<String>, Option<DateTime<Utc>>)>()?.flatten() {
        attachments.push(TaskAttachment {
            task_id: row.0,
            id: row.1,
            team_id: row.2.unwrap_or(Uuid::nil()),
            file_name: row.3.unwrap_or_default(),
            file_size: row.4.unwrap_or(0),
            mime_type: row.5.unwrap_or_default(),
            uploaded_by: row.6.unwrap_or(Uuid::nil()),
            uploader_name: row.7.unwrap_or_default(),
            created_at: row.8.unwrap_or(Utc::now()),
        });
    }

    Ok(attachments)
}

pub async fn get_task_attachment_data(
    db: &DbSession,
    task_id: &Uuid,
    attachment_id: &Uuid,
) -> Result<(String, String, Vec<u8>), AppError> {
    let result = db
        .query_unpaged(
            "SELECT file_name, mime_type, file_data FROM inertial_eclipse.task_attachments WHERE task_id = ? AND id = ?",
            (task_id, attachment_id),
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

pub async fn delete_task_attachment(
    db: &DbSession,
    task_id: &Uuid,
    attachment_id: &Uuid,
) -> Result<(), AppError> {
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.task_attachments WHERE task_id = ? AND id = ?",
        (task_id, attachment_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}
