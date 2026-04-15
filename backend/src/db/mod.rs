pub mod migrations;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use scylla::query::Query;
use scylla::serialize::row::SerializeRow;
use scylla::statement::PagingState;
use scylla::transport::errors::QueryError;
use scylla::transport::query_result::QueryResult;
use scylla::{Session, SessionBuilder};
use std::ops::ControlFlow;
use std::sync::Arc;

pub type DbSession = Arc<Session>;

pub async fn connect(database_url: &str) -> DbSession {
    // Phase 1: bare connection (no keyspace) to run migrations
    let bare = SessionBuilder::new()
        .known_node(database_url)
        .build()
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
        .build()
        .await
        .expect("Failed to connect to Cassandra with keyspace");

    Arc::new(session)
}

/// Execute a single-page query with optional cursor-based pagination.
/// Returns the query result and an optional base64-encoded cursor for the next page.
pub async fn query_paged(
    session: &Session,
    cql: &str,
    values: impl SerializeRow,
    page_size: i32,
    cursor: Option<&str>,
) -> Result<(QueryResult, Option<String>), QueryError> {
    let mut query = Query::new(cql);
    query.set_page_size(page_size);

    let paging_state = match cursor {
        Some(cursor_b64) => match B64.decode(cursor_b64) {
            Ok(bytes) => PagingState::new_from_raw_bytes(bytes),
            Err(_) => PagingState::start(),
        },
        None => PagingState::start(),
    };

    let (result, paging_response) = session
        .query_single_page(query, values, paging_state)
        .await?;

    let next_cursor = match paging_response.into_paging_control_flow() {
        ControlFlow::Continue(next_state) => {
            next_state.as_bytes_slice().map(|bytes| B64.encode(bytes))
        }
        ControlFlow::Break(()) => None,
    };

    Ok((result, next_cursor))
}
