//! Skill library — workspace-scoped capability instructions invokable
//! from the LLM tool loop. See docstring on `to_llm_tool` for how a
//! skill surfaces to the model.
//!
//! Multi-tenancy: every query filters on `workspace_id`. The handler
//! pulls `workspace_id` from the JWT middleware (`AuthUser`) — never
//! from request body — and `ws_service::require_editor_role` gates
//! writes. See `docs/memory` `project_multitenancy_workspace`.

use chrono::{DateTime, Utc};
use scylla::frame::value::CqlTimestamp;
use serde_json::json;
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::models::skill::{CreateSkillRequest, Skill, UpdateSkillRequest};

fn ts_now() -> CqlTimestamp {
    CqlTimestamp(Utc::now().timestamp_millis())
}

/// Lower-case, ASCII-only slug from a free-form name. Used both as the
/// user-visible slug and as the LLM tool-name suffix (`use_skill_<slug>`).
/// Keep conservative — OpenAI enforces `^[a-zA-Z0-9_-]+$`.
pub fn slugify(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let lowered = name.to_lowercase();
    for c in lowered.chars() {
        match c {
            'á' | 'à' | 'ã' | 'â' | 'ä' => out.push('a'),
            'é' | 'è' | 'ê' | 'ë' => out.push('e'),
            'í' | 'ì' | 'î' | 'ï' => out.push('i'),
            'ó' | 'ò' | 'õ' | 'ô' | 'ö' => out.push('o'),
            'ú' | 'ù' | 'û' | 'ü' => out.push('u'),
            'ç' => out.push('c'),
            'ñ' => out.push('n'),
            ' ' | '-' | '_' => out.push('_'),
            c if c.is_ascii_alphanumeric() => out.push(c),
            _ => {}
        }
    }
    let trimmed = out.trim_matches('_').to_string();
    if trimmed.is_empty() {
        "skill".to_string()
    } else {
        trimmed
    }
}

pub async fn create(
    db: &DbSession,
    workspace_id: &Uuid,
    created_by: &Uuid,
    req: CreateSkillRequest,
) -> Result<Skill, AppError> {
    let name = req.name.trim();
    let description = req.description.trim();
    let instructions = req.instructions.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name vazio".into()));
    }
    if description.is_empty() {
        return Err(AppError::BadRequest("description vazio".into()));
    }
    if instructions.is_empty() {
        return Err(AppError::BadRequest("instructions vazio".into()));
    }

    let slug = unique_slug(db, workspace_id, &slugify(name), None).await?;
    let id = Uuid::new_v4();
    let now = ts_now();

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.skills (workspace_id, id, slug, name, description, instructions, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (workspace_id, &id, &slug, name, description, instructions, created_by, now, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(Skill {
        workspace_id: *workspace_id,
        id,
        slug,
        name: name.to_string(),
        description: description.to_string(),
        instructions: instructions.to_string(),
        created_by: *created_by,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    })
}

pub async fn list(db: &DbSession, workspace_id: &Uuid) -> Result<Vec<Skill>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT workspace_id, id, slug, name, description, instructions, created_by, created_at, updated_at FROM inertial_eclipse.skills WHERE workspace_id = ?",
            (workspace_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;

    let mut out = Vec::new();
    for row in rows
        .rows::<(
            Uuid,
            Uuid,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<Uuid>,
            Option<DateTime<Utc>>,
            Option<DateTime<Utc>>,
        )>()?
        .flatten()
    {
        out.push(Skill {
            workspace_id: row.0,
            id: row.1,
            slug: row.2.unwrap_or_default(),
            name: row.3.unwrap_or_default(),
            description: row.4.unwrap_or_default(),
            instructions: row.5.unwrap_or_default(),
            created_by: row.6.unwrap_or(Uuid::nil()),
            created_at: row.7.unwrap_or_else(Utc::now),
            updated_at: row.8.unwrap_or_else(Utc::now),
        });
    }
    Ok(out)
}

pub async fn get(
    db: &DbSession,
    workspace_id: &Uuid,
    id: &Uuid,
) -> Result<Option<Skill>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT workspace_id, id, slug, name, description, instructions, created_by, created_at, updated_at FROM inertial_eclipse.skills WHERE workspace_id = ? AND id = ?",
            (workspace_id, id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;
    let row = rows.maybe_first_row::<(
        Uuid,
        Uuid,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<Uuid>,
        Option<DateTime<Utc>>,
        Option<DateTime<Utc>>,
    )>()?;
    let Some(row) = row else {
        return Ok(None);
    };
    Ok(Some(Skill {
        workspace_id: row.0,
        id: row.1,
        slug: row.2.unwrap_or_default(),
        name: row.3.unwrap_or_default(),
        description: row.4.unwrap_or_default(),
        instructions: row.5.unwrap_or_default(),
        created_by: row.6.unwrap_or(Uuid::nil()),
        created_at: row.7.unwrap_or_else(Utc::now),
        updated_at: row.8.unwrap_or_else(Utc::now),
    }))
}

pub async fn update(
    db: &DbSession,
    workspace_id: &Uuid,
    id: &Uuid,
    req: UpdateSkillRequest,
) -> Result<Skill, AppError> {
    let mut existing = get(db, workspace_id, id)
        .await?
        .ok_or_else(|| AppError::NotFound("skill não encontrada".into()))?;

    if let Some(name) = req.name.as_deref().map(str::trim) {
        if name.is_empty() {
            return Err(AppError::BadRequest("name vazio".into()));
        }
        // Renaming regenerates the slug. Keep the existing slug if it still
        // derives from the new name (avoids breaking any persisted reference).
        let new_slug_base = slugify(name);
        if new_slug_base != existing.slug {
            let fresh = unique_slug(db, workspace_id, &new_slug_base, Some(id)).await?;
            existing.slug = fresh;
        }
        existing.name = name.to_string();
    }
    if let Some(d) = req.description.as_deref().map(str::trim) {
        if d.is_empty() {
            return Err(AppError::BadRequest("description vazio".into()));
        }
        existing.description = d.to_string();
    }
    if let Some(i) = req.instructions.as_deref().map(str::trim) {
        if i.is_empty() {
            return Err(AppError::BadRequest("instructions vazio".into()));
        }
        existing.instructions = i.to_string();
    }
    let now = ts_now();
    db.query_unpaged(
        "UPDATE inertial_eclipse.skills SET slug = ?, name = ?, description = ?, instructions = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
        (
            &existing.slug,
            &existing.name,
            &existing.description,
            &existing.instructions,
            now,
            workspace_id,
            id,
        ),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    existing.updated_at = Utc::now();
    Ok(existing)
}

pub async fn delete(
    db: &DbSession,
    workspace_id: &Uuid,
    id: &Uuid,
) -> Result<(), AppError> {
    // Cascade: unlink from all assistants. `assistant_skills` partitions on
    // (assistant_id, workspace_id), so lookup by skill_id needs filtering.
    // Bounded by # of assistants — fine for V1.
    let result = db
        .query_unpaged(
            "SELECT assistant_id FROM inertial_eclipse.assistant_skills WHERE skill_id = ? ALLOW FILTERING",
            (id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;
    for row in rows.rows::<(Uuid,)>()?.flatten() {
        let _ = db
            .query_unpaged(
                "DELETE FROM inertial_eclipse.assistant_skills WHERE assistant_id = ? AND workspace_id = ? AND skill_id = ?",
                (&row.0, workspace_id, id),
            )
            .await;
    }

    db.query_unpaged(
        "DELETE FROM inertial_eclipse.skills WHERE workspace_id = ? AND id = ?",
        (workspace_id, id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(())
}

pub async fn link(
    db: &DbSession,
    workspace_id: &Uuid,
    assistant_id: &Uuid,
    skill_id: &Uuid,
    linked_by: &Uuid,
) -> Result<(), AppError> {
    // Validate skill exists in this workspace. Assistant check happens in
    // the handler (via `assistant_service::get_assistant`).
    if get(db, workspace_id, skill_id).await?.is_none() {
        return Err(AppError::NotFound("skill não encontrada".into()));
    }
    let now = ts_now();
    db.query_unpaged(
        "INSERT INTO inertial_eclipse.assistant_skills (assistant_id, workspace_id, skill_id, linked_by, linked_at) VALUES (?, ?, ?, ?, ?)",
        (assistant_id, workspace_id, skill_id, linked_by, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(())
}

pub async fn unlink(
    db: &DbSession,
    workspace_id: &Uuid,
    assistant_id: &Uuid,
    skill_id: &Uuid,
) -> Result<(), AppError> {
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.assistant_skills WHERE assistant_id = ? AND workspace_id = ? AND skill_id = ?",
        (assistant_id, workspace_id, skill_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(())
}

pub async fn list_for_assistant(
    db: &DbSession,
    assistant_id: &Uuid,
    workspace_id: &Uuid,
) -> Result<Vec<Skill>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT skill_id FROM inertial_eclipse.assistant_skills WHERE assistant_id = ? AND workspace_id = ?",
            (assistant_id, workspace_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;
    let mut skill_ids: Vec<Uuid> = Vec::new();
    for row in rows.rows::<(Uuid,)>()?.flatten() {
        skill_ids.push(row.0);
    }

    let mut out = Vec::with_capacity(skill_ids.len());
    for sid in &skill_ids {
        if let Some(s) = get(db, workspace_id, sid).await? {
            out.push(s);
        }
    }
    Ok(out)
}

/// Build the LLM-facing tool for a skill. Exposes it as
/// `use_skill_<slug>`; the dispatcher returns `skill.instructions` as the
/// tool_result when the model invokes this tool. Zero arguments — keeps
/// the activation decision at the LLM layer.
pub fn to_llm_tool(skill: &Skill) -> crate::services::llm::LlmTool {
    crate::services::llm::LlmTool {
        id: Some(skill.id),
        name: format!("use_skill_{}", skill.slug),
        description: skill.description.clone(),
        parameters: json!({"type": "object", "properties": {}, "required": []}),
        endpoint: String::new(),
        method: String::new(),
        headers: None,
        auth: None,
        query_params: None,
        body_content_type: None,
        body_content: Some(skill.instructions.clone()),
        tool_type: "skill".to_string(),
    }
}

/// Pick a slug that doesn't collide within the workspace. If `skip_id`
/// is set, ignore a collision on that exact row (used on rename to let
/// a skill keep its identity if no sibling competes).
async fn unique_slug(
    db: &DbSession,
    workspace_id: &Uuid,
    base: &str,
    skip_id: Option<&Uuid>,
) -> Result<String, AppError> {
    let existing = list(db, workspace_id).await?;
    let taken: std::collections::HashSet<String> = existing
        .iter()
        .filter(|s| skip_id.is_none_or(|id| &s.id != id))
        .map(|s| s.slug.clone())
        .collect();

    if !taken.contains(base) {
        return Ok(base.to_string());
    }
    for n in 2..1000u32 {
        let candidate = format!("{base}_{n}");
        if !taken.contains(&candidate) {
            return Ok(candidate);
        }
    }
    Err(AppError::BadRequest(
        "impossível gerar slug único — renomeie a skill".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_basic() {
        assert_eq!(slugify("Atendimento Pós-Venda"), "atendimento_pos_venda");
        assert_eq!(slugify("  Multi   Space  "), "multi___space");
        assert_eq!(slugify("Ação!"), "acao");
        assert_eq!(slugify("!!!"), "skill");
        assert_eq!(slugify("OK_123"), "ok_123");
    }

    #[test]
    fn to_llm_tool_shape() {
        let s = Skill {
            workspace_id: Uuid::nil(),
            id: Uuid::nil(),
            slug: "agendar_reuniao".into(),
            name: "Agendar reunião".into(),
            description: "Use para marcar horário".into(),
            instructions: "Peça ao cliente o melhor dia...".into(),
            created_by: Uuid::nil(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let t = to_llm_tool(&s);
        assert_eq!(t.name, "use_skill_agendar_reuniao");
        assert_eq!(t.tool_type, "skill");
        assert_eq!(t.body_content.as_deref(), Some("Peça ao cliente o melhor dia..."));
    }
}
