use chrono::{DateTime, Utc};
use scylla::frame::value::CqlTimestamp;
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::services::encryption::EncryptionService;

const CHUNK_SIZE: usize = 1500;
const CHUNK_OVERLAP: usize = 200;

#[allow(dead_code)]
#[derive(Debug)]
pub struct FileRecord {
    pub assistant_id: Uuid,
    pub user_id: Uuid,
    pub id: Uuid,
    pub name: String,
    pub size: i32,
    pub mime_type: String,
    pub uploaded_at: DateTime<Utc>,
}

/// Split text into overlapping chunks
fn chunk_text(text: &str, chunk_size: usize, overlap: usize) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= chunk_size {
        return vec![text.to_string()];
    }

    let mut chunks = Vec::new();
    let mut start = 0;
    while start < chars.len() {
        let end = (start + chunk_size).min(chars.len());
        let chunk: String = chars[start..end].iter().collect();
        chunks.push(chunk);
        if end >= chars.len() {
            break;
        }
        start += chunk_size - overlap;
    }
    chunks
}

/// Extract text content from uploaded file bytes
fn extract_text(content: &[u8], mime_type: &str) -> Result<String, AppError> {
    match mime_type {
        "text/plain" | "text/markdown" | "text/csv" | "application/json" => {
            String::from_utf8(content.to_vec())
                .map_err(|e| AppError::BadRequest(format!("Invalid UTF-8: {e}")))
        }
        "application/pdf" => {
            // Simple PDF text extraction — look for text between stream markers
            // For production, use a proper PDF library
            let raw = String::from_utf8_lossy(content);
            let text: String = raw
                .lines()
                .filter(|l| !l.starts_with('%') && !l.contains("obj") && !l.contains("endobj"))
                .filter(|l| {
                    l.chars()
                        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
                        .count()
                        > l.len() / 2
                })
                .collect::<Vec<_>>()
                .join("\n");
            if text.trim().is_empty() {
                Err(AppError::BadRequest(
                    "Could not extract text from PDF. Try uploading as TXT.".into(),
                ))
            } else {
                Ok(text)
            }
        }
        _ => Err(AppError::BadRequest(format!(
            "Unsupported file type: {mime_type}"
        ))),
    }
}

/// Upload a file: extract text, chunk, store in Cassandra
pub async fn upload_file(
    db: &DbSession,
    _encryption: &EncryptionService,
    user_id: &Uuid,
    assistant_id: &Uuid,
    file_name: &str,
    file_bytes: &[u8],
    mime_type: &str,
) -> Result<FileRecord, AppError> {
    let content_text = extract_text(file_bytes, mime_type)?;
    let chunks = chunk_text(&content_text, CHUNK_SIZE, CHUNK_OVERLAP);
    let now = CqlTimestamp(Utc::now().timestamp_millis());
    let file_id = Uuid::new_v4();

    for (i, chunk) in chunks.iter().enumerate() {
        let chunk_id = if i == 0 { file_id } else { Uuid::new_v4() };
        let chunk_name = if chunks.len() == 1 {
            file_name.to_string()
        } else {
            format!("{} [part {}]", file_name, i + 1)
        };

        db.query_unpaged(
            "INSERT INTO inertial_eclipse.assistant_files (assistant_id, user_id, id, name, size, mime_type, content_text, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (assistant_id, user_id, &chunk_id, &chunk_name as &str, file_bytes.len() as i32, mime_type, chunk.as_str(), now),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }

    Ok(FileRecord {
        assistant_id: *assistant_id,
        user_id: *user_id,
        id: file_id,
        name: file_name.to_string(),
        size: file_bytes.len() as i32,
        mime_type: mime_type.to_string(),
        uploaded_at: Utc::now(),
    })
}

/// List files for an assistant (deduplicated by base name)
pub async fn list_files(
    db: &DbSession,
    assistant_id: &Uuid,
    user_id: &Uuid,
) -> Result<Vec<FileRecord>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT assistant_id, user_id, id, name, size, mime_type, uploaded_at FROM inertial_eclipse.assistant_files WHERE assistant_id = ? AND user_id = ?",
            (assistant_id, user_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut files = Vec::new();
    let mut seen_names = std::collections::HashSet::new();

    let rows = result.into_rows_result()?;
    for row in rows.rows::<(Uuid, Uuid, Uuid, String, i32, String, DateTime<Utc>)>()? {
        let r = row.map_err(|e| AppError::DatabaseError(e.to_string()))?;
        // Deduplicate chunks — only show base file name
        let base_name = r.3.split(" [part ").next().unwrap_or(&r.3).to_string();
        if seen_names.insert(base_name.clone()) {
            files.push(FileRecord {
                assistant_id: r.0,
                user_id: r.1,
                id: r.2,
                name: base_name,
                size: r.4,
                mime_type: r.5,
                uploaded_at: r.6,
            });
        }
    }

    Ok(files)
}

/// Delete all chunks of a file
pub async fn delete_file(
    db: &DbSession,
    assistant_id: &Uuid,
    user_id: &Uuid,
    file_id: &Uuid,
) -> Result<(), AppError> {
    // Get the file name first to find all chunks
    let result = db
        .query_unpaged(
            "SELECT name FROM inertial_eclipse.assistant_files WHERE assistant_id = ? AND user_id = ? AND id = ?",
            (assistant_id, user_id, file_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let name = result
        .into_rows_result()
        .ok()
        .and_then(|r| r.single_row::<(String,)>().ok())
        .map(|r| r.0)
        .unwrap_or_default();

    let base_name = name.split(" [part ").next().unwrap_or(&name);

    // Find all chunks with this base name
    let all = db
        .query_unpaged(
            "SELECT id, name FROM inertial_eclipse.assistant_files WHERE assistant_id = ? AND user_id = ?",
            (assistant_id, user_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let all_rows = all.into_rows_result()?;
    for row in all_rows.rows::<(Uuid, String)>()? {
        let (chunk_id, chunk_name) = row.map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let chunk_base = chunk_name.split(" [part ").next().unwrap_or(&chunk_name);
        if chunk_base == base_name {
            db.query_unpaged(
                "DELETE FROM inertial_eclipse.assistant_files WHERE assistant_id = ? AND user_id = ? AND id = ?",
                (assistant_id, user_id, &chunk_id),
            )
            .await
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        }
    }

    Ok(())
}

/// Retrieve relevant context from knowledge base
pub async fn retrieve_context(
    db: &DbSession,
    _encryption: &EncryptionService,
    user_id: &Uuid,
    assistant_id: &Uuid,
    _query: &str,
    limit: i32,
) -> Result<Vec<String>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT content_text FROM inertial_eclipse.assistant_files WHERE assistant_id = ? AND user_id = ?",
            (assistant_id, user_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut contexts = Vec::new();
    let rows = result.into_rows_result()?;
    for row in rows.rows::<(String,)>()? {
        let (text,) = row.map_err(|e| AppError::DatabaseError(e.to_string()))?;
        if !text.trim().is_empty() {
            contexts.push(text);
            if contexts.len() >= limit as usize {
                break;
            }
        }
    }

    Ok(contexts)
}
