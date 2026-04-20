use chrono::{DateTime, Utc};
use scylla::frame::value::CqlTimestamp;
use scylla::DeserializeRow;
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::models::assistant::{
    Assistant, AssistantTool, CreateAssistantRequest, CreateToolRequest, UpdateAssistantRequest,
    UpdateToolRequest,
};
use crate::models::integration::{
    AssistantIntegration, CreateIntegrationRequest, UpdateIntegrationRequest,
};
use crate::services::encryption::EncryptionService;

fn ts_now() -> CqlTimestamp {
    CqlTimestamp(Utc::now().timestamp_millis())
}

// --- Assistants ---

#[derive(DeserializeRow)]
struct AssistantRow {
    user_id: Uuid,
    id: Uuid,
    name: String,
    description: Option<String>,
    llm_provider: String,
    model: String,
    temperature: Option<f32>,
    max_tokens: Option<i32>,
    system_prompt: Option<String>,
    is_team_lead: Option<bool>,
    parent_assistant_id: Option<Uuid>,
    share_token: Option<String>,
    share_permissions: Option<Vec<String>>,
    config_split_messages: Option<bool>,
    config_typing_indicator: Option<bool>,
    config_rate_limit_per_day: Option<i32>,
    config_max_message_length: Option<i32>,
    config_rate_limit_message: Option<String>,
    config_max_length_message: Option<String>,
    config_interpret_documents: Option<bool>,
    config_unsupported_media_message: Option<String>,
    config_audio_provider: Option<String>,
    config_audio_mode: Option<String>,
    config_audio_transcribe: Option<bool>,
    config_audio_fallback_to_text: Option<bool>,
    config_audio_transcription_failure_message: Option<String>,
    config_audio_voice_id: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

fn row_to_assistant(r: AssistantRow) -> Assistant {
    Assistant {
        user_id: r.user_id,
        id: r.id,
        name: r.name,
        description: r.description,
        llm_provider: r.llm_provider,
        model: r.model,
        temperature: r.temperature.unwrap_or(0.7),
        max_tokens: r.max_tokens.unwrap_or(2048),
        system_prompt: r.system_prompt,
        is_team_lead: r.is_team_lead.unwrap_or(false),
        parent_assistant_id: r.parent_assistant_id,
        share_token: r.share_token,
        share_permissions: r.share_permissions,
        config_split_messages: r.config_split_messages.unwrap_or(false),
        config_typing_indicator: r.config_typing_indicator.unwrap_or(true),
        config_rate_limit_per_day: r.config_rate_limit_per_day,
        config_max_message_length: r.config_max_message_length,
        config_rate_limit_message: r.config_rate_limit_message,
        config_max_length_message: r.config_max_length_message,
        config_interpret_documents: r.config_interpret_documents.unwrap_or(false),
        config_unsupported_media_message: r.config_unsupported_media_message,
        config_audio_provider: r.config_audio_provider,
        config_audio_mode: r.config_audio_mode,
        config_audio_transcribe: r.config_audio_transcribe.unwrap_or(false),
        config_audio_fallback_to_text: r.config_audio_fallback_to_text.unwrap_or(true),
        config_audio_transcription_failure_message: r.config_audio_transcription_failure_message,
        config_audio_voice_id: r.config_audio_voice_id,
        created_at: r.created_at,
        updated_at: r.updated_at,
    }
}

const ASSISTANT_COLS: &str = "user_id, id, name, description, llm_provider, model, temperature, max_tokens, system_prompt, is_team_lead, parent_assistant_id, share_token, share_permissions, config_split_messages, config_typing_indicator, config_rate_limit_per_day, config_max_message_length, config_rate_limit_message, config_max_length_message, config_interpret_documents, config_unsupported_media_message, config_audio_provider, config_audio_mode, config_audio_transcribe, config_audio_fallback_to_text, config_audio_transcription_failure_message, config_audio_voice_id, created_at, updated_at";

pub async fn list_assistants(db: &DbSession, user_id: &Uuid) -> Result<Vec<Assistant>, AppError> {
    let query =
        format!("SELECT {ASSISTANT_COLS} FROM inertial_eclipse.assistants WHERE user_id = ?");
    let result = db
        .query_unpaged(query, (user_id,))
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let result = result.into_rows_result()?;

    let mut assistants = Vec::new();
    for row in result.rows::<AssistantRow>()?.flatten() {
        assistants.push(row_to_assistant(row));
    }

    Ok(assistants)
}

pub async fn get_assistant(
    db: &DbSession,
    user_id: &Uuid,
    assistant_id: &Uuid,
) -> Result<Assistant, AppError> {
    let query = format!(
        "SELECT {ASSISTANT_COLS} FROM inertial_eclipse.assistants WHERE user_id = ? AND id = ?"
    );
    let result = db
        .query_unpaged(query, (user_id, assistant_id))
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let row = result
        .into_rows_result()?
        .single_row::<AssistantRow>()
        .map_err(|_| AppError::NotFound("Assistant not found".into()))?;

    Ok(row_to_assistant(row))
}

pub async fn create_assistant(
    db: &DbSession,
    user_id: &Uuid,
    req: CreateAssistantRequest,
) -> Result<Assistant, AppError> {
    let id = Uuid::new_v4();
    let now = ts_now();
    let temperature = req.temperature.unwrap_or(0.7);
    let max_tokens = req.max_tokens.unwrap_or(2048);
    let is_team_lead = req.is_team_lead.unwrap_or(false);

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.assistants (user_id, id, name, description, llm_provider, model, temperature, max_tokens, system_prompt, is_team_lead, parent_assistant_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (user_id, &id, &req.name as &str, &req.description, &req.llm_provider as &str, &req.model as &str, temperature, max_tokens, &req.system_prompt, is_team_lead, &req.parent_assistant_id, now, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    get_assistant(db, user_id, &id).await
}

pub async fn update_assistant(
    db: &DbSession,
    user_id: &Uuid,
    assistant_id: &Uuid,
    req: UpdateAssistantRequest,
) -> Result<Assistant, AppError> {
    let existing = get_assistant(db, user_id, assistant_id).await?;
    let now = ts_now();

    let name = req.name.unwrap_or(existing.name);
    let description = req.description.or(existing.description);
    let llm_provider = req.llm_provider.unwrap_or(existing.llm_provider);
    let model = req.model.unwrap_or(existing.model);
    let temperature = req.temperature.unwrap_or(existing.temperature);
    let max_tokens = req.max_tokens.unwrap_or(existing.max_tokens);
    let system_prompt = req.system_prompt.or(existing.system_prompt);
    let is_team_lead = req.is_team_lead.unwrap_or(existing.is_team_lead);
    let parent_assistant_id = req.parent_assistant_id.or(existing.parent_assistant_id);
    let config_split_messages = req
        .integration_settings
        .as_ref()
        .and_then(|s| s.split_on_double_newline)
        .unwrap_or(existing.config_split_messages);
    let config_typing_indicator = req
        .integration_settings
        .as_ref()
        .and_then(|s| s.typing_indicator)
        .unwrap_or(existing.config_typing_indicator);
    let config_rate_limit_per_day = req
        .integration_settings
        .as_ref()
        .and_then(|s| s.rate_limit_per_day)
        .or(existing.config_rate_limit_per_day);
    let config_max_message_length = req
        .integration_settings
        .as_ref()
        .and_then(|s| s.max_message_length)
        .or(existing.config_max_message_length);
    let config_rate_limit_message = req
        .integration_settings
        .as_ref()
        .and_then(|s| s.rate_limit_message.clone())
        .or(existing.config_rate_limit_message);
    let config_max_length_message = req
        .integration_settings
        .as_ref()
        .and_then(|s| s.max_length_message.clone())
        .or(existing.config_max_length_message);
    let config_interpret_documents = req
        .integration_settings
        .as_ref()
        .and_then(|s| s.interpret_documents)
        .unwrap_or(existing.config_interpret_documents);
    let config_unsupported_media_message = req
        .integration_settings
        .as_ref()
        .and_then(|s| s.unsupported_media_message.clone())
        .or(existing.config_unsupported_media_message.clone());

    let config_audio_provider = req
        .audio_settings
        .as_ref()
        .and_then(|s| s.provider.clone())
        .or(existing.config_audio_provider);
    let config_audio_mode = req
        .audio_settings
        .as_ref()
        .and_then(|s| s.mode.clone())
        .or(existing.config_audio_mode);
    let config_audio_transcribe = req
        .audio_settings
        .as_ref()
        .and_then(|s| s.transcribe)
        .unwrap_or(existing.config_audio_transcribe);
    let config_audio_fallback_to_text = req
        .audio_settings
        .as_ref()
        .and_then(|s| s.fallback_to_text)
        .unwrap_or(existing.config_audio_fallback_to_text);
    let config_audio_transcription_failure_message = req
        .audio_settings
        .as_ref()
        .and_then(|s| s.transcription_failure_message.clone())
        .or(existing.config_audio_transcription_failure_message);
    let config_audio_voice_id = req
        .audio_settings
        .as_ref()
        .and_then(|s| s.voice_id.clone())
        .or(existing.config_audio_voice_id);

    db.query_unpaged(
        "UPDATE inertial_eclipse.assistants SET name = ?, description = ?, llm_provider = ?, model = ?, temperature = ?, max_tokens = ?, system_prompt = ?, is_team_lead = ?, parent_assistant_id = ?, config_split_messages = ?, config_typing_indicator = ?, updated_at = ? WHERE user_id = ? AND id = ?",
        (&name as &str, &description, &llm_provider as &str, &model as &str, temperature, max_tokens, &system_prompt, is_team_lead, &parent_assistant_id, config_split_messages, config_typing_indicator, now, user_id, assistant_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    db.query_unpaged(
        "UPDATE inertial_eclipse.assistants SET config_rate_limit_per_day = ?, config_max_message_length = ?, config_rate_limit_message = ?, config_max_length_message = ? WHERE user_id = ? AND id = ?",
        (&config_rate_limit_per_day, &config_max_message_length, &config_rate_limit_message, &config_max_length_message, user_id, assistant_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    db.query_unpaged(
        "UPDATE inertial_eclipse.assistants SET config_audio_provider = ?, config_audio_mode = ?, config_audio_transcribe = ?, config_audio_fallback_to_text = ?, config_audio_transcription_failure_message = ?, config_audio_voice_id = ? WHERE user_id = ? AND id = ?",
        (&config_audio_provider, &config_audio_mode, config_audio_transcribe, config_audio_fallback_to_text, &config_audio_transcription_failure_message, &config_audio_voice_id, user_id, assistant_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    db.query_unpaged(
        "UPDATE inertial_eclipse.assistants SET config_interpret_documents = ?, config_unsupported_media_message = ? WHERE user_id = ? AND id = ?",
        (config_interpret_documents, &config_unsupported_media_message, user_id, assistant_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    get_assistant(db, user_id, assistant_id).await
}

pub async fn delete_assistant(
    db: &DbSession,
    user_id: &Uuid,
    assistant_id: &Uuid,
) -> Result<(), AppError> {
    get_assistant(db, user_id, assistant_id).await?;

    // Cascade delete: remove all related data

    // Delete integrations (PK: (assistant_id, user_id), id)
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.assistant_integrations WHERE assistant_id = ? AND user_id = ?",
        (assistant_id, user_id),
    ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Delete tools (PK: assistant_id, id)
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.assistant_tools WHERE assistant_id = ?",
        (assistant_id,),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Delete files (PK: (assistant_id, user_id), id)
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.assistant_files WHERE assistant_id = ? AND user_id = ?",
        (assistant_id, user_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Delete conversations and their messages (conversations PK: (assistant_id, user_id), id)
    let convs = db
        .query_unpaged(
            "SELECT id FROM inertial_eclipse.conversations WHERE assistant_id = ? AND user_id = ?",
            (assistant_id, user_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let convs = convs.into_rows_result()?;
    for row in convs.rows::<(Uuid,)>()?.flatten() {
        let (conv_id,) = row;
        {
            // Delete messages for this conversation (PK: conversation_id, id)
            let _ = db
                .query_unpaged(
                    "DELETE FROM inertial_eclipse.messages WHERE conversation_id = ?",
                    (&conv_id,),
                )
                .await;
        }
    }

    db.query_unpaged(
        "DELETE FROM inertial_eclipse.conversations WHERE assistant_id = ? AND user_id = ?",
        (assistant_id, user_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Delete usage stats (PK: (user_id, assistant_id), period)
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.usage_stats WHERE user_id = ? AND assistant_id = ?",
        (user_id, assistant_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Delete LLM call logs (PK: (user_id, assistant_id), id)
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.llm_call_logs WHERE user_id = ? AND assistant_id = ?",
        (user_id, assistant_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Delete access tokens (PK: (user_id, assistant_id), id)
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.access_tokens WHERE user_id = ? AND assistant_id = ?",
        (user_id, assistant_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Delete tool call logs (PK: (assistant_id, tool_id), called_at, id) — delete all tools' logs
    // Note: we can't easily delete without tool_id, but tools are already deleted above

    // Delete availability config (PK: assistant_id)
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.assistant_availability WHERE assistant_id = ?",
        (assistant_id,),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Delete accepted shares by assistant (PK: assistant_id, accepted_at, user_id)
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.accepted_shares_by_assistant WHERE assistant_id = ?",
        (assistant_id,),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Finally, delete the assistant itself
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.assistants WHERE user_id = ? AND id = ?",
        (user_id, assistant_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

// --- Tools ---

type ToolRow = (
    Uuid,           // assistant_id
    Uuid,           // id
    String,         // name
    Option<String>, // description
    String,         // endpoint
    String,         // method
    Option<String>, // schema_json
    Option<String>, // headers_json
    Option<bool>,   // is_enabled
    Option<String>, // tool_type
);

fn row_to_tool(r: ToolRow) -> AssistantTool {
    AssistantTool {
        assistant_id: r.0,
        id: r.1,
        name: r.2,
        description: r.3,
        endpoint: r.4,
        method: r.5,
        schema_json: r.6,
        headers_json: r.7,
        is_enabled: r.8.unwrap_or(true),
        tool_type: Some(r.9.unwrap_or_else(|| "http_request".to_string())),
    }
}

const TOOL_COLS: &str = "assistant_id, id, name, description, endpoint, method, schema_json, headers_json, is_enabled, tool_type";

pub async fn list_tools(
    db: &DbSession,
    assistant_id: &Uuid,
) -> Result<Vec<AssistantTool>, AppError> {
    let query =
        format!("SELECT {TOOL_COLS} FROM inertial_eclipse.assistant_tools WHERE assistant_id = ?");
    let result = db
        .query_unpaged(query, (assistant_id,))
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut tools = Vec::new();
    let result = result.into_rows_result()?;
    for row in result.rows::<ToolRow>()?.flatten() {
        tools.push(row_to_tool(row));
    }

    Ok(tools)
}

pub async fn create_tool(
    db: &DbSession,
    assistant_id: &Uuid,
    req: CreateToolRequest,
) -> Result<AssistantTool, AppError> {
    let tool_type = req.tool_type.as_deref().unwrap_or("http_request");

    // Singleton validation for notify_human only
    if tool_type == "notify_human" {
        let existing = list_tools(db, assistant_id).await?;
        if existing
            .iter()
            .any(|t| t.tool_type.as_deref() == Some("notify_human"))
        {
            return Err(AppError::BadRequest(
                "Já existe uma ferramenta desse tipo neste assistente".into(),
            ));
        }
    }

    let id = Uuid::new_v4();
    let is_enabled = req.is_enabled.unwrap_or(true);
    let endpoint = req.endpoint.unwrap_or_default();
    let method = req.method.unwrap_or_else(|| "POST".to_string());

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.assistant_tools (assistant_id, id, name, description, endpoint, method, schema_json, headers_json, is_enabled, tool_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (assistant_id, &id, &req.name as &str, &req.description, &endpoint as &str, &method as &str, &req.schema_json, &req.headers_json, is_enabled, tool_type),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(AssistantTool {
        assistant_id: *assistant_id,
        id,
        name: req.name,
        description: req.description,
        endpoint,
        method,
        schema_json: req.schema_json,
        headers_json: req.headers_json,
        is_enabled,
        tool_type: Some(tool_type.to_string()),
    })
}

pub async fn update_tool(
    db: &DbSession,
    assistant_id: &Uuid,
    tool_id: &Uuid,
    req: UpdateToolRequest,
) -> Result<AssistantTool, AppError> {
    let query = format!(
        "SELECT {TOOL_COLS} FROM inertial_eclipse.assistant_tools WHERE assistant_id = ? AND id = ?"
    );
    let result = db
        .query_unpaged(query, (assistant_id, tool_id))
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let existing = result
        .into_rows_result()?
        .single_row::<ToolRow>()
        .map_err(|_| AppError::NotFound("Tool not found".into()))?;

    let name = req.name.unwrap_or(existing.2);
    let description = req.description.or(existing.3);
    let endpoint = req.endpoint.unwrap_or(existing.4);
    let method = req.method.unwrap_or(existing.5);
    let schema_json = req.schema_json.or(existing.6);
    let headers_json = req.headers_json.or(existing.7);
    let is_enabled = req.is_enabled.unwrap_or(existing.8.unwrap_or(true));
    let tool_type = req
        .tool_type
        .or(existing.9)
        .unwrap_or_else(|| "http_request".to_string());

    db.query_unpaged(
        "UPDATE inertial_eclipse.assistant_tools SET name = ?, description = ?, endpoint = ?, method = ?, schema_json = ?, headers_json = ?, is_enabled = ?, tool_type = ? WHERE assistant_id = ? AND id = ?",
        (&name as &str, &description, &endpoint as &str, &method as &str, &schema_json, &headers_json, is_enabled, &tool_type as &str, assistant_id, tool_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(AssistantTool {
        assistant_id: *assistant_id,
        id: *tool_id,
        name,
        description,
        endpoint,
        method,
        schema_json,
        headers_json,
        is_enabled,
        tool_type: Some(tool_type),
    })
}

pub async fn delete_tool(
    db: &DbSession,
    assistant_id: &Uuid,
    tool_id: &Uuid,
) -> Result<(), AppError> {
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.assistant_tools WHERE assistant_id = ? AND id = ?",
        (assistant_id, tool_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

// --- Tool Call Logs ---

use crate::models::assistant::ToolCallLog;

type ToolCallLogRow = (
    Uuid,                 // assistant_id
    Uuid,                 // tool_id
    Uuid,                 // id
    Option<String>,       // tool_name
    Option<String>,       // arguments
    Option<i32>,          // status_code
    Option<String>,       // response_body
    Option<String>,       // error
    Option<i32>,          // duration_ms
    Option<CqlTimestamp>, // called_at
);

pub async fn save_tool_call_log(
    db: &DbSession,
    assistant_id: &Uuid,
    tool_id: &Uuid,
    tool_name: &str,
    arguments: Option<&str>,
    status_code: Option<i32>,
    response_body: Option<&str>,
    error: Option<&str>,
    duration_ms: i32,
) -> Result<(), AppError> {
    let now = CqlTimestamp(chrono::Utc::now().timestamp_millis());
    let id = Uuid::new_v4();

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.tool_call_logs (assistant_id, tool_id, id, tool_name, arguments, status_code, response_body, error, duration_ms, called_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (assistant_id, tool_id, &id, tool_name, &arguments, &status_code, &response_body, &error, duration_ms, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

pub async fn list_tool_call_logs(
    db: &DbSession,
    assistant_id: &Uuid,
    tool_id: &Uuid,
    limit: i32,
    from_ts: Option<i64>,
    to_ts: Option<i64>,
) -> Result<Vec<ToolCallLog>, AppError> {
    let from = CqlTimestamp(from_ts.unwrap_or(0));
    // 9999-12-31T23:59:59.999Z — safer than i64::MAX for driver roundtrip.
    let to = CqlTimestamp(to_ts.unwrap_or(253_402_300_799_999));
    let query = format!(
        "SELECT assistant_id, tool_id, id, tool_name, arguments, status_code, response_body, error, duration_ms, called_at FROM inertial_eclipse.tool_call_logs WHERE assistant_id = ? AND tool_id = ? AND called_at >= ? AND called_at <= ? ORDER BY called_at DESC LIMIT {limit}"
    );
    let result = db
        .query_unpaged(query, (assistant_id, tool_id, from, to))
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut logs = Vec::new();
    let result = result.into_rows_result()?;
    for r in result.rows::<ToolCallLogRow>()?.flatten() {
        let called_at =
            r.9.map(|ts| {
                chrono::DateTime::<chrono::Utc>::from(
                    std::time::UNIX_EPOCH + std::time::Duration::from_millis(ts.0 as u64),
                )
            })
            .unwrap_or_else(chrono::Utc::now);
        logs.push(ToolCallLog {
            assistant_id: r.0,
            tool_id: r.1,
            id: r.2,
            tool_name: r.3.unwrap_or_default(),
            arguments: r.4,
            status_code: r.5,
            response_body: r.6,
            error: r.7,
            duration_ms: r.8.unwrap_or(0),
            called_at,
        });
    }

    Ok(logs)
}

pub async fn list_tool_call_logs_paged(
    db: &DbSession,
    assistant_id: &Uuid,
    tool_id: &Uuid,
    limit: i32,
    cursor: Option<&str>,
) -> Result<crate::models::pagination::PaginatedResponse<ToolCallLog>, AppError> {
    let (result, next_cursor) = crate::db::query_paged(
        db,
        "SELECT assistant_id, tool_id, id, tool_name, arguments, status_code, response_body, error, duration_ms, called_at FROM inertial_eclipse.tool_call_logs WHERE assistant_id = ? AND tool_id = ? ORDER BY called_at DESC",
        (assistant_id, tool_id),
        limit,
        cursor,
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut logs = Vec::new();
    let result = result.into_rows_result()?;
    for r in result.rows::<ToolCallLogRow>()?.flatten() {
        let called_at =
            r.9.map(|ts| {
                chrono::DateTime::<chrono::Utc>::from(
                    std::time::UNIX_EPOCH + std::time::Duration::from_millis(ts.0 as u64),
                )
            })
            .unwrap_or_else(chrono::Utc::now);
        logs.push(ToolCallLog {
            assistant_id: r.0,
            tool_id: r.1,
            id: r.2,
            tool_name: r.3.unwrap_or_default(),
            arguments: r.4,
            status_code: r.5,
            response_body: r.6,
            error: r.7,
            duration_ms: r.8.unwrap_or(0),
            called_at,
        });
    }

    Ok(crate::models::pagination::PaginatedResponse {
        items: logs,
        cursor: next_cursor,
    })
}

// --- Integrations ---

type IntegrationRow = (
    Uuid,           // assistant_id
    Uuid,           // user_id
    Uuid,           // id
    String,         // channel
    String,         // provider
    Option<String>, // status
    Option<String>, // config_token
    Option<String>, // config_phone_number
    Option<String>, // config_chatwoot_url
    Option<i32>,    // config_rate_limit_per_day
    Option<i32>,    // config_max_message_length
    Option<String>, // config_audio_response_mode
    Option<bool>,   // config_interpret_documents
    Option<bool>,   // config_split_messages
    Option<String>, // config_webhook_verify_token
    DateTime<Utc>,  // created_at
);

/// Convert a DB row into an `AssistantIntegration`, transparently decrypting
/// the four sensitive columns (`config_token`, `config_phone_number`,
/// `config_chatwoot_url`, `config_webhook_verify_token`) with a passthrough
/// fallback so legacy plaintext rows survive until the backfill migration
/// runs. See `EncryptionService::try_decrypt_or_passthrough`.
fn row_to_integration(
    encryption: &EncryptionService,
    r: IntegrationRow,
) -> AssistantIntegration {
    AssistantIntegration {
        assistant_id: r.0,
        user_id: r.1,
        id: r.2,
        channel: r.3,
        provider: r.4,
        status: r.5.unwrap_or_else(|| "active".into()),
        config_token: encryption.try_decrypt_opt(r.6),
        config_phone_number: encryption.try_decrypt_opt(r.7),
        config_chatwoot_url: encryption.try_decrypt_opt(r.8),
        config_rate_limit_per_day: r.9,
        config_max_message_length: r.10,
        config_audio_response_mode: r.11,
        config_interpret_documents: r.12,
        config_split_messages: r.13,
        config_webhook_verify_token: encryption.try_decrypt_opt(r.14),
        created_at: r.15,
    }
}

const INTEGRATION_COLS: &str = "assistant_id, user_id, id, channel, provider, status, config_token, config_phone_number, config_chatwoot_url, config_rate_limit_per_day, config_max_message_length, config_audio_response_mode, config_interpret_documents, config_split_messages, config_webhook_verify_token, created_at";

pub async fn list_integrations(
    db: &DbSession,
    encryption: &EncryptionService,
    assistant_id: &Uuid,
    user_id: &Uuid,
) -> Result<Vec<AssistantIntegration>, AppError> {
    let query = format!(
        "SELECT {INTEGRATION_COLS} FROM inertial_eclipse.assistant_integrations WHERE assistant_id = ? AND user_id = ?"
    );
    let result = db
        .query_unpaged(query, (assistant_id, user_id))
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut integrations = Vec::new();
    let result = result.into_rows_result()?;
    for row in result.rows::<IntegrationRow>()?.flatten() {
        integrations.push(row_to_integration(encryption, row));
    }

    Ok(integrations)
}

pub async fn create_integration(
    db: &DbSession,
    encryption: &EncryptionService,
    assistant_id: &Uuid,
    user_id: &Uuid,
    req: CreateIntegrationRequest,
) -> Result<AssistantIntegration, AppError> {
    // Check for existing integration with same channel+provider for this assistant
    let existing = list_integrations(db, encryption, assistant_id, user_id).await?;
    if let Some(found) = existing
        .iter()
        .find(|i| i.channel == req.channel && i.provider == req.provider)
    {
        return Ok(found.clone());
    }

    // Prevent duplicate phone numbers across integrations
    if let Some(ref phone) = req.config_phone_number {
        if !phone.is_empty() {
            if let Ok(existing_integration) =
                crate::services::messaging::find_any_integration_by_phone(db, encryption, phone)
                    .await
            {
                // Allow if it's the same assistant (re-creation), reject otherwise
                if existing_integration.assistant_id != *assistant_id
                    || existing_integration.user_id != *user_id
                {
                    // If the existing integration is disconnected, clean it up and allow
                    if existing_integration.status == "disconnected" {
                        let _ = db.query_unpaged(
                            "DELETE FROM inertial_eclipse.assistant_integrations WHERE assistant_id = ? AND user_id = ? AND id = ?",
                            (&existing_integration.assistant_id, &existing_integration.user_id, &existing_integration.id),
                        ).await;
                        tracing::info!(
                            "Cleaned up disconnected integration {} to free phone for new user",
                            existing_integration.id
                        );
                    } else {
                        let is_same_user = existing_integration.user_id == *user_id;
                        let assistant_name = if is_same_user {
                            get_assistant(
                                db,
                                &existing_integration.user_id,
                                &existing_integration.assistant_id,
                            )
                            .await
                            .map(|a| a.name)
                            .unwrap_or_else(|_| "outro assistente".into())
                        } else {
                            "assistente de outro usuário".into()
                        };
                        let msg = if is_same_user {
                            format!(
                                "PHONE_CONFLICT_SAME_USER|{}|{}|{}|Este número já está conectado ao assistente \"{}\".",
                                existing_integration.assistant_id,
                                existing_integration.id,
                                assistant_name,
                                assistant_name
                            )
                        } else {
                            "PHONE_CONFLICT_OTHER_USER|Este número já está em uso por outro usuário.".into()
                        };
                        return Err(AppError::BadRequest(msg));
                    }
                }
            }
        }
    }

    let id = Uuid::new_v4();
    let now = ts_now();

    // Encrypt the 4 sensitive columns before persisting. Empty strings and
    // None pass through untouched (see `EncryptionService::encrypt_opt`).
    let enc_config_token = encryption.encrypt_opt(req.config_token.clone())?;
    let enc_config_phone_number = encryption.encrypt_opt(req.config_phone_number.clone())?;
    let enc_config_chatwoot_url = encryption.encrypt_opt(req.config_chatwoot_url.clone())?;
    let enc_config_webhook_verify_token =
        encryption.encrypt_opt(req.config_webhook_verify_token.clone())?;

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.assistant_integrations (assistant_id, user_id, id, channel, provider, status, config_token, config_phone_number, config_chatwoot_url, config_rate_limit_per_day, config_max_message_length, config_audio_response_mode, config_interpret_documents, config_split_messages, config_webhook_verify_token, created_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (assistant_id, user_id, &id, &req.channel as &str, &req.provider as &str, &enc_config_token, &enc_config_phone_number, &enc_config_chatwoot_url, &req.config_rate_limit_per_day, &req.config_max_message_length, &req.config_audio_response_mode, &req.config_interpret_documents, &req.config_split_messages, &enc_config_webhook_verify_token, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Returned object holds PLAINTEXT so the API response is unchanged for the
    // caller/client — encryption is a storage-layer concern only.
    Ok(AssistantIntegration {
        assistant_id: *assistant_id,
        user_id: *user_id,
        id,
        channel: req.channel,
        provider: req.provider,
        status: "active".into(),
        config_token: req.config_token,
        config_phone_number: req.config_phone_number,
        config_chatwoot_url: req.config_chatwoot_url,
        config_rate_limit_per_day: req.config_rate_limit_per_day,
        config_max_message_length: req.config_max_message_length,
        config_audio_response_mode: req.config_audio_response_mode,
        config_interpret_documents: req.config_interpret_documents,
        config_split_messages: req.config_split_messages,
        config_webhook_verify_token: req.config_webhook_verify_token,
        created_at: Utc::now(),
    })
}

pub async fn update_integration(
    db: &DbSession,
    encryption: &EncryptionService,
    assistant_id: &Uuid,
    user_id: &Uuid,
    integration_id: &Uuid,
    req: UpdateIntegrationRequest,
) -> Result<AssistantIntegration, AppError> {
    let integrations = list_integrations(db, encryption, assistant_id, user_id).await?;
    let existing = integrations
        .into_iter()
        .find(|i| i.id == *integration_id)
        .ok_or_else(|| AppError::NotFound("Integration not found".into()))?;

    let phone_requested = req.config_phone_number.is_some();

    let channel = req.channel.unwrap_or(existing.channel);
    let provider = req.provider.unwrap_or(existing.provider);
    let status = req.status.unwrap_or(existing.status);
    // `existing` already holds plaintext values (row_to_integration decrypts
    // via the passthrough helper), so merging plaintext+plaintext is safe.
    let config_token = req.config_token.or(existing.config_token);
    let config_phone_number = req
        .config_phone_number
        .or(existing.config_phone_number.clone());
    let config_chatwoot_url = req.config_chatwoot_url.or(existing.config_chatwoot_url);
    let config_rate_limit_per_day = req
        .config_rate_limit_per_day
        .or(existing.config_rate_limit_per_day);
    let config_max_message_length = req
        .config_max_message_length
        .or(existing.config_max_message_length);
    let config_audio_response_mode = req
        .config_audio_response_mode
        .or(existing.config_audio_response_mode);
    let config_interpret_documents = req
        .config_interpret_documents
        .or(existing.config_interpret_documents);
    let config_split_messages = req.config_split_messages.or(existing.config_split_messages);
    let config_webhook_verify_token = req
        .config_webhook_verify_token
        .or(existing.config_webhook_verify_token.clone());

    // Prevent duplicate phone numbers across integrations (only check when phone actually changed)
    let phone_changed = phone_requested && config_phone_number != existing.config_phone_number;
    if phone_changed {
        if let Some(ref phone) = config_phone_number {
            if !phone.is_empty() {
                if let Ok(existing_integration) =
                    crate::services::messaging::find_any_integration_by_phone(db, encryption, phone)
                        .await
                {
                    // Allow if it's the same integration being updated, reject otherwise
                    if existing_integration.id != *integration_id {
                        if existing_integration.status == "disconnected" {
                            let _ = db.query_unpaged(
                                "DELETE FROM inertial_eclipse.assistant_integrations WHERE assistant_id = ? AND user_id = ? AND id = ?",
                                (&existing_integration.assistant_id, &existing_integration.user_id, &existing_integration.id),
                            ).await;
                            tracing::info!(
                                "Cleaned up disconnected integration {} to free phone for update",
                                existing_integration.id
                            );
                        } else {
                            let is_same_user = existing_integration.user_id == *user_id;
                            let assistant_name = if is_same_user {
                                get_assistant(
                                    db,
                                    &existing_integration.user_id,
                                    &existing_integration.assistant_id,
                                )
                                .await
                                .map(|a| a.name)
                                .unwrap_or_else(|_| "outro assistente".into())
                            } else {
                                "assistente de outro usuário".into()
                            };
                            let msg = if is_same_user {
                                format!(
                                    "PHONE_CONFLICT_SAME_USER|{}|{}|{}|Este número já está conectado ao assistente \"{}\".",
                                    existing_integration.assistant_id,
                                    existing_integration.id,
                                    assistant_name,
                                    assistant_name
                                )
                            } else {
                                "PHONE_CONFLICT_OTHER_USER|Este número já está em uso por outro usuário.".into()
                            };
                            return Err(AppError::BadRequest(msg));
                        }
                    }
                }
            }
        }
    }

    // Encrypt the 4 sensitive columns before persisting.
    let enc_config_token = encryption.encrypt_opt(config_token.clone())?;
    let enc_config_phone_number = encryption.encrypt_opt(config_phone_number.clone())?;
    let enc_config_chatwoot_url = encryption.encrypt_opt(config_chatwoot_url.clone())?;
    let enc_config_webhook_verify_token =
        encryption.encrypt_opt(config_webhook_verify_token.clone())?;

    db.query_unpaged(
        "UPDATE inertial_eclipse.assistant_integrations SET channel = ?, provider = ?, status = ?, config_token = ?, config_phone_number = ?, config_chatwoot_url = ?, config_rate_limit_per_day = ?, config_max_message_length = ?, config_audio_response_mode = ?, config_interpret_documents = ?, config_split_messages = ?, config_webhook_verify_token = ? WHERE assistant_id = ? AND user_id = ? AND id = ?",
        (&channel as &str, &provider as &str, &status as &str, &enc_config_token, &enc_config_phone_number, &enc_config_chatwoot_url, &config_rate_limit_per_day, &config_max_message_length, &config_audio_response_mode, &config_interpret_documents, &config_split_messages, &enc_config_webhook_verify_token, assistant_id, user_id, integration_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Return plaintext to caller (API contract unchanged).
    Ok(AssistantIntegration {
        assistant_id: *assistant_id,
        user_id: *user_id,
        id: *integration_id,
        channel,
        provider,
        status,
        config_token,
        config_phone_number,
        config_chatwoot_url,
        config_rate_limit_per_day,
        config_max_message_length,
        config_audio_response_mode,
        config_interpret_documents,
        config_split_messages,
        config_webhook_verify_token,
        created_at: existing.created_at,
    })
}

pub async fn delete_integration(
    db: &DbSession,
    assistant_id: &Uuid,
    user_id: &Uuid,
    integration_id: &Uuid,
) -> Result<(), AppError> {
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.assistant_integrations WHERE assistant_id = ? AND user_id = ? AND id = ?",
        (assistant_id, user_id, integration_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

pub async fn set_share_token(
    db: &DbSession,
    user_id: &Uuid,
    assistant_id: &Uuid,
    token: Option<String>,
    permissions: Option<Vec<String>>,
) -> Result<(), AppError> {
    let now = ts_now();
    db.query_unpaged(
        "UPDATE inertial_eclipse.assistants SET share_token = ?, share_permissions = ?, updated_at = ? WHERE user_id = ? AND id = ?",
        (&token, &permissions, now, user_id, assistant_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(())
}

pub async fn get_by_share_token(db: &DbSession, token: &str) -> Result<Assistant, AppError> {
    let query = format!(
        "SELECT {ASSISTANT_COLS} FROM inertial_eclipse.assistants WHERE share_token = ? ALLOW FILTERING"
    );
    let result = db
        .query_unpaged(query, (token,))
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let row = result
        .into_rows_result()?
        .single_row::<AssistantRow>()
        .map_err(|_| AppError::NotFound("Token inválido ou assistente não encontrado".into()))?;

    Ok(row_to_assistant(row))
}

/// Resolve an assistant from any valid token (share_token on assistant or access_tokens table).
/// Returns (assistant, permissions).
pub async fn get_by_any_token(
    db: &DbSession,
    token: &str,
) -> Result<(Assistant, Vec<String>), AppError> {
    // 1. Try share_token on assistants table
    if let Ok(asst) = get_by_share_token(db, token).await {
        let perms = asst.share_permissions.clone().unwrap_or_default();
        return Ok((asst, perms));
    }

    // 2. Try access_tokens table (ALLOW FILTERING is acceptable for low-frequency lookups)
    let result = db
        .query_unpaged(
            "SELECT user_id, assistant_id, permission_level, is_revoked \
             FROM inertial_eclipse.access_tokens WHERE \"token\" = ? ALLOW FILTERING",
            (token,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let row = result
        .into_rows_result()?
        .single_row::<(Uuid, Uuid, String, bool)>()
        .map_err(|_| AppError::NotFound("Token inválido ou assistente não encontrado".into()))?;

    let (owner_id, assistant_id, permission_level, is_revoked) = row;

    if is_revoked {
        return Err(AppError::Unauthorized("Token revogado".into()));
    }

    let asst = get_assistant(db, &owner_id, &assistant_id).await?;
    Ok((asst, vec![permission_level]))
}

/// Resolves the owner's user_id for an assistant, checking either direct ownership
/// or a share_token with the required permission level.
/// Permission hierarchy: admin >= write >= read.
pub async fn resolve_assistant_access(
    db: &DbSession,
    auth_user_id: &Uuid,
    assistant_id: &Uuid,
    share_token: Option<&str>,
    required_permission: &str,
) -> Result<Uuid, AppError> {
    // 1. Try ownership first
    if get_assistant(db, auth_user_id, assistant_id).await.is_ok() {
        return Ok(*auth_user_id);
    }

    // 2. Fall back to share token
    let token = share_token.ok_or_else(|| AppError::NotFound("Assistant not found".into()))?;
    let (asst, perms) = get_by_any_token(db, token).await?;
    if asst.id != *assistant_id {
        return Err(AppError::NotFound("Assistant not found".into()));
    }

    // Check permission hierarchy: admin >= write >= read
    let has_permission = perms.iter().any(|p| match required_permission {
        "read" => p == "read" || p == "write" || p == "admin",
        "write" => p == "write" || p == "admin",
        "admin" => p == "admin",
        _ => false,
    });
    if !has_permission {
        return Err(AppError::Unauthorized(
            "Permissão insuficiente para esta operação".into(),
        ));
    }

    Ok(asst.user_id)
}

/// Resolves which user_id to use for API key lookup.
/// If assistant_id + share_token are provided, resolves to the owner.
/// Otherwise uses the authenticated user.
pub async fn resolve_api_key_user(
    db: &DbSession,
    auth_user_id: &Uuid,
    assistant_id: Option<&Uuid>,
    share_token: Option<&str>,
) -> Result<Uuid, AppError> {
    match (assistant_id, share_token) {
        (Some(aid), Some(token)) => {
            resolve_assistant_access(db, auth_user_id, aid, Some(token), "read").await
        }
        (Some(aid), None) => {
            // Owned assistant — verify ownership
            get_assistant(db, auth_user_id, aid).await?;
            Ok(*auth_user_id)
        }
        _ => Ok(*auth_user_id),
    }
}

// ── Accepted Shares ──────────────────────────────────────────────────────────

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct AcceptedShare {
    pub user_id: Uuid,
    pub assistant_id: Uuid,
    pub share_token: String,
    pub assistant_name: String,
    pub assistant_description: Option<String>,
    pub permissions: Vec<String>,
    pub accepted_at: DateTime<Utc>,
}

pub async fn accept_share(
    db: &DbSession,
    user_id: &Uuid,
    assistant_id: &Uuid,
    token: &str,
    name: &str,
    description: Option<&str>,
    permissions: &[String],
) -> Result<(), AppError> {
    let now = CqlTimestamp(Utc::now().timestamp_millis());
    db.query_unpaged(
        "INSERT INTO inertial_eclipse.accepted_shares (user_id, assistant_id, share_token, assistant_name, assistant_description, permissions, accepted_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (user_id, assistant_id, token, name, &description, permissions, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Also insert into the reverse-lookup table for the assistant owner
    let (user_email, user_name) = get_user_email_name(db, user_id).await;
    db.query_unpaged(
        "INSERT INTO inertial_eclipse.accepted_shares_by_assistant (assistant_id, user_id, share_token, user_email, user_name, permissions, accepted_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (assistant_id, user_id, token, &user_email, &user_name, permissions, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

async fn get_user_email_name(db: &DbSession, user_id: &Uuid) -> (String, String) {
    let result = db
        .query_unpaged(
            "SELECT email, name FROM inertial_eclipse.users WHERE id = ?",
            (user_id,),
        )
        .await
        .ok();
    if let Some(res) = result {
        if let Ok(rows) = res.into_rows_result() {
            if let Ok(Some((email, name))) = rows.maybe_first_row::<(String, Option<String>)>() {
                return (email, name.unwrap_or_default());
            }
        }
    }
    ("".to_string(), "".to_string())
}

#[derive(Debug, Clone, Serialize)]
pub struct TokenUser {
    pub user_id: Uuid,
    pub user_email: String,
    pub user_name: String,
    pub share_token: String,
    pub permissions: Vec<String>,
    pub accepted_at: DateTime<Utc>,
}

pub async fn list_token_users(
    db: &DbSession,
    assistant_id: &Uuid,
) -> Result<Vec<TokenUser>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT assistant_id, user_id, share_token, user_email, user_name, permissions, accepted_at FROM inertial_eclipse.accepted_shares_by_assistant WHERE assistant_id = ?",
            (assistant_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut users = Vec::new();
    let result = result.into_rows_result()?;
    for (_aid, uid, token, email, name, perms, ts) in result
        .rows::<(
            Uuid,
            Uuid,
            String,
            String,
            String,
            Vec<String>,
            CqlTimestamp,
        )>()?
        .flatten()
    {
        users.push(TokenUser {
            user_id: uid,
            user_email: email,
            user_name: name,
            share_token: token,
            permissions: perms,
            accepted_at: DateTime::from_timestamp_millis(ts.0).unwrap_or_default(),
        });
    }
    Ok(users)
}

pub async fn list_accepted_shares(
    db: &DbSession,
    user_id: &Uuid,
) -> Result<Vec<AcceptedShare>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT user_id, assistant_id, share_token, assistant_name, assistant_description, permissions, accepted_at FROM inertial_eclipse.accepted_shares WHERE user_id = ?",
            (user_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut shares = Vec::new();
    let result = result.into_rows_result()?;
    for (uid, aid, token, name, desc, perms, ts) in result
        .rows::<(
            Uuid,
            Uuid,
            String,
            String,
            Option<String>,
            Vec<String>,
            CqlTimestamp,
        )>()?
        .flatten()
    {
        shares.push(AcceptedShare {
            user_id: uid,
            assistant_id: aid,
            share_token: token,
            assistant_name: name,
            assistant_description: desc,
            permissions: perms,
            accepted_at: DateTime::from_timestamp_millis(ts.0).unwrap_or_default(),
        });
    }
    Ok(shares)
}

pub async fn get_accepted_share(
    db: &DbSession,
    user_id: &Uuid,
    assistant_id: &Uuid,
) -> Result<Option<AcceptedShare>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT user_id, assistant_id, share_token, assistant_name, assistant_description, permissions, accepted_at FROM inertial_eclipse.accepted_shares WHERE user_id = ? AND assistant_id = ?",
            (user_id, assistant_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let row = result.into_rows_result()?.maybe_first_row::<(
        Uuid,
        Uuid,
        String,
        String,
        Option<String>,
        Vec<String>,
        CqlTimestamp,
    )>()?;

    Ok(
        row.map(|(uid, aid, token, name, desc, perms, ts)| AcceptedShare {
            user_id: uid,
            assistant_id: aid,
            share_token: token,
            assistant_name: name,
            assistant_description: desc,
            permissions: perms,
            accepted_at: DateTime::from_timestamp_millis(ts.0).unwrap_or_default(),
        }),
    )
}

pub async fn remove_accepted_share(
    db: &DbSession,
    user_id: &Uuid,
    assistant_id: &Uuid,
) -> Result<(), AppError> {
    // Get the accepted_at timestamp before deleting (needed for reverse table key)
    let share = get_accepted_share(db, user_id, assistant_id).await?;

    db.query_unpaged(
        "DELETE FROM inertial_eclipse.accepted_shares WHERE user_id = ? AND assistant_id = ?",
        (user_id, assistant_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Also remove from reverse-lookup table
    if let Some(s) = share {
        let ts = CqlTimestamp(s.accepted_at.timestamp_millis());
        let _ = db.query_unpaged(
            "DELETE FROM inertial_eclipse.accepted_shares_by_assistant WHERE assistant_id = ? AND accepted_at = ? AND user_id = ?",
            (assistant_id, ts, user_id),
        ).await;
    }

    Ok(())
}
