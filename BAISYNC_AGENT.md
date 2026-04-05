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
| `update_assistant` | `assistant_id, name?, description?, system_prompt?, model?, temperature?, max_tokens?` | `useAssistantStore.updateAssistant()` |
| `delete_assistant` | `assistant_id` | `useAssistantStore.deleteAssistant()` |

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
