use chrono::{DateTime, Utc};
use scylla::frame::value::CqlTimestamp;
use tracing::warn;
use uuid::Uuid;

use crate::config::Config;
use crate::db::DbSession;
use crate::errors::AppError;
use crate::models::admin::{
    AdminChargeInfo, AdminCreateUserRequest, AdminDashboardStats, AdminIntegrationInfo,
    AdminIntegrationsResponse, AdminLoginResponse, AdminUsageResponse, AdminUserAssistant,
    AdminUserAssistantEnriched, AdminUserDetail, AdminUserDetailEnriched, AdminUserInfo,
    AdminUserIntegration, AppointmentStatusCount, AssistantTokens, ChannelCount, MonthlyCount,
    MonthlyRevenue, MonthlyTokens, ProviderCount, ProviderTokens, RecentUser, UserTokens,
};
use crate::services::auth::{create_admin_jwt, hash_password};
use crate::services::encryption::EncryptionService;
use std::collections::HashMap;

pub fn admin_login(
    config: &Config,
    username: &str,
    password: &str,
    jwt_secret: &str,
) -> Result<AdminLoginResponse, AppError> {
    if config.admin_user.is_empty() || config.admin_password.is_empty() {
        return Err(AppError::Unauthorized("Admin access not configured".into()));
    }

    // Constant-time comparison to prevent timing attacks
    use subtle::ConstantTimeEq;
    let user_match = username.as_bytes().ct_eq(config.admin_user.as_bytes());
    let pass_match = password.as_bytes().ct_eq(config.admin_password.as_bytes());

    if !bool::from(user_match & pass_match) {
        return Err(AppError::Unauthorized("Invalid admin credentials".into()));
    }

    let token = create_admin_jwt(jwt_secret)?;
    Ok(AdminLoginResponse { token })
}

pub async fn get_dashboard_stats(db: &DbSession) -> Result<AdminDashboardStats, AppError> {
    // Users with created_at for monthly breakdown
    let users_result = db
        .query_unpaged(
            "SELECT id, name, email, created_at FROM inertial_eclipse.users",
            &[],
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut total_users = 0_i64;
    let mut users_by_month_map: HashMap<String, i64> = HashMap::new();
    let mut recent_users: Vec<RecentUser> = Vec::new();

    if let Ok(rows) = users_result.into_rows_result() {
        for row in rows
            .rows::<(Uuid, String, String, DateTime<Utc>)>()
            .into_iter()
            .flatten()
            .flatten()
        {
            let (id, name, email, created_at) = row;
            total_users += 1;
            let month_key = created_at.format("%Y-%m").to_string();
            *users_by_month_map.entry(month_key).or_insert(0) += 1;
            recent_users.push(RecentUser {
                id,
                name,
                email,
                created_at,
            });
        }
    }

    // Sort recent users by date desc and take top 5
    recent_users.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    recent_users.truncate(5);

    // Users by month sorted
    let mut users_by_month: Vec<MonthlyCount> = users_by_month_map
        .into_iter()
        .map(|(month, count)| MonthlyCount { month, count })
        .collect();
    users_by_month.sort_by(|a, b| a.month.cmp(&b.month));
    // Keep last 6 months
    if users_by_month.len() > 6 {
        users_by_month = users_by_month.split_off(users_by_month.len() - 6);
    }

    // Assistants with llm_provider for distribution chart
    let assistants_result = db
        .query_unpaged(
            "SELECT user_id, id, llm_provider FROM inertial_eclipse.assistants",
            &[],
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut total_assistants = 0_i64;
    let mut provider_map: HashMap<String, i64> = HashMap::new();

    if let Ok(rows) = assistants_result.into_rows_result() {
        for row in rows
            .rows::<(Uuid, Uuid, String)>()
            .into_iter()
            .flatten()
            .flatten()
        {
            let (_user_id, _id, provider) = row;
            total_assistants += 1;
            *provider_map.entry(provider).or_insert(0) += 1;
        }
    }

    let mut providers: Vec<ProviderCount> = provider_map
        .into_iter()
        .map(|(provider, count)| ProviderCount { provider, count })
        .collect();
    providers.sort_by(|a, b| b.count.cmp(&a.count));

    // Count conversations
    let convs_result = db
        .query_unpaged(
            "SELECT assistant_id, user_id, id FROM inertial_eclipse.conversations",
            &[],
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let total_conversations = if let Ok(convs_rows) = convs_result.into_rows_result() {
        convs_rows
            .rows::<(Uuid, Uuid, Uuid)>()
            .map(|r| r.count() as i64)
            .unwrap_or(0)
    } else {
        0
    };

    // Count messages
    let msgs_result = db
        .query_unpaged(
            "SELECT conversation_id, id FROM inertial_eclipse.messages",
            &[],
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let total_messages = if let Ok(msgs_rows) = msgs_result.into_rows_result() {
        msgs_rows
            .rows::<(Uuid, Uuid)>()
            .map(|r| r.count() as i64)
            .unwrap_or(0)
    } else {
        0
    };

    // Financial stats from pix_charges with monthly breakdown
    let charges_result = db
        .query_unpaged(
            "SELECT amount, status, created_at FROM inertial_eclipse.pix_charges",
            &[],
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut total_revenue = 0.0_f64;
    let mut total_charges = 0_i64;
    let mut paid_count = 0_i64;
    let mut pending_count = 0_i64;
    let mut cancelled_count = 0_i64;
    let mut revenue_month_map: HashMap<String, (f64, i64)> = HashMap::new();

    if let Ok(rows) = charges_result.into_rows_result() {
        for row in rows
            .rows::<(f64, String, DateTime<Utc>)>()
            .into_iter()
            .flatten()
            .flatten()
        {
            let (amount, status, created_at) = row;
            total_charges += 1;
            let month_key = created_at.format("%Y-%m").to_string();
            let entry = revenue_month_map.entry(month_key).or_insert((0.0, 0));
            entry.1 += 1;
            match status.as_str() {
                "approved" => {
                    paid_count += 1;
                    total_revenue += amount;
                    entry.0 += amount;
                }
                "pending" => pending_count += 1,
                "cancelled" => cancelled_count += 1,
                _ => {}
            }
        }
    }

    let mut revenue_by_month: Vec<MonthlyRevenue> = revenue_month_map
        .into_iter()
        .map(|(month, (revenue, charges))| MonthlyRevenue {
            month,
            revenue,
            charges,
        })
        .collect();
    revenue_by_month.sort_by(|a, b| a.month.cmp(&b.month));
    if revenue_by_month.len() > 6 {
        revenue_by_month = revenue_by_month.split_off(revenue_by_month.len() - 6);
    }

    Ok(AdminDashboardStats {
        total_users,
        total_assistants,
        total_conversations,
        total_messages,
        total_revenue,
        total_charges,
        paid_count,
        pending_count,
        cancelled_count,
        users_by_month,
        revenue_by_month,
        providers,
        recent_users,
    })
}

pub async fn list_all_users(db: &DbSession) -> Result<Vec<AdminUserInfo>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT id, email, name, blocked, created_at FROM inertial_eclipse.users",
            &[],
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut users = Vec::new();

    if let Ok(rows) = result.into_rows_result() {
        for row in rows
            .rows::<(Uuid, String, String, Option<bool>, DateTime<Utc>)>()
            .into_iter()
            .flatten()
            .flatten()
        {
            let (id, email, name, blocked, created_at) = row;

            // Count assistants for this user
            let assistant_result = db
                .query_unpaged(
                    "SELECT id FROM inertial_eclipse.assistants WHERE user_id = ?",
                    (&id,),
                )
                .await;
            let assistant_count = assistant_result
                .ok()
                .and_then(|r| r.into_rows_result().ok())
                .and_then(|r| {
                    let count = r.rows::<(Uuid,)>().ok()?.count() as i64;
                    Some(count)
                })
                .unwrap_or(0);

            users.push(AdminUserInfo {
                id,
                email,
                name,
                blocked: blocked.unwrap_or(false),
                created_at,
                assistant_count,
            });
        }
    }

    // Sort by created_at descending (newest first)
    users.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    Ok(users)
}

pub async fn get_user_detail(db: &DbSession, user_id: &Uuid) -> Result<AdminUserDetail, AppError> {
    let result = db
        .query_unpaged(
            "SELECT id, email, name, blocked, created_at FROM inertial_eclipse.users WHERE id = ?",
            (user_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let (id, email, name, blocked, created_at) = result
        .into_rows_result()
        .map_err(|_| AppError::NotFound("User not found".into()))?
        .single_row::<(Uuid, String, String, Option<bool>, DateTime<Utc>)>()
        .map_err(|_| AppError::NotFound("User not found".into()))?;

    // Get user's assistants
    let assistants_result = db
        .query_unpaged(
            "SELECT id, name, description FROM inertial_eclipse.assistants WHERE user_id = ?",
            (user_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut assistants = Vec::new();
    if let Ok(rows) = assistants_result.into_rows_result() {
        for row in rows
            .rows::<(Uuid, String, Option<String>)>()
            .into_iter()
            .flatten()
            .flatten()
        {
            let (aid, aname, adesc) = row;
            assistants.push(AdminUserAssistant {
                id: aid,
                name: aname,
                description: adesc,
            });
        }
    }

    Ok(AdminUserDetail {
        id,
        email,
        name,
        blocked: blocked.unwrap_or(false),
        created_at,
        assistants,
    })
}

pub async fn create_user(
    db: &DbSession,
    req: &AdminCreateUserRequest,
) -> Result<AdminUserInfo, AppError> {
    // Validate email format
    if !req.email.contains('@') || !req.email.contains('.') || req.email.len() < 5 {
        return Err(AppError::BadRequest("Invalid email format".into()));
    }

    // Validate password length
    if req.password.len() < 6 {
        return Err(AppError::BadRequest(
            "Password must be at least 6 characters".into(),
        ));
    }

    // Check if email already exists
    let existing = db
        .query_unpaged(
            "SELECT id FROM inertial_eclipse.users WHERE email = ?",
            (&req.email,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    if existing
        .into_rows_result()?
        .maybe_first_row::<(Uuid,)>()?
        .is_some()
    {
        return Err(AppError::BadRequest("Email already registered".into()));
    }

    let id = Uuid::new_v4();
    let password_hash = hash_password(&req.password)?;
    let now = CqlTimestamp(Utc::now().timestamp_millis());

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.users (id, email, password_hash, name, two_factor_enabled, blocked, created_at, updated_at) VALUES (?, ?, ?, ?, false, false, ?, ?)",
        (id, &req.email, &password_hash as &str, &req.name, now, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(AdminUserInfo {
        id,
        email: req.email.clone(),
        name: req.name.clone(),
        blocked: false,
        created_at: Utc::now(),
        assistant_count: 0,
    })
}

pub async fn block_user(db: &DbSession, user_id: &Uuid, blocked: bool) -> Result<(), AppError> {
    // Verify user exists
    let result = db
        .query_unpaged(
            "SELECT id FROM inertial_eclipse.users WHERE id = ?",
            (user_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    result
        .into_rows_result()
        .map_err(|_| AppError::NotFound("User not found".into()))?
        .single_row::<(Uuid,)>()
        .map_err(|_| AppError::NotFound("User not found".into()))?;

    let now = CqlTimestamp(Utc::now().timestamp_millis());

    db.query_unpaged(
        "UPDATE inertial_eclipse.users SET blocked = ?, updated_at = ? WHERE id = ?",
        (blocked, now, user_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

// --- Integrations ---

pub async fn list_all_integrations(
    db: &DbSession,
    encryption: &EncryptionService,
) -> Result<AdminIntegrationsResponse, AppError> {
    // Build user lookup: id -> (name, email)
    let users_result = db
        .query_unpaged("SELECT id, name, email FROM inertial_eclipse.users", &[])
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let mut user_map: HashMap<Uuid, (String, String)> = HashMap::new();
    if let Ok(rows) = users_result.into_rows_result() {
        for row in rows
            .rows::<(Uuid, String, String)>()
            .into_iter()
            .flatten()
            .flatten()
        {
            user_map.insert(row.0, (row.1, row.2));
        }
    }

    // Build assistant lookup: (user_id, id) -> name
    let assistants_result = db
        .query_unpaged(
            "SELECT user_id, id, name FROM inertial_eclipse.assistants",
            &[],
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let mut assistant_map: HashMap<(Uuid, Uuid), String> = HashMap::new();
    if let Ok(rows) = assistants_result.into_rows_result() {
        for row in rows
            .rows::<(Uuid, Uuid, String)>()
            .into_iter()
            .flatten()
            .flatten()
        {
            assistant_map.insert((row.0, row.1), row.2);
        }
    }

    // Fetch all integrations
    let integrations_result = db
        .query_unpaged(
            "SELECT assistant_id, user_id, id, channel, provider, status, config_phone_number, created_at FROM inertial_eclipse.assistant_integrations",
            &[],
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut integrations = Vec::new();
    let mut total = 0_i64;
    let mut connected = 0_i64;
    let mut disconnected = 0_i64;
    let mut channel_map: HashMap<String, i64> = HashMap::new();
    let mut provider_map: HashMap<String, i64> = HashMap::new();

    if let Ok(rows) = integrations_result.into_rows_result() {
        for row in rows
            .rows::<(
                Uuid,
                Uuid,
                Uuid,
                String,
                String,
                String,
                Option<String>,
                DateTime<Utc>,
            )>()
            .into_iter()
            .flatten()
            .flatten()
        {
            let (assistant_id, user_id, id, channel, provider, status, phone, created_at) = row;
            total += 1;

            match status.as_str() {
                "connected" => connected += 1,
                _ => disconnected += 1,
            }
            *channel_map.entry(channel.clone()).or_insert(0) += 1;
            *provider_map.entry(provider.clone()).or_insert(0) += 1;

            let (user_name, user_email) = user_map
                .get(&user_id)
                .cloned()
                .unwrap_or_else(|| ("Unknown".into(), "unknown".into()));
            let assistant_name = assistant_map
                .get(&(user_id, assistant_id))
                .cloned()
                .unwrap_or_else(|| "Unknown".into());

            // Phone numbers may be plaintext (legacy) or ciphertext (post-S0
            // backfill). Decrypt with passthrough so the admin panel sees the
            // real value either way.
            let phone = encryption.try_decrypt_opt(phone);

            integrations.push(AdminIntegrationInfo {
                id,
                assistant_id,
                assistant_name,
                user_id,
                user_name,
                user_email,
                channel,
                provider,
                status,
                phone_number: phone,
                created_at,
            });
        }
    }

    integrations.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    let mut by_channel: Vec<ChannelCount> = channel_map
        .into_iter()
        .map(|(channel, count)| ChannelCount { channel, count })
        .collect();
    by_channel.sort_by(|a, b| b.count.cmp(&a.count));

    let mut by_provider: Vec<ProviderCount> = provider_map
        .into_iter()
        .map(|(provider, count)| ProviderCount { provider, count })
        .collect();
    by_provider.sort_by(|a, b| b.count.cmp(&a.count));

    Ok(AdminIntegrationsResponse {
        total,
        connected,
        disconnected,
        by_channel,
        by_provider,
        integrations,
    })
}

// --- Usage ---

pub async fn get_platform_usage(db: &DbSession) -> Result<AdminUsageResponse, AppError> {
    let now = Utc::now();
    let current_month = now.format("%Y-%m-%d").to_string()[..7].to_string();
    let prev_month = {
        let prev = now - chrono::Duration::days(30);
        prev.format("%Y-%m-%d").to_string()[..7].to_string()
    };

    // Build user lookup
    let users_result = db
        .query_unpaged("SELECT id, name, email FROM inertial_eclipse.users", &[])
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let mut user_map: HashMap<Uuid, (String, String)> = HashMap::new();
    if let Ok(rows) = users_result.into_rows_result() {
        for row in rows
            .rows::<(Uuid, String, String)>()
            .into_iter()
            .flatten()
            .flatten()
        {
            user_map.insert(row.0, (row.1, row.2));
        }
    }

    // Build assistant lookup: (user_id, id) -> (name, provider)
    let assistants_result = db
        .query_unpaged(
            "SELECT user_id, id, name, llm_provider FROM inertial_eclipse.assistants",
            &[],
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let mut assistant_map: HashMap<(Uuid, Uuid), (String, String)> = HashMap::new();
    if let Ok(rows) = assistants_result.into_rows_result() {
        for row in rows
            .rows::<(Uuid, Uuid, String, String)>()
            .into_iter()
            .flatten()
            .flatten()
        {
            assistant_map.insert((row.0, row.1), (row.2, row.3));
        }
    }

    // Fetch all usage_stats
    let usage_result = db
        .query_unpaged(
            "SELECT user_id, assistant_id, period, total_tokens, total_messages FROM inertial_eclipse.usage_stats",
            &[],
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut total_tokens_current = 0_i64;
    let mut total_tokens_previous = 0_i64;
    let mut total_messages_current = 0_i64;
    let mut month_map: HashMap<String, (i64, i64)> = HashMap::new(); // month -> (tokens, messages)
    let mut user_tokens_map: HashMap<Uuid, i64> = HashMap::new();
    let mut assistant_tokens_map: HashMap<(Uuid, Uuid), i64> = HashMap::new();

    if let Ok(rows) = usage_result.into_rows_result() {
        for row in rows
            .rows::<(Uuid, Uuid, String, i64, i64)>()
            .into_iter()
            .flatten()
            .flatten()
        {
            let (user_id, assistant_id, period, tokens, messages) = row;
            let month = if period.len() >= 7 {
                period[..7].to_string()
            } else {
                period.clone()
            };

            if month == current_month {
                total_tokens_current += tokens;
                total_messages_current += messages;
            } else if month == prev_month {
                total_tokens_previous += tokens;
            }

            let entry = month_map.entry(month).or_insert((0, 0));
            entry.0 += tokens;
            entry.1 += messages;

            *user_tokens_map.entry(user_id).or_insert(0) += tokens;
            *assistant_tokens_map
                .entry((user_id, assistant_id))
                .or_insert(0) += tokens;
        }
    }

    // Tokens by month (last 6)
    let mut tokens_by_month: Vec<MonthlyTokens> = month_map
        .into_iter()
        .map(|(month, (tokens, messages))| MonthlyTokens {
            month,
            tokens,
            messages,
        })
        .collect();
    tokens_by_month.sort_by(|a, b| a.month.cmp(&b.month));
    if tokens_by_month.len() > 6 {
        tokens_by_month = tokens_by_month.split_off(tokens_by_month.len() - 6);
    }

    // Top 10 users
    let mut user_tokens_vec: Vec<(Uuid, i64)> = user_tokens_map.into_iter().collect();
    user_tokens_vec.sort_by(|a, b| b.1.cmp(&a.1));
    user_tokens_vec.truncate(10);
    let top_users_by_tokens: Vec<UserTokens> = user_tokens_vec
        .into_iter()
        .map(|(uid, tokens)| {
            let (name, email) = user_map
                .get(&uid)
                .cloned()
                .unwrap_or_else(|| ("Unknown".into(), "unknown".into()));
            UserTokens {
                user_id: uid,
                user_name: name,
                user_email: email,
                tokens,
            }
        })
        .collect();

    // Top 10 assistants
    let mut assistant_tokens_vec: Vec<((Uuid, Uuid), i64)> =
        assistant_tokens_map.into_iter().collect();
    assistant_tokens_vec.sort_by(|a, b| b.1.cmp(&a.1));
    assistant_tokens_vec.truncate(10);
    let top_assistants_by_tokens: Vec<AssistantTokens> = assistant_tokens_vec
        .into_iter()
        .map(|((uid, aid), tokens)| {
            let name = assistant_map
                .get(&(uid, aid))
                .map(|(n, _)| n.clone())
                .unwrap_or_else(|| "Unknown".into());
            AssistantTokens {
                assistant_id: aid,
                assistant_name: name,
                user_id: uid,
                tokens,
            }
        })
        .collect();

    // By provider: correlate assistant with usage
    let mut provider_tokens_map: HashMap<String, i64> = HashMap::new();
    // Re-fetch since we consumed the iterator
    let usage_result2 = db
        .query_unpaged(
            "SELECT user_id, assistant_id, total_tokens FROM inertial_eclipse.usage_stats",
            &[],
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    if let Ok(rows) = usage_result2.into_rows_result() {
        for row in rows
            .rows::<(Uuid, Uuid, i64)>()
            .into_iter()
            .flatten()
            .flatten()
        {
            let (uid, aid, tokens) = row;
            let provider = assistant_map
                .get(&(uid, aid))
                .map(|(_, p)| p.clone())
                .unwrap_or_else(|| "unknown".into());
            *provider_tokens_map.entry(provider).or_insert(0) += tokens;
        }
    }
    let mut by_provider: Vec<ProviderTokens> = provider_tokens_map
        .into_iter()
        .map(|(provider, tokens)| ProviderTokens { provider, tokens })
        .collect();
    by_provider.sort_by(|a, b| b.tokens.cmp(&a.tokens));

    Ok(AdminUsageResponse {
        total_tokens_current_month: total_tokens_current,
        total_tokens_previous_month: total_tokens_previous,
        total_messages_current_month: total_messages_current,
        tokens_by_month,
        top_users_by_tokens,
        top_assistants_by_tokens,
        by_provider,
    })
}

// --- Enriched User Detail ---

pub async fn get_user_detail_enriched(
    db: &DbSession,
    encryption: &EncryptionService,
    user_id: &Uuid,
) -> Result<AdminUserDetailEnriched, AppError> {
    // Get user with security fields
    let result = db
        .query_unpaged(
            "SELECT id, email, name, blocked, created_at, two_factor_enabled, api_key_openai, api_key_claude, api_key_gemini, api_key_elevenlabs, api_key_mercadopago FROM inertial_eclipse.users WHERE id = ?",
            (user_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let (
        id,
        email,
        name,
        blocked,
        created_at,
        two_factor_enabled,
        key_openai,
        key_claude,
        key_gemini,
        key_elevenlabs,
        key_mercadopago,
    ) = result
        .into_rows_result()
        .map_err(|_| AppError::NotFound("User not found".into()))?
        .single_row::<(
            Uuid,
            String,
            String,
            Option<bool>,
            DateTime<Utc>,
            Option<bool>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        )>()
        .map_err(|_| AppError::NotFound("User not found".into()))?;

    // Get user's assistants with enriched data
    let assistants_result = db
        .query_unpaged(
            "SELECT id, name, description, llm_provider, model FROM inertial_eclipse.assistants WHERE user_id = ?",
            (user_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut assistants = Vec::new();
    if let Ok(rows) = assistants_result.into_rows_result() {
        for row in rows
            .rows::<(Uuid, String, Option<String>, String, String)>()
            .into_iter()
            .flatten()
            .flatten()
        {
            let (aid, aname, adesc, provider, model) = row;

            // Count tools
            let tool_count = db
                .query_unpaged(
                    "SELECT id FROM inertial_eclipse.assistant_tools WHERE assistant_id = ?",
                    (&aid,),
                )
                .await
                .ok()
                .and_then(|r| r.into_rows_result().ok())
                .and_then(|r| {
                    let count = r.rows::<(Uuid,)>().ok()?.count() as i64;
                    Some(count)
                })
                .unwrap_or(0);

            // Count files
            let file_count = db
                .query_unpaged(
                    "SELECT id FROM inertial_eclipse.assistant_files WHERE assistant_id = ? AND user_id = ?",
                    (&aid, user_id),
                )
                .await
                .ok()
                .and_then(|r| r.into_rows_result().ok())
                .and_then(|r| { let count = r.rows::<(Uuid,)>().ok()?.count() as i64; Some(count) })
                .unwrap_or(0);

            // Count integrations
            let integration_count = db
                .query_unpaged(
                    "SELECT id FROM inertial_eclipse.assistant_integrations WHERE assistant_id = ? AND user_id = ?",
                    (&aid, user_id),
                )
                .await
                .ok()
                .and_then(|r| r.into_rows_result().ok())
                .and_then(|r| { let count = r.rows::<(Uuid,)>().ok()?.count() as i64; Some(count) })
                .unwrap_or(0);

            assistants.push(AdminUserAssistantEnriched {
                id: aid,
                name: aname,
                description: adesc,
                llm_provider: provider,
                model,
                tool_count,
                file_count,
                integration_count,
            });
        }
    }

    // PIX charges
    let charges_result = db
        .query_unpaged(
            "SELECT id, amount, status, description, customer_name, created_at FROM inertial_eclipse.pix_charges WHERE user_id = ?",
            (user_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut total_revenue = 0.0_f64;
    let mut paid_charges = 0_i64;
    let mut pending_charges = 0_i64;
    let mut cancelled_charges = 0_i64;
    let mut recent_charges: Vec<AdminChargeInfo> = Vec::new();

    if let Ok(rows) = charges_result.into_rows_result() {
        for row in rows
            .rows::<(
                Uuid,
                f64,
                String,
                Option<String>,
                Option<String>,
                DateTime<Utc>,
            )>()
            .into_iter()
            .flatten()
            .flatten()
        {
            let (cid, amount, status, description, customer_name, created_at) = row;
            match status.as_str() {
                "approved" => {
                    paid_charges += 1;
                    total_revenue += amount;
                }
                "pending" => pending_charges += 1,
                "cancelled" => cancelled_charges += 1,
                _ => {}
            }
            recent_charges.push(AdminChargeInfo {
                id: cid,
                amount,
                status,
                description,
                customer_name,
                created_at,
            });
        }
    }
    recent_charges.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    recent_charges.truncate(10);

    // Usage stats (composite partition key: user_id + assistant_id)
    let mut total_tokens = 0_i64;
    let mut total_messages = 0_i64;
    for assistant in &assistants {
        let usage_result = db
            .query_unpaged(
                "SELECT total_tokens, total_messages FROM inertial_eclipse.usage_stats WHERE user_id = ? AND assistant_id = ?",
                (user_id, &assistant.id),
            )
            .await;
        if let Ok(res) = usage_result {
            if let Ok(rows) = res.into_rows_result() {
                for row in rows.rows::<(i64, i64)>().into_iter().flatten().flatten() {
                    total_tokens += row.0;
                    total_messages += row.1;
                }
            }
        }
    }

    // Integrations
    let mut integrations = Vec::new();
    for assistant in &assistants {
        let int_result = db
            .query_unpaged(
                "SELECT id, channel, provider, status, config_phone_number FROM inertial_eclipse.assistant_integrations WHERE assistant_id = ? AND user_id = ?",
                (&assistant.id, user_id),
            )
            .await;
        if let Ok(int_res) = int_result {
            if let Ok(rows) = int_res.into_rows_result() {
                for row in rows
                    .rows::<(Uuid, String, String, String, Option<String>)>()
                    .into_iter()
                    .flatten()
                    .flatten()
                {
                    // Phone may be plaintext (legacy) or ciphertext
                    // (post-S0). Try-decrypt so admin UI sees the real value.
                    let phone = encryption.try_decrypt_opt(row.4);
                    integrations.push(AdminUserIntegration {
                        id: row.0,
                        assistant_id: assistant.id,
                        channel: row.1,
                        provider: row.2,
                        status: row.3,
                        phone_number: phone,
                    });
                }
            }
        }
    }

    // Appointments by status
    let appt_result = db
        .query_unpaged(
            "SELECT status FROM inertial_eclipse.appointments WHERE user_id = ?",
            (user_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut appt_status_map: HashMap<String, i64> = HashMap::new();
    if let Ok(rows) = appt_result.into_rows_result() {
        for row in rows.rows::<(String,)>().into_iter().flatten().flatten() {
            *appt_status_map.entry(row.0).or_insert(0) += 1;
        }
    }
    let appointments_by_status: Vec<AppointmentStatusCount> = appt_status_map
        .into_iter()
        .map(|(status, count)| AppointmentStatusCount { status, count })
        .collect();

    Ok(AdminUserDetailEnriched {
        id,
        email,
        name,
        blocked: blocked.unwrap_or(false),
        created_at,
        two_factor_enabled: two_factor_enabled.unwrap_or(false),
        has_openai_key: key_openai.map(|k| !k.is_empty()).unwrap_or(false),
        has_claude_key: key_claude.map(|k| !k.is_empty()).unwrap_or(false),
        has_gemini_key: key_gemini.map(|k| !k.is_empty()).unwrap_or(false),
        has_elevenlabs_key: key_elevenlabs.map(|k| !k.is_empty()).unwrap_or(false),
        has_mercadopago_key: key_mercadopago.map(|k| !k.is_empty()).unwrap_or(false),
        total_revenue,
        paid_charges,
        pending_charges,
        cancelled_charges,
        recent_charges,
        total_tokens,
        total_messages,
        integrations,
        appointments_by_status,
        assistants,
    })
}

pub async fn delete_user(db: &DbSession, user_id: &Uuid) -> Result<(), AppError> {
    // Verify user exists
    let result = db
        .query_unpaged(
            "SELECT id FROM inertial_eclipse.users WHERE id = ?",
            (user_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    result
        .into_rows_result()
        .map_err(|_| AppError::NotFound("User not found".into()))?
        .single_row::<(Uuid,)>()
        .map_err(|_| AppError::NotFound("User not found".into()))?;

    // Delete user's assistants and related data
    let assistants = db
        .query_unpaged(
            "SELECT id FROM inertial_eclipse.assistants WHERE user_id = ?",
            (user_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    if let Ok(rows) = assistants.into_rows_result() {
        for row in rows.rows::<(Uuid,)>().into_iter().flatten().flatten() {
            let assistant_id = row.0;
            if let Err(e) = db
                .query_unpaged(
                    "DELETE FROM inertial_eclipse.assistant_tools WHERE assistant_id = ?",
                    (&assistant_id,),
                )
                .await
            {
                warn!(user_id = %user_id, assistant_id = %assistant_id, error = %e, "Failed to delete assistant_tools");
            }
            if let Err(e) = db.query_unpaged("DELETE FROM inertial_eclipse.assistant_files WHERE assistant_id = ? AND user_id = ?", (&assistant_id, user_id)).await {
                warn!(user_id = %user_id, assistant_id = %assistant_id, error = %e, "Failed to delete assistant_files");
            }
            if let Err(e) = db.query_unpaged("DELETE FROM inertial_eclipse.assistant_integrations WHERE assistant_id = ? AND user_id = ?", (&assistant_id, user_id)).await {
                warn!(user_id = %user_id, assistant_id = %assistant_id, error = %e, "Failed to delete assistant_integrations");
            }
            if let Err(e) = db
                .query_unpaged(
                    "DELETE FROM inertial_eclipse.availability_config WHERE assistant_id = ?",
                    (&assistant_id,),
                )
                .await
            {
                warn!(user_id = %user_id, assistant_id = %assistant_id, error = %e, "Failed to delete availability_config");
            }

            // Delete conversations and their messages
            let convs = db
                .query_unpaged(
                    "SELECT id FROM inertial_eclipse.conversations WHERE assistant_id = ? AND user_id = ?",
                    (&assistant_id, user_id),
                )
                .await;
            if let Ok(conv_result) = convs {
                if let Ok(conv_rows) = conv_result.into_rows_result() {
                    for conv in conv_rows.rows::<(Uuid,)>().into_iter().flatten().flatten() {
                        if let Err(e) = db
                            .query_unpaged(
                                "DELETE FROM inertial_eclipse.messages WHERE conversation_id = ?",
                                (&conv.0,),
                            )
                            .await
                        {
                            warn!(conversation_id = %conv.0, error = %e, "Failed to delete messages");
                        }
                    }
                }
            }
            if let Err(e) = db.query_unpaged("DELETE FROM inertial_eclipse.conversations WHERE assistant_id = ? AND user_id = ?", (&assistant_id, user_id)).await {
                warn!(user_id = %user_id, assistant_id = %assistant_id, error = %e, "Failed to delete conversations");
            }
        }
    }

    // Delete assistants
    if let Err(e) = db
        .query_unpaged(
            "DELETE FROM inertial_eclipse.assistants WHERE user_id = ?",
            (user_id,),
        )
        .await
    {
        warn!(user_id = %user_id, error = %e, "Failed to delete assistants");
    }

    // Delete PIX charges
    if let Err(e) = db
        .query_unpaged(
            "DELETE FROM inertial_eclipse.pix_charges WHERE user_id = ?",
            (user_id,),
        )
        .await
    {
        warn!(user_id = %user_id, error = %e, "Failed to delete pix_charges");
    }

    // Delete notifications
    if let Err(e) = db
        .query_unpaged(
            "DELETE FROM inertial_eclipse.notifications WHERE user_id = ?",
            (user_id,),
        )
        .await
    {
        warn!(user_id = %user_id, error = %e, "Failed to delete notifications");
    }

    // Delete appointments
    if let Err(e) = db
        .query_unpaged(
            "DELETE FROM inertial_eclipse.appointments WHERE user_id = ?",
            (user_id,),
        )
        .await
    {
        warn!(user_id = %user_id, error = %e, "Failed to delete appointments");
    }

    // Delete accepted shares
    if let Err(e) = db
        .query_unpaged(
            "DELETE FROM inertial_eclipse.accepted_shares WHERE user_id = ?",
            (user_id,),
        )
        .await
    {
        warn!(user_id = %user_id, error = %e, "Failed to delete accepted_shares");
    }

    // Delete usage stats
    if let Err(e) = db
        .query_unpaged(
            "DELETE FROM inertial_eclipse.usage_stats WHERE user_id = ?",
            (user_id,),
        )
        .await
    {
        warn!(user_id = %user_id, error = %e, "Failed to delete usage_stats");
    }

    // Delete user
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.users WHERE id = ?",
        (user_id,),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}
