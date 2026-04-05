use axum::extract::Extension;
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

// ─── Types ───────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct BaisyncChatRequest {
    pub message: String,
    #[serde(default)]
    pub history: Vec<BaisyncMessage>,
    pub skill: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct BaisyncMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct RateLimitResponse {
    pub used: i64,
    pub limit: i32,
    pub reset_at: String,
}

// ─── Skills ──────────────────────────────────────────────────────────────────

struct Skill {
    name: &'static str,
    description: &'static str,
    prompt: &'static str,
}

const SKILLS: &[Skill] = &[
    Skill {
        name: "criar_atendente",
        description: "Guia o usuário passo a passo na criação de um assistente de IA para atendimento ao cliente",
        prompt: r#"Você está executando a skill "Criar Atendente de IA". Conduza uma consultoria exploratória para entender profundamente o negócio do cliente antes de criar o assistente.

IMPORTANTE: Faça UMA pergunta por vez. Aguarde a resposta antes de avançar. Use question_box para perguntas com opções.

## Fluxo de perguntas (uma por vez):

### Etapa 1 — Setor e Negócio
Pergunte qual o setor do negócio. Use question_box com opções:
- Restaurante / Alimentação
- Clínica / Saúde
- E-commerce / Loja
- Consultoria / Serviços
- Imobiliária
- Educação
- Outro (peça para descrever)

### Etapa 2 — Volume de Atendimento
Pergunte quantas pessoas/clientes o negócio atende por dia ou por mês. Use question_box:
- Até 20 por dia
- 20 a 100 por dia
- 100 a 500 por dia
- Mais de 500 por dia

### Etapa 3 — Dores Principais
Pergunte quais são os maiores desafios no atendimento atual. Exemplos:
- Responder as mesmas perguntas repetidamente
- Demora para responder fora do horário
- Perder clientes por falta de agilidade
- Dificuldade em agendar compromissos

### Etapa 4 — Tom de Comunicação
Pergunte como o negócio se comunica com os clientes. Use question_box:
- Formal e profissional
- Casual e amigável
- Técnico e preciso
- Descontraído e próximo

### Etapa 5 — Funcionalidades Necessárias
Pergunte quais funcionalidades o assistente precisa ter. Use question_box com múltiplas opções relevantes ao setor:
- Responder dúvidas frequentes (FAQ)
- Agendar compromissos / consultas
- Enviar documentos (cardápio, catálogo, tabela de preços)
- Encaminhar para atendente humano quando necessário
- Coletar dados do cliente (nome, telefone, pedido)

### Etapa 6 — Horário de Funcionamento
Pergunte em quais horários o assistente deve operar. Use question_box:
- 24 horas por dia
- Horário comercial (8h-18h)
- Personalizado (peça os horários)

### Etapa 7 — Canal de Mensagens
Pergunte qual canal usar. Use question_box:
- WhatsApp
- Telegram
- Ambos

### Etapa 8 — Criação
Com base em TODAS as respostas coletadas:
1. Sugira um nome para o assistente baseado no negócio
2. Construa um system_prompt detalhado e personalizado incluindo:
   - O setor e tipo de negócio
   - O tom de comunicação escolhido
   - As funcionalidades que deve ter
   - O horário de funcionamento
   - Instruções específicas para o tipo de atendimento
3. Escolha automaticamente o melhor modelo (GPT-4o para uso geral)
4. Gere a action create_assistant com todos os dados
5. Mostre um assistant_card com os detalhes criados
6. Se o usuário escolheu WhatsApp, pergunte o número para conectar via connect_whatsapp

## Regras da skill
- Faça UMA pergunta por vez, nunca liste todas as etapas
- Use question_box para TODAS as perguntas com opções predefinidas
- Adapte as opções ao setor identificado (ex: restaurante -> cardápio; clínica -> consultas)
- Seja consultivo: explique brevemente por que cada informação é importante
- Ao criar o system_prompt, seja detalhado e específico ao negócio do cliente
- Sempre responda em português brasileiro"#,
    },
    Skill {
        name: "sobre_plataforma",
        description: "Responde dúvidas sobre o funcionamento e recursos da plataforma Baisync",
        prompt: r#"Você está executando a skill "Sobre a Plataforma". Você é um especialista na plataforma Baisync (Inertial Eclipse).

Informações da plataforma:
- **O que é**: SaaS para criar agentes de IA para atendimento ao cliente via WhatsApp e Telegram
- **Provedores LLM**: Suporta OpenAI (GPT-4o, GPT-4o-mini, o1, etc), Claude (Sonnet, Opus, Haiku), e Gemini
- **Canais**: WhatsApp (via Baileys - conexão direta, ou Chatwoot), Telegram (via Bot API)
- **Base de conhecimento (RAG)**: Upload de documentos (PDF, TXT, DOCX) que são indexados com embeddings para contextualizar respostas
- **Ferramentas**: Agendamentos, envio de documentos, notificação de humanos, ferramentas HTTP customizadas
- **Transcrição de áudio**: Suporta OpenAI Whisper e ElevenLabs para transcrever áudios recebidos
- **Interpretação de documentos**: Capacidade de analisar imagens e documentos enviados pelos usuários
- **Multi-agentes**: Possibilidade de configurar sub-agentes especializados
- **Compartilhamento**: Assistentes podem ser compartilhados com outros usuários via token
- **Agendamentos**: Sistema de calendário integrado com disponibilidade configurável por assistente
- **Logs e métricas**: Dashboard com uso de tokens, requisições, atividade recente e sparklines por assistente
- **Chaves de API**: Cada usuário configura suas próprias chaves de API dos provedores LLM

Responda sempre em português brasileiro, de forma clara e objetiva."#,
    },
];

fn get_skill_prompt(name: &str) -> Option<&'static str> {
    SKILLS.iter().find(|s| s.name == name).map(|s| s.prompt)
}

fn skills_summary() -> String {
    SKILLS
        .iter()
        .map(|s| format!("- **{}**: {}", s.name, s.description))
        .collect::<Vec<_>>()
        .join("\n")
}

// ─── Rate Limiting ───────────────────────────────────────────────────────────

fn current_hour_bucket() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H").to_string()
}

fn next_hour_reset() -> String {
    let now = chrono::Utc::now();
    let next = now + chrono::Duration::hours(1);
    next.format("%Y-%m-%dT%H:00:00Z").to_string()
}

async fn get_usage_count(db: &DbSession, user_id: &Uuid) -> i64 {
    let bucket = current_hour_bucket();
    let result = db
        .query_unpaged(
            "SELECT count FROM inertial_eclipse.baisync_rate_limits WHERE user_id = ? AND hour_bucket = ?",
            (user_id, &bucket as &str),
        )
        .await;

    match result {
        Ok(res) => {
            if let Ok(Some((count,))) = res.maybe_first_row_typed::<(i64,)>() {
                count
            } else {
                0
            }
        }
        Err(_) => 0,
    }
}

async fn increment_usage(db: &DbSession, user_id: &Uuid) {
    let bucket = current_hour_bucket();
    let _ = db
        .query_unpaged(
            "UPDATE inertial_eclipse.baisync_rate_limits SET count = count + 1 WHERE user_id = ? AND hour_bucket = ?",
            (user_id, &bucket as &str),
        )
        .await;
}

// ─── Chat endpoint (SSE streaming) ────��─────────────────────────────────────

pub async fn chat(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<BaisyncChatRequest>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
    let api_key = config.baisync_api_key.clone();
    if api_key.is_empty() {
        return Err(AppError::InternalError("BAISYNC_API_KEY not configured".into()));
    }

    let user_id = auth_user.user_id;

    // Rate limit check
    let used = get_usage_count(&db, &user_id).await;
    let limit = config.baisync_rate_limit;
    if used >= limit as i64 {
        return Err(AppError::BadRequest(format!(
            "Limite de mensagens atingido ({}/{}). Tente novamente em breve.",
            used, limit
        )));
    }

    // Build system prompt
    let user = crate::services::auth::get_user_by_id(&db, &user_id).await?;
    let assistants = crate::services::assistant::list_assistants(&db, &user_id).await.unwrap_or_default();

    let mut assistant_details = Vec::new();
    for a in &assistants {
        let mut detail = format!(
            "### {} (id: {})\n- Provedor: {} | Modelo: {}\n- Temperatura: {} | Max tokens: {}",
            a.name, a.id, a.llm_provider, a.model, a.temperature, a.max_tokens
        );
        if let Some(ref desc) = a.description {
            if !desc.is_empty() {
                detail.push_str(&format!("\n- Descrição: {}", desc));
            }
        }
        if let Some(ref sp) = a.system_prompt {
            if !sp.is_empty() {
                let truncated: String = sp.chars().take(300).collect();
                detail.push_str(&format!("\n- Prompt do sistema (resumo): {}...", truncated));
            }
        }
        detail.push_str(&format!(
            "\n- Configurações: split_msgs={}, typing={}, interpret_docs={}, team_lead={}",
            a.config_split_messages, a.config_typing_indicator, a.config_interpret_documents, a.is_team_lead
        ));
        if let Some(rl) = a.config_rate_limit_per_day {
            detail.push_str(&format!(", rate_limit={}/dia", rl));
        }

        // Fetch integrations
        if let Ok(integrations) = crate::services::assistant::list_integrations(&db, &a.id, &user_id).await {
            if !integrations.is_empty() {
                let int_list: Vec<String> = integrations.iter().map(|i| {
                    format!("{}/{} (status: {})", i.channel, i.provider, i.status)
                }).collect();
                detail.push_str(&format!("\n- Integrações: {}", int_list.join(", ")));
            }
        }

        // Fetch tools
        if let Ok(tools) = crate::services::assistant::list_tools(&db, &a.id).await {
            if !tools.is_empty() {
                let tool_list: Vec<String> = tools.iter().map(|t| {
                    format!("{} ({})", t.name, if t.is_enabled { "ativo" } else { "inativo" })
                }).collect();
                detail.push_str(&format!("\n- Ferramentas: {}", tool_list.join(", ")));
            }
        }

        // Fetch files
        if let Ok(files) = crate::services::rag::list_files(&db, &a.id, &user_id).await {
            if !files.is_empty() {
                let file_list: Vec<String> = files.iter().map(|f| {
                    format!("{} ({})", f.name, f.mime_type)
                }).collect();
                detail.push_str(&format!("\n- Arquivos (RAG): {}", file_list.join(", ")));
            }
        }

        assistant_details.push(detail);
    }

    let assistant_list = if assistant_details.is_empty() {
        "Nenhum assistente configurado ainda.".to_string()
    } else {
        assistant_details.join("\n\n")
    };

    let mut system_prompt = format!(
        r#"Você é o Baisync Agent, o assistente inteligente da plataforma Baisync. Você ajuda os usuários a gerenciar seus assistentes de IA, configurar integrações e entender a plataforma.

## Contexto do Usuário
- Nome: {user_name}
- Email: {user_email}
- Assistentes configurados:
{assistant_list}

## Skills Disponíveis
Você tem acesso às seguintes skills. Quando uma skill for relevante para a conversa, use-a automaticamente:
{skills}

## Capacidades de UI Dinâmica
Você pode gerar elementos visuais interativos usando tags XML. Exemplo:

<baisync-ui>{{"type": "question_box", "data": {{"question": "Sua pergunta", "options": ["Opção 1", "Opção 2"]}}}}</baisync-ui>

Tipos disponíveis:
- question_box: pergunta com botões (campos: question, options[])
- qr_code: exibir QR code (campos: assistant_id, message)
- assistant_card: card de assistente (campos: name, provider, model, status)

## Ações do Sistema
Você pode executar ações reais no sistema usando tags XML. O sistema processa automaticamente e o conteúdo é INVISÍVEL para o usuário.

FORMATO OBRIGATÓRIO — use exatamente assim:
<baisync-action>{{"action": "NOME", "data": {{...}}}}</baisync-action>

Ações disponíveis:
- create_assistant: data: {{name, description, llm_provider, model, temperature, max_tokens, system_prompt}}
- update_assistant: data: {{assistant_id, assistant_name, name?, description?, system_prompt?, model?, temperature?, max_tokens?}}
- delete_assistant: data: {{assistant_id, assistant_name}}
- connect_whatsapp: data: {{assistant_id, phone}} (phone: +5511999999999)
- list_events: data: {{}} (sem parâmetros)
- create_event: data: {{client_name, client_phone, date_time, duration_minutes?, appointment_type?, notes?, assistant_id?}}

Exemplos de uso:

Vou verificar sua agenda agora.
<baisync-action>{{"action": "list_events", "data": {{}}}}</baisync-action>

Vou agendar o evento agora.
<baisync-action>{{"action": "create_event", "data": {{"client_name": "João Silva", "client_phone": "+5511999999999", "date_time": "2026-04-10T14:00:00", "duration_minutes": 30}}}}</baisync-action>

Vou conectar o WhatsApp do assistente agora.
<baisync-action>{{"action": "connect_whatsapp", "data": {{"assistant_id": "id-aqui", "phone": "+5511999999999"}}}}</baisync-action>

## O que você pode fazer
- Ver detalhes completos dos assistentes: nome, modelo, prompt do sistema, integrações, ferramentas, arquivos RAG, configurações
- Criar novos assistentes com todas as configurações
- Atualizar assistentes existentes (nome, descrição, prompt, modelo, etc.)
- Excluir assistentes
- Conectar WhatsApp via Baileys diretamente (pedir o número do telefone no formato internacional e usar a ação connect_whatsapp)
- Listar todos os eventos/agendamentos da agenda do usuário
- Criar novos eventos na agenda (pedir nome do cliente, telefone, data/hora e opcionalmente duração, tipo e notas)
- Sugerir melhorias nos prompts dos assistentes
- Explicar como funcionam as ferramentas, RAG e sub-agentes
- Diagnosticar problemas com assistentes com base nas configurações visíveis

## Regras
- Responda SEMPRE em português brasileiro
- Seja conciso e direto
- Use **negrito** para destacar informações importantes
- NUNCA use emojis em suas respostas. Use apenas texto e formatação markdown.
- Use elementos de UI dinâmica quando apropriado
- Quando o usuário pedir para conectar WhatsApp, peça o número no formato internacional (ex: +5511999999999) e o assistente, então use a ação connect_whatsapp. O QR Code será exibido automaticamente no chat.
- Quando o usuário pedir para criar algo, colete todas as informações necessárias antes de executar a ação
- As ações são executadas automaticamente pelo sistema. NÃO peça confirmação ao usuário para executar ações, apenas execute.
- Quando o usuário perguntar sobre um assistente, mostre todas as informaç��es disponíveis (prompt, integrações, ferramentas, arquivos)"#,
        user_name = if user.name.is_empty() { "Usuário" } else { &user.name },
        user_email = user.email,
        assistant_list = assistant_list,
        skills = skills_summary(),
    );

    // If a skill is active, inject its full prompt
    if let Some(ref skill_name) = req.skill {
        if let Some(skill_prompt) = get_skill_prompt(skill_name) {
            system_prompt.push_str("\n\n## Skill Ativa\n");
            system_prompt.push_str(skill_prompt);
        }
    }

    // Build messages array for OpenAI
    let mut messages = vec![serde_json::json!({
        "role": "system",
        "content": system_prompt,
    })];

    for msg in &req.history {
        messages.push(serde_json::json!({
            "role": msg.role,
            "content": msg.content,
        }));
    }

    messages.push(serde_json::json!({
        "role": "user",
        "content": req.message,
    }));

    // Increment usage counter
    increment_usage(&db, &user_id).await;

    // Calculate rate limit info for warnings
    let new_used = used + 1;
    let pct = (new_used as f64 / limit as f64) * 100.0;

    // Create channel for SSE events
    let (tx, rx) = mpsc::channel::<Result<Event, Infallible>>(128);

    // Spawn streaming task
    tokio::spawn(async move {
        // Send thinking status
        let _ = tx
            .send(Ok(Event::default()
                .event("status")
                .data(serde_json::json!({"text": "Analisando mensagem..."}).to_string())))
            .await;

        // Call OpenAI with streaming
        let client = reqwest::Client::new();
        let body = serde_json::json!({
            "model": "gpt-5.3-chat-latest",
            "messages": messages,
            "stream": true,
            "max_completion_tokens": 4096,
        });

        let resp = client
            .post("https://api.openai.com/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await;

        let _ = tx
            .send(Ok(Event::default()
                .event("status")
                .data(serde_json::json!({"text": "Pensando sobre o problema..."}).to_string())))
            .await;

        match resp {
            Ok(response) => {
                if !response.status().is_success() {
                    let error_text = response.text().await.unwrap_or_default();
                    tracing::error!("OpenAI API error: {}", error_text);
                    let truncated: String = error_text.chars().take(200).collect();
                    let _ = tx
                        .send(Ok(Event::default()
                            .event("error")
                            .data(serde_json::json!({"error": format!("Erro na API OpenAI: {}", truncated)}).to_string())))
                        .await;
                    let _ = tx.send(Ok(Event::default().event("done").data("{}"))).await;
                    return;
                }

                // Process SSE stream from OpenAI
                let mut stream = response.bytes_stream();
                let mut buffer = String::new();
                let mut full_content = String::new();

                use futures::StreamExt;
                while let Some(chunk_result) = stream.next().await {
                    match chunk_result {
                        Ok(bytes) => {
                            buffer.push_str(&String::from_utf8_lossy(&bytes));

                            // Process complete SSE lines
                            while let Some(pos) = buffer.find('\n') {
                                let line = buffer[..pos].trim().to_string();
                                buffer = buffer[pos + 1..].to_string();

                                if line.is_empty() || line == "data: [DONE]" {
                                    continue;
                                }

                                if let Some(data) = line.strip_prefix("data: ") {
                                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                                        if let Some(delta) = parsed["choices"][0]["delta"]["content"].as_str() {
                                            full_content.push_str(delta);
                                            let _ = tx
                                                .send(Ok(Event::default()
                                                    .event("token")
                                                    .data(serde_json::json!({"text": delta}).to_string())))
                                                .await;
                                        }
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            tracing::error!("Stream error: {}", e);
                            break;
                        }
                    }
                }

                // Send rate limit warning if approaching limit
                if pct >= 60.0 {
                    let warning_msg = if pct >= 100.0 {
                        "Limite atingido. Tente novamente em breve.".to_string()
                    } else if pct >= 90.0 {
                        format!("Quase no limite! {}% usado.", pct as i32)
                    } else if pct >= 80.0 {
                        format!("Atenção: {}% do limite usado.", pct as i32)
                    } else {
                        format!("{}% do limite de mensagens usado.", pct as i32)
                    };
                    let rl_data = serde_json::json!({
                        "used": new_used,
                        "limit": limit,
                        "pct": pct as i32,
                        "warning": warning_msg,
                    });
                    let _ = tx.send(Ok(Event::default().event("rate_limit").data(rl_data.to_string()))).await;
                }

                let _ = tx
                    .send(Ok(Event::default()
                        .event("done")
                        .data(serde_json::json!({"content_length": full_content.len()}).to_string())))
                    .await;
            }
            Err(e) => {
                tracing::error!("OpenAI request failed: {}", e);
                let _ = tx
                    .send(Ok(Event::default()
                        .event("error")
                        .data(serde_json::json!({"error": format!("Falha na requisição: {}", e)}).to_string())))
                    .await;
                let _ = tx.send(Ok(Event::default().event("done").data("{}"))).await;
            }
        }
    });

    let stream = ReceiverStream::new(rx);
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

// ─── Rate limit info endpoint ──────��─────────────────────────────────────────

pub async fn rate_limit(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<RateLimitResponse>, AppError> {
    let used = get_usage_count(&db, &auth_user.user_id).await;

    Ok(Json(RateLimitResponse {
        used,
        limit: config.baisync_rate_limit,
        reset_at: next_hour_reset(),
    }))
}
