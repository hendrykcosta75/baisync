use axum::extract::{Extension, Path, Query};
use axum::Json;
use reqwest::Client;
use serde::Serialize;
use serde_json::Value;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::handlers::assistants::OwnerResolveQuery;
use crate::middleware::auth::AuthUser;
use crate::services::assistant as assistant_service;
use crate::services::auth as auth_service;
use crate::services::encryption::EncryptionService;

#[derive(Debug, Serialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct ModelsResponse {
    pub provider: String,
    pub models: Vec<ModelInfo>,
}

pub async fn list_models(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Extension(encryption): Extension<EncryptionService>,
    Path(provider): Path<String>,
    Query(query): Query<OwnerResolveQuery>,
) -> Result<Json<ModelsResponse>, AppError> {
    let user_id = assistant_service::resolve_api_key_user(
        &db, &auth_user.user_id, query.assistant_id.as_ref(), query.share_token.as_deref(),
    ).await?;
    let user = auth_service::get_user_by_id(&db, &user_id).await?;

    let encrypted_key = match provider.as_str() {
        "openai" => user.api_key_openai,
        "claude" => user.api_key_claude,
        "gemini" => user.api_key_gemini,
        _ => return Err(AppError::BadRequest(format!("Unknown provider: {provider}"))),
    }
    .ok_or_else(|| {
        AppError::BadRequest(format!(
            "No API key configured for {provider}. Configure it in API Keys settings."
        ))
    })?;

    let api_key = encryption.decrypt(&encrypted_key)?;

    let models = match provider.as_str() {
        "openai" => fetch_openai_models(&api_key).await?,
        "claude" => get_claude_models(),
        "gemini" => fetch_gemini_models(&api_key).await?,
        _ => unreachable!(),
    };

    Ok(Json(ModelsResponse { provider, models }))
}

async fn fetch_openai_models(api_key: &str) -> Result<Vec<ModelInfo>, AppError> {
    let client = Client::new();
    let resp = client
        .get("https://api.openai.com/v1/models")
        .header("Authorization", format!("Bearer {api_key}"))
        .send()
        .await
        .map_err(|e| AppError::InternalError(format!("OpenAI models request failed: {e}")))?;

    let data: Value = resp
        .json()
        .await
        .map_err(|e| AppError::InternalError(format!("OpenAI models parse failed: {e}")))?;

    let mut models: Vec<ModelInfo> = data["data"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|m| {
            let id = m["id"].as_str()?;
            let is_chat_model = id.starts_with("gpt-")
                || id.starts_with("chatgpt-")
                || id.starts_with("o1")
                || id.starts_with("o3")
                || id.starts_with("o4");
            if is_chat_model {
                Some(ModelInfo {
                    id: id.to_string(),
                    name: format_model_name(id),
                })
            } else {
                None
            }
        })
        .collect();

    models.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(models)
}

fn get_claude_models() -> Vec<ModelInfo> {
    vec![
        ModelInfo {
            id: "claude-opus-4-6".into(),
            name: "Claude Opus 4.6".into(),
        },
        ModelInfo {
            id: "claude-sonnet-4-6".into(),
            name: "Claude Sonnet 4.6".into(),
        },
        ModelInfo {
            id: "claude-opus-4-20250514".into(),
            name: "Claude Opus 4".into(),
        },
        ModelInfo {
            id: "claude-sonnet-4-20250514".into(),
            name: "Claude Sonnet 4".into(),
        },
        ModelInfo {
            id: "claude-sonnet-4-5-20250514".into(),
            name: "Claude Sonnet 4.5".into(),
        },
        ModelInfo {
            id: "claude-haiku-4-5-20251001".into(),
            name: "Claude Haiku 4.5".into(),
        },
    ]
}

async fn fetch_gemini_models(api_key: &str) -> Result<Vec<ModelInfo>, AppError> {
    let client = Client::new();
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
    );

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::InternalError(format!("Gemini models request failed: {e}")))?;

    let data: Value = resp
        .json()
        .await
        .map_err(|e| AppError::InternalError(format!("Gemini models parse failed: {e}")))?;

    let mut models: Vec<ModelInfo> = data["models"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|m| {
            let supported_methods = m["supportedGenerationMethods"].as_array()?;
            let supports_generate = supported_methods
                .iter()
                .any(|method| method.as_str() == Some("generateContent"));

            if !supports_generate {
                return None;
            }

            let name = m["name"].as_str()?;
            let display_name = m["displayName"].as_str().unwrap_or(name);
            let id = name.strip_prefix("models/").unwrap_or(name);

            Some(ModelInfo {
                id: id.to_string(),
                name: display_name.to_string(),
            })
        })
        .collect();

    models.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(models)
}

fn format_model_name(id: &str) -> String {
    id.split('-')
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                None => String::new(),
                Some(c) => c.to_uppercase().to_string() + chars.as_str(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}
