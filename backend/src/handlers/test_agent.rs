use axum::extract::Extension;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::db::DbSession;
use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::services::encryption::EncryptionService;
use crate::services::llm::{self, LlmMessage};

// --- Test Agent Chat (simple LLM call, no tools/RAG/storage) ---

#[derive(Debug, Deserialize)]
pub struct TestAgentChatRequest {
    pub provider: String,
    pub model: String,
    pub system_prompt: String,
    pub messages: Vec<TestAgentMessage>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<i32>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct TestAgentMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct TestAgentChatResponse {
    pub reply: String,
    pub tokens_used: i32,
}

pub async fn chat(
    Extension(db): Extension<DbSession>,
    Extension(encryption): Extension<EncryptionService>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<TestAgentChatRequest>,
) -> Result<Json<TestAgentChatResponse>, AppError> {
    let user = crate::services::auth::get_user_by_id(&db, &auth_user.user_id).await?;
    let encrypted_key = match req.provider.as_str() {
        "openai" => user.api_key_openai,
        "claude" => user.api_key_claude,
        "gemini" => user.api_key_gemini,
        _ => None,
    }
    .ok_or_else(|| AppError::BadRequest("API key not configured for this provider".into()))?;

    let api_key = encryption.decrypt(&encrypted_key)?;

    let mut llm_messages = vec![LlmMessage {
        role: "system".into(),
        content: req.system_prompt,
        media_base64: None,
        media_mime_type: None,
    }];
    for msg in &req.messages {
        llm_messages.push(LlmMessage {
            role: msg.role.clone(),
            content: msg.content.clone(),
            media_base64: None,
            media_mime_type: None,
        });
    }

    let temperature = req.temperature.unwrap_or(0.7);
    let max_tokens = req.max_tokens.unwrap_or(1024);

    let response = llm::call_llm(
        &req.provider, &req.model, &api_key, llm_messages, temperature, max_tokens,
    )
    .await?;

    Ok(Json(TestAgentChatResponse {
        reply: response.content,
        tokens_used: response.tokens_used,
    }))
}

// --- Generate Test Prompt from assistant's system prompt ---

#[derive(Debug, Deserialize)]
pub struct GeneratePromptRequest {
    pub provider: String,
    pub model: String,
    pub assistant_system_prompt: String,
}

#[derive(Debug, Serialize)]
pub struct GeneratePromptResponse {
    pub prompt: String,
    pub tokens_used: i32,
}

pub async fn generate_prompt(
    Extension(db): Extension<DbSession>,
    Extension(encryption): Extension<EncryptionService>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<GeneratePromptRequest>,
) -> Result<Json<GeneratePromptResponse>, AppError> {
    let user = crate::services::auth::get_user_by_id(&db, &auth_user.user_id).await?;
    let encrypted_key = match req.provider.as_str() {
        "openai" => user.api_key_openai,
        "claude" => user.api_key_claude,
        "gemini" => user.api_key_gemini,
        _ => None,
    }
    .ok_or_else(|| AppError::BadRequest("API key not configured for this provider".into()))?;

    let api_key = encryption.decrypt(&encrypted_key)?;

    let system = "Você é um especialista em QA e testes de chatbots. Sua tarefa é criar um prompt de sistema para um agente de teste que vai simular um cliente conversando com um chatbot de atendimento.\n\n\
        O prompt deve instruir o agente de teste a:\n\
        1. Se comportar como um cliente real com perguntas e cenários variados\n\
        2. Testar diferentes tipos de interação (perguntas simples, complexas, edge cases, tentativas de confundir o bot)\n\
        3. Ser natural e realista na conversação\n\
        4. Variar o tom (educado, direto, confuso, impaciente)\n\
        5. Testar se o assistente segue as regras do seu prompt de sistema\n\n\
        Responda APENAS com o prompt de sistema para o agente de teste, sem explicações adicionais. O prompt deve ser em português brasileiro.";

    // Truncate very long prompts to avoid provider errors
    let assistant_prompt = if req.assistant_system_prompt.len() > 8000 {
        format!("{}...\n[truncado]", &req.assistant_system_prompt[..8000])
    } else {
        req.assistant_system_prompt.clone()
    };

    let llm_messages = vec![
        LlmMessage { role: "system".into(), content: system.into(), media_base64: None, media_mime_type: None },
        LlmMessage {
            role: "user".into(),
            content: format!(
                "Crie um prompt de agente de teste baseado no seguinte prompt de sistema do assistente oficial:\n\n---\n{}\n---",
                assistant_prompt
            ),
            media_base64: None,
            media_mime_type: None,
        },
    ];

    let response = llm::call_llm(&req.provider, &req.model, &api_key, llm_messages, 0.5, 1500).await?;

    Ok(Json(GeneratePromptResponse {
        prompt: response.content,
        tokens_used: response.tokens_used,
    }))
}

// --- Evaluate Test Conversation ---

#[derive(Debug, Deserialize)]
pub struct EvaluateRequest {
    pub provider: String,
    pub model: String,
    pub assistant_system_prompt: String,
    pub messages: Vec<TestAgentMessage>,
}

#[derive(Debug, Serialize)]
pub struct EvaluateResponse {
    pub evaluation: String,
    pub tokens_used: i32,
}

pub async fn evaluate(
    Extension(db): Extension<DbSession>,
    Extension(encryption): Extension<EncryptionService>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<EvaluateRequest>,
) -> Result<Json<EvaluateResponse>, AppError> {
    let user = crate::services::auth::get_user_by_id(&db, &auth_user.user_id).await?;
    let encrypted_key = match req.provider.as_str() {
        "openai" => user.api_key_openai,
        "claude" => user.api_key_claude,
        "gemini" => user.api_key_gemini,
        _ => None,
    }
    .ok_or_else(|| AppError::BadRequest("API key not configured for this provider".into()))?;

    let api_key = encryption.decrypt(&encrypted_key)?;

    let mut transcript = String::new();
    for msg in &req.messages {
        let label = if msg.role == "user" { "Agente de Teste (Cliente)" } else { "Assistente Oficial" };
        transcript.push_str(&format!("{}: {}\n\n", label, msg.content));
    }

    let system = "Você é um especialista em QA de chatbots e atendimento ao cliente. Analise a conversa de teste abaixo entre um Agente de Teste (simulando um cliente) e o Assistente Oficial (o chatbot sendo testado).\n\n\
        Forneça uma avaliação detalhada incluindo:\n\n\
        ## Resumo do Teste\n\
        Breve descrição dos cenários testados.\n\n\
        ## Avaliação por Critério\n\
        Para cada critério, dê uma nota de 1 a 10:\n\
        - **Aderência ao Prompt**: O assistente seguiu as instruções do seu prompt de sistema?\n\
        - **Qualidade das Respostas**: As respostas foram claras, precisas e úteis?\n\
        - **Consistência**: O assistente manteve consistência ao longo da conversa?\n\
        - **Tratamento de Edge Cases**: Como lidou com perguntas inesperadas ou fora do escopo?\n\
        - **Tom e Cordialidade**: O tom foi adequado ao contexto?\n\
        - **Completude**: As respostas cobriram adequadamente os assuntos?\n\n\
        ## Nota Geral\n\
        Nota de 1 a 10 com justificativa.\n\n\
        ## Pontos Fortes\n\
        O que o assistente fez bem.\n\n\
        ## Pontos a Melhorar\n\
        O que pode ser aprimorado, com sugestões específicas.\n\n\
        Responda em português brasileiro de forma clara e estruturada.";

    let user_content = format!(
        "Prompt de sistema do assistente oficial:\n---\n{}\n---\n\nConversa de teste:\n---\n{}\n---",
        req.assistant_system_prompt, transcript
    );

    let llm_messages = vec![
        LlmMessage { role: "system".into(), content: system.into(), media_base64: None, media_mime_type: None },
        LlmMessage { role: "user".into(), content: user_content, media_base64: None, media_mime_type: None },
    ];

    let response = llm::call_llm(&req.provider, &req.model, &api_key, llm_messages, 0.3, 3000).await?;

    Ok(Json(EvaluateResponse {
        evaluation: response.content,
        tokens_used: response.tokens_used,
    }))
}
