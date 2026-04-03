use reqwest::Client;
use uuid::Uuid;

use crate::config::Config;
use crate::db::DbSession;
use crate::services::email;
use crate::services::notification;

/// Background task: runs every 5 minutes, checks all connected integrations.
/// If a connection is lost, updates the status, creates an in-app notification,
/// and sends an email to the user.
pub async fn run(db: DbSession, config: Config) {
    let interval = std::time::Duration::from_secs(20);
    loop {
        tokio::time::sleep(interval).await;
        if let Err(e) = check_all_connections(&db, &config).await {
            tracing::error!("Health check error: {e}");
        }
    }
}

async fn check_all_connections(db: &DbSession, config: &Config) -> Result<(), String> {
    // Query all integrations that are currently "connected"
    let result = db
        .query_unpaged(
            "SELECT assistant_id, user_id, id, channel, provider, config_token, config_phone_number FROM inertial_eclipse.assistant_integrations WHERE status = 'connected' ALLOW FILTERING",
            &[],
        )
        .await
        .map_err(|e| format!("DB query failed: {e}"))?;

    type Row = (
        Uuid,           // assistant_id
        Uuid,           // user_id
        Uuid,           // id (integration_id)
        String,         // channel
        String,         // provider
        Option<String>, // config_token
        Option<String>, // config_phone_number
    );

    let rows: Vec<Row> = result
        .rows_typed::<Row>()
        .map_err(|e| format!("Row parse failed: {e}"))?
        .filter_map(|r| r.ok())
        .collect();

    if rows.is_empty() {
        return Ok(());
    }

    let client = Client::new();

    for (assistant_id, user_id, integration_id, channel, provider, config_token, config_phone_number) in rows {
        let still_connected = check_connection(
            &client,
            config,
            &provider,
            config_token.as_deref(),
            config_phone_number.as_deref(),
        )
        .await;

        if !still_connected {
            if let Err(e) = handle_disconnection(
                db,
                config,
                &user_id,
                &assistant_id,
                &integration_id,
                &channel,
                &provider,
            )
            .await
            {
                tracing::warn!(
                    "Failed to handle disconnection for integration {integration_id}: {e}"
                );
            }
        }
    }

    Ok(())
}

/// Returns true if the connection is still alive.
async fn check_connection(
    client: &Client,
    config: &Config,
    provider: &str,
    config_token: Option<&str>,
    config_phone_number: Option<&str>,
) -> bool {
    match provider {
        "baileys" => {
            // Baileys connection state is managed exclusively via webhooks (connection.update).
            // Do not verify externally — assume still connected.
            true
        }
        "meta_official" => {
            let (Some(phone_id), Some(token)) = (config_phone_number, config_token) else {
                return false;
            };
            let url = format!("https://graph.facebook.com/v21.0/{phone_id}");
            client
                .get(&url)
                .bearer_auth(token)
                .send()
                .await
                .map(|r| r.status().is_success())
                .unwrap_or(false)
        }
        "telegram" => {
            let Some(token) = config_token else {
                return false;
            };
            let url = format!("https://api.telegram.org/bot{token}/getMe");
            client
                .get(&url)
                .send()
                .await
                .map(|r| r.status().is_success())
                .unwrap_or(false)
        }
        _ => true, // Unknown provider — don't flag as disconnected
    }
}

async fn handle_disconnection(
    db: &DbSession,
    config: &Config,
    user_id: &Uuid,
    assistant_id: &Uuid,
    integration_id: &Uuid,
    channel: &str,
    provider: &str,
) -> Result<(), String> {
    // Update integration status to disconnected
    db.query_unpaged(
        "UPDATE inertial_eclipse.assistant_integrations SET status = 'disconnected' WHERE assistant_id = ? AND user_id = ? AND id = ?",
        (assistant_id, user_id, integration_id),
    )
    .await
    .map_err(|e| format!("Failed to update integration status: {e}"))?;

    // Fetch assistant name for notification
    let assistant_name = get_assistant_name(db, user_id, assistant_id)
        .await
        .unwrap_or_else(|| "seu assistente".to_string());

    let provider_label = provider_display_name(provider);
    let channel_label = channel_display_name(channel);

    let title = format!("Conexão perdida — {assistant_name}");
    let message = format!(
        "A integração {channel_label} via {provider_label} perdeu a conexão. Acesse o painel para reconectar."
    );

    // Create in-app notification
    if let Err(e) = notification::create_notification(
        db,
        user_id,
        Some(assistant_id),
        Some(integration_id),
        "connection_lost",
        &title,
        &message,
    )
    .await
    {
        tracing::warn!("Failed to create notification: {e}");
    }

    // Fetch user email and send email notification
    if let Some(user_email) = get_user_email(db, user_id).await {
        if let Err(e) = email::send_connection_lost_email(
            config,
            &user_email,
            &assistant_name,
            &channel_label,
            &provider_label,
        )
        .await
        {
            tracing::warn!("Failed to send connection lost email to {user_email}: {e}");
        }
    }

    tracing::info!(
        "Integration {integration_id} for user {user_id} marked as disconnected (health check)"
    );

    Ok(())
}

async fn get_user_email(db: &DbSession, user_id: &Uuid) -> Option<String> {
    let result = db
        .query_unpaged(
            "SELECT email FROM inertial_eclipse.users WHERE id = ?",
            (user_id,),
        )
        .await
        .ok()?;
    result
        .single_row_typed::<(String,)>()
        .ok()
        .map(|(email,)| email)
}

async fn get_assistant_name(db: &DbSession, user_id: &Uuid, assistant_id: &Uuid) -> Option<String> {
    let result = db
        .query_unpaged(
            "SELECT name FROM inertial_eclipse.assistants WHERE user_id = ? AND id = ?",
            (user_id, assistant_id),
        )
        .await
        .ok()?;
    result
        .single_row_typed::<(String,)>()
        .ok()
        .map(|(name,)| name)
}

fn provider_display_name(provider: &str) -> String {
    match provider {
        "baileys" => "Baileys".to_string(),
        "meta_official" => "API Oficial Meta".to_string(),
        "telegram" => "Telegram".to_string(),
        other => other.to_string(),
    }
}

fn channel_display_name(channel: &str) -> String {
    match channel {
        "whatsapp" => "WhatsApp".to_string(),
        "telegram" => "Telegram".to_string(),
        other => other.to_string(),
    }
}
