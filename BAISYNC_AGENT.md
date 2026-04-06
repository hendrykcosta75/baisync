# Baisync Agent — Documentacao Tecnica

O Baisync Agent e o assistente de IA integrado na plataforma Inertial Eclipse. Ele auxilia usuarios a gerenciar assistentes, configurar integracoes e entender a plataforma via chat no dashboard.

---

## Arquitetura

### Backend
- **Endpoint**: `POST /api/baisync/chat` (SSE streaming)
- **Rate limit**: `GET /api/baisync/rate-limit`
- **Arquivo**: `backend/src/handlers/baisync.rs`
- **Modelo LLM**: `gpt-5.3-chat-latest` (OpenAI API)
- **API Key**: `BAISYNC_API_KEY` (env var)
- **Rate limit**: `BAISYNC_RATE_LIMIT_PER_HOUR` (default: 150)

### Frontend
- **Store**: `frontend/store/useBaisyncStore.ts` (Zustand + persist)
- **Componentes**: `frontend/components/baisync/`
  - `baisync-bubble.tsx` — Botao flutuante
  - `baisync-panel.tsx` — Painel do chat
  - `baisync-message.tsx` — Renderizacao de mensagens + ThinkingAnimation
  - `baisync-ui-blocks.tsx` — Blocos de UI dinamicos

### Banco de dados
- **Tabela**: `inertial_eclipse.baisync_rate_limits`
- **Migracao**: `backend/migrations/032_baisync_rate_limits.cql`
- **Schema**: `(user_id uuid, hour_bucket text, count counter)`

---

## Contexto enviado para a IA

O sistema prompt inclui:

| Dado | Fonte | Descricao |
|------|-------|-----------|
| Nome do usuario | `users` table | Nome e email do usuario autenticado |
| Lista de assistentes | `assistants` table | Nome, ID, provedor, modelo, temperatura, max_tokens |
| Descricao | `assistants.description` | Descricao do assistente |
| Prompt do sistema | `assistants.system_prompt` | Resumo (primeiros 300 chars) |
| Configuracoes | `assistants` table | split_msgs, typing, interpret_docs, team_lead, rate_limit |
| Integracoes | `assistant_integrations` table | Canal, provedor, status (por assistente) |
| Ferramentas | `assistant_tools` table | Nome, status ativo/inativo (por assistente) |
| Arquivos RAG | `assistant_files` table | Nome, mime_type (por assistente) |
| Skills disponiveis | Constantes no backend | Lista de skills com descricao |

---

## Skills

| Nome | Descricao |
|------|-----------|
| `criar_atendente` | Guia passo a passo na criacao de um assistente de IA |
| `sobre_plataforma` | Responde duvidas sobre recursos e funcionamento da plataforma |

Skills sao ativadas pelo frontend ao clicar nos atalhos ou automaticamente pela IA quando relevante. O prompt completo da skill e injetado no system prompt quando ativa.

---

## Acoes do Sistema

Acoes que a IA pode executar via blocos `baisync-action`:

| Acao | Dados | Frontend Handler |
|------|-------|-----------------|
| `create_assistant` | `name, description, llm_provider, model, temperature, max_tokens, system_prompt` | `useAssistantStore.addAssistant()` |
| `update_assistant` | `assistant_id, assistant_name, name?, description?, system_prompt?, model?, temperature?, max_tokens?` | `useAssistantStore.updateAssistant()` |
| `delete_assistant` | `assistant_id, assistant_name` | `useAssistantStore.deleteAssistant()` |
| `list_assistants` | (sem parametros) | `useAssistantStore.fetchAssistants()` → sendActionResult |

### Ferramentas (Tools) — 4 tipos

| Tipo | Descricao | Endpoint? | Singleton? |
|------|-----------|-----------|------------|
| `http_request` | Ferramenta HTTP customizada | Obrigatorio | Nao |
| `notify_human` | Notifica atendente humano | Nao usado | Sim (max 1) |
| `send_document` | Envia documento/imagem via URL | URL do doc | Nao |
| `schedule_appointment` | Agenda/cancela/reagenda compromissos | Nao usado | Nao |

| Acao | Dados | Frontend Handler |
|------|-------|-----------------|
| `list_tools` | `assistant_id` | `GET /api/assistants/{id}/tools` → sendActionResult |
| `create_tool` | Varia por tipo (veja system prompt) | `POST /api/assistants/{id}/tools` |
| `update_tool` | `assistant_id, tool_id, name?, description?, endpoint?, method?, schema_json?, headers_json?` | `PUT /api/assistants/{id}/tools/{tool_id}` |
| `delete_tool` | `assistant_id, tool_id` | `DELETE /api/assistants/{id}/tools/{tool_id}` |
| `toggle_tool` | `assistant_id, tool_id, is_enabled` | `PUT /api/assistants/{id}/tools/{tool_id}` |

### Integracoes
| Acao | Dados | Frontend Handler |
|------|-------|-----------------|
| `connect_whatsapp` | `assistant_id, phone` | Cria integracao Baileys + polling QR |
| `connect_meta` | `assistant_id, phone_number_id, access_token, verify_token` | Cria integracao Meta + connect |
| `connect_telegram` | `assistant_id, bot_token` | Cria integracao Telegram + connect |
| `disconnect_integration` | `assistant_id, integration_id` | `POST .../disconnect` |
| `list_integrations` | `assistant_id` | `GET /api/assistants/{id}/integrations` → sendActionResult |

### Conversas
| Acao | Dados | Frontend Handler |
|------|-------|-----------------|
| `list_conversations` | `assistant_id` | `GET /api/assistants/{id}/conversations` → sendActionResult |
| `list_messages` | `assistant_id, conversation_id` | `GET .../messages` → sendActionResult |
| `delete_conversation` | `assistant_id, conversation_id` | `DELETE .../conversations/{id}` |
| `toggle_ai` | `assistant_id, conversation_id, ai_enabled` | `PATCH .../conversations/{id}` |
| `summarize_conversation` | `assistant_id, conversation_id` | `POST .../summary` → sendActionResult |

### Tokens de Acesso
| Acao | Dados | Frontend Handler |
|------|-------|-----------------|
| `list_access_tokens` | `assistant_id` | `GET /api/assistants/{id}/access-tokens` → sendActionResult |
| `create_access_token` | `assistant_id, name, permission_level, email?, expires_in_days?` | `POST /api/assistants/{id}/access-tokens` → sendActionResult |
| `delete_access_token` | `assistant_id, token_id` | `DELETE .../access-tokens/{id}` |
| `revoke_access_token` | `assistant_id, token_id` | `PATCH .../access-tokens/{id}/revoke` |

### Compartilhamento
| Acao | Dados | Frontend Handler |
|------|-------|-----------------|
| `create_share_token` | `assistant_id` | `POST /api/assistants/{id}/share-token` → sendActionResult |
| `get_share_token` | `assistant_id` | `GET /api/assistants/{id}/share-token` → sendActionResult |
| `revoke_share_token` | `assistant_id` | `DELETE /api/assistants/{id}/share-token` |

### Voz (TTS)
| Acao | Dados | Frontend Handler |
|------|-------|-----------------|
| `list_voices` | `provider` (elevenlabs/openai) | `GET /api/{provider}/voices` → sendActionResult |

### Agenda
| Acao | Dados | Frontend Handler |
|------|-------|-----------------|
| `list_events` | (sem parametros) | `GET /api/appointments` → sendActionResult |
| `create_event` | `client_name, client_phone?, date_time, duration_minutes?, appointment_type?, notes?, assistant_id?` | `POST /api/appointments` |
| `update_event` | `event_id, status?, date_time?, notes?, duration_minutes?, appointment_type?` | `PUT /api/appointments/{id}` |
| `delete_event` | `event_id` | `DELETE /api/appointments/{id}` |
| `cancel_event` | `event_id` | `PUT /api/appointments/{id}` com status=cancelled |

### Disponibilidade
| Acao | Dados | Frontend Handler |
|------|-------|-----------------|
| `get_availability` | `assistant_id` | `GET /api/assistants/{id}/availability` → sendActionResult |
| `set_availability` | `assistant_id, timezone?, default_duration_minutes?, buffer_minutes?, max_per_day?, schedule?` | `PUT /api/assistants/{id}/availability` |
| `get_available_slots` | `assistant_id, date?` | `GET /api/assistants/{id}/availability/slots` → sendActionResult |

### Notificacoes
| Acao | Dados | Frontend Handler |
|------|-------|-----------------|
| `list_notifications` | (sem parametros) | `GET /api/notifications` → sendActionResult |
| `mark_notification_read` | `notification_id` | `POST /api/notifications/{id}/read` |
| `mark_all_notifications_read` | (sem parametros) | `POST /api/notifications/read-all` |
| `delete_notification` | `notification_id` | `DELETE /api/notifications/{id}` |
| `delete_all_notifications` | (sem parametros) | `DELETE /api/notifications` |

### Analytics
| Acao | Dados | Frontend Handler |
|------|-------|-----------------|
| `get_usage` | (sem parametros) | `GET /api/user/usage` → sendActionResult |
| `get_assistant_stats` | `assistant_id` | `GET /api/assistants/{id}/stats` → sendActionResult |
| `get_assistant_logs` | `assistant_id` | `GET /api/assistants/{id}/logs` → sendActionResult |
| `get_activity` | (sem parametros) | `GET /api/user/activity` → sendActionResult |

---

## Blocos de UI Dinamica

Blocos que a IA pode gerar via `baisync-ui`:

| Tipo | Dados | Componente |
|------|-------|-----------|
| `question_box` | `question, options[]` | Pergunta com botoes clicaveis |
| `qr_code` | `assistant_id, message` | QR Code para conexao Baileys |
| `assistant_card` | `name, provider, model, status` | Card de confirmacao do assistente |

---

## Eventos SSE

| Evento | Payload | Descricao |
|--------|---------|-----------|
| `status` | `{"text": "..."}` | Mensagem de status (pensando, analisando) |
| `token` | `{"text": "..."}` | Token de conteudo streamed |
| `error` | `{"error": "..."}` | Mensagem de erro |
| `rate_limit` | `{"used", "limit", "pct", "warning"}` | Alerta de rate limit |
| `done` | `{"content_length": N}` | Fim do streaming |

---

## Rate Limiting

- Armazenado em Cassandra com counter table por `(user_id, hour_bucket)`
- Bucket format: `YYYY-MM-DDTHH`
- Alertas visuais no frontend:
  - 0-60%: escondido
  - 60-80%: barra amarela
  - 80-90%: barra laranja
  - 90-100%: barra vermelha
  - 100%: input desabilitado

---

## Regras do Agente

- Responde sempre em portugues brasileiro
- Nunca usa emojis
- Usa **negrito** para destaques
- Usa UI dinamica quando apropriado
- Coleta informacoes antes de executar acoes
- Mostra detalhes completos quando perguntado sobre assistentes

---

## Persistencia

O historico de conversa e persistido no localStorage via Zustand `persist` middleware (key: `baisync-chat`). Campos persistidos: `messages`, `activeSkill`.
