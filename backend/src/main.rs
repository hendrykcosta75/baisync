mod app;
mod config;
mod db;
mod errors;
mod handlers;
mod middleware;
mod models;
mod services;

use tokio::sync::mpsc;
use tracing_subscriber::EnvFilter;

use crate::config::Config;
use crate::services::connection_state::ConnectionStateStore;
use crate::services::encryption::EncryptionService;
use crate::services::llm::{
    apply_llm_call_log_event, init_llm_call_log_sender, LlmCallLogEvent,
};
use crate::services::messaging_recovery;
use crate::services::session::{
    apply_session_mutation, init_session_sender, SessionMutation,
};

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .json()
        .init();

    let config = Config::from_env();
    // T2.3 — emit a WARN at startup when auto-compaction is globally
    // disabled (COMPACTION_API_KEY unset), so operators notice inert
    // assistants. Does not fail startup.
    config.log_compaction_status();
    // W2.1 — same treatment for the post-turn evaluator: WARN when
    // both EVALUATOR_API_KEY and COMPACTION_API_KEY are unset so
    // assistants with config_enable_evaluator=true silently no-op.
    config.log_evaluator_status();
    let db = db::connect(&config.database_url).await;
    let encryption = EncryptionService::new(&config.encryption_key)
        .expect("ENCRYPTION_KEY must be 64 hex chars (32 bytes)");
    let conn_store = ConnectionStateStore::new();

    // T1.2 — spawn the llm_call_logs drain task. The hot LLM path only `send`s
    // into this channel (fire-and-forget); the drain owns all Cassandra I/O.
    // Unbounded: volume is one event pair per top-level LLM call; if this ever
    // becomes a backlog risk, swap for a bounded channel with a drop policy.
    {
        let (tx, mut rx) = mpsc::unbounded_channel::<LlmCallLogEvent>();
        init_llm_call_log_sender(tx);
        let db_drain = db.clone();
        tokio::spawn(async move {
            while let Some(event) = rx.recv().await {
                if let Err(e) = apply_llm_call_log_event(&db_drain, event).await {
                    tracing::warn!("llm_call_log write failed: {e}");
                }
            }
            tracing::info!("llm_call_log drain task exiting (sender dropped)");
        });
    }

    // T2.1 — session service drain. Mirrors the T1.2 mpsc pattern: handlers
    // enqueue `SessionMutation`s fire-and-forget; this background task owns
    // all Cassandra writes to `sessions` / `session_events` so user-facing
    // responses stay independent of database latency.
    {
        let (session_tx, mut session_rx) = mpsc::unbounded_channel::<SessionMutation>();
        init_session_sender(session_tx);
        let db_for_sessions = db.clone();
        tokio::spawn(async move {
            while let Some(m) = session_rx.recv().await {
                if let Err(e) = apply_session_mutation(&db_for_sessions, m).await {
                    tracing::error!(error = %e, "session mutation failed");
                }
            }
            tracing::info!("session mutation drain task exiting (sender dropped)");
        });
    }

    // Spawn background health check task
    {
        let db_hc = db.clone();
        let config_hc = config.clone();
        let enc_hc = encryption.clone();
        tokio::spawn(async move {
            services::health_check::run(db_hc, enc_hc, config_hc).await;
        });
    }

    // W1.3 — messaging recovery poller. Detecta linhas em `llm_call_logs`
    // com status='in_progress' há >120s (backend morreu mid-LLM) e envia
    // uma mensagem de recovery ao usuário para destravar a conversa.
    // Threshold de drift: 30s (placeholder até I1 acumular histograma p99).
    {
        let db_rec = db.clone();
        let config_rec = config.clone();
        let enc_rec = encryption.clone();
        messaging_recovery::spawn_recovery_poller(db_rec, config_rec, enc_rec);
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
