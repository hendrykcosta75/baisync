use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: Uuid,
    pub name: String,
    #[serde(rename = "type")]
    pub workspace_type: String,
    pub owner_id: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceMember {
    pub workspace_id: Uuid,
    pub user_id: Uuid,
    pub role: String,
    pub invited_by: Option<Uuid>,
    pub joined_at: DateTime<Utc>,
    pub user_name: Option<String>,
    pub user_email: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserWorkspace {
    pub user_id: Uuid,
    pub workspace_id: Uuid,
    pub workspace_name: String,
    pub workspace_type: String,
    pub role: String,
    pub joined_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceInvite {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub email: String,
    pub role: String,
    pub invited_by: Uuid,
    pub token: String,
    pub expires_at: DateTime<Utc>,
    pub accepted: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceApiKeys {
    pub workspace_id: Uuid,
    pub openai_api_key: Option<String>,
    pub claude_api_key: Option<String>,
    pub gemini_api_key: Option<String>,
    pub elevenlabs_api_key: Option<String>,
    pub grok_api_key: Option<String>,
    pub deepseek_api_key: Option<String>,
    pub mercadopago_access_token: Option<String>,
    pub mercadopago_public_key: Option<String>,
    pub stripe_secret_key: Option<String>,
    pub stripe_public_key: Option<String>,
    pub updated_at: Option<DateTime<Utc>>,
    /// T3.2 F1 — version of the AES key used to encrypt the encrypted
    /// columns on THIS row. `None` maps to V1 for backward compatibility
    /// with rows written before migration 101 (legacy single-key era).
    /// Serialized as a hint for callers; not user-editable via API.
    #[serde(default)]
    pub key_version: Option<i32>,
}

// Request types

#[derive(Debug, Deserialize)]
pub struct CreateWorkspaceRequest {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateWorkspaceRequest {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct InviteMemberRequest {
    pub email: String,
    #[serde(default = "default_member_role")]
    pub role: String,
}

fn default_member_role() -> String {
    "member".to_string()
}

#[derive(Debug, Deserialize)]
pub struct UpdateMemberRoleRequest {
    pub role: String,
}

// Response types

#[derive(Debug, Serialize)]
pub struct WorkspaceApiKeysResponse {
    pub openai_configured: bool,
    pub claude_configured: bool,
    pub gemini_configured: bool,
    pub elevenlabs_configured: bool,
    pub grok_configured: bool,
    pub deepseek_configured: bool,
    pub mercadopago_configured: bool,
    pub stripe_configured: bool,
}
