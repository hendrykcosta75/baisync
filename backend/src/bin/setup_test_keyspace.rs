//! One-shot binary to prepare an isolated Cassandra keyspace for integration tests.
//!
//! Reads `CASSANDRA_HOST` (default: `127.0.0.1:9042`) and `CASSANDRA_KEYSPACE`
//! (default: `inertial_eclipse_test`) from the environment. Drops and recreates
//! the target keyspace, then applies every migration in `backend/migrations/`.
//!
//! Why duplicate the migration logic instead of reusing `db::migrations::run_migrations`?
//! The shared function is hardcoded to the production keyspace `inertial_eclipse`
//! (also baked into the `.cql` files as `USE inertial_eclipse;` and
//! `inertial_eclipse.tablename` qualified references). To keep test data
//! isolated without refactoring `backend/src/db/mod.rs`, we mirror the same
//! file-reading and statement-splitting logic here but textually rewrite
//! `inertial_eclipse` to the target keyspace name before executing each
//! statement. If the shared function is later parameterized by keyspace, this
//! binary should be simplified to call it directly.
//!
//! Run with:
//!     cargo run --bin setup_test_keyspace
//! or set a custom keyspace:
//!     CASSANDRA_KEYSPACE=my_test_ks cargo run --bin setup_test_keyspace

use scylla::{Session, SessionBuilder};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

const PROD_KEYSPACE: &str = "inertial_eclipse";
const MIGRATIONS_DIR_CANDIDATES: &[&str] = &["backend/migrations", "migrations", "/app/migrations"];

#[tokio::main]
async fn main() -> ExitCode {
    // Best-effort dotenv loading (both .env.test at repo root and .env).
    // Not fatal if absent — the user may have exported the vars manually.
    let _ = dotenvy::from_filename(".env.test");
    let _ = dotenvy::from_filename("../.env.test");
    let _ = dotenvy::dotenv();

    let host = std::env::var("CASSANDRA_HOST").unwrap_or_else(|_| "127.0.0.1:9042".into());
    let keyspace =
        std::env::var("CASSANDRA_KEYSPACE").unwrap_or_else(|_| "inertial_eclipse_test".into());

    if !is_safe_identifier(&keyspace) {
        eprintln!(
            "[setup_test_keyspace] Refusing unsafe keyspace name '{}' (only [A-Za-z0-9_] allowed)",
            keyspace
        );
        return ExitCode::from(2);
    }
    if keyspace == PROD_KEYSPACE {
        eprintln!(
            "[setup_test_keyspace] Refusing to operate on production keyspace '{}'. \
             Set CASSANDRA_KEYSPACE to a distinct test keyspace (e.g. inertial_eclipse_test).",
            PROD_KEYSPACE
        );
        return ExitCode::from(2);
    }

    println!(
        "[setup_test_keyspace] host={} keyspace={}",
        host, keyspace
    );

    match run(&host, &keyspace).await {
        Ok(_) => {
            println!("[setup_test_keyspace] SUCCESS keyspace '{}' ready.", keyspace);
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("[setup_test_keyspace] FAILED: {}", e);
            ExitCode::from(1)
        }
    }
}

async fn run(host: &str, keyspace: &str) -> Result<(), Box<dyn std::error::Error>> {
    let session: Session = SessionBuilder::new().known_node(host).build().await?;

    println!("[setup_test_keyspace] Dropping existing keyspace (if any)...");
    session
        .query_unpaged(format!("DROP KEYSPACE IF EXISTS {}", keyspace), &[])
        .await?;

    println!("[setup_test_keyspace] Applying migrations...");
    let dir = locate_migrations_dir()?;
    let mut entries: Vec<_> = std::fs::read_dir(&dir)?
        .filter_map(|e| e.ok())
        .filter(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            name.ends_with(".cql") && name.chars().next().is_some_and(|c| c.is_ascii_digit())
        })
        .collect();
    entries.sort_by_key(|e| e.file_name());

    println!(
        "[setup_test_keyspace] Found {} migration files in {}",
        entries.len(),
        dir.display()
    );

    for entry in entries {
        let filename = entry.file_name().to_string_lossy().to_string();
        let raw = std::fs::read_to_string(entry.path())?;
        // Textually retarget the keyspace. Safe because PROD_KEYSPACE never
        // appears in user data at this point (fresh keyspace) and migrations
        // only reference it as an identifier.
        let content = raw.replace(PROD_KEYSPACE, keyspace);
        let statements = parse_cql_statements(&content);

        for stmt in &statements {
            match session.query_unpaged(stmt.as_str(), &[]).await {
                Ok(_) => {}
                Err(e) => {
                    let msg = e.to_string();
                    if msg.contains("already exists") || msg.contains("existing column") {
                        // Tolerated — mirrors run_migrations behavior.
                        println!("[setup_test_keyspace] {}: {}", filename, msg);
                    } else {
                        return Err(
                            format!("Migration {} failed: {}", filename, msg).into()
                        );
                    }
                }
            }
        }
        println!("[setup_test_keyspace] applied: {}", filename);
    }

    Ok(())
}

fn locate_migrations_dir() -> Result<PathBuf, Box<dyn std::error::Error>> {
    for candidate in MIGRATIONS_DIR_CANDIDATES {
        let p = Path::new(candidate);
        if p.exists() {
            return Ok(p.to_path_buf());
        }
    }
    Err(format!(
        "Could not locate migrations directory. Tried: {:?}",
        MIGRATIONS_DIR_CANDIDATES
    )
    .into())
}

fn parse_cql_statements(content: &str) -> Vec<String> {
    content
        .lines()
        .filter(|line| !line.trim_start().starts_with("--"))
        .collect::<Vec<_>>()
        .join("\n")
        .split(';')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Conservative identifier check to prevent CQL injection via the keyspace env var.
fn is_safe_identifier(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 48
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}
