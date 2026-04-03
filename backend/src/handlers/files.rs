use axum::extract::{Extension, Multipart, Path, Query};
use axum::Json;
use serde::Serialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::services::assistant as assistant_service;
use crate::services::encryption::EncryptionService;
use crate::services::rag;

use crate::handlers::assistants::ShareTokenQuery;

#[derive(Serialize)]
pub struct FileResponse {
    pub id: String,
    pub name: String,
    pub size: i32,
    #[serde(rename = "type")]
    pub mime_type: String,
    #[serde(rename = "uploadedAt")]
    pub uploaded_at: String,
}

pub async fn upload(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Extension(encryption): Extension<EncryptionService>,
    Path(assistant_id): Path<Uuid>,
    Query(query): Query<ShareTokenQuery>,
    mut multipart: Multipart,
) -> Result<Json<Value>, AppError> {
    let owner_id = assistant_service::resolve_assistant_access(
        &db, &auth_user.user_id, &assistant_id, query.share_token.as_deref(), "admin",
    ).await?;

    let mut file_name = String::new();
    let mut file_bytes = Vec::new();
    let mut mime_type = "text/plain".to_string();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("Multipart error: {e}")))?
    {
        if field.name() == Some("file") {
            file_name = field
                .file_name()
                .unwrap_or("unnamed")
                .to_string();
            mime_type = field
                .content_type()
                .unwrap_or("text/plain")
                .to_string();

            // Infer mime from extension if generic
            if mime_type == "application/octet-stream" {
                mime_type = match file_name.rsplit('.').next() {
                    Some("txt") => "text/plain",
                    Some("md") => "text/markdown",
                    Some("csv") => "text/csv",
                    Some("json") => "application/json",
                    Some("pdf") => "application/pdf",
                    _ => "text/plain",
                }
                .to_string();
            }

            file_bytes = field
                .bytes()
                .await
                .map_err(|e| AppError::BadRequest(format!("Failed to read file: {e}")))?
                .to_vec();
        }
    }

    if file_bytes.is_empty() {
        return Err(AppError::BadRequest("No file uploaded".into()));
    }

    if file_bytes.len() > 10 * 1024 * 1024 {
        return Err(AppError::BadRequest("File exceeds 10MB limit".into()));
    }

    let record = rag::upload_file(
        &db,
        &encryption,
        &owner_id,
        &assistant_id,
        &file_name,
        &file_bytes,
        &mime_type,
    )
    .await?;

    Ok(Json(json!({
        "file": {
            "id": record.id.to_string(),
            "name": record.name,
            "size": record.size,
            "type": record.mime_type,
            "uploadedAt": record.uploaded_at.to_rfc3339(),
        }
    })))
}

pub async fn list(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(assistant_id): Path<Uuid>,
    Query(query): Query<ShareTokenQuery>,
) -> Result<Json<Vec<FileResponse>>, AppError> {
    let owner_id = assistant_service::resolve_assistant_access(
        &db, &auth_user.user_id, &assistant_id, query.share_token.as_deref(), "read",
    ).await?;
    let files = rag::list_files(&db, &assistant_id, &owner_id).await?;

    Ok(Json(
        files
            .into_iter()
            .map(|f| FileResponse {
                id: f.id.to_string(),
                name: f.name,
                size: f.size,
                mime_type: f.mime_type,
                uploaded_at: f.uploaded_at.to_rfc3339(),
            })
            .collect(),
    ))
}

pub async fn delete(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path((assistant_id, file_id)): Path<(Uuid, Uuid)>,
    Query(query): Query<ShareTokenQuery>,
) -> Result<Json<Value>, AppError> {
    let owner_id = assistant_service::resolve_assistant_access(
        &db, &auth_user.user_id, &assistant_id, query.share_token.as_deref(), "admin",
    ).await?;
    rag::delete_file(&db, &assistant_id, &owner_id, &file_id).await?;
    Ok(Json(json!({"message": "File deleted"})))
}
