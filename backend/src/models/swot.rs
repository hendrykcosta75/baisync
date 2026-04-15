use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwotAnalysis {
    pub workspace_id: Uuid,
    pub id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub cycle: Option<String>,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub items: Option<Vec<SwotItem>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwotItem {
    pub analysis_id: Uuid,
    pub id: Uuid,
    pub quadrant: String,
    pub content: String,
    pub priority: i32,
    pub linked_objective_id: Option<Uuid>,
    pub author_id: Uuid,
    pub position: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateSwotRequest {
    pub title: String,
    pub description: Option<String>,
    pub cycle: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSwotRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    #[allow(dead_code)]
    pub cycle: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateSwotItemRequest {
    pub quadrant: String,
    pub content: String,
    #[serde(default = "default_priority")]
    pub priority: i32,
    pub linked_objective_id: Option<Uuid>,
}

fn default_priority() -> i32 {
    3
}

#[derive(Debug, Deserialize)]
pub struct UpdateSwotItemRequest {
    pub content: Option<String>,
    pub priority: Option<i32>,
    pub quadrant: Option<String>,
    pub linked_objective_id: Option<Uuid>,
    pub position: Option<i32>,
}
