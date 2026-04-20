//! Idempotent backfill binary for the S0 plaintext → ciphertext migration.
//!
//! Walks every row of every table/column pair where S0 targets the schema,
//! and rewrites any plaintext value as AES-GCM ciphertext in place.
//!
//! DESIGN GOALS
//! ────────────
//! 1. **Idempotent.** A value that is already valid ciphertext is SKIPPED
//!    (detected by a successful `decrypt()` call) — re-running is safe.
//! 2. **Reversible blast radius.** Runs default in `--dry-run` mode so the
//!    operator sees which rows WOULD change before committing writes.
//! 3. **No logging of plaintext or ciphertext.** Only row identifiers
//!    (`user_id`, `assistant_id`, `id`) and summary counts reach tracing.
//!    See invariant #4 of the S0 plan.
//! 4. **Non-destructive on partial failure.** A row write error is counted
//!    and the loop continues. Binary exits non-zero if any row failed.
//!
//! TABLES & COLUMNS
//! ────────────────
//!   assistant_integrations:
//!     - config_token
//!     - config_phone_number
//!     - config_chatwoot_url
//!     - config_webhook_verify_token
//!   users (legacy columns, successor is workspace_api_keys):
//!     - api_key_elevenlabs
//!     - api_key_mercadopago
//!     - api_key_stripe
//!     - api_key_grok
//!     - api_key_deepseek
//!
//! USAGE
//! ─────
//!     CASSANDRA_HOST=... ENCRYPTION_KEY=... cargo run --bin encrypt_legacy
//!       # dry-run by default
//!
//!     CASSANDRA_HOST=... ENCRYPTION_KEY=... cargo run --bin encrypt_legacy -- --apply
//!       # actually writes
//!
//! DANGER
//! ──────
//! Run on staging first with a cloned dataset. In production, take a snapshot
//! before `--apply`. After the backfill completes, equality queries like
//! `WHERE config_phone_number = ?` will no longer match any rows whose
//! columns were just encrypted (random nonce → non-deterministic ciphertext).
//! See the TODO S0 comments in `services/messaging.rs` and
//! `handlers/messages.rs`.

use scylla::{Session, SessionBuilder};
use std::process::ExitCode;
use uuid::Uuid;

use backend::errors::AppError;
use backend::services::encryption::EncryptionService;

const KEYSPACE: &str = "inertial_eclipse";

/// `(table, pk_cols_csv, column)`
/// `pk_cols_csv` is the ordered list of primary-key columns used to target a
/// specific row for UPDATE. Order matters — must match the table's PK.
const INTEGRATION_COLUMNS: &[(&str, &str, &str)] = &[
    (
        "assistant_integrations",
        "assistant_id, user_id, id",
        "config_token",
    ),
    (
        "assistant_integrations",
        "assistant_id, user_id, id",
        "config_phone_number",
    ),
    (
        "assistant_integrations",
        "assistant_id, user_id, id",
        "config_chatwoot_url",
    ),
    (
        "assistant_integrations",
        "assistant_id, user_id, id",
        "config_webhook_verify_token",
    ),
];

const USER_COLUMNS: &[(&str, &str, &str)] = &[
    ("users", "id", "api_key_elevenlabs"),
    ("users", "id", "api_key_mercadopago"),
    ("users", "id", "api_key_stripe"),
    ("users", "id", "api_key_grok"),
    ("users", "id", "api_key_deepseek"),
];

struct RunStats {
    total_rows_scanned: u64,
    skipped_already_ciphertext: u64,
    skipped_null_or_empty: u64,
    encrypted: u64,
    failed: u64,
}

impl RunStats {
    fn new() -> Self {
        Self {
            total_rows_scanned: 0,
            skipped_already_ciphertext: 0,
            skipped_null_or_empty: 0,
            encrypted: 0,
            failed: 0,
        }
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    let _ = dotenvy::dotenv();
    let _ = dotenvy::from_filename("../.env");

    let apply = std::env::args().any(|a| a == "--apply");
    let dry_run = !apply;

    let host =
        std::env::var("CASSANDRA_HOST").unwrap_or_else(|_| "127.0.0.1:9042".into());
    let encryption_key = match std::env::var("ENCRYPTION_KEY") {
        Ok(k) => k,
        Err(_) => {
            eprintln!("[encrypt_legacy] ERROR: ENCRYPTION_KEY env var is required.");
            return ExitCode::from(2);
        }
    };

    let encryption = match EncryptionService::new(&encryption_key) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("[encrypt_legacy] ERROR: invalid ENCRYPTION_KEY: {e}");
            return ExitCode::from(2);
        }
    };

    let session: Session = match SessionBuilder::new()
        .known_node(&host)
        .build()
        .await
    {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[encrypt_legacy] ERROR: failed to connect to Cassandra at {host}: {e}");
            return ExitCode::from(1);
        }
    };

    println!(
        "[encrypt_legacy] mode = {} | host = {} | keyspace = {}",
        if dry_run { "DRY-RUN" } else { "APPLY" },
        host,
        KEYSPACE
    );
    if dry_run {
        println!("[encrypt_legacy] Dry-run mode: scanning rows, NOT writing. Re-run with --apply to commit changes.");
    }

    let mut total = RunStats::new();

    // ── Stage 1: assistant_integrations ──────────────────────────────────
    for (table, pk_csv, column) in INTEGRATION_COLUMNS {
        println!(
            "[encrypt_legacy] Stage: {}.{}  (pk: {})",
            table, column, pk_csv
        );
        let stats = process_integration_column(
            &session,
            &encryption,
            table,
            pk_csv,
            column,
            dry_run,
        )
        .await;
        print_stage_stats(table, column, &stats);
        total = merge(total, stats);
    }

    // ── Stage 2: users ───────────────────────────────────────────────────
    for (table, pk_csv, column) in USER_COLUMNS {
        println!(
            "[encrypt_legacy] Stage: {}.{}  (pk: {})",
            table, column, pk_csv
        );
        let stats = process_user_column(
            &session,
            &encryption,
            table,
            pk_csv,
            column,
            dry_run,
        )
        .await;
        print_stage_stats(table, column, &stats);
        total = merge(total, stats);
    }

    println!("──────────────────────────────────────────────");
    println!(
        "[encrypt_legacy] TOTAL scanned={} skipped_ciphertext={} skipped_null={} encrypted={} failed={}",
        total.total_rows_scanned,
        total.skipped_already_ciphertext,
        total.skipped_null_or_empty,
        total.encrypted,
        total.failed
    );
    if dry_run {
        println!("[encrypt_legacy] Dry-run complete. Re-run with --apply to commit.");
    }

    if total.failed > 0 {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    }
}

fn merge(mut a: RunStats, b: RunStats) -> RunStats {
    a.total_rows_scanned += b.total_rows_scanned;
    a.skipped_already_ciphertext += b.skipped_already_ciphertext;
    a.skipped_null_or_empty += b.skipped_null_or_empty;
    a.encrypted += b.encrypted;
    a.failed += b.failed;
    a
}

fn print_stage_stats(table: &str, column: &str, s: &RunStats) {
    println!(
        "  {}.{}: scanned={} skipped_ciphertext={} skipped_null={} encrypted={} failed={}",
        table, column, s.total_rows_scanned, s.skipped_already_ciphertext, s.skipped_null_or_empty, s.encrypted, s.failed
    );
}

/// Process a single `(assistant_id, user_id, id)`-keyed column in
/// `assistant_integrations`.
async fn process_integration_column(
    session: &Session,
    encryption: &EncryptionService,
    table: &str,
    _pk_csv: &str,
    column: &str,
    dry_run: bool,
) -> RunStats {
    let mut stats = RunStats::new();

    let select_q = format!(
        "SELECT assistant_id, user_id, id, {col} FROM {ks}.{table}",
        col = column,
        ks = KEYSPACE,
        table = table,
    );

    let result = match session.query_unpaged(select_q, &[]).await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[encrypt_legacy] SELECT failed for {}.{}: {}", table, column, e);
            stats.failed += 1;
            return stats;
        }
    };

    let rows = match result.into_rows_result() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[encrypt_legacy] rows_result failed for {}.{}: {}", table, column, e);
            stats.failed += 1;
            return stats;
        }
    };

    let iter = match rows.rows::<(Uuid, Uuid, Uuid, Option<String>)>() {
        Ok(it) => it,
        Err(e) => {
            eprintln!("[encrypt_legacy] row iter failed for {}.{}: {}", table, column, e);
            stats.failed += 1;
            return stats;
        }
    };

    for row in iter {
        stats.total_rows_scanned += 1;
        let (assistant_id, user_id, id, value) = match row {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[encrypt_legacy] row parse error on {}.{}: {}", table, column, e);
                stats.failed += 1;
                continue;
            }
        };

        let plaintext = match classify(encryption, value) {
            Classification::NullOrEmpty => {
                stats.skipped_null_or_empty += 1;
                continue;
            }
            Classification::AlreadyCiphertext => {
                stats.skipped_already_ciphertext += 1;
                continue;
            }
            Classification::Plaintext(p) => p,
        };

        match maybe_update_integration(
            session,
            encryption,
            table,
            column,
            &assistant_id,
            &user_id,
            &id,
            &plaintext,
            dry_run,
        )
        .await
        {
            Ok(()) => stats.encrypted += 1,
            Err(e) => {
                eprintln!(
                    "[encrypt_legacy] UPDATE failed {}.{} user_id={} assistant_id={} id={}: {}",
                    table, column, user_id, assistant_id, id, e
                );
                stats.failed += 1;
            }
        }
    }

    stats
}

/// Process a single `id`-keyed column in `users`.
async fn process_user_column(
    session: &Session,
    encryption: &EncryptionService,
    table: &str,
    _pk_csv: &str,
    column: &str,
    dry_run: bool,
) -> RunStats {
    let mut stats = RunStats::new();

    let select_q = format!(
        "SELECT id, {col} FROM {ks}.{table}",
        col = column,
        ks = KEYSPACE,
        table = table,
    );

    let result = match session.query_unpaged(select_q, &[]).await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[encrypt_legacy] SELECT failed for {}.{}: {}", table, column, e);
            stats.failed += 1;
            return stats;
        }
    };

    let rows = match result.into_rows_result() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[encrypt_legacy] rows_result failed for {}.{}: {}", table, column, e);
            stats.failed += 1;
            return stats;
        }
    };

    let iter = match rows.rows::<(Uuid, Option<String>)>() {
        Ok(it) => it,
        Err(e) => {
            eprintln!("[encrypt_legacy] row iter failed for {}.{}: {}", table, column, e);
            stats.failed += 1;
            return stats;
        }
    };

    for row in iter {
        stats.total_rows_scanned += 1;
        let (id, value) = match row {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[encrypt_legacy] row parse error on {}.{}: {}", table, column, e);
                stats.failed += 1;
                continue;
            }
        };

        let plaintext = match classify(encryption, value) {
            Classification::NullOrEmpty => {
                stats.skipped_null_or_empty += 1;
                continue;
            }
            Classification::AlreadyCiphertext => {
                stats.skipped_already_ciphertext += 1;
                continue;
            }
            Classification::Plaintext(p) => p,
        };

        match maybe_update_user(session, encryption, table, column, &id, &plaintext, dry_run)
            .await
        {
            Ok(()) => stats.encrypted += 1,
            Err(e) => {
                eprintln!(
                    "[encrypt_legacy] UPDATE failed {}.{} id={}: {}",
                    table, column, id, e
                );
                stats.failed += 1;
            }
        }
    }

    stats
}

enum Classification {
    NullOrEmpty,
    AlreadyCiphertext,
    Plaintext(String),
}

/// Classify a DB value as null/empty, already-ciphertext, or legacy plaintext.
/// If `decrypt()` succeeds, the value is already AES-GCM ciphertext and must
/// not be re-encrypted (to preserve idempotence).
fn classify(encryption: &EncryptionService, value: Option<String>) -> Classification {
    match value {
        None => Classification::NullOrEmpty,
        Some(v) if v.is_empty() => Classification::NullOrEmpty,
        Some(v) => match encryption.decrypt(&v) {
            Ok(_) => Classification::AlreadyCiphertext,
            Err(_) => Classification::Plaintext(v),
        },
    }
}

#[allow(clippy::too_many_arguments)]
async fn maybe_update_integration(
    session: &Session,
    encryption: &EncryptionService,
    table: &str,
    column: &str,
    assistant_id: &Uuid,
    user_id: &Uuid,
    id: &Uuid,
    plaintext: &str,
    dry_run: bool,
) -> Result<(), AppError> {
    let ciphertext = encryption.encrypt(plaintext)?;

    if dry_run {
        // Log only row identifiers, never the value (plaintext or ciphertext).
        println!(
            "[encrypt_legacy] WOULD encrypt {}.{}: user_id={} assistant_id={} id={}",
            table, column, user_id, assistant_id, id
        );
        return Ok(());
    }

    let update_q = format!(
        "UPDATE {ks}.{table} SET {col} = ? WHERE assistant_id = ? AND user_id = ? AND id = ?",
        ks = KEYSPACE,
        table = table,
        col = column,
    );

    session
        .query_unpaged(update_q, (ciphertext, assistant_id, user_id, id))
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    println!(
        "[encrypt_legacy] ENCRYPTED {}.{}: user_id={} assistant_id={} id={}",
        table, column, user_id, assistant_id, id
    );
    Ok(())
}

async fn maybe_update_user(
    session: &Session,
    encryption: &EncryptionService,
    table: &str,
    column: &str,
    id: &Uuid,
    plaintext: &str,
    dry_run: bool,
) -> Result<(), AppError> {
    let ciphertext = encryption.encrypt(plaintext)?;

    if dry_run {
        println!(
            "[encrypt_legacy] WOULD encrypt {}.{}: id={}",
            table, column, id
        );
        return Ok(());
    }

    let update_q = format!(
        "UPDATE {ks}.{table} SET {col} = ? WHERE id = ?",
        ks = KEYSPACE,
        table = table,
        col = column,
    );

    session
        .query_unpaged(update_q, (ciphertext, id))
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    println!("[encrypt_legacy] ENCRYPTED {}.{}: id={}", table, column, id);
    Ok(())
}
