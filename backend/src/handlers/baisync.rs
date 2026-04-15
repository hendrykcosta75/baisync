use axum::extract::Extension;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use base64::Engine;
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
pub struct BaisyncAttachment {
    pub name: String,
    pub mime_type: String,
    pub data_base64: String,
}

#[derive(Debug, Deserialize)]
pub struct BaisyncChatRequest {
    pub message: String,
    #[serde(default)]
    pub history: Vec<BaisyncMessage>,
    pub skill: Option<String>,
    #[serde(default)]
    pub attachments: Vec<BaisyncAttachment>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct BaisyncFileRef {
    pub id: String,
    pub kind: String, // "image" or "file"
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct BaisyncMessage {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub file_refs: Vec<BaisyncFileRef>,
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
            if let Ok(rows) = res.into_rows_result() {
                if let Ok(Some((count,))) = rows.maybe_first_row::<(i64,)>() {
                    count
                } else {
                    0
                }
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
        return Err(AppError::InternalError(
            "BAISYNC_API_KEY not configured".into(),
        ));
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
    let assistants = crate::services::assistant::list_assistants(&db, &user_id)
        .await
        .unwrap_or_default();

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
            "\n- Configurações: split_msgs={}, typing={}, interpret_docs={}",
            a.config_split_messages, a.config_typing_indicator, a.config_interpret_documents
        ));
        if let Some(rl) = a.config_rate_limit_per_day {
            detail.push_str(&format!(", rate_limit={}/dia", rl));
        }

        // Fetch integrations
        if let Ok(integrations) =
            crate::services::assistant::list_integrations(&db, &a.id, &user_id).await
        {
            if !integrations.is_empty() {
                let int_list: Vec<String> = integrations
                    .iter()
                    .map(|i| format!("{}/{} (status: {})", i.channel, i.provider, i.status))
                    .collect();
                detail.push_str(&format!("\n- Integrações: {}", int_list.join(", ")));
            }
        }

        // Fetch tools
        if let Ok(tools) = crate::services::assistant::list_tools(&db, &a.id).await {
            if !tools.is_empty() {
                let tool_list: Vec<String> = tools
                    .iter()
                    .map(|t| {
                        format!(
                            "{} ({})",
                            t.name,
                            if t.is_enabled { "ativo" } else { "inativo" }
                        )
                    })
                    .collect();
                detail.push_str(&format!("\n- Ferramentas: {}", tool_list.join(", ")));
            }
        }

        // Fetch files
        if let Ok(files) = crate::services::rag::list_files(&db, &a.id, &user_id).await {
            if !files.is_empty() {
                let file_list: Vec<String> = files
                    .iter()
                    .map(|f| format!("{} ({})", f.name, f.mime_type))
                    .collect();
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

    // ─── Workspace & Channel Context ─────────────────────────────────────
    let active_ws_id = crate::services::workspace::get_active_workspace_id(&db, &user_id)
        .await
        .unwrap_or(user_id);
    let active_ws = crate::services::workspace::get_workspace(&db, &active_ws_id)
        .await
        .ok();
    let user_workspaces = crate::services::workspace::list_user_workspaces(&db, &user_id)
        .await
        .unwrap_or_default();
    let user_channels = crate::services::channel::list_user_channels(&db, &user_id, &active_ws_id)
        .await
        .unwrap_or_default();

    let workspace_context = {
        let active_ws_name = active_ws
            .as_ref()
            .map(|w| w.name.as_str())
            .unwrap_or("Pessoal");

        let ws_list: Vec<String> = user_workspaces
            .iter()
            .map(|w| {
                let marker = if w.workspace_id == active_ws_id {
                    " <- ativo"
                } else {
                    ""
                };
                format!(
                    "  - {} (id: {}, tipo: {}, role: {}){}",
                    w.workspace_name, w.workspace_id, w.workspace_type, w.role, marker
                )
            })
            .collect();

        let mut channel_lines: Vec<String> = user_channels
            .iter()
            .take(20)
            .map(|c| {
                let prefix = if c.channel_type == "dm" { "" } else { "#" };
                format!(
                    "  - {}{} ({}, {} não lidas) (id: {})",
                    prefix, c.channel_name, c.channel_type, c.unread_count, c.channel_id
                )
            })
            .collect();
        if user_channels.len() > 20 {
            channel_lines.push(format!(
                "  - ... e mais {} canais (use list_channels para ver todos)",
                user_channels.len() - 20
            ));
        }

        let channels_section = if channel_lines.is_empty() {
            "Nenhum canal no workspace ativo.".to_string()
        } else {
            channel_lines.join("\n")
        };

        format!(
            r#"## Contexto de Workspaces
- Workspace ativo: {active_ws_name} (id: {active_ws_id})
- Workspaces do usuário:
{ws_list}

### Canais no workspace ativo
{channels_section}"#,
            active_ws_name = active_ws_name,
            active_ws_id = active_ws_id,
            ws_list = ws_list.join("\n"),
            channels_section = channels_section,
        )
    };

    let mut system_prompt = format!(
        r#"Você é o Baisync Agent, o assistente inteligente da plataforma Baisync. Você ajuda os usuários a gerenciar seus assistentes de IA, configurar integrações e entender a plataforma.

## Contexto do Usuário
- Nome: {user_name}
- Email: {user_email}
- Assistentes configurados:
{assistant_list}

{workspace_context}

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

### Assistentes
- create_assistant: data: {{name, description, llm_provider, model, temperature, max_tokens, system_prompt}}
- update_assistant: data: {{assistant_id, assistant_name, name?, description?, system_prompt?, model?, temperature?, max_tokens?}}
- delete_assistant: data: {{assistant_id, assistant_name}}
- list_assistants: data: {{}} (retorna lista formatada de todos os assistentes)

### Ferramentas (Tools)
- list_tools: data: {{assistant_id}}
- create_tool: data depende do tool_type (veja abaixo)
- update_tool: data: {{assistant_id, tool_id, name?, description?, endpoint?, method?, schema_json?, headers_json?}}
- delete_tool: data: {{assistant_id, tool_id}}
- toggle_tool: data: {{assistant_id, tool_id, is_enabled}} (true/false)

Existem 6 tipos de ferramentas. Use o campo tool_type correto ao criar:

1. **http_request** (padrão): Ferramenta HTTP customizada que chama um endpoint externo.
   - create_tool data: {{assistant_id, name, description?, endpoint, method?, schema_json?, headers_json?, tool_type: "http_request"}}
   - endpoint é OBRIGATÓRIO (URL da API externa)
   - method padrão: "POST"
   - schema_json: schema JSON dos parâmetros que a IA deve preencher
   - headers_json: headers HTTP adicionais (ex: autenticação)

2. **notify_human**: Notifica um atendente humano para intervir na conversa.
   - create_tool data: {{assistant_id, name, description?, tool_type: "notify_human"}}
   - NÃO precisa de endpoint, method, schema_json ou headers_json
   - MÁXIMO 1 por assistente (singleton)
   - Schema é gerado automaticamente pelo backend (campo "reason")

3. **send_document**: Envia um documento ou imagem na conversa via URL.
   - create_tool data: {{assistant_id, name, description?, endpoint, tool_type: "send_document"}}
   - endpoint é OBRIGATÓRIO (URL do documento/imagem a ser enviado)
   - NÃO precisa de method, schema_json ou headers_json
   - Schema é gerado automaticamente pelo backend (campo "caption")

4. **schedule_appointment**: Agenda, cancela ou reagenda compromissos com clientes.
   - create_tool data: {{assistant_id, name, description?, tool_type: "schedule_appointment"}}
   - NÃO precisa de endpoint, method, schema_json ou headers_json
   - Schema é gerado automaticamente pelo backend (campos: action, client_name, client_phone, date_time, etc.)
   - Funciona integrado com o sistema de agenda da plataforma

5. **pix_payment**: Gera cobranças PIX e verifica pagamentos durante conversas.
   - create_tool data: {{assistant_id, name, description?, endpoint, headers_json, tool_type: "pix_payment"}}
   - endpoint é OBRIGATÓRIO (chave PIX do recebedor, ex: "12345678900" para CPF)
   - headers_json é OBRIGATÓRIO (tipo da chave PIX: {{"pix_key_type": "cpf"}})
   - Tipos de chave válidos: "cpf", "cnpj", "email", "phone", "random"
   - Schema é gerado automaticamente pelo backend (campos: action, amount, description, charge_id)
   - A IA pode criar cobranças (create_charge) e verificar status (check_status)
   - O QR code PIX é enviado automaticamente ao cliente

6. **card_payment**: Gera cobranças por cartão de crédito/débito e verifica pagamentos.
   - create_tool data: {{assistant_id, name, description?, headers_json, tool_type: "card_payment"}}
   - headers_json é OBRIGATÓRIO: {{"card_mode": "stripe"}} ou {{"card_mode": "mercadopago"}}
   - NÃO precisa de endpoint
   - Schema é gerado automaticamente pelo backend (campos: action, amount, description, customer_name, payment_type, installments, charge_id)
   - A IA pode criar cobranças (create_charge) e verificar status (check_status)
   - O link de pagamento seguro é enviado automaticamente ao cliente
   - Stripe: apenas pagamento à vista, não restringe crédito/débito
   - Mercado Pago: suporta crédito/débito e parcelamento de 1x a 12x

### Integrações
- connect_whatsapp: data: {{assistant_id, phone}} (Baileys, phone: +5511999999999)
- disconnect_integration: data: {{assistant_id, integration_id}}
- list_integrations: data: {{assistant_id}}

IMPORTANTE: A integração com a API Oficial da Meta (WhatsApp Cloud API) e o Telegram estão temporariamente desativadas. Apenas a conexão via Baileys (WhatsApp auto-hospedado) está disponível no momento. Se o usuário perguntar sobre Meta ou Telegram, informe que essas opções estarão disponíveis em breve.

### Conversas
- list_conversations: data: {{assistant_id}} (retorna lista com id de cada conversa — use o id para as ações abaixo)
- list_messages: data: {{assistant_id, conversation_id}} (retorna últimas 20 mensagens)
- delete_conversation: data: {{assistant_id, conversation_id}}
- toggle_ai: data: {{assistant_id, conversation_id, ai_enabled}} (true/false)
- summarize_conversation: data: {{assistant_id, conversation_id}} (gera resumo via IA)

### Tokens de Acesso
- list_access_tokens: data: {{assistant_id}}
- create_access_token: data: {{assistant_id, name, permission_level, email?, expires_in_days?}}
  - permission_level: "read", "write" ou "admin"
- delete_access_token: data: {{assistant_id, token_id}}
- revoke_access_token: data: {{assistant_id, token_id}}

### Compartilhamento
- create_share_token: data: {{assistant_id}}
- get_share_token: data: {{assistant_id}}
- revoke_share_token: data: {{assistant_id}}

### Voz (TTS)
- list_voices: data: {{provider}} (provider: "elevenlabs" ou "openai")

### Agenda
- list_events: data: {{}} (sem parâmetros)
- create_event: data: {{client_name, client_phone?, date_time, duration_minutes?, appointment_type?, notes?, assistant_id?}}
- update_event: data: {{event_id, status?, date_time?, notes?, duration_minutes?, appointment_type?}}
- delete_event: data: {{event_id}}
- cancel_event: data: {{event_id}}

### Disponibilidade
- get_availability: data: {{assistant_id}}
- set_availability: data: {{assistant_id, timezone?, default_duration_minutes?, buffer_minutes?, max_per_day?, schedule?}}
- get_available_slots: data: {{assistant_id, date?}} (date formato: YYYY-MM-DD)

### Notificações
- list_notifications: data: {{}}
- mark_notification_read: data: {{notification_id}}
- mark_all_notifications_read: data: {{}}
- delete_notification: data: {{notification_id}}
- delete_all_notifications: data: {{}}

### Financeiro (PIX)
- financial_overview: data: {{}} (resumo financeiro de todos os assistentes: receita, cobranças, pagas, pendentes)
- financial_summary: data: {{assistant_id}} (resumo financeiro de um assistente específico)
- list_charges: data: {{assistant_id, limit?}} (lista cobranças PIX de um assistente, default 50)

### Analytics
- get_usage: data: {{}} (retorna estatísticas de uso do usuário)
- get_assistant_stats: data: {{assistant_id}}
- get_assistant_logs: data: {{assistant_id}}
- get_activity: data: {{}} (retorna timeline de atividade)

### Workspaces e Canais
- list_workspaces: data: {{}} (lista todos os workspaces do usuário com IDs e roles)
- switch_workspace: data: {{workspace_id}} (troca o workspace ativo — afeta toda a aplicação)
- get_workspace_members: data: {{workspace_id}} (lista membros do workspace com roles)
- list_channels: data: {{workspace_id?}} (lista canais do workspace, default = workspace ativo)
- get_channel_messages: data: {{channel_id, limit?}} (últimas N mensagens do canal, default 20)
- send_channel_message: data: {{channel_id, content}} (envia mensagem em um canal)
- list_channel_notes: data: {{channel_id}} (lista notas do canal)
- get_channel_note: data: {{channel_id, note_id}} (retorna conteúdo de uma nota)
- create_channel: data: {{workspace_id?, name, description?, channel_type?}} (cria canal, default tipo "public")
- mark_channel_read: data: {{channel_id}} (marca todas as mensagens do canal como lidas)

### Planejamento Estratégico (requer workspace_id do workspace ativo)
- list_okrs: data: {{workspace_id}} (lista objetivos OKR com KRs e progresso)
- list_swot: data: {{workspace_id}} (lista análises SWOT do workspace)

- list_bowtie: data: {{workspace_id}} (lista análises de risco Bowtie do workspace)
- list_stakeholders: data: {{workspace_id}} (lista mapas de stakeholders do workspace)
- list_teams: data: {{workspace_id}} (lista equipes do workspace com membros)
- get_strategy_map: data: {{workspace_id}} (retorna nós e conexões do mapa estratégico)

## REGRA CRÍTICA SOBRE IDs
NUNCA invente, adivinhe ou use placeholders para IDs. Todo assistant_id, tool_id, conversation_id, workspace_id, channel_id etc. DEVE ser um UUID real que aparece no "Contexto do Usuário" ou "Contexto de Workspaces" acima, ou que foi retornado por uma ação anterior. Se você não sabe o ID, pergunte ao usuário ou use list_assistants/list_tools/list_workspaces/list_channels para descobrir. Ações com IDs inválidos falharão silenciosamente.

Exemplos de uso (substitua SEMPRE pelo UUID real do assistente):

Vou verificar sua agenda agora.
<baisync-action>{{"action": "list_events", "data": {{}}}}</baisync-action>

Para criar ferramentas, use o UUID real do assistente (visível em "Contexto do Usuário"):
<baisync-action>{{"action": "create_tool", "data": {{"assistant_id": "UUID-REAL-DO-ASSISTENTE", "name": "Consultar CEP", "endpoint": "https://viacep.com.br/ws/{{cep}}/json", "method": "GET", "description": "Busca endereço pelo CEP", "tool_type": "http_request"}}}}</baisync-action>

Tipos de ferramenta — SEMPRE preencha assistant_id com o UUID real:
- notify_human: {{"assistant_id": "UUID", "name": "...", "tool_type": "notify_human"}}
- send_document: {{"assistant_id": "UUID", "name": "...", "endpoint": "URL-DO-ARQUIVO", "tool_type": "send_document"}}
- schedule_appointment: {{"assistant_id": "UUID", "name": "...", "tool_type": "schedule_appointment"}}
- pix_payment: {{"assistant_id": "UUID", "name": "...", "endpoint": "CHAVE-PIX", "headers_json": "{{\"pix_key_type\":\"cpf\"}}", "tool_type": "pix_payment"}}
- card_payment: {{"assistant_id": "UUID", "name": "...", "headers_json": "{{\"card_mode\":\"mercadopago\"}}", "tool_type": "card_payment"}}

## Pesquisa na Internet
Você tem acesso a pesquisa na internet em tempo real. Use essa capacidade quando:
- O usuário perguntar sobre informações atuais, notícias ou eventos recentes
- Precisar de dados técnicos, documentações ou tutoriais atualizados
- O usuário pedir para pesquisar algo específico
- Precisar verificar preços, funcionalidades ou comparações de serviços
- Qualquer situação onde informações atualizadas da web possam enriquecer sua resposta

Quando usar a pesquisa, integre os resultados naturalmente na sua resposta, citando as fontes quando relevante.

## Análise de Documentos e Imagens
O usuário pode enviar imagens e documentos diretamente no chat. Quando receber anexos:
- **Imagens**: Analise o conteúdo visual, descreva o que vê, e responda perguntas sobre a imagem
- **Documentos** (PDF, TXT, DOCX, etc.): Leia e interprete o conteúdo do documento
- Integre a análise dos anexos na sua resposta de forma natural
- Se o usuário enviar uma captura de tela de um erro ou configuração, ajude a diagnosticar o problema

## O que você pode fazer
- Pesquisar na internet em tempo real para obter informações atualizadas
- Analisar imagens e documentos enviados pelo usuário
- Ver detalhes completos dos assistentes: nome, modelo, prompt do sistema, integrações, ferramentas, arquivos RAG, configurações
- Criar, atualizar e excluir assistentes
- Listar assistentes com informações resumidas
- Gerenciar os 6 tipos de ferramentas: HTTP Request, Notificar Humano, Enviar Documento, Agendar Compromisso, Cobrança PIX, Cobrança por Cartão
- Conectar e desconectar integrações: WhatsApp (Baileys), WhatsApp (Meta), Telegram
- Listar e gerenciar conversas: ver mensagens, excluir, ativar/desativar IA, resumir
- Gerenciar tokens de acesso: criar, revogar, excluir
- Compartilhar assistentes: criar e revogar links de compartilhamento
- Listar vozes disponíveis (ElevenLabs e OpenAI)
- Gerenciar agenda: criar, editar, cancelar e excluir eventos
- Configurar disponibilidade dos assistentes: horários, duração, buffer, máximo por dia
- Gerenciar notificações: listar, marcar como lida, excluir
- Consultar analytics: uso de tokens, estatísticas por assistente, logs, atividade
- Ver workspaces, canais, mensagens e notas do usuário
- Trocar workspace ativo e acessar informações de qualquer workspace
- Enviar mensagens em canais, criar canais e gerenciar notas
- Listar membros de workspaces
- Consultar planejamento estratégico: OKRs, SWOT, Bowtie, Stakeholders
- Ver equipes do workspace e mapa estratégico
- Sugerir melhorias nos prompts dos assistentes
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
- SEMPRE use os IDs reais (UUIDs) dos assistentes que estão listados acima em "Contexto do Usuário". NUNCA invente IDs, use placeholders ou strings genéricas. Se não souber o ID, use list_assistants primeiro.
- Se o usuário mencionar um assistente pelo nome, encontre o UUID correspondente na lista do "Contexto do Usuário" antes de executar qualquer ação.
- Se não houver assistentes configurados e o usuário pedir para fazer algo em um assistente, informe que ele precisa criar um assistente primeiro.
- Quando o usuário perguntar sobre um assistente, mostre todas as informações disponíveis (prompt, integrações, ferramentas, arquivos)
- Para ações de workspace/canais, use os IDs do Contexto de Workspaces. Se o usuário mencionar um canal pelo nome (ex: #geral), encontre o channel_id na lista.
- Quando o usuário pedir informações de outro workspace, use o workspace_id correspondente. Você só pode acessar workspaces listados no contexto.
- Ações como get_channel_messages e send_channel_message funcionam com qualquer canal que o usuário tenha acesso, independente do workspace ativo."#,
        user_name = if user.name.is_empty() {
            "Usuário"
        } else {
            &user.name
        },
        user_email = user.email,
        assistant_list = assistant_list,
        workspace_context = workspace_context,
        skills = skills_summary(),
    );

    // If a skill is active, inject its full prompt
    if let Some(ref skill_name) = req.skill {
        if let Some(skill_prompt) = get_skill_prompt(skill_name) {
            system_prompt.push_str("\n\n## Skill Ativa\n");
            system_prompt.push_str(skill_prompt);
        }
    }

    // Build input array for OpenAI Responses API
    let mut input = vec![serde_json::json!({
        "role": "developer",
        "content": system_prompt,
    })];

    for msg in &req.history {
        if msg.file_refs.is_empty() {
            input.push(serde_json::json!({
                "role": msg.role,
                "content": msg.content,
            }));
        } else {
            // Rebuild multimodal content with file references
            let mut parts = vec![serde_json::json!({
                "type": "input_text",
                "text": msg.content,
            })];
            for fref in &msg.file_refs {
                if fref.kind == "image" {
                    parts.push(serde_json::json!({
                        "type": "input_image",
                        "file_id": fref.id,
                    }));
                } else {
                    parts.push(serde_json::json!({
                        "type": "input_file",
                        "file_id": fref.id,
                    }));
                }
            }
            input.push(serde_json::json!({
                "role": msg.role,
                "content": parts,
            }));
        }
    }

    // Build user message — multimodal if attachments are present
    let mut uploaded_file_refs: Vec<serde_json::Value> = Vec::new();

    if req.attachments.is_empty() {
        input.push(serde_json::json!({
            "role": "user",
            "content": req.message,
        }));
    } else {
        let mut content_parts = vec![serde_json::json!({
            "type": "input_text",
            "text": req.message,
        })];

        let client = reqwest::Client::new();

        for att in &req.attachments {
            // Upload all attachments (images + documents) to Files API for persistent file_id
            let file_bytes = base64::engine::general_purpose::STANDARD
                .decode(&att.data_base64)
                .unwrap_or_default();

            let file_part = reqwest::multipart::Part::bytes(file_bytes)
                .file_name(att.name.clone())
                .mime_str(&att.mime_type)
                .unwrap_or_else(|_| reqwest::multipart::Part::bytes(vec![]));

            let form = reqwest::multipart::Form::new()
                .text("purpose", "user_data")
                .part("file", file_part);

            let upload_res = client
                .post("https://api.openai.com/v1/files")
                .header("Authorization", format!("Bearer {}", api_key))
                .multipart(form)
                .send()
                .await;

            let file_id = match upload_res {
                Ok(res) if res.status().is_success() => res
                    .json::<serde_json::Value>()
                    .await
                    .ok()
                    .and_then(|body| body["id"].as_str().map(String::from)),
                Ok(res) => {
                    let err = res.text().await.unwrap_or_default();
                    tracing::error!("OpenAI file upload failed: {}", err);
                    None
                }
                Err(e) => {
                    tracing::error!("OpenAI file upload error: {}", e);
                    None
                }
            };

            let Some(file_id) = file_id else {
                return Err(AppError::BadRequest(format!(
                    "Não foi possível processar o arquivo \"{}\". Tente novamente.",
                    att.name
                )));
            };

            let kind = if att.mime_type.starts_with("image/") {
                "image"
            } else {
                "file"
            };
            uploaded_file_refs.push(serde_json::json!({"id": file_id, "kind": kind}));

            if att.mime_type.starts_with("image/") {
                content_parts.push(serde_json::json!({
                    "type": "input_image",
                    "file_id": file_id,
                }));
            } else {
                content_parts.push(serde_json::json!({
                    "type": "input_file",
                    "file_id": file_id,
                }));
            }
        }

        input.push(serde_json::json!({
            "role": "user",
            "content": content_parts,
        }));
    }

    // Increment usage counter
    increment_usage(&db, &user_id).await;

    // Calculate rate limit info for warnings
    let new_used = used + 1;
    let pct = (new_used as f64 / limit as f64) * 100.0;

    // Create channel for SSE events
    let (tx, rx) = mpsc::channel::<Result<Event, Infallible>>(128);

    // Spawn streaming task
    tokio::spawn(async move {
        // Send uploaded file refs so frontend can persist them for history
        if !uploaded_file_refs.is_empty() {
            let _ = tx
                .send(Ok(Event::default().event("file_refs").data(
                    serde_json::json!({"file_refs": uploaded_file_refs}).to_string(),
                )))
                .await;
        }

        // Send thinking status
        let _ = tx
            .send(Ok(Event::default().event("status").data(
                serde_json::json!({"text": "Analisando mensagem..."}).to_string(),
            )))
            .await;

        // Call OpenAI Responses API with streaming
        let client = reqwest::Client::new();
        let body = serde_json::json!({
            "model": "gpt-5.3-chat-latest",
            "input": input,
            "stream": true,
            "max_output_tokens": 4096,
        });

        let resp = client
            .post("https://api.openai.com/v1/responses")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await;

        let _ = tx
            .send(Ok(Event::default().event("status").data(
                serde_json::json!({"text": "Pensando sobre o problema..."}).to_string(),
            )))
            .await;

        match resp {
            Ok(response) => {
                if !response.status().is_success() {
                    let error_text = response.text().await.unwrap_or_default();
                    tracing::error!("OpenAI API error: {}", error_text);
                    let _ = tx
                        .send(Ok(Event::default()
                            .event("error")
                            .data(serde_json::json!({"error": "Não foi possível processar sua mensagem no momento. Tente novamente."}).to_string())))
                        .await;
                    let _ = tx.send(Ok(Event::default().event("done").data("{}"))).await;
                    return;
                }

                // Process SSE stream from OpenAI Responses API
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

                                if line.is_empty() {
                                    continue;
                                }

                                if let Some(data) = line.strip_prefix("data: ") {
                                    if let Ok(parsed) =
                                        serde_json::from_str::<serde_json::Value>(data)
                                    {
                                        let event_type = parsed["type"].as_str().unwrap_or("");

                                        // response.output_text.delta contains streaming text
                                        if event_type == "response.output_text.delta" {
                                            if let Some(delta) = parsed["delta"].as_str() {
                                                full_content.push_str(delta);
                                                let _ = tx
                                                    .send(Ok(Event::default().event("token").data(
                                                        serde_json::json!({"text": delta})
                                                            .to_string(),
                                                    )))
                                                    .await;
                                            }
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
                    let _ = tx
                        .send(Ok(Event::default()
                            .event("rate_limit")
                            .data(rl_data.to_string())))
                        .await;
                }

                let _ = tx
                    .send(Ok(Event::default().event("done").data(
                        serde_json::json!({"content_length": full_content.len()}).to_string(),
                    )))
                    .await;
            }
            Err(e) => {
                tracing::error!("OpenAI request failed: {}", e);
                let _ = tx
                    .send(Ok(Event::default()
                        .event("error")
                        .data(serde_json::json!({"error": "Não foi possível processar sua mensagem no momento. Tente novamente."}).to_string())))
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
