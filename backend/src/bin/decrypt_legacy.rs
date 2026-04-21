//! EMERGENCY REVERSAL of `encrypt_legacy` backfill.
//!
//! The S0 backfill (in `encrypt_legacy.rs`) encrypted sensitive columns in
//! `assistant_integrations` and `users`. AES-GCM with a random nonce is
//! non-deterministic — so the existing `find_integration_by_phone` query
//! (`WHERE config_phone_number = ?`) stopped matching after encryption. The
//! fix for lookup-by-ciphertext is a deterministic HMAC fingerprint column,
//! which is not yet implemented (see `docs/harness/security-debt.md:26`).
//!
//! This binary undoes the backfill: any column currently holding ciphertext
//! is decrypted and rewritten in plaintext. Idempotent — a value that fails
//! to decrypt is assumed already plaintext and left alone.
//!
//! USAGE
//! ─────
//!   CASSANDRA_HOST=... ENCRYPTION_KEY=... cargo run --bin decrypt_legacy
//!     # dry-run by default
//!   CASSANDRA_HOST=... ENCRYPTION_KEY=... cargo run --bin decrypt_legacy -- --apply
//!
//! After running this, equality queries (`WHERE config_phone_number = ?`)
//! work again; security falls back to the pre-S0 state. Re-run
//! `encrypt_legacy` ONLY after fingerprint HMAC lookup is implemented.

use scylla::{Session, SessionBuilder};
use std::process::ExitCode;
use uuid::Uuid;

use backend::services::encryption::EncryptionService;

const KEYSPACE: &str = "inertial_eclipse";

// Scope: ONLY the `assistant_integrations` columns that participate in
// equality lookups (`WHERE col = ?`). The `users` legacy api_key_* columns
// are NOT equality-queried anywhere in the backend (confirmed by grep over
// `WHERE api_key_*`), so they stay encrypted — `try_decrypt_or_passthrough`
// in `services/workspace.rs` keeps reads working regardless of state.
const INTEGRATION_COLUMNS: &[(&str, &str)] = &[
    ("assistant_integrations", "config_token"),
    ("assistant_integrations", "config_phone_number"),
    ("assistant_integrations", "config_chatwoot_url"),
    ("assistant_integrations", "config_webhook_verify_token"),
];

const USER_COLUMNS: &[(&str, &str)] = &[];

struct Stats {
    scanned: u64,
    skipped_null: u64,
    skipped_plaintext: u64,
    decrypted: u64,
    failed: u64,
}

impl Stats {
    fn new() -> Self {
        Self {
            scanned: 0,
            skipped_null: 0,
            skipped_plaintext: 0,
            decrypted: 0,
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

    let host = std::env::var("CASSANDRA_HOST").unwrap_or_else(|_| "127.0.0.1:9042".into());

    let encryption = match EncryptionService::from_env() {
        Ok(e) => e,
        Err(e) => {
            eprintln!("[decrypt_legacy] ERROR init encryption: {e}");
            return ExitCode::from(2);
        }
    };

    let session: Session = match SessionBuilder::new().known_node(&host).build().await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[decrypt_legacy] ERROR connect to Cassandra: {e}");
            return ExitCode::from(1);
        }
    };

    println!(
        "[decrypt_legacy] mode = {} | host = {}",
        if dry_run { "DRY-RUN" } else { "APPLY" },
        host
    );

    let mut total = Stats::new();

    for (table, column) in INTEGRATION_COLUMNS {
        let s = process_integration(&session, &encryption, table, column, dry_run).await;
        print_stats(table, column, &s);
        total = merge(total, s);
    }
    for (table, column) in USER_COLUMNS {
        let s = process_user(&session, &encryption, table, column, dry_run).await;
        print_stats(table, column, &s);
        total = merge(total, s);
    }

    println!("──────────────────────────────────────────────");
    println!(
        "[decrypt_legacy] TOTAL scanned={} skipped_null={} skipped_plaintext={} decrypted={} failed={}",
        total.scanned, total.skipped_null, total.skipped_plaintext, total.decrypted, total.failed
    );
    if dry_run {
        println!("[decrypt_legacy] Dry-run. Re-run with --apply to commit.");
    }

    if total.failed > 0 {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    }
}

fn merge(mut a: Stats, b: Stats) -> Stats {
    a.scanned += b.scanned;
    a.skipped_null += b.skipped_null;
    a.skipped_plaintext += b.skipped_plaintext;
    a.decrypted += b.decrypted;
    a.failed += b.failed;
    a
}

fn print_stats(table: &str, column: &str, s: &Stats) {
    println!(
        "  {}.{}: scanned={} skipped_null={} skipped_plaintext={} decrypted={} failed={}",
        table, column, s.scanned, s.skipped_null, s.skipped_plaintext, s.decrypted, s.failed
    );
}

async fn process_integration(
    session: &Session,
    encryption: &EncryptionService,
    table: &str,
    column: &str,
    dry_run: bool,
) -> Stats {
    let mut stats = Stats::new();
    let q = format!(
        "SELECT assistant_id, user_id, id, {col} FROM {ks}.{table}",
        col = column, ks = KEYSPACE, table = table
    );
    let r = match session.query_unpaged(q, &[]).await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[decrypt_legacy] SELECT failed: {e}");
            stats.failed += 1;
            return stats;
        }
    };
    let rows = match r.into_rows_result() {
        Ok(r) => r,
        Err(e) => { eprintln!("[decrypt_legacy] rows: {e}"); stats.failed += 1; return stats; }
    };
    let iter = match rows.rows::<(Uuid, Uuid, Uuid, Option<String>)>() {
        Ok(it) => it,
        Err(e) => { eprintln!("[decrypt_legacy] iter: {e}"); stats.failed += 1; return stats; }
    };
    for row in iter {
        stats.scanned += 1;
        let (aid, uid, id, val) = match row {
            Ok(r) => r,
            Err(e) => { eprintln!("[decrypt_legacy] parse: {e}"); stats.failed += 1; continue; }
        };
        let plaintext = match val {
            None => { stats.skipped_null += 1; continue; }
            Some(v) if v.is_empty() => { stats.skipped_null += 1; continue; }
            Some(v) => match encryption.decrypt(&v) {
                Ok(pt) => pt,
                Err(_) => { stats.skipped_plaintext += 1; continue; }
            },
        };
        if dry_run {
            println!("[decrypt_legacy] WOULD decrypt {}.{}: user_id={} id={}", table, column, uid, id);
            stats.decrypted += 1;
            continue;
        }
        let uq = format!(
            "UPDATE {ks}.{table} SET {col} = ? WHERE assistant_id = ? AND user_id = ? AND id = ?",
            ks = KEYSPACE, table = table, col = column
        );
        match session.query_unpaged(uq, (plaintext, aid, uid, id)).await {
            Ok(_) => {
                println!("[decrypt_legacy] DECRYPTED {}.{}: user_id={} id={}", table, column, uid, id);
                stats.decrypted += 1;
            }
            Err(e) => {
                eprintln!("[decrypt_legacy] UPDATE failed {}.{} id={}: {}", table, column, id, e);
                stats.failed += 1;
            }
        }
    }
    stats
}

async fn process_user(
    session: &Session,
    encryption: &EncryptionService,
    table: &str,
    column: &str,
    dry_run: bool,
) -> Stats {
    let mut stats = Stats::new();
    let q = format!(
        "SELECT id, {col} FROM {ks}.{table}",
        col = column, ks = KEYSPACE, table = table
    );
    let r = match session.query_unpaged(q, &[]).await {
        Ok(r) => r,
        Err(e) => { eprintln!("[decrypt_legacy] SELECT: {e}"); stats.failed += 1; return stats; }
    };
    let rows = match r.into_rows_result() {
        Ok(r) => r,
        Err(e) => { eprintln!("[decrypt_legacy] rows: {e}"); stats.failed += 1; return stats; }
    };
    let iter = match rows.rows::<(Uuid, Option<String>)>() {
        Ok(it) => it,
        Err(e) => { eprintln!("[decrypt_legacy] iter: {e}"); stats.failed += 1; return stats; }
    };
    for row in iter {
        stats.scanned += 1;
        let (id, val) = match row {
            Ok(r) => r,
            Err(e) => { eprintln!("[decrypt_legacy] parse: {e}"); stats.failed += 1; continue; }
        };
        let plaintext = match val {
            None => { stats.skipped_null += 1; continue; }
            Some(v) if v.is_empty() => { stats.skipped_null += 1; continue; }
            Some(v) => match encryption.decrypt(&v) {
                Ok(pt) => pt,
                Err(_) => { stats.skipped_plaintext += 1; continue; }
            },
        };
        if dry_run {
            println!("[decrypt_legacy] WOULD decrypt {}.{}: id={}", table, column, id);
            stats.decrypted += 1;
            continue;
        }
        let uq = format!(
            "UPDATE {ks}.{table} SET {col} = ? WHERE id = ?",
            ks = KEYSPACE, table = table, col = column
        );
        match session.query_unpaged(uq, (plaintext, id)).await {
            Ok(_) => {
                println!("[decrypt_legacy] DECRYPTED {}.{}: id={}", table, column, id);
                stats.decrypted += 1;
            }
            Err(e) => {
                eprintln!("[decrypt_legacy] UPDATE failed {}.{} id={}: {}", table, column, id, e);
                stats.failed += 1;
            }
        }
    }
    stats
}
