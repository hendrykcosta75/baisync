mod config;
mod db;
mod errors;
mod handlers;
mod middleware;
mod models;
mod services;

use axum::extract::DefaultBodyLimit;
use axum::middleware as axum_mw;
use axum::routing::{delete, get, patch, post, put};
use axum::{Extension, Router};
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

use crate::config::Config;
use crate::services::connection_state::ConnectionStateStore;
use crate::services::encryption::EncryptionService;

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .json()
        .init();

    let config = Config::from_env();
    let db = db::connect(&config.database_url).await;
    let encryption = EncryptionService::new(&config.encryption_key)
        .expect("Failed to initialize encryption service");

    let conn_store = ConnectionStateStore::new();
    let jwt_secret = config.jwt_secret.clone();

    // Spawn background health check task
    {
        let db_hc = db.clone();
        let config_hc = config.clone();
        tokio::spawn(async move {
            services::health_check::run(db_hc, config_hc).await;
        });
    }

    // Public routes (no auth)
    let public_routes = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/api/auth/register", post(handlers::auth::register))
        .route("/api/auth/login", post(handlers::auth::login))
        .route(
            "/api/auth/forgot-password",
            post(handlers::auth::forgot_password),
        )
        .route(
            "/api/auth/reset-password",
            post(handlers::auth::reset_password),
        )
        .route(
            "/api/webhooks/baileys/{phone}",
            post(handlers::messages::webhook_baileys),
        )
        .route(
            "/api/webhooks/meta",
            get(handlers::messages::webhook_meta_verify)
                .post(handlers::messages::webhook_meta),
        )
        .route(
            "/api/webhooks/telegram/{token}",
            post(handlers::messages::webhook_telegram),
        )
;

    // Protected routes (require auth)
    let protected_routes = Router::new()
        .route("/api/auth/me", get(handlers::auth::me))
        .route("/api/auth/enable-2fa", post(handlers::auth::enable_2fa))
        .route("/api/auth/verify-2fa", post(handlers::auth::verify_2fa))
        // Assistants
        .route(
            "/api/assistants",
            get(handlers::assistants::list).post(handlers::assistants::create),
        )
        .route(
            "/api/assistants/{id}",
            get(handlers::assistants::get)
                .put(handlers::assistants::update)
                .delete(handlers::assistants::delete),
        )
        // Tools
        .route(
            "/api/tools/test-url",
            post(handlers::tools::test_url),
        )
        .route(
            "/api/assistants/{id}/tools",
            get(handlers::tools::list).post(handlers::tools::create),
        )
        .route(
            "/api/assistants/{id}/tools/{tool_id}",
            put(handlers::tools::update).delete(handlers::tools::delete),
        )
        .route(
            "/api/assistants/{id}/tools/{tool_id}/calls",
            get(handlers::tools::list_calls),
        )
        // Files (Knowledge Base)
        .route(
            "/api/assistants/{id}/files",
            get(handlers::files::list)
                .post(handlers::files::upload)
                .layer(DefaultBodyLimit::max(11 * 1024 * 1024)),
        )
        .route(
            "/api/assistants/{id}/files/{file_id}",
            delete(handlers::files::delete),
        )
        // Integrations
        .route(
            "/api/assistants/{id}/integrations",
            get(handlers::integrations::list).post(handlers::integrations::create),
        )
        .route(
            "/api/assistants/{id}/integrations/{int_id}",
            put(handlers::integrations::update).delete(handlers::integrations::delete),
        )
        .route(
            "/api/assistants/{id}/integrations/{int_id}/connect",
            post(handlers::integrations::connect),
        )
        .route(
            "/api/assistants/{id}/integrations/{int_id}/status",
            get(handlers::integrations::status),
        )
        .route(
            "/api/assistants/{id}/integrations/{int_id}/disconnect",
            post(handlers::integrations::disconnect),
        )
        // Messaging config
        .route(
            "/api/config/messaging",
            get(handlers::integrations::messaging_config),
        )
        // Models
        .route(
            "/api/models/{provider}",
            get(handlers::models::list_models),
        )
        // User profile
        .route(
            "/api/user/profile",
            put(handlers::auth::update_profile),
        )
        .route(
            "/api/user/change-password",
            post(handlers::auth::change_password),
        )
        .route(
            "/api/user/account",
            delete(handlers::auth::delete_account),
        )
        // API Keys
        .route(
            "/api/user/api-keys",
            get(handlers::api_keys::get_keys).put(handlers::api_keys::update_keys),
        )
        // ElevenLabs
        .route(
            "/api/elevenlabs/voices",
            get(handlers::elevenlabs::list_voices),
        )
        .route(
            "/api/elevenlabs/preview",
            post(handlers::elevenlabs::preview_voice),
        )
        // OpenAI Audio
        .route(
            "/api/openai/voices",
            get(handlers::openai_audio::list_voices),
        )
        .route(
            "/api/openai/preview",
            post(handlers::openai_audio::preview_voice),
        )
        // Usage & Activity stats
        .route("/api/user/usage", get(handlers::stats::user_usage))
        .route("/api/user/activity", get(handlers::stats::user_activity))
        .route(
            "/api/assistants/{id}/stats",
            get(handlers::stats::assistant_stats),
        )
        .route(
            "/api/assistants/{id}/logs",
            get(handlers::stats::assistant_logs),
        )
        // Sharing / access control
        .route(
            "/api/assistants/{id}/share-token",
            get(handlers::sharing::get_share_token)
                .post(handlers::sharing::create_share_token)
                .delete(handlers::sharing::revoke_share_token),
        )
        .route(
            "/api/shared/{token}",
            get(handlers::sharing::get_shared_assistant),
        )
        // Accepted shares
        .route(
            "/api/shares/accept",
            post(handlers::sharing::accept_share),
        )
        .route(
            "/api/shares/accepted",
            get(handlers::sharing::list_accepted_shares),
        )
        .route(
            "/api/shares/accepted/{assistant_id}",
            delete(handlers::sharing::remove_accepted_share),
        )
        // Access control tokens
        .route(
            "/api/assistants/{id}/token-users",
            get(handlers::access_tokens::token_users),
        )
        .route(
            "/api/assistants/{id}/access-tokens",
            get(handlers::access_tokens::list_tokens)
                .post(handlers::access_tokens::create_token),
        )
        .route(
            "/api/assistants/{id}/access-tokens/{token_id}",
            delete(handlers::access_tokens::delete_token),
        )
        .route(
            "/api/assistants/{id}/access-tokens/{token_id}/revoke",
            patch(handlers::access_tokens::revoke_token),
        )
        // Notifications
        .route(
            "/api/notifications",
            get(handlers::notifications::list).delete(handlers::notifications::delete_all),
        )
        .route(
            "/api/notifications/read-all",
            post(handlers::notifications::mark_all_read),
        )
        .route(
            "/api/notifications/{id}/read",
            post(handlers::notifications::mark_read),
        )
        .route(
            "/api/notifications/{id}",
            delete(handlers::notifications::delete),
        )
        // Appointments / Calendar
        .route(
            "/api/appointments",
            get(handlers::appointments::list).post(handlers::appointments::create),
        )
        .route(
            "/api/appointments/{id}",
            get(handlers::appointments::get)
                .put(handlers::appointments::update)
                .delete(handlers::appointments::delete),
        )
        .route(
            "/api/assistants/{id}/availability",
            get(handlers::appointments::get_availability)
                .put(handlers::appointments::upsert_availability),
        )
        .route(
            "/api/assistants/{id}/availability/slots",
            get(handlers::appointments::available_slots),
        )
        // Test Agent
        .route(
            "/api/test-agent/chat",
            post(handlers::test_agent::chat),
        )
        .route(
            "/api/test-agent/generate-prompt",
            post(handlers::test_agent::generate_prompt),
        )
        .route(
            "/api/test-agent/evaluate",
            post(handlers::test_agent::evaluate),
        )
        // Playground chat
        .route(
            "/api/assistants/{id}/chat",
            post(handlers::messages::playground_chat),
        )
        // Conversations & Messages
        .route(
            "/api/assistants/{id}/conversations",
            get(handlers::messages::list_conversations),
        )
        .route(
            "/api/assistants/{id}/conversations/{conv_id}",
            delete(handlers::messages::delete_conversation)
                .patch(handlers::messages::toggle_ai),
        )
        .route(
            "/api/assistants/{id}/conversations/{conv_id}/messages",
            get(handlers::messages::list_messages).post(handlers::messages::send_message),
        )
        .route(
            "/api/assistants/{id}/conversations/{conv_id}/summary",
            post(handlers::messages::summarize_conversation),
        )
        .layer(axum_mw::from_fn(middleware::auth::auth_middleware));

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .merge(public_routes)
        .merge(protected_routes)
        .layer(Extension(db))
        .layer(Extension(config.clone()))
        .layer(Extension(encryption))
        .layer(Extension(conn_store))
        .layer(Extension(jwt_secret))
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3001")
        .await
        .expect("Failed to bind to port 3001");

    tracing::info!("Backend server running on port 3001");
    axum::serve(listener, app).await.expect("Server failed");
}
