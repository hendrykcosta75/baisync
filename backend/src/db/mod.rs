pub mod migrations;

use scylla::{LegacySession, SessionBuilder};
use std::sync::Arc;

pub type DbSession = Arc<LegacySession>;

pub async fn connect(database_url: &str) -> DbSession {
    // Phase 1: bare connection (no keyspace) to run migrations
    let bare = SessionBuilder::new()
        .known_node(database_url)
        .build_legacy()
        .await
        .expect("Failed to connect to Cassandra");

    migrations::run_migrations(&bare)
        .await
        .expect("Failed to run migrations");

    drop(bare);

    // Phase 2: application connection with keyspace
    let session = SessionBuilder::new()
        .known_node(database_url)
        .use_keyspace("inertial_eclipse", false)
        .build_legacy()
        .await
        .expect("Failed to connect to Cassandra with keyspace");

    Arc::new(session)
}
