# Session Model

Como sessões e durabilidade de conversas funcionam hoje (sem tabela `sessions`) e o que muda após Onda 2 (T2.1 + S2.1).

> Plano: [harness-plan-final.md](../../harness-plan-final.md) §Onda 2 / T2.1 / S2.1
> Status: arquitetura atual descrita; drift tracking em **shadow** (I1 implementado); tabelas `sessions`/`session_events` **pendentes** (T2.1).

## Arquitetura atual

- **WhatsApp agents**: brain (LLM) e hands (tools) co-localizados no backend Rust (`services/messaging.rs` + `services/llm.rs`). Não há `session` persistida hoje — se o processo cair no meio de um tool loop, nada garante recovery. A única durabilidade é a tabela `messages` (append-only por `conversation_id`). Recovery contínuo só entra em **W1.3**; a sessão durável subjacente entra em **T2.1**.
- **Sophie** (Baisync Agent): brain no backend Rust (`handlers/baisync.rs` chamando Gemini), hands no **frontend** (parse de XML retornado pelo LLM + `fetch` HTTP executado pelo browser). A session hoje é o `localStorage` do usuário. Consequência direta: **Sophie não executa ações quando o usuário não tem a aba aberta** (nenhum worker server-side continua o plano). Mitigação só em **S2.1**.
- **Outras mensageria** (Meta, Telegram): mesmo padrão WhatsApp (brain+hands co-localizados no backend).

## Estado após Onda 2 (T2.1 + S2.1)

- Nova tabela `sessions ((user_id), session_id TIMEUUID)` com metadata da sessão (assistant_id, conversation_id, status, created_at, last_event_at).
- Nova tabela `session_events ((user_id, session_id), event_id TIMEUUID)` append-only, TTL 90d — fonte da verdade para replay após crash e para auditoria.
- Event types válidos: `user_msg | llm_msg | tool_call | tool_result | compaction | evaluator_verdict | plan | wake`.
- `llm_call_logs` (migration 093) é mantida como **analítica** — `handlers/stats.rs` depende dela e continua funcionando em paralelo. `session_events` é para lógica de agente; `llm_call_logs` é para dashboards de uso/custo.
- S2.1 reutiliza `sessions` + `session_events` para Sophie, eliminando o `localStorage` como fonte primária. O browser hidrata a partir do backend no login.

## Drift tracking (I1)

- `tracing::info!(event="llm_call_started", drift_ms, ...)` em `backend/src/services/llm.rs:683-709` — **JÁ IMPLEMENTADO**. Emite `drift_ms = now - last_message_at` em cada chamada de LLM para onde existir `conversation_id` + `user_id` + `assistant_id`.
- Coleta contínua de ≥2 semanas; p99 documentado aqui após coleta.
- **PLACEHOLDER: p99 drift pendente — coleta iniciada [data de deploy em produção].**
- O valor medido substitui o chute hardcoded de `30s` em W1.3 (recovery). Critério: `|last_message_at - started_at| <= $P99_DRIFT` é um dos guards para aceitar recovery. Se o valor observado >> 30s, W1.3 precisa ampliar janela; se << 30s, estreitar.

## Relação com `messages` e `conversations`

- `messages` continua sendo o log durável por canal/conversa (partition `(user_id, conversation_id)`). Não desaparece após T2.1.
- `conversations.last_message_at` é a fonte do drift hoje (I1) e continua sendo até T2.1.
- Após T2.1, `session_events` vira fonte primária pro **agente** (loop, replay, recovery), enquanto `messages` vira projeção pro **cliente final** (envio WhatsApp/Telegram/UI). Escritas duplicadas aceitas deliberadamente — custo de Cassandra write é desprezível comparado ao LLM call.

## Referências

- Migration `backend/migrations/007_create_conversations.cql` — colunas `last_message_at` e friends, usadas pelo cálculo de drift (I1).
- `backend/src/services/llm.rs:683-712` — emissão do evento `llm_call_started` com `drift_ms` (I1).
- `backend/src/services/messaging.rs` — loop de tools atual (ainda sem session; reescrito em T2.1).
- `backend/src/handlers/baisync.rs` — brain Sophie (backend) que será integrado a `sessions` em S2.1.
- `backend/src/handlers/stats.rs` — consumidor de `llm_call_logs`; não muda com T2.1.
- Plano T2.1 (Onda 2) para schema final de `sessions`/`session_events`.
- Plano W1.3 (Onda 1) para consumo do p99 de drift no recovery.
- Plano S2.1 (Onda 2) para migração do localStorage Sophie para server-side.
