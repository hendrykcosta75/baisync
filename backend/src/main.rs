mod app;
mod config;
mod db;
mod errors;
mod handlers;
mod middleware;
mod models;
mod services;

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
        .expect("ENCRYPTION_KEY must be 64 hex chars (32 bytes)");
    let conn_store = ConnectionStateStore::new();

    // Spawn background health check task
    {
        let db_hc = db.clone();
        let config_hc = config.clone();
        let enc_hc = encryption.clone();
        tokio::spawn(async move {
            services::health_check::run(db_hc, enc_hc, config_hc).await;
        });
    }

    let event_bus = services::events::EventBus::new();
    services::events::init_global(event_bus.clone());

    let app = app::build_router(db, config, encryption, event_bus, conn_store);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3001")
        .await
        .expect("Failed to bind to port 3001");

    tracing::info!("Backend server running on port 3001");
    axum::serve(listener, app).await.expect("Server failed");
}
