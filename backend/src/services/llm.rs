use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::models::assistant::AssistantTool;

/// Context passed to execute_tool for built-in tools that need database access
pub struct ToolContext<'a> {
    pub db: Option<&'a DbSession>,
    pub assistant_id: Option<Uuid>,
    pub user_id: Option<Uuid>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LlmMessage {
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_base64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_mime_type: Option<String>,
}

#[derive(Debug)]
pub struct LlmResponse {
    pub content: String,
    pub tokens_used: i32,
    pub tool_call_records: Vec<ToolCallRecord>,
}

/// Tool definition converted for LLM providers
#[derive(Debug, Clone)]
pub struct LlmTool {
    pub id: Option<uuid::Uuid>,
    pub name: String,
    pub description: String,
    pub parameters: Value,
    pub endpoint: String,
    pub method: String,
    pub headers: Option<String>,
    /// Auth config extracted from __extended
    pub auth: Option<Value>,
    /// Query params extracted from __extended: [{"key":"k","value":"v"}, ...]
    pub query_params: Option<Vec<Value>>,
    /// Body content type: "json", "form-urlencoded", "raw"
    pub body_content_type: Option<String>,
    /// Body content template (with {{placeholders}})
    pub body_content: Option<String>,
    /// Tool type: "http_request", "send_document", "notify_human"
    pub tool_type: String,
}

/// Result of a single tool execution (for logging)
#[derive(Debug, Clone)]
pub struct ToolCallRecord {
    pub tool_id: Option<uuid::Uuid>,
    pub tool_name: String,
    pub arguments: Value,
    pub status_code: Option<i32>,
    pub response_body: Option<String>,
    pub error: Option<String>,
    pub duration_ms: i32,
    pub tool_type: String,
}

/// Extract `{{placeholder}}` variable names from a string.
fn extract_placeholders(s: &str) -> Vec<String> {
    let mut vars = Vec::new();
    let mut rest = s;
    while let Some(start) = rest.find("{{") {
        let after = &rest[start + 2..];
        if let Some(end) = after.find("}}") {
            let var_name = after[..end].trim().to_string();
            if !var_name.is_empty() && !vars.contains(&var_name) {
                vars.push(var_name);
            }
            rest = &after[end + 2..];
        } else {
            break;
        }
    }
    vars
}

/// Build a JSON Schema from placeholder variables found in endpoint, headers, and body.
fn auto_schema_from_placeholders(endpoint: &str, headers: Option<&str>, body: Option<&str>) -> Value {
    let mut vars = extract_placeholders(endpoint);
    if let Some(h) = headers {
        for v in extract_placeholders(h) {
            if !vars.contains(&v) {
                vars.push(v);
            }
        }
    }
    if let Some(b) = body {
        for v in extract_placeholders(b) {
            if !vars.contains(&v) {
                vars.push(v);
            }
        }
    }

    if vars.is_empty() {
        return json!({"type": "object", "properties": {}});
    }

    let mut properties = serde_json::Map::new();
    for var in &vars {
        properties.insert(
            var.clone(),
            json!({"type": "string", "description": format!("Value for {{{{{}}}}}", var)}),
        );
    }

    json!({
        "type": "object",
        "properties": properties,
        "required": vars,
    })
}

impl From<&AssistantTool> for LlmTool {
    fn from(t: &AssistantTool) -> Self {
        let tool_type = t.tool_type.as_deref().unwrap_or("http_request").to_string();

        // Built-in tool types use hardcoded schemas
        match tool_type.as_str() {
            "send_document" => {
                return Self {
                    id: Some(t.id),
                    name: t.name.replace(' ', "_").to_lowercase(),
                    description: t.description.clone().unwrap_or_else(|| "Envia um documento ou imagem na conversa".to_string()),
                    parameters: json!({
                        "type": "object",
                        "properties": {
                            "caption": {"type": "string", "description": "Legenda opcional para acompanhar o documento"}
                        }
                    }),
                    endpoint: t.endpoint.clone(),
                    method: String::new(),
                    headers: None,
                    auth: None,
                    query_params: None,
                    body_content_type: None,
                    body_content: None,
                    tool_type,
                };
            }
            "notify_human" => {
                return Self {
                    id: Some(t.id),
                    name: t.name.replace(' ', "_").to_lowercase(),
                    description: t.description.clone().unwrap_or_else(|| "Notifica um agente humano para intervir na conversa quando não conseguir resolver o problema do usuário".to_string()),
                    parameters: json!({
                        "type": "object",
                        "properties": {
                            "reason": {"type": "string", "description": "Motivo pelo qual um agente humano é necessário"}
                        },
                        "required": ["reason"]
                    }),
                    endpoint: String::new(),
                    method: String::new(),
                    headers: None,
                    auth: None,
                    query_params: None,
                    body_content_type: None,
                    body_content: None,
                    tool_type,
                };
            }
            "schedule_appointment" => {
                return Self {
                    id: Some(t.id),
                    name: t.name.replace(' ', "_").to_lowercase(),
                    description: t.description.clone().unwrap_or_else(||
                        "Agenda, cancela ou reagenda compromissos. IMPORTANTE: SEMPRE use check_availability ANTES de agendar. Use week_start para ver dias disponíveis, depois date para horários específicos. Nunca agende sem verificar disponibilidade primeiro.".to_string()
                    ),
                    parameters: json!({
                        "type": "object",
                        "properties": {
                            "action": {
                                "type": "string",
                                "enum": ["check_availability", "create", "cancel", "reschedule"],
                                "description": "Ação: check_availability (SEMPRE use primeiro — verificar disponibilidade), create (novo agendamento), cancel (cancelar), reschedule (reagendar)"
                            },
                            "client_name": { "type": "string", "description": "Nome completo do cliente" },
                            "client_email": { "type": "string", "description": "Email do cliente" },
                            "client_phone": { "type": "string", "description": "Telefone com código do país (ex: +5511999999999)" },
                            "date_time": { "type": "string", "description": "Data e hora ISO 8601 (ex: 2026-04-15T14:00:00)" },
                            "duration_minutes": { "type": "integer", "description": "Duração em minutos" },
                            "appointment_type": { "type": "string", "description": "Tipo/motivo (ex: consulta, reunião, demonstração)" },
                            "notes": { "type": "string", "description": "Observações adicionais" },
                            "appointment_id": { "type": "string", "description": "ID do agendamento (obrigatório para cancel e reschedule)" },
                            "date": { "type": "string", "description": "Data no formato YYYY-MM-DD (para check_availability de um dia específico)" },
                            "week_start": { "type": "string", "description": "Data início da semana YYYY-MM-DD (para check_availability — retorna resumo de 7 dias com disponibilidade)" }
                        },
                        "required": ["action"]
                    }),
                    endpoint: String::new(),
                    method: String::new(),
                    headers: None,
                    auth: None,
                    query_params: None,
                    body_content_type: None,
                    body_content: None,
                    tool_type,
                };
            }
            _ => {}
        }

        // HTTP Request tool — existing logic
        let mut body_content: Option<String> = None;
        let mut auth: Option<Value> = None;
        let mut query_params: Option<Vec<Value>> = None;
        let mut body_content_type: Option<String> = None;

        let user_schema = t
            .schema_json
            .as_deref()
            .and_then(|s| serde_json::from_str::<Value>(s).ok())
            .and_then(|v| {
                if v.get("__extended").and_then(|e| e.as_bool()).unwrap_or(false) {
                    body_content = v.get("bodyContent")
                        .and_then(|b| b.as_str())
                        .map(|s| s.to_string());
                    auth = v.get("auth").cloned();
                    query_params = v.get("queryParams")
                        .and_then(|qp| qp.as_array())
                        .cloned();
                    body_content_type = v.get("bodyContentType")
                        .and_then(|b| b.as_str())
                        .map(|s| s.to_string());

                    v.get("schema")
                        .and_then(|s| {
                            if s.is_string() {
                                serde_json::from_str(s.as_str().unwrap()).ok()
                            } else if s.is_object() {
                                Some(s.clone())
                            } else {
                                None
                            }
                        })
                } else {
                    Some(v)
                }
            });

        let parameters = match &user_schema {
            Some(schema) if schema.get("properties").and_then(|p| p.as_object()).map(|o| !o.is_empty()).unwrap_or(false) => {
                schema.clone()
            }
            _ => {
                auto_schema_from_placeholders(
                    &t.endpoint,
                    t.headers_json.as_deref(),
                    body_content.as_deref(),
                )
            }
        };

        Self {
            id: Some(t.id),
            name: t.name.replace(' ', "_").to_lowercase(),
            description: t.description.clone().unwrap_or_default(),
            parameters,
            endpoint: t.endpoint.clone(),
            method: t.method.clone(),
            headers: t.headers_json.clone(),
            auth,
            query_params,
            body_content_type,
            body_content,
            tool_type,
        }
    }
}

pub async fn call_llm(
    provider: &str,
    model: &str,
    api_key: &str,
    messages: Vec<LlmMessage>,
    temperature: f32,
    max_tokens: i32,
) -> Result<LlmResponse, AppError> {
    call_llm_with_tools(provider, model, api_key, messages, temperature, max_tokens, &[]).await
}

pub async fn call_llm_with_tools(
    provider: &str,
    model: &str,
    api_key: &str,
    messages: Vec<LlmMessage>,
    temperature: f32,
    max_tokens: i32,
    tools: &[LlmTool],
) -> Result<LlmResponse, AppError> {
    let ctx = ToolContext { db: None, assistant_id: None, user_id: None };
    call_llm_with_tools_ctx(provider, model, api_key, messages, temperature, max_tokens, tools, &ctx).await
}

pub async fn call_llm_with_tools_ctx(
    provider: &str,
    model: &str,
    api_key: &str,
    messages: Vec<LlmMessage>,
    temperature: f32,
    max_tokens: i32,
    tools: &[LlmTool],
    ctx: &ToolContext<'_>,
) -> Result<LlmResponse, AppError> {
    let client = Client::new();

    match provider {
        "openai" => call_openai_with_tools(&client, api_key, model, messages, temperature, max_tokens, tools, ctx).await,
        "claude" => call_claude_with_tools(&client, api_key, model, messages, temperature, max_tokens, tools, ctx).await,
        "gemini" => call_gemini_with_tools(&client, api_key, model, messages, temperature, max_tokens).await,
        _ => Err(AppError::BadRequest(format!("Unknown LLM provider: {provider}"))),
    }
}

struct RawLlmResult {
    content: String,
    tokens: i32,
    tool_calls: Option<Vec<ToolCall>>,
    /// Raw tool_calls JSON from OpenAI (needed to echo back in conversation)
    raw_tool_calls: Option<Value>,
    /// Raw content blocks from Claude (needed to echo back tool_use blocks)
    raw_content_blocks: Option<Value>,
}

struct ToolCall {
    id: String,
    name: String,
    arguments: Value,
}

/// Replace `{{key}}` placeholders in a string with values from the arguments JSON object.
fn interpolate_template(template: &str, arguments: &Value) -> String {
    let mut result = template.to_string();
    if let Some(obj) = arguments.as_object() {
        for (key, value) in obj {
            let placeholder = format!("{{{{{}}}}}", key); // produces {{key}}
            let replacement = match value {
                Value::String(s) => s.clone(),
                Value::Null => String::new(),
                other => other.to_string(),
            };
            result = result.replace(&placeholder, &replacement);
        }
    }
    result
}

async fn execute_tool(client: &Client, tool: &LlmTool, arguments: &Value, ctx: &ToolContext<'_>) -> (String, ToolCallRecord) {
    let start = std::time::Instant::now();

    // Built-in tool types return synthetic results — actual side-effects are handled post-LLM
    match tool.tool_type.as_str() {
        "send_document" => {
            let result = r#"{"status":"queued","message":"Documento será enviado ao usuário."}"#.to_string();
            let record = ToolCallRecord {
                tool_id: tool.id,
                tool_name: tool.name.clone(),
                arguments: arguments.clone(),
                status_code: Some(200),
                response_body: Some(result.clone()),
                error: None,
                duration_ms: 0,
                tool_type: "send_document".to_string(),
            };
            return (result, record);
        }
        "notify_human" => {
            let result = r#"{"status":"queued","message":"Agente humano foi notificado."}"#.to_string();
            let record = ToolCallRecord {
                tool_id: tool.id,
                tool_name: tool.name.clone(),
                arguments: arguments.clone(),
                status_code: Some(200),
                response_body: Some(result.clone()),
                error: None,
                duration_ms: 0,
                tool_type: "notify_human".to_string(),
            };
            return (result, record);
        }
        "schedule_appointment" => {
            let action = arguments.get("action").and_then(|v| v.as_str()).unwrap_or("create");
            tracing::info!(action = %action, arguments = %arguments, "schedule_appointment tool called");

            let result = if action == "check_availability" {
                if let (Some(db), Some(assistant_id)) = (ctx.db, ctx.assistant_id) {
                    let date = arguments.get("date").and_then(|v| v.as_str()).unwrap_or("");
                    let week_start = arguments.get("week_start").and_then(|v| v.as_str()).unwrap_or("");

                    if !week_start.is_empty() {
                        // Week-level availability summary (7 days)
                        match crate::services::appointment::get_available_days(db, &assistant_id, week_start).await {
                            Ok(days) => json!({"status": "ok", "week_start": week_start, "days": days}).to_string(),
                            Err(e) => json!({"status": "error", "message": e.to_string()}).to_string(),
                        }
                    } else if !date.is_empty() {
                        // Day-level: specific time slots
                        match crate::services::appointment::get_available_slots(db, &assistant_id, date).await {
                            Ok(slots) if slots.is_empty() => {
                                json!({"status": "ok", "available_slots": [], "message": "Não há horários disponíveis nesta data."}).to_string()
                            }
                            Ok(slots) => {
                                json!({"status": "ok", "available_slots": slots, "date": date}).to_string()
                            }
                            Err(e) => json!({"status": "error", "message": e.to_string()}).to_string(),
                        }
                    } else {
                        json!({"status": "error", "message": "Informe 'date' (YYYY-MM-DD) para horários ou 'week_start' (YYYY-MM-DD) para disponibilidade semanal."}).to_string()
                    }
                } else {
                    json!({"status": "error", "message": "Serviço de agendamento indisponível"}).to_string()
                }
            } else if action == "create" {
                // Pre-validate before telling the LLM it's queued
                if let (Some(db), Some(assistant_id)) = (ctx.db, ctx.assistant_id) {
                    let date_time_str = arguments.get("date_time").and_then(|v| v.as_str()).unwrap_or("");
                    let tz = crate::services::appointment::resolve_assistant_tz(db, &assistant_id).await;
                    let dt_utc = crate::services::appointment::parse_datetime_in_tz(date_time_str, &tz);

                    match dt_utc {
                        Some(dt_utc) => {
                            let duration = if let Some(d) = arguments.get("duration_minutes").and_then(|v| v.as_i64()) {
                                d as i32
                            } else {
                                match crate::services::appointment::get_availability(db, &assistant_id).await {
                                    Ok(Some(avail)) => avail.default_duration_minutes,
                                    _ => 30,
                                }
                            };
                            match crate::services::appointment::validate_appointment(db, &assistant_id, &dt_utc, duration, None).await {
                                Ok(errors) if !errors.is_empty() => {
                                    json!({"status": "error", "action": "create", "errors": errors, "message": "Não foi possível agendar. Informe os erros ao cliente e sugira alternativas."}).to_string()
                                }
                                Ok(_) => {
                                    json!({"status": "queued", "action": "create", "message": "Agendamento validado e será processado."}).to_string()
                                }
                                Err(e) => {
                                    json!({"status": "error", "action": "create", "message": format!("Erro ao validar: {}", e)}).to_string()
                                }
                            }
                        }
                        None => {
                            json!({"status": "error", "action": "create", "message": "Data/hora inválida. Use formato ISO 8601 (ex: 2026-04-15T14:00:00)"}).to_string()
                        }
                    }
                } else {
                    json!({"status": "error", "message": "Serviço de agendamento indisponível"}).to_string()
                }
            } else if action == "reschedule" {
                // Pre-validate rescheduling
                if let (Some(db), Some(assistant_id)) = (ctx.db, ctx.assistant_id) {
                    let date_time_str = arguments.get("date_time").and_then(|v| v.as_str()).unwrap_or("");
                    let appointment_id_str = arguments.get("appointment_id").and_then(|v| v.as_str()).unwrap_or("");
                    let tz = crate::services::appointment::resolve_assistant_tz(db, &assistant_id).await;
                    let dt_utc = crate::services::appointment::parse_datetime_in_tz(date_time_str, &tz);

                    match (dt_utc, uuid::Uuid::parse_str(appointment_id_str)) {
                        (Some(dt_utc), Ok(appt_id)) => {
                            let duration = if let Some(d) = arguments.get("duration_minutes").and_then(|v| v.as_i64()) {
                                d as i32
                            } else if let Some(user_id) = ctx.user_id {
                                match crate::services::appointment::get_appointment(db, &user_id, &appt_id).await {
                                    Ok(existing) => existing.duration_minutes,
                                    _ => 30,
                                }
                            } else {
                                30
                            };
                            match crate::services::appointment::validate_appointment(db, &assistant_id, &dt_utc, duration, Some(&appt_id)).await {
                                Ok(errors) if !errors.is_empty() => {
                                    json!({"status": "error", "action": "reschedule", "errors": errors, "message": "Não foi possível reagendar. Informe os erros ao cliente e sugira alternativas."}).to_string()
                                }
                                Ok(_) => {
                                    json!({"status": "queued", "action": "reschedule", "message": "Reagendamento validado e será processado."}).to_string()
                                }
                                Err(e) => {
                                    json!({"status": "error", "action": "reschedule", "message": format!("Erro ao validar: {}", e)}).to_string()
                                }
                            }
                        }
                        _ => {
                            json!({"status": "error", "action": "reschedule", "message": "Data/hora ou ID do agendamento inválido."}).to_string()
                        }
                    }
                } else {
                    json!({"status": "error", "message": "Serviço de agendamento indisponível"}).to_string()
                }
            } else {
                // cancel — no pre-validation needed, side effects in messaging.rs
                json!({"status": "queued", "action": action, "message": "Solicitação será processada."}).to_string()
            };

            let record = ToolCallRecord {
                tool_id: tool.id,
                tool_name: tool.name.clone(),
                arguments: arguments.clone(),
                status_code: Some(200),
                response_body: Some(result.clone()),
                error: None,
                duration_ms: start.elapsed().as_millis() as i32,
                tool_type: "schedule_appointment".to_string(),
            };
            return (result, record);
        }
        _ => {}
    }

    // Interpolate {{placeholders}} in the endpoint URL with argument values
    let mut endpoint = interpolate_template(&tool.endpoint, arguments);

    // Apply query parameters from extended config
    if let Some(query_params) = &tool.query_params {
        if let Ok(mut url) = reqwest::Url::parse(&endpoint) {
            for param in query_params {
                if let (Some(key), Some(value)) = (
                    param.get("key").and_then(|k| k.as_str()),
                    param.get("value").and_then(|v| v.as_str()),
                ) {
                    if !key.trim().is_empty() {
                        let interpolated_value = interpolate_template(value, arguments);
                        url.query_pairs_mut().append_pair(key, &interpolated_value);
                    }
                }
            }
            endpoint = url.to_string();
        }
    }

    let mut req = match tool.method.to_uppercase().as_str() {
        "GET" => client.get(&endpoint),
        "POST" => client.post(&endpoint),
        "PUT" => client.put(&endpoint),
        "PATCH" => client.patch(&endpoint),
        "DELETE" => client.delete(&endpoint),
        _ => client.post(&endpoint),
    };

    // Add custom headers (with placeholder interpolation)
    if let Some(headers_json) = &tool.headers {
        let interpolated = interpolate_template(headers_json, arguments);
        if let Ok(headers) = serde_json::from_str::<Value>(&interpolated) {
            if let Some(obj) = headers.as_object() {
                for (k, v) in obj {
                    if let Some(val) = v.as_str() {
                        req = req.header(k.as_str(), val);
                    }
                }
            }
        }
    }

    // Apply auth from extended config
    if let Some(auth) = &tool.auth {
        let auth_type = auth.get("type").and_then(|t| t.as_str()).unwrap_or("none");
        match auth_type {
            "bearer" => {
                if let Some(token) = auth.get("token").and_then(|t| t.as_str()) {
                    req = req.header("Authorization", format!("Bearer {token}"));
                }
            }
            "basic" => {
                let username = auth.get("username").and_then(|u| u.as_str()).unwrap_or("");
                let password = auth.get("password").and_then(|p| p.as_str()).unwrap_or("");
                req = req.basic_auth(username, Some(password));
            }
            "header" => {
                if let (Some(name), Some(value)) = (
                    auth.get("headerName").and_then(|n| n.as_str()),
                    auth.get("headerValue").and_then(|v| v.as_str()),
                ) {
                    req = req.header(name, value);
                }
            }
            _ => {}
        }
    }

    // For POST/PUT/PATCH, send body content or arguments
    if matches!(tool.method.to_uppercase().as_str(), "POST" | "PUT" | "PATCH") {
        if let Some(body_template) = &tool.body_content {
            if !body_template.trim().is_empty() {
                let interpolated_body = interpolate_template(body_template, arguments);
                let content_type = tool.body_content_type.as_deref().unwrap_or("json");
                match content_type {
                    "json" => {
                        req = req.header("Content-Type", "application/json");
                        req = req.body(interpolated_body);
                    }
                    "form-urlencoded" => {
                        req = req.header("Content-Type", "application/x-www-form-urlencoded");
                        req = req.body(interpolated_body);
                    }
                    _ => {
                        req = req.body(interpolated_body);
                    }
                }
            } else {
                req = req.json(arguments);
            }
        } else {
            req = req.json(arguments);
        }
    }

    let duration_ms = |s: std::time::Instant| s.elapsed().as_millis() as i32;

    tracing::info!(tool = %tool.name, endpoint = %endpoint, method = %tool.method, "Executing tool call");

    match req.send().await {
        Ok(resp) => {
            let status = resp.status().as_u16() as i32;
            tracing::info!(tool = %tool.name, status = status, "Tool call response");
            match resp.text().await {
                Ok(text) => {
                    let result_text = if text.len() > 65536 {
                        format!("{}...[truncated]", &text[..65536])
                    } else {
                        text.clone()
                    };
                    let record = ToolCallRecord {
                        tool_id: tool.id,
                        tool_name: tool.name.clone(),
                        arguments: arguments.clone(),
                        status_code: Some(status),
                        response_body: Some(if text.len() > 8000 { format!("{}...[truncated]", &text[..8000]) } else { text }),
                        error: None,
                        duration_ms: duration_ms(start),
                        tool_type: tool.tool_type.clone(),
                    };
                    (result_text, record)
                }
                Err(e) => {
                    let err_msg = format!("Error reading tool response: {e}");
                    let record = ToolCallRecord {
                        tool_id: tool.id,
                        tool_name: tool.name.clone(),
                        arguments: arguments.clone(),
                        status_code: Some(status),
                        response_body: None,
                        error: Some(err_msg.clone()),
                        duration_ms: duration_ms(start),
                        tool_type: tool.tool_type.clone(),
                    };
                    (err_msg, record)
                }
            }
        }
        Err(e) => {
            let err_msg = format!("Error calling tool: {e}");
            tracing::error!(tool = %tool.name, error = %e, "Tool call failed");
            let record = ToolCallRecord {
                tool_id: tool.id,
                tool_name: tool.name.clone(),
                arguments: arguments.clone(),
                status_code: None,
                response_body: None,
                error: Some(err_msg.clone()),
                duration_ms: duration_ms(start),
                tool_type: tool.tool_type.clone(),
            };
            (err_msg, record)
        }
    }
}

// =====================================================================
// OpenAI
// =====================================================================

/// Returns true for reasoning models that don't accept temperature.
/// Includes o-series and GPT-5 family (all are reasoning models).
fn is_openai_reasoning_model(model: &str) -> bool {
    model.starts_with("o1")
        || model.starts_with("o3")
        || model.starts_with("o4")
        || model.starts_with("gpt-5")
}

/// Returns true for models that require max_completion_tokens instead of max_tokens
fn is_openai_new_api_model(model: &str) -> bool {
    is_openai_reasoning_model(model)
        || model.starts_with("gpt-5")
        || model.starts_with("gpt-4.1")
        || model.starts_with("chatgpt-")
}

/// OpenAI tool call loop with proper role="tool" + tool_call_id formatting
async fn call_openai_with_tools(
    client: &Client,
    api_key: &str,
    model: &str,
    messages: Vec<LlmMessage>,
    temperature: f32,
    max_tokens: i32,
    tools: &[LlmTool],
    ctx: &ToolContext<'_>,
) -> Result<LlmResponse, AppError> {
    // Convert LlmMessages to OpenAI JSON format.
    // GPT-5, GPT-4.1, o-series and chatgpt-* models use "developer" instead of "system".
    let use_developer_role = is_openai_new_api_model(model);
    let mut raw_messages: Vec<Value> = messages
        .iter()
        .map(|m| {
            let role = if m.role == "system" && use_developer_role {
                "developer"
            } else {
                &m.role
            };
            let content = if let (Some(b64), Some(mime)) = (&m.media_base64, &m.media_mime_type) {
                let mut parts = vec![];
                if !m.content.is_empty() {
                    parts.push(json!({"type": "text", "text": m.content}));
                }
                if mime == "application/pdf" {
                    parts.push(json!({
                        "type": "file",
                        "file": { "filename": "document.pdf", "file_data": format!("data:{mime};base64,{b64}") }
                    }));
                } else {
                    parts.push(json!({
                        "type": "image_url",
                        "image_url": { "url": format!("data:{mime};base64,{b64}") }
                    }));
                }
                json!(parts)
            } else {
                json!(m.content)
            };
            json!({"role": role, "content": content})
        })
        .collect();

    let mut total_tokens = 0i32;
    let mut all_records: Vec<ToolCallRecord> = Vec::new();

    for round in 0..5 {
        let result = call_openai_raw(client, api_key, model, &raw_messages, temperature, max_tokens, tools).await?;
        total_tokens += result.tokens;

        match result.tool_calls {
            Some(calls) if !calls.is_empty() => {
                let tool_names: Vec<&str> = calls.iter().map(|c| c.name.as_str()).collect();
                tracing::info!(round = round, tools = ?tool_names, "OpenAI tool call round");
                // Echo back assistant message WITH the raw tool_calls array
                let mut assistant_msg = json!({
                    "role": "assistant",
                });
                if !result.content.is_empty() {
                    assistant_msg["content"] = json!(result.content);
                }
                if let Some(raw_tc) = &result.raw_tool_calls {
                    assistant_msg["tool_calls"] = raw_tc.clone();
                }
                raw_messages.push(assistant_msg);

                // Execute each tool and add results with role="tool" + tool_call_id
                for call in &calls {
                    let tool = tools.iter().find(|t| t.name == call.name);
                    let (tool_result, record) = if let Some(t) = tool {
                        execute_tool(client, t, &call.arguments, ctx).await
                    } else {
                        let err_msg = format!("Error: tool '{}' not found", call.name);
                        (err_msg.clone(), ToolCallRecord {
                            tool_id: None,
                            tool_name: call.name.clone(),
                            arguments: call.arguments.clone(),
                            status_code: None,
                            response_body: None,
                            error: Some(err_msg),
                            duration_ms: 0,
                            tool_type: "http_request".to_string(),
                        })
                    };
                    all_records.push(record);

                    raw_messages.push(json!({
                        "role": "tool",
                        "tool_call_id": call.id,
                        "content": tool_result,
                    }));
                }
            }
            _ => {
                return Ok(LlmResponse {
                    content: result.content,
                    tokens_used: total_tokens,
                    tool_call_records: all_records,
                });
            }
        }
    }

    Err(AppError::InternalError("Too many tool call rounds".into()))
}

async fn call_openai_raw(
    client: &Client,
    api_key: &str,
    model: &str,
    messages: &[Value],
    temperature: f32,
    max_tokens: i32,
    tools: &[LlmTool],
) -> Result<RawLlmResult, AppError> {
    let mut body = json!({
        "model": model,
        "messages": messages,
    });

    // Newer models use max_completion_tokens; older ones use max_tokens
    if is_openai_new_api_model(model) {
        body["max_completion_tokens"] = json!(max_tokens);
    } else {
        body["max_tokens"] = json!(max_tokens);
    }

    // Reasoning models don't accept temperature
    if !is_openai_reasoning_model(model) {
        body["temperature"] = json!(temperature);
    }

    if !tools.is_empty() {
        let functions: Vec<Value> = tools
            .iter()
            .map(|t| {
                json!({
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters,
                    }
                })
            })
            .collect();
        body["tools"] = json!(functions);
    }

    let resp = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {api_key}"))
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::InternalError(format!("OpenAI request failed: {e}")))?;

    let data: Value = resp
        .json()
        .await
        .map_err(|e| AppError::InternalError(format!("OpenAI response parse failed: {e}")))?;

    // Check for API error response
    if let Some(err) = data["error"]["message"].as_str() {
        tracing::error!("OpenAI API error for model {model}: {err}");
        return Err(AppError::InternalError(format!("OpenAI API error: {err}")));
    }

    let message = &data["choices"][0]["message"];
    let content = message["content"].as_str().unwrap_or("").to_string();
    let tokens = data["usage"]["total_tokens"].as_i64().unwrap_or(0) as i32;

    // Preserve raw tool_calls for echoing back
    let raw_tool_calls = message.get("tool_calls").cloned();

    let tool_calls = message["tool_calls"]
        .as_array()
        .map(|calls| {
            calls
                .iter()
                .filter_map(|c| {
                    let id = c["id"].as_str()?.to_string();
                    let name = c["function"]["name"].as_str()?.to_string();
                    let args: Value = c["function"]["arguments"]
                        .as_str()
                        .and_then(|s| serde_json::from_str(s).ok())
                        .unwrap_or(json!({}));
                    Some(ToolCall { id, name, arguments: args })
                })
                .collect()
        });

    Ok(RawLlmResult {
        content,
        tokens,
        tool_calls,
        raw_tool_calls,
        raw_content_blocks: None,
    })
}

// =====================================================================
// Claude
// =====================================================================

/// Merge consecutive same-role messages and ensure alternation starts with "user".
/// Claude API requires strict user/assistant alternation.
fn coalesce_claude_messages(messages: Vec<Value>) -> Vec<Value> {
    if messages.is_empty() {
        return messages;
    }

    let mut coalesced: Vec<Value> = Vec::new();
    for msg in messages {
        let role = msg["role"].as_str().unwrap_or("user");
        if let Some(last) = coalesced.last_mut() {
            if last["role"].as_str().unwrap_or("") == role {
                // Merge: append content with separator
                let prev = last["content"].as_str().unwrap_or("").to_string();
                let curr = msg["content"].as_str().unwrap_or("");
                last["content"] = json!(format!("{prev}\n\n{curr}"));
                continue;
            }
        }
        coalesced.push(msg);
    }

    // Ensure first message is "user" (Claude requirement)
    if let Some(first) = coalesced.first() {
        if first["role"].as_str() == Some("assistant") {
            coalesced.insert(0, json!({"role": "user", "content": "Continue."}));
        }
    }

    coalesced
}

/// Claude tool call loop with proper tool_result content blocks + tool_use_id
async fn call_claude_with_tools(
    client: &Client,
    api_key: &str,
    model: &str,
    messages: Vec<LlmMessage>,
    temperature: f32,
    max_tokens: i32,
    tools: &[LlmTool],
    ctx: &ToolContext<'_>,
) -> Result<LlmResponse, AppError> {
    // Extract system message
    let system_msg = messages
        .iter()
        .find(|m| m.role == "system")
        .map(|m| m.content.clone());

    // Build initial messages (excluding system), then coalesce for alternation
    let initial: Vec<Value> = messages
        .iter()
        .filter(|m| m.role != "system")
        .map(|m| {
            let content = if let (Some(b64), Some(mime)) = (&m.media_base64, &m.media_mime_type) {
                let mut parts = vec![];
                if !m.content.is_empty() {
                    parts.push(json!({"type": "text", "text": m.content}));
                }
                if mime == "application/pdf" {
                    parts.push(json!({
                        "type": "document",
                        "source": { "type": "base64", "media_type": mime, "data": b64 }
                    }));
                } else {
                    parts.push(json!({
                        "type": "image",
                        "source": { "type": "base64", "media_type": mime, "data": b64 }
                    }));
                }
                json!(parts)
            } else {
                json!(m.content)
            };
            json!({"role": m.role, "content": content})
        })
        .collect();
    let mut raw_messages = coalesce_claude_messages(initial);

    let mut total_tokens = 0i32;
    let mut all_records: Vec<ToolCallRecord> = Vec::new();

    for round in 0..5 {
        let result = call_claude_raw(client, api_key, model, &raw_messages, &system_msg, temperature, max_tokens, tools).await?;
        total_tokens += result.tokens;

        match result.tool_calls {
            Some(calls) if !calls.is_empty() => {
                let tool_names: Vec<&str> = calls.iter().map(|c| c.name.as_str()).collect();
                tracing::info!(round = round, tools = ?tool_names, "Claude tool call round");
                // Echo back assistant message with the raw content blocks (text + tool_use)
                if let Some(raw_blocks) = &result.raw_content_blocks {
                    raw_messages.push(json!({
                        "role": "assistant",
                        "content": raw_blocks,
                    }));
                } else {
                    raw_messages.push(json!({
                        "role": "assistant",
                        "content": result.content,
                    }));
                }

                // Execute tools and build a SINGLE user message with all tool_result blocks
                let mut tool_result_blocks: Vec<Value> = Vec::new();
                for call in &calls {
                    let tool = tools.iter().find(|t| t.name == call.name);
                    let (tool_result, record) = if let Some(t) = tool {
                        execute_tool(client, t, &call.arguments, ctx).await
                    } else {
                        let err_msg = format!("Error: tool '{}' not found", call.name);
                        (err_msg.clone(), ToolCallRecord {
                            tool_id: None,
                            tool_name: call.name.clone(),
                            arguments: call.arguments.clone(),
                            status_code: None,
                            response_body: None,
                            error: Some(err_msg),
                            duration_ms: 0,
                            tool_type: "http_request".to_string(),
                        })
                    };
                    all_records.push(record);

                    tool_result_blocks.push(json!({
                        "type": "tool_result",
                        "tool_use_id": call.id,
                        "content": tool_result,
                    }));
                }

                raw_messages.push(json!({
                    "role": "user",
                    "content": tool_result_blocks,
                }));
            }
            _ => {
                return Ok(LlmResponse {
                    content: result.content,
                    tokens_used: total_tokens,
                    tool_call_records: all_records,
                });
            }
        }
    }

    Err(AppError::InternalError("Too many tool call rounds".into()))
}

async fn call_claude_raw(
    client: &Client,
    api_key: &str,
    model: &str,
    messages: &[Value],
    system_msg: &Option<String>,
    temperature: f32,
    max_tokens: i32,
    tools: &[LlmTool],
) -> Result<RawLlmResult, AppError> {
    let mut body = json!({
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    });

    if let Some(system) = system_msg {
        body["system"] = json!(system);
    }

    if !tools.is_empty() {
        let tool_defs: Vec<Value> = tools
            .iter()
            .map(|t| {
                json!({
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.parameters,
                })
            })
            .collect();
        body["tools"] = json!(tool_defs);
    }

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::InternalError(format!("Claude request failed: {e}")))?;

    let data: Value = resp
        .json()
        .await
        .map_err(|e| AppError::InternalError(format!("Claude response parse failed: {e}")))?;

    // Check for API error response
    if let Some(err) = data["error"]["message"].as_str() {
        tracing::error!("Claude API error for model {model}: {err}");
        return Err(AppError::InternalError(format!("Claude API error: {err}")));
    }

    let mut content = String::new();
    let mut tool_calls = Vec::new();

    // Preserve raw content blocks for echoing back (needed for tool_use IDs)
    let raw_content_blocks = data.get("content").cloned();

    if let Some(blocks) = data["content"].as_array() {
        for block in blocks {
            match block["type"].as_str() {
                Some("text") => {
                    content.push_str(block["text"].as_str().unwrap_or(""));
                }
                Some("tool_use") => {
                    if let (Some(id), Some(name)) = (block["id"].as_str(), block["name"].as_str()) {
                        tool_calls.push(ToolCall {
                            id: id.to_string(),
                            name: name.to_string(),
                            arguments: block["input"].clone(),
                        });
                    }
                }
                _ => {}
            }
        }
    }

    let input_tokens = data["usage"]["input_tokens"].as_i64().unwrap_or(0);
    let output_tokens = data["usage"]["output_tokens"].as_i64().unwrap_or(0);

    Ok(RawLlmResult {
        content,
        tokens: (input_tokens + output_tokens) as i32,
        tool_calls: if tool_calls.is_empty() { None } else { Some(tool_calls) },
        raw_tool_calls: None,
        raw_content_blocks,
    })
}

// =====================================================================
// Gemini (no tool support for now)
// =====================================================================

async fn call_gemini_with_tools(
    client: &Client,
    api_key: &str,
    model: &str,
    messages: Vec<LlmMessage>,
    temperature: f32,
    max_tokens: i32,
) -> Result<LlmResponse, AppError> {
    let system_instruction = messages
        .iter()
        .find(|m| m.role == "system")
        .map(|m| json!({"parts": [{"text": m.content}]}));

    let contents: Vec<Value> = messages
        .iter()
        .filter(|m| m.role != "system")
        .map(|m| {
            let role = if m.role == "assistant" { "model" } else { "user" };
            let parts = if let (Some(b64), Some(mime)) = (&m.media_base64, &m.media_mime_type) {
                let mut p = vec![];
                if !m.content.is_empty() {
                    p.push(json!({"text": m.content}));
                }
                p.push(json!({"inline_data": {"mime_type": mime, "data": b64}}));
                p
            } else {
                vec![json!({"text": m.content})]
            };
            json!({"role": role, "parts": parts})
        })
        .collect();

    // Gemini also needs consecutive same-role messages merged
    let contents = coalesce_gemini_contents(contents);

    let mut body = json!({
        "contents": contents,
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
        },
    });

    if let Some(si) = system_instruction {
        body["systemInstruction"] = si;
    }

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    );

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::InternalError(format!("Gemini request failed: {e}")))?;

    let data: Value = resp
        .json()
        .await
        .map_err(|e| AppError::InternalError(format!("Gemini response parse failed: {e}")))?;

    // Check for API error response
    if let Some(err) = data["error"]["message"].as_str() {
        tracing::error!("Gemini API error for model {model}: {err}");
        return Err(AppError::InternalError(format!("Gemini API error: {err}")));
    }

    let content = data["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .unwrap_or("")
        .to_string();

    let tokens = data["usageMetadata"]["totalTokenCount"]
        .as_i64()
        .unwrap_or(0) as i32;

    Ok(LlmResponse { content, tokens_used: tokens, tool_call_records: Vec::new() })
}

/// Merge consecutive same-role Gemini contents into one entry.
fn coalesce_gemini_contents(contents: Vec<Value>) -> Vec<Value> {
    if contents.is_empty() {
        return contents;
    }

    let mut coalesced: Vec<Value> = Vec::new();
    for msg in contents {
        let role = msg["role"].as_str().unwrap_or("user");
        if let Some(last) = coalesced.last_mut() {
            if last["role"].as_str().unwrap_or("") == role {
                // Merge parts arrays
                if let (Some(existing), Some(new)) = (
                    last.get_mut("parts").and_then(|p| p.as_array_mut()),
                    msg["parts"].as_array(),
                ) {
                    existing.extend(new.iter().cloned());
                }
                continue;
            }
        }
        coalesced.push(msg);
    }

    coalesced
}
