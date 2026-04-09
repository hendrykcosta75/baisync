use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct AdminLoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct AdminLoginResponse {
    pub token: String,
}

#[derive(Debug, Serialize)]
pub struct AdminDashboardStats {
    pub total_users: i64,
    pub total_assistants: i64,
    pub total_conversations: i64,
    pub total_messages: i64,
    pub total_revenue: f64,
    pub total_charges: i64,
    pub paid_count: i64,
    pub pending_count: i64,
    pub cancelled_count: i64,
    pub users_by_month: Vec<MonthlyCount>,
    pub revenue_by_month: Vec<MonthlyRevenue>,
    pub providers: Vec<ProviderCount>,
    pub recent_users: Vec<RecentUser>,
}

#[derive(Debug, Serialize)]
pub struct MonthlyCount {
    pub month: String,
    pub count: i64,
}

#[derive(Debug, Serialize)]
pub struct MonthlyRevenue {
    pub month: String,
    pub revenue: f64,
    pub charges: i64,
}

#[derive(Debug, Serialize)]
pub struct ProviderCount {
    pub provider: String,
    pub count: i64,
}

#[derive(Debug, Serialize)]
pub struct RecentUser {
    pub id: Uuid,
    pub name: String,
    pub email: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct AdminUserInfo {
    pub id: Uuid,
    pub email: String,
    pub name: String,
    pub blocked: bool,
    pub created_at: DateTime<Utc>,
    pub assistant_count: i64,
}

#[derive(Debug, Serialize)]
pub struct AdminUserAssistant {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AdminUserDetail {
    pub id: Uuid,
    pub email: String,
    pub name: String,
    pub blocked: bool,
    pub created_at: DateTime<Utc>,
    pub assistants: Vec<AdminUserAssistant>,
}

#[derive(Debug, Deserialize)]
pub struct AdminCreateUserRequest {
    pub email: String,
    pub password: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct AdminBlockRequest {
    pub blocked: bool,
}

// --- Integrations ---

#[derive(Debug, Serialize)]
pub struct AdminIntegrationInfo {
    pub id: Uuid,
    pub assistant_id: Uuid,
    pub assistant_name: String,
    pub user_id: Uuid,
    pub user_name: String,
    pub user_email: String,
    pub channel: String,
    pub provider: String,
    pub status: String,
    pub phone_number: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct AdminIntegrationsResponse {
    pub total: i64,
    pub connected: i64,
    pub disconnected: i64,
    pub by_channel: Vec<ChannelCount>,
    pub by_provider: Vec<ProviderCount>,
    pub integrations: Vec<AdminIntegrationInfo>,
}

#[derive(Debug, Serialize)]
pub struct ChannelCount {
    pub channel: String,
    pub count: i64,
}

// --- Usage ---

#[derive(Debug, Serialize)]
pub struct AdminUsageResponse {
    pub total_tokens_current_month: i64,
    pub total_tokens_previous_month: i64,
    pub total_messages_current_month: i64,
    pub tokens_by_month: Vec<MonthlyTokens>,
    pub top_users_by_tokens: Vec<UserTokens>,
    pub top_assistants_by_tokens: Vec<AssistantTokens>,
    pub by_provider: Vec<ProviderTokens>,
}

#[derive(Debug, Serialize)]
pub struct MonthlyTokens {
    pub month: String,
    pub tokens: i64,
    pub messages: i64,
}

#[derive(Debug, Serialize)]
pub struct UserTokens {
    pub user_id: Uuid,
    pub user_name: String,
    pub user_email: String,
    pub tokens: i64,
}

#[derive(Debug, Serialize)]
pub struct AssistantTokens {
    pub assistant_id: Uuid,
    pub assistant_name: String,
    pub user_id: Uuid,
    pub tokens: i64,
}

#[derive(Debug, Serialize)]
pub struct ProviderTokens {
    pub provider: String,
    pub tokens: i64,
}

// --- Enriched User Detail ---

#[derive(Debug, Serialize)]
pub struct AdminUserDetailEnriched {
    pub id: Uuid,
    pub email: String,
    pub name: String,
    pub blocked: bool,
    pub created_at: DateTime<Utc>,
    // Security
    pub two_factor_enabled: bool,
    pub has_openai_key: bool,
    pub has_claude_key: bool,
    pub has_gemini_key: bool,
    pub has_elevenlabs_key: bool,
    pub has_mercadopago_key: bool,
    // Financial
    pub total_revenue: f64,
    pub paid_charges: i64,
    pub pending_charges: i64,
    pub cancelled_charges: i64,
    pub recent_charges: Vec<AdminChargeInfo>,
    // Usage
    pub total_tokens: i64,
    pub total_messages: i64,
    // Integrations
    pub integrations: Vec<AdminUserIntegration>,
    // Appointments
    pub appointments_by_status: Vec<AppointmentStatusCount>,
    // Assistants (enriched)
    pub assistants: Vec<AdminUserAssistantEnriched>,
}

#[derive(Debug, Serialize)]
pub struct AdminChargeInfo {
    pub id: Uuid,
    pub amount: f64,
    pub status: String,
    pub description: Option<String>,
    pub customer_name: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct AdminUserIntegration {
    pub id: Uuid,
    pub assistant_id: Uuid,
    pub channel: String,
    pub provider: String,
    pub status: String,
    pub phone_number: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AppointmentStatusCount {
    pub status: String,
    pub count: i64,
}

#[derive(Debug, Serialize)]
pub struct AdminUserAssistantEnriched {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub llm_provider: String,
    pub model: String,
    pub tool_count: i64,
    pub file_count: i64,
    pub integration_count: i64,
}
