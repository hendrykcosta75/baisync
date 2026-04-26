//! Idempotent backfill for `assistant_integrations.config_phone_fp` and
//! `config_token_fp`.
//!
//! After migration 109 adds the two `blob` columns, every existing row has
//! `NULL` fingerprints and is therefore unreachable by the rewritten lookup
//! queries (`find_integration_by_phone`, `find_integration_by_token`).
//!
//! This binary scans every row, decrypts the AES-GCM ciphertext stored in
//! `config_phone_number` / `config_token`, computes the deterministic
//! HMAC-SHA256 fingerprint via `services::lookup_fp`, and writes it back.
//!
//! USAGE
//! ─────
//!     CASSANDRA_HOST=... ENCRYPTION_KEY=... cargo run --bin backfill_integration_fp
//!       # dry-run by default
//!
//!     CASSANDRA_HOST=... ENCRYPTION_KEY=... cargo run --bin backfill_integration_fp -- --apply
//!       # actually writes
//!
//! IDEMPOTENCE
//! ───────────
//! HMAC-SHA256 with a fixed key is deterministic, so re-running with `--apply`
//! overwrites each row with the same value it already holds — safe. Rows whose
//! source columns are NULL/empty get NULL fingerprints (and are correctly
//! unreachable by indexed lookup, which is the desired behavior).

use scylla::{Session, SessionBuilder};
use std::process::ExitCode;
use uuid::Uuid;

use backend::services::encryption::EncryptionService;
use backend::services::lookup_fp;

const KEYSPACE: &str = "inertial_eclipse";

struct Stats {
    scanned: u64,
    phone_fp_written: u64,
    token_fp_written: u64,
    skipped_no_secrets: u64,
    decrypt_failures: u64,
    write_failures: u64,
}

impl Stats {
    fn new() -> Self {
        Self {
            scanned: 0,
            phone_fp_written: 0,
            token_fp_written: 0,
            skipped_no_secrets: 0,
            decrypt_failures: 0,
            write_failures: 0,
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
            eprintln!("[backfill_fp] ERROR: failed to initialize encryption service: {e}");
            return ExitCode::from(2);
        }
    };

    let session: Session = match SessionBuilder::new().known_node(&host).build().await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[backfill_fp] ERROR: failed to connect to Cassandra at {host}: {e}");
            return ExitCode::from(1);
        }
    };

    println!(
        "[backfill_fp] mode = {} | host = {} | keyspace = {}",
        if dry_run { "DRY-RUN" } else { "APPLY" },
        host,
        KEYSPACE
    );
    if dry_run {
        println!("[backfill_fp] Dry-run mode: scanning rows, NOT writing. Re-run with --apply to commit.");
    }

    let stats = run(&session, &encryption, dry_run).await;

    println!("──────────────────────────────────────────────");
    println!(
        "[backfill_fp] scanned={} phone_fp_written={} token_fp_written={} skipped_no_secrets={} decrypt_failures={} write_failures={}",
        stats.scanned,
        stats.phone_fp_written,
        stats.token_fp_written,
        stats.skipped_no_secrets,
        stats.decrypt_failures,
        stats.write_failures
    );
    if dry_run {
        println!("[backfill_fp] Dry-run complete. Re-run with --apply to commit.");
    }

    if stats.write_failures > 0 {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    }
}

async fn run(session: &Session, encryption: &EncryptionService, dry_run: bool) -> Stats {
    let mut stats = Stats::new();

    let select = format!(
        "SELECT assistant_id, user_id, id, config_phone_number, config_token FROM {KEYSPACE}.assistant_integrations"
    );

    let result = match session.query_unpaged(select, &[]).await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[backfill_fp] SELECT failed: {e}");
            stats.write_failures += 1;
            return stats;
        }
    };

    let rows = match result.into_rows_result() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[backfill_fp] rows_result failed: {e}");
            stats.write_failures += 1;
            return stats;
        }
    };

    type Row = (Uuid, Uuid, Uuid, Option<String>, Option<String>);
    let iter = match rows.rows::<Row>() {
        Ok(it) => it,
        Err(e) => {
            eprintln!("[backfill_fp] row iter failed: {e}");
            stats.write_failures += 1;
            return stats;
        }
    };

    for row in iter {
        stats.scanned += 1;
        let (assistant_id, user_id, id, phone_enc, token_enc) = match row {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[backfill_fp] row parse error: {e}");
                stats.write_failures += 1;
                continue;
            }
        };

        let phone_plain = decode_secret(encryption, phone_enc.as_deref());
        let token_plain = decode_secret(encryption, token_enc.as_deref());

        if phone_plain.is_none() && token_plain.is_none() {
            stats.skipped_no_secrets += 1;
            continue;
        }

        let phone_fp_value = phone_plain
            .as_deref()
            .and_then(|p| lookup_fp::phone_fp(encryption, p));
        let token_fp_value = token_plain
            .as_deref()
            .and_then(|t| lookup_fp::token_fp(encryption, t));

        if phone_plain.is_some() && phone_fp_value.is_none() {
            // Decrypted to empty / non-numeric value — fingerprint would be
            // None, so don't bother writing. Count as a soft decrypt issue.
            stats.decrypt_failures += 1;
        }
        if token_plain.is_some() && token_fp_value.is_none() {
            stats.decrypt_failures += 1;
        }

        if dry_run {
            println!(
                "[backfill_fp] WOULD set fp on user_id={user_id} assistant_id={assistant_id} id={id} phone_fp={} token_fp={}",
                phone_fp_value.is_some(),
                token_fp_value.is_some()
            );
            if phone_fp_value.is_some() {
                stats.phone_fp_written += 1;
            }
            if token_fp_value.is_some() {
                stats.token_fp_written += 1;
            }
            continue;
        }

        let update = format!(
            "UPDATE {KEYSPACE}.assistant_integrations SET config_phone_fp = ?, config_token_fp = ? WHERE assistant_id = ? AND user_id = ? AND id = ?"
        );

        match session
            .query_unpaged(
                update,
                (
                    &phone_fp_value,
                    &token_fp_value,
                    &assistant_id,
                    &user_id,
                    &id,
                ),
            )
            .await
        {
            Ok(_) => {
                if phone_fp_value.is_some() {
                    stats.phone_fp_written += 1;
                }
                if token_fp_value.is_some() {
                    stats.token_fp_written += 1;
                }
                println!(
                    "[backfill_fp] WROTE fp on user_id={user_id} assistant_id={assistant_id} id={id}"
                );
            }
            Err(e) => {
                eprintln!(
                    "[backfill_fp] UPDATE failed user_id={user_id} assistant_id={assistant_id} id={id}: {e}"
                );
                stats.write_failures += 1;
            }
        }
    }

    stats
}

/// Try to decrypt a stored secret. Returns the plaintext if decryption
/// succeeds, or the value as-is if it appears to be legacy plaintext (so
/// fingerprints get computed even on rows the encrypt_legacy backfill
/// hasn't reached). Returns None on NULL/empty.
fn decode_secret(encryption: &EncryptionService, value: Option<&str>) -> Option<String> {
    let v = value?;
    if v.is_empty() {
        return None;
    }
    Some(encryption.try_decrypt_or_passthrough(v))
}
