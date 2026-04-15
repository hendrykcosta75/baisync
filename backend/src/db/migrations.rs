use scylla::Session;
use std::path::Path;

const MIGRATIONS_DIR_PROD: &str = "/app/migrations";
const MIGRATIONS_DIR_DEV: &str = "migrations";

pub async fn run_migrations(session: &Session) -> Result<(), Box<dyn std::error::Error>> {
    let dir = if Path::new(MIGRATIONS_DIR_PROD).exists() {
        MIGRATIONS_DIR_PROD
    } else {
        MIGRATIONS_DIR_DEV
    };

    let mut entries: Vec<_> = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .filter(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            name.ends_with(".cql") && name.chars().next().is_some_and(|c| c.is_ascii_digit())
        })
        .collect();

    entries.sort_by_key(|e| e.file_name());

    tracing::info!("Found {} CQL migrations to apply", entries.len());

    for entry in entries {
        let filename = entry.file_name().to_string_lossy().to_string();
        let content = std::fs::read_to_string(entry.path())?;
        let statements = parse_cql_statements(&content);

        for stmt in &statements {
            match session.query_unpaged(stmt.as_str(), &[]).await {
                Ok(_) => {}
                Err(e) => {
                    let err_msg = e.to_string();
                    if err_msg.contains("already exists") || err_msg.contains("existing column") {
                        tracing::warn!("{}: {}", filename, err_msg);
                    } else {
                        return Err(format!("Migration {} failed: {}", filename, err_msg).into());
                    }
                }
            }
        }
        tracing::info!("Applied migration: {}", filename);
    }

    tracing::info!("All migrations applied successfully");
    Ok(())
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
