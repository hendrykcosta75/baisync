use chrono::{DateTime, Utc};
use scylla::frame::value::CqlTimestamp;
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::models::swot::{SwotAnalysis, SwotItem};

fn ts_now() -> CqlTimestamp {
    CqlTimestamp(Utc::now().timestamp_millis())
}

pub async fn create_analysis(
    db: &DbSession,
    workspace_id: &Uuid,
    title: &str,
    description: Option<&str>,
    cycle: Option<&str>,
    created_by: &Uuid,
) -> Result<SwotAnalysis, AppError> {
    let id = Uuid::new_v4();
    let now = ts_now();

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.swot_analyses (workspace_id, id, title, description, cycle, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (workspace_id, &id, title, &description.unwrap_or(""), &cycle.unwrap_or(""), created_by, now, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(SwotAnalysis {
        workspace_id: *workspace_id,
        id,
        title: title.to_string(),
        description: description.map(String::from),
        cycle: cycle.map(String::from),
        created_by: *created_by,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        items: None,
    })
}

pub async fn list_analyses(
    db: &DbSession,
    workspace_id: &Uuid,
) -> Result<Vec<SwotAnalysis>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT workspace_id, id, title, description, cycle, created_by, created_at, updated_at FROM inertial_eclipse.swot_analyses WHERE workspace_id = ?",
            (workspace_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;

    let mut analyses = Vec::new();
    for row in rows.rows::<(Uuid, Uuid, Option<String>, Option<String>, Option<String>, Option<Uuid>, Option<DateTime<Utc>>, Option<DateTime<Utc>>)>()?.flatten() {
        analyses.push(SwotAnalysis {
            workspace_id: row.0,
            id: row.1,
            title: row.2.unwrap_or_default(),
            description: row.3,
            cycle: row.4,
            created_by: row.5.unwrap_or(Uuid::nil()),
            created_at: row.6.unwrap_or(Utc::now()),
            updated_at: row.7.unwrap_or(Utc::now()),
            items: None,
        });
    }

    Ok(analyses)
}

pub async fn get_analysis(
    db: &DbSession,
    workspace_id: &Uuid,
    analysis_id: &Uuid,
) -> Result<SwotAnalysis, AppError> {
    let result = db
        .query_unpaged(
            "SELECT workspace_id, id, title, description, cycle, created_by, created_at, updated_at FROM inertial_eclipse.swot_analyses WHERE workspace_id = ? AND id = ?",
            (workspace_id, analysis_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let row = result
        .into_rows_result()
        .map_err(|_| AppError::NotFound("SWOT analysis not found".into()))?
        .single_row::<(Uuid, Uuid, Option<String>, Option<String>, Option<String>, Option<Uuid>, Option<DateTime<Utc>>, Option<DateTime<Utc>>)>()
        .map_err(|_| AppError::NotFound("SWOT analysis not found".into()))?;

    let items = list_items(db, analysis_id).await?;

    Ok(SwotAnalysis {
        workspace_id: row.0,
        id: row.1,
        title: row.2.unwrap_or_default(),
        description: row.3,
        cycle: row.4,
        created_by: row.5.unwrap_or(Uuid::nil()),
        created_at: row.6.unwrap_or(Utc::now()),
        updated_at: row.7.unwrap_or(Utc::now()),
        items: Some(items),
    })
}

pub async fn delete_analysis(
    db: &DbSession,
    workspace_id: &Uuid,
    analysis_id: &Uuid,
) -> Result<(), AppError> {
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.swot_items WHERE analysis_id = ?",
        (analysis_id,),
    ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;

    db.query_unpaged(
        "DELETE FROM inertial_eclipse.swot_analyses WHERE workspace_id = ? AND id = ?",
        (workspace_id, analysis_id),
    ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

// ─── Items ───

pub async fn create_item(
    db: &DbSession,
    analysis_id: &Uuid,
    quadrant: &str,
    content: &str,
    priority: i32,
    linked_objective_id: Option<&Uuid>,
    author_id: &Uuid,
) -> Result<SwotItem, AppError> {
    let id = Uuid::new_v4();
    let now = ts_now();

    // Count items for position
    let items = list_items(db, analysis_id).await?;
    let position = items.iter().filter(|i| i.quadrant == quadrant).count() as i32;

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.swot_items (analysis_id, id, quadrant, content, priority, linked_objective_id, author_id, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (analysis_id, &id, quadrant, content, priority, &linked_objective_id, author_id, position, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(SwotItem {
        analysis_id: *analysis_id,
        id,
        quadrant: quadrant.to_string(),
        content: content.to_string(),
        priority,
        linked_objective_id: linked_objective_id.copied(),
        author_id: *author_id,
        position,
        created_at: Utc::now(),
    })
}

pub async fn list_items(
    db: &DbSession,
    analysis_id: &Uuid,
) -> Result<Vec<SwotItem>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT analysis_id, id, quadrant, content, priority, linked_objective_id, author_id, position, created_at FROM inertial_eclipse.swot_items WHERE analysis_id = ?",
            (analysis_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;

    let mut items = Vec::new();
    for row in rows.rows::<(Uuid, Uuid, Option<String>, Option<String>, Option<i32>, Option<Uuid>, Option<Uuid>, Option<i32>, Option<DateTime<Utc>>)>()?.flatten() {
        items.push(SwotItem {
            analysis_id: row.0,
            id: row.1,
            quadrant: row.2.unwrap_or_default(),
            content: row.3.unwrap_or_default(),
            priority: row.4.unwrap_or(3),
            linked_objective_id: row.5,
            author_id: row.6.unwrap_or(Uuid::nil()),
            position: row.7.unwrap_or(0),
            created_at: row.8.unwrap_or(Utc::now()),
        });
    }

    items.sort_by_key(|i| i.position);
    Ok(items)
}

pub async fn update_item(
    db: &DbSession,
    analysis_id: &Uuid,
    item_id: &Uuid,
    content: Option<&str>,
    priority: Option<i32>,
    quadrant: Option<&str>,
    linked_objective_id: Option<&Uuid>,
    position: Option<i32>,
) -> Result<(), AppError> {
    if let Some(v) = content {
        db.query_unpaged(
            "UPDATE inertial_eclipse.swot_items SET content = ? WHERE analysis_id = ? AND id = ?",
            (v, analysis_id, item_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = priority {
        db.query_unpaged(
            "UPDATE inertial_eclipse.swot_items SET priority = ? WHERE analysis_id = ? AND id = ?",
            (v, analysis_id, item_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = quadrant {
        db.query_unpaged(
            "UPDATE inertial_eclipse.swot_items SET quadrant = ? WHERE analysis_id = ? AND id = ?",
            (v, analysis_id, item_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = linked_objective_id {
        db.query_unpaged(
            "UPDATE inertial_eclipse.swot_items SET linked_objective_id = ? WHERE analysis_id = ? AND id = ?",
            (v, analysis_id, item_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = position {
        db.query_unpaged(
            "UPDATE inertial_eclipse.swot_items SET position = ? WHERE analysis_id = ? AND id = ?",
            (v, analysis_id, item_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    Ok(())
}

pub async fn delete_item(
    db: &DbSession,
    analysis_id: &Uuid,
    item_id: &Uuid,
) -> Result<(), AppError> {
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.swot_items WHERE analysis_id = ? AND id = ?",
        (analysis_id, item_id),
    ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}
