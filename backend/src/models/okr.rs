use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ─── Domain Models ───

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OkrObjective {
    pub workspace_id: Uuid,
    pub id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub objective_type: String,
    pub cycle: String,
    pub status: String,
    pub owner_id: Uuid,
    pub team_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team_ids: Option<Vec<Uuid>>,
    pub parent_objective_id: Option<Uuid>,
    pub progress: f32,
    pub confidence: f32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    // Enriched fields
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_results: Option<Vec<OkrKeyResult>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<OkrObjectiveChild>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OkrObjectiveChild {
    pub parent_objective_id: Uuid,
    pub child_objective_id: Uuid,
    pub workspace_id: Uuid,
    pub child_title: String,
    pub child_progress: f32,
    pub child_confidence: f32,
    pub child_team_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OkrObjectiveByCycle {
    pub workspace_id: Uuid,
    pub cycle: String,
    pub objective_id: Uuid,
    pub title: String,
    pub objective_type: String,
    pub status: String,
    pub progress: f32,
    pub confidence: f32,
    pub owner_id: Uuid,
    pub team_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team_ids: Option<Vec<Uuid>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OkrKeyResult {
    pub objective_id: Uuid,
    pub id: Uuid,
    pub title: String,
    pub kr_type: String,
    pub start_value: f32,
    pub target_value: f32,
    pub current_value: f32,
    pub unit: Option<String>,
    pub confidence: f32,
    pub status: String,
    pub owner_id: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    // Enriched
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub check_ins: Option<Vec<OkrCheckIn>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OkrCheckIn {
    pub key_result_id: Uuid,
    pub id: Uuid,
    pub previous_value: f32,
    pub new_value: f32,
    pub confidence: f32,
    pub note: Option<String>,
    pub blockers: Option<String>,
    pub author_id: Uuid,
    pub author_name: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OkrAttachment {
    pub entity_id: Uuid,
    pub id: Uuid,
    pub entity_type: String,
    pub workspace_id: Uuid,
    pub file_name: String,
    pub file_size: i64,
    pub mime_type: String,
    pub uploaded_by: Uuid,
    pub uploader_name: String,
    pub created_at: DateTime<Utc>,
}

// ─── Request Types ───

#[derive(Debug, Deserialize)]
pub struct CreateObjectiveRequest {
    pub title: String,
    pub description: Option<String>,
    #[serde(default = "default_objective_type")]
    pub objective_type: String,
    pub cycle: String,
    pub owner_id: Option<Uuid>,
    pub team_id: Option<Uuid>,
    pub team_ids: Option<Vec<Uuid>>,
    pub parent_objective_id: Option<Uuid>,
}

fn default_objective_type() -> String {
    "committed".to_string()
}

#[derive(Debug, Deserialize)]
pub struct UpdateObjectiveRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    pub objective_type: Option<String>,
    pub cycle: Option<String>,
    pub status: Option<String>,
    pub owner_id: Option<Uuid>,
    pub team_id: Option<Uuid>,
    pub team_ids: Option<Vec<Uuid>>,
    pub parent_objective_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct CreateKeyResultRequest {
    pub title: String,
    #[serde(default = "default_kr_type")]
    pub kr_type: String,
    #[serde(default)]
    pub start_value: f32,
    pub target_value: f32,
    pub unit: Option<String>,
    pub owner_id: Option<Uuid>,
}

fn default_kr_type() -> String {
    "number".to_string()
}

#[derive(Debug, Deserialize)]
pub struct UpdateKeyResultRequest {
    pub title: Option<String>,
    pub kr_type: Option<String>,
    pub start_value: Option<f32>,
    pub target_value: Option<f32>,
    pub current_value: Option<f32>,
    pub unit: Option<String>,
    pub confidence: Option<f32>,
    pub status: Option<String>,
    pub owner_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct CreateCheckInRequest {
    pub new_value: f32,
    pub confidence: f32,
    pub note: Option<String>,
    pub blockers: Option<String>,
}

// ─── Query Params ───

#[derive(Debug, Deserialize)]
pub struct OkrQueryParams {
    pub cycle: Option<String>,
    pub team_id: Option<Uuid>,
}
