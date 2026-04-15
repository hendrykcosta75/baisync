use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ─── Domain Models ───

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Team {
    pub workspace_id: Uuid,
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamMember {
    pub team_id: Uuid,
    pub user_id: Uuid,
    pub workspace_id: Uuid,
    pub role: String,
    pub joined_at: DateTime<Utc>,
    pub user_name: Option<String>,
    pub user_email: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserTeam {
    pub user_id: Uuid,
    pub workspace_id: Uuid,
    pub team_id: Uuid,
    pub team_name: String,
    pub role: String,
    pub joined_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub team_id: Uuid,
    pub id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub priority: String,
    pub assignee_id: Option<Uuid>,
    pub created_by: Uuid,
    pub due_date: Option<DateTime<Utc>>,
    pub tags: Vec<String>,
    pub checklist_total: i32,
    pub checklist_done: i32,
    pub okr_objective_id: Option<Uuid>,
    pub okr_key_result_id: Option<Uuid>,
    pub position: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    // Enriched fields (not in DB, populated at handler level)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignee_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskComment {
    pub task_id: Uuid,
    pub id: Uuid,
    pub author_id: Uuid,
    pub author_name: String,
    pub content: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamActivityEntry {
    pub team_id: Uuid,
    pub id: Uuid,
    pub actor_id: Uuid,
    pub actor_name: String,
    pub action: String,
    pub entity_type: String,
    pub entity_id: Option<Uuid>,
    pub entity_name: Option<String>,
    pub details: Option<String>,
    pub created_at: DateTime<Utc>,
}

// ─── Request Types ───

#[derive(Debug, Deserialize)]
pub struct CreateTeamRequest {
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTeamRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AddTeamMemberRequest {
    pub user_id: Uuid,
    #[serde(default = "default_member_role")]
    pub role: String,
}

fn default_member_role() -> String {
    "member".to_string()
}

#[derive(Debug, Deserialize)]
pub struct CreateTaskRequest {
    pub title: String,
    pub description: Option<String>,
    #[serde(default = "default_task_status")]
    pub status: String,
    #[serde(default = "default_task_priority")]
    pub priority: String,
    pub assignee_id: Option<Uuid>,
    pub due_date: Option<DateTime<Utc>>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub okr_objective_id: Option<Uuid>,
    pub okr_key_result_id: Option<Uuid>,
}

fn default_task_status() -> String {
    "backlog".to_string()
}

fn default_task_priority() -> String {
    "medium".to_string()
}

#[derive(Debug, Deserialize)]
pub struct UpdateTaskRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub assignee_id: Option<Uuid>,
    pub due_date: Option<DateTime<Utc>>,
    pub tags: Option<Vec<String>>,
    pub checklist_total: Option<i32>,
    pub checklist_done: Option<i32>,
    pub okr_objective_id: Option<Uuid>,
    pub okr_key_result_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct MoveTaskRequest {
    pub status: String,
    pub position: i32,
}

#[derive(Debug, Deserialize)]
pub struct CreateTaskCommentRequest {
    pub content: String,
}

// ─── Response Types ───

#[derive(Debug, Serialize)]
pub struct TeamWithStats {
    #[serde(flatten)]
    pub team: Team,
    pub member_count: i32,
    pub task_counts: TaskCounts,
    pub okr_progress: Option<f32>,
}

#[derive(Debug, Serialize)]
pub struct TaskCounts {
    pub open: i32,
    pub in_progress: i32,
    pub done: i32,
}

#[derive(Debug, Serialize)]
pub struct ActivityPage {
    pub entries: Vec<TeamActivityEntry>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CommentsPage {
    pub comments: Vec<TaskComment>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskAttachment {
    pub task_id: Uuid,
    pub id: Uuid,
    pub team_id: Uuid,
    pub file_name: String,
    pub file_size: i64,
    pub mime_type: String,
    pub uploaded_by: Uuid,
    pub uploader_name: String,
    pub created_at: DateTime<Utc>,
}
