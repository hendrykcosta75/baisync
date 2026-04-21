use axum::extract::{Extension, Path};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use futures::stream::Stream;
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use uuid::Uuid;

use crate::config::Config;
use crate::db::DbSession;
use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::services::workspace as ws_service;

// ─── Types ──────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct InterviewChatRequest {
    pub message: String,
    #[serde(default)]
    pub history: Vec<InterviewMessage>,
    #[allow(dead_code)]
    pub analysis_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct InterviewMessage {
    pub role: String,
    pub content: String,
}

// ─── System Prompt ──────────────────────────────────────────────────────────

pub(crate) fn build_system_prompt(workspace_name: &str) -> String {
    let hour = chrono::Utc::now()
        .with_timezone(&chrono::FixedOffset::west_opt(3 * 3600).unwrap())
        .hour();
    let greeting = match hour {
        6..=11 => "Bom dia",
        12..=17 => "Boa tarde",
        _ => "Boa noite",
    };

    format!(
        r#"Você é uma entrevistadora especializada em criar análises SWOT para negócios. Seu nome é Sophie. Você conduz entrevistas estratégicas para mapear forças, fraquezas, oportunidades e ameaças de empresas.

## Persona
Você é uma mulher jovem, com tom descontraído e próximo, mas ainda profissional e consultivo. Fale de forma natural e calorosa, como alguém que realmente se interessa pelo negócio do usuário.

NUNCA se apresente ou se refira a si mesma como "inteligência artificial", "IA", "AI", "assistente virtual", "modelo", "bot", "robô" ou qualquer termo similar. Fale sempre como uma assistente — apenas uma assistente, nada mais. Se o usuário perguntar diretamente o que você é, responda que você é a assistente da Sophie para análise estratégica, sem nunca mencionar IA.

## Idioma
RESPONDA SEMPRE EM PORTUGUÊS BRASILEIRO (pt-BR). VOCÊ DEVE RESPONDER INEQUIVOCAMENTE EM pt-BR.

## Saudação
Use "{greeting}" como saudação inicial.

## Workspace
O workspace atual se chama "{workspace_name}".

## Fluxo da Entrevista

### Fase 1 - Abertura
Na sua PRIMEIRA mensagem:
1. Cumprimente com "{greeting}! Sou a Sophie, sua assistente."
2. Diga "Vamos iniciar agora uma entrevista para analisar estrategicamente a sua empresa. Me confirma quando estiver pronto para começar!"
3. PARE e aguarde confirmação.

### Fase 2 - Entendimento do Negócio
Após confirmação, use <swot-questions> para perguntas estruturadas. Faça UMA pergunta por vez.

Perguntas iniciais:
1. Qual o nome e setor da empresa?
   Opções: Tecnologia, Saúde, Alimentação, Varejo/E-commerce, Serviços/Consultoria, Educação, Imobiliário, Indústria, Outro

2. Quais os principais produtos ou serviços oferecidos?

3. Qual o porte da empresa?
   Opções: MEI/Autônomo, Microempresa (até 10 func.), Pequena empresa (10-50), Média empresa (50-250), Grande empresa (250+)

4. Quem é o público-alvo principal?

### Fase 3 - Análise SWOT Aprofundada
Faça perguntas exploratórias para cada quadrante:

**Forças (Strengths):**
- Quais diferenciais competitivos da empresa?
- Que recursos ou capacidades únicas a empresa tem?
- O que os clientes mais elogiam?

**Fraquezas (Weaknesses):**
- Quais áreas precisam de melhoria?
- Que limitações internas existem?
- Onde a empresa perde para concorrentes?

**Oportunidades (Opportunities):**
- Que tendências de mercado podem ser aproveitadas?
- Existem nichos ou segmentos inexplorados?
- Que parcerias ou tecnologias podem gerar crescimento?

**Ameaças (Threats):**
- Quais concorrentes preocupam mais?
- Que mudanças regulatórias ou econômicas podem impactar?
- Quais riscos externos mais relevantes?

### Fase 4 - Perguntas Complementares
Faça 2-3 perguntas adicionais baseadas nas respostas para aprofundar a análise.

### Fase 5 - Geração do SWOT
Quando tiver informações suficientes (mínimo ~8 trocas de mensagens), gere o SWOT:
1. Informe que vai criar a análise
2. Emita a tag <swot-create> com os itens

## Formato de Question Box
Para perguntas com opções, use:
<swot-questions>{{"question": "Sua pergunta aqui", "options": ["Opção 1", "Opção 2", "Opção 3"]}}</swot-questions>

Use question_box para TODAS as perguntas que tenham opções previsíveis. Para perguntas abertas, use texto normal.

## Formato de Criação SWOT
Quando pronto para criar o SWOT:
<swot-create>{{"title": "SWOT - [Nome da Empresa]", "items": [{{"quadrant": "strengths", "content": "Descrição do item"}}, {{"quadrant": "weaknesses", "content": "..."}}  , {{"quadrant": "opportunities", "content": "..."}}, {{"quadrant": "threats", "content": "..."}}]}}</swot-create>

Gere pelo menos 3 itens por quadrante (12+ no total).

## Regras
- Responda SEMPRE em português brasileiro com acentuação correta
- Faça UMA pergunta por vez, nunca liste todas
- Seja consultivo: explique brevemente por que cada informação importa
- Use linguagem profissional mas acessível
- Quando usar <swot-questions>, a resposta do usuário será a opção selecionada
- Mantenha respostas curtas e diretas (máximo 3 parágrafos)
- NÃO use emojis
- Ao gerar o SWOT, seja específico e baseado nas respostas coletadas
- Cada item do SWOT deve ser uma frase completa e acionável"#,
        greeting = greeting,
        workspace_name = workspace_name,
    )
}

use chrono::Timelike;

// ─── Interview Chat (SSE) ───────────────────────────────────────────────────

pub async fn interview_chat(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(auth_user): Extension<AuthUser>,
    Path(workspace_id): Path<Uuid>,
    Json(req): Json<InterviewChatRequest>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
    let _ = ws_service::get_member_role(&db, &workspace_id, &auth_user.user_id).await?;

    let api_key = config.baisync_api_key.clone();
    if api_key.is_empty() {
        return Err(AppError::InternalError(
            "BAISYNC_API_KEY not configured".into(),
        ));
    }

    let workspace = ws_service::get_workspace(&db, &workspace_id).await.ok();
    let ws_name = workspace
        .as_ref()
        .map(|w| w.name.as_str())
        .unwrap_or("Minha Empresa");

    let system_prompt = build_system_prompt(ws_name);

    // Build Gemini contents
    let mut contents: Vec<serde_json::Value> = Vec::new();

    for msg in &req.history {
        let role = if msg.role == "assistant" { "model" } else { "user" };
        contents.push(serde_json::json!({
            "role": role,
            "parts": [{"text": msg.content}],
        }));
    }

    contents.push(serde_json::json!({
        "role": "user",
        "parts": [{"text": req.message}],
    }));

    // Coalesce consecutive same-role messages (Gemini requirement)
    contents = coalesce_contents(contents);

    // T1.3 — timeout envolve apenas a resposta inicial do POST (SSE connect),
    // não o loop de frames.
    let llm_timeout_secs = config.llm_global_timeout_secs;

    let (tx, rx) = mpsc::channel::<Result<Event, Infallible>>(128);

    tokio::spawn(async move {
        let client = reqwest::Client::new();
        let body = serde_json::json!({
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": contents,
            "generationConfig": {
                "temperature": 0.7,
                "maxOutputTokens": 2048,
            },
        });

        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:streamGenerateContent?alt=sse&key={}",
            api_key
        );

        // T1.3 + T2.2 — retry the initial POST (connect + headers) only. Once
        // the SSE stream starts, we never rewind — parsed-response frames are
        // committed to the client (R1).
        let body_ref = &body;
        let url_ref = url.as_str();
        let (resp_outer, _outcome) = crate::services::llm::retry_http_post(
            "gemini_swot_stream",
            std::time::Duration::from_secs(llm_timeout_secs),
            || {
                client
                    .post(url_ref)
                    .header("Content-Type", "application/json")
                    .json(body_ref)
                    .send()
            },
        )
        .await;
        let response = match resp_outer {
            Ok(r) => r,
            Err(e) => {
                let msg = match e {
                    crate::errors::AppError::InternalError(inner) if inner.contains("timeout") => {
                        format!(
                            "A chamada ao provider gemini excedeu {llm_timeout_secs}s. Tente resposta mais concisa ou reduza max_tokens."
                        )
                    }
                    crate::errors::AppError::InternalError(inner) => inner,
                    other => other.to_string(),
                };
                tracing::error!("Gemini SWOT interview request failed: {msg}");
                let _ = tx
                    .send(Ok(Event::default().event("error").data(
                        serde_json::json!({"error": msg}).to_string(),
                    )))
                    .await;
                let _ = tx.send(Ok(Event::default().event("done").data("{}"))).await;
                return;
            }
        };

        // Retry helper already delivered a ready `reqwest::Response`; flow
        // straight into SSE streaming without re-matching.
        {
            {
                if !response.status().is_success() {
                    let error_text = response.text().await.unwrap_or_default();
                    tracing::error!("Gemini API error for SWOT interview: {}", error_text);
                    let _ = tx
                        .send(Ok(Event::default().event("error").data(
                            serde_json::json!({"error": "Nao foi possivel processar. Tente novamente."}).to_string(),
                        )))
                        .await;
                    let _ = tx.send(Ok(Event::default().event("done").data("{}"))).await;
                    return;
                }

                let mut stream = response.bytes_stream();
                let mut buffer = String::new();
                let mut full_content = String::new();

                use futures::StreamExt;
                while let Some(chunk_result) = stream.next().await {
                    match chunk_result {
                        Ok(bytes) => {
                            buffer.push_str(&String::from_utf8_lossy(&bytes));

                            while let Some(pos) = buffer.find('\n') {
                                let line = buffer[..pos].trim().to_string();
                                buffer = buffer[pos + 1..].to_string();

                                if line.is_empty() {
                                    continue;
                                }

                                if let Some(data) = line.strip_prefix("data: ") {
                                    if let Ok(parsed) =
                                        serde_json::from_str::<serde_json::Value>(data)
                                    {
                                        // Gemini streaming: extract text from candidates
                                        if let Some(text) = parsed["candidates"][0]["content"]["parts"][0]["text"].as_str() {
                                            full_content.push_str(text);
                                            let _ = tx
                                                .send(Ok(Event::default().event("token").data(
                                                    serde_json::json!({"text": text})
                                                        .to_string(),
                                                )))
                                                .await;
                                        }
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            tracing::error!("SWOT interview stream error: {}", e);
                            break;
                        }
                    }
                }

                // Parse special tags from full content and send as structured events
                let (questions, swot_create) = parse_swot_special_tags(&full_content);
                if let Some(parsed) = questions {
                    let _ = tx
                        .send(Ok(Event::default()
                            .event("questions")
                            .data(parsed.to_string())))
                        .await;
                }
                if let Some(parsed) = swot_create {
                    let _ = tx
                        .send(Ok(Event::default()
                            .event("swot_create")
                            .data(parsed.to_string())))
                        .await;
                }

                let _ = tx
                    .send(Ok(Event::default().event("done").data(
                        serde_json::json!({"content_length": full_content.len()}).to_string(),
                    )))
                    .await;
            }
        }
    });

    let stream = ReceiverStream::new(rx);
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Merge consecutive same-role Gemini contents into one entry.
fn coalesce_contents(contents: Vec<serde_json::Value>) -> Vec<serde_json::Value> {
    if contents.is_empty() {
        return contents;
    }

    let mut coalesced: Vec<serde_json::Value> = Vec::new();
    for msg in contents {
        let role = msg["role"].as_str().unwrap_or("user");
        if let Some(last) = coalesced.last_mut() {
            if last["role"].as_str().unwrap_or("") == role {
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

/// Extract <swot-questions> and <swot-create> payloads from the assistant's
/// accumulated output. Returns (questions, swot_create) as parsed JSON when present.
pub(crate) fn parse_swot_special_tags(
    full_content: &str,
) -> (Option<serde_json::Value>, Option<serde_json::Value>) {
    let questions = extract_tag(full_content, "swot-questions");
    let swot_create = extract_tag(full_content, "swot-create");
    (questions, swot_create)
}

fn extract_tag(text: &str, tag: &str) -> Option<serde_json::Value> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = text.find(&open)?;
    let end = text[start..].find(&close)? + start;
    let json_str = &text[start + open.len()..end];
    serde_json::from_str(json_str).ok()
}

