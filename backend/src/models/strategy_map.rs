use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrategyMapNode {
    pub workspace_id: Uuid,
    pub id: Uuid,
    pub node_type: String,
    pub entity_id: Option<Uuid>,
    pub label: String,
    pub position_x: f32,
    pub position_y: f32,
    pub width: f32,
    pub height: f32,
    pub style_data: Option<String>,
    pub bsc_perspective: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrategyMapEdge {
    pub workspace_id: Uuid,
    pub id: Uuid,
    pub source_node_id: Uuid,
    pub target_node_id: Uuid,
    pub edge_type: String,
    pub label: Option<String>,
    pub style_data: Option<String>,
    pub created_at: DateTime<Utc>,
}

// ─── Request Types ───

#[derive(Debug, Deserialize)]
pub struct CreateNodeRequest {
    pub node_type: String,
    pub entity_id: Option<Uuid>,
    pub label: String,
    pub position_x: f32,
    pub position_y: f32,
    #[serde(default = "default_width")]
    pub width: f32,
    #[serde(default = "default_height")]
    pub height: f32,
    pub style_data: Option<String>,
    pub bsc_perspective: Option<String>,
}

fn default_width() -> f32 {
    200.0
}
fn default_height() -> f32 {
    100.0
}

#[derive(Debug, Deserialize)]
pub struct UpdateNodeRequest {
    pub label: Option<String>,
    pub position_x: Option<f32>,
    pub position_y: Option<f32>,
    pub width: Option<f32>,
    pub height: Option<f32>,
    pub style_data: Option<String>,
    pub bsc_perspective: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct BatchUpdatePositionsRequest {
    pub nodes: Vec<NodePositionUpdate>,
}

#[derive(Debug, Deserialize)]
pub struct NodePositionUpdate {
    pub id: Uuid,
    pub position_x: f32,
    pub position_y: f32,
}

#[derive(Debug, Deserialize)]
pub struct CreateEdgeRequest {
    pub source_node_id: Uuid,
    pub target_node_id: Uuid,
    #[serde(default = "default_edge_type")]
    pub edge_type: String,
    pub label: Option<String>,
    pub style_data: Option<String>,
}

fn default_edge_type() -> String {
    "hierarchy".to_string()
}
