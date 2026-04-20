# Evaluators (Opt-in)

Segundo modelo, barato, que revisa respostas do assistente principal antes de virarem ruído no cliente. Opt-in por assistente.

> Plano: [harness-plan-final.md](../../harness-plan-final.md) §W2.1
> Status: **pendente** (Onda 2). Migration 099 (`config_enable_evaluator`, `config_evaluator_model`) ainda não criada.

## O que é

Após cada `call_llm_with_tools_ctx` que produz uma resposta final pro usuário, um modelo barato (gpt-4o-mini, gemini-flash ou equivalente) recebe a resposta + contexto mínimo e retorna um verdict estruturado:

```json
{ "ok": true|false, "issues": ["pii_detected", "impossible_promise", "inappropriate_tone", ...] }
```

Critérios padrão (extensíveis por assistente):
- **PII**: resposta vaza CPF, email pessoal de terceiros, telefones não autorizados.
- **Promessas impossíveis**: "vou resolver em 1h", garantias sem backing, SLAs inventados.
- **Tom inadequado**: agressivo, condescendente, ou fora do persona definido.
- **Leak de prompt**: resposta revela instruções internas do system prompt.

## Como ativar

- Coluna `config_enable_evaluator BOOLEAN DEFAULT FALSE` em `assistants` (migration 099, pendente).
- Coluna `config_evaluator_model TEXT` opcional — se nulo, usa default (`gpt-4o-mini`).
- UI no dashboard do assistente: toggle simples "Revisor de respostas" + dropdown de modelo.

## Não bloqueia resposta

Evaluator roda **fire-and-forget** em `tokio::spawn`. A resposta do assistente principal vai pro cliente imediatamente; o resultado do evaluator:

- Emite evento SSE `evaluator_verdict` pro dashboard (visível em tempo real para quem estiver acompanhando).
- Grava em `llm_call_logs.error` quando `ok=false` (campo já existe; reutilizado como "issue flag").
- Em T2.1, também emite `evaluator_verdict` como event type em `session_events` para replay/auditoria.

Nunca atrasa, reprocessa, ou rejeita a resposta já enviada. Custo de latência percebida = 0.

## Princípio 10 — Agente separado

Evaluator é um **agente separado**, não uma instrução extra no system prompt do assistente sendo avaliado:
- Session/prompt independentes (não compartilham histórico nem tools).
- Prompt do evaluator descreve apenas os critérios; não tem acesso ao prompt do assistente avaliado.
- Pode ter bugs/viéses próprios — por isso fica opt-in e não bloqueante.

## Custo esperado

- Tokens: evaluator consome ~10-30% dos tokens da resposta original (só o output + contexto mínimo).
- Custo em USD: entre **+20% e +100%** do custo do assistente que ativar, dependendo do modelo escolhido (gpt-4o-mini é o mais barato; claude-3.5-haiku ~2× mais caro).
- Latência para o cliente: **0ms** (fire-and-forget).
- Latência para ver o verdict no dashboard: 1-5s típico.

## Semaphore global

`tokio::sync::Semaphore` limita N concurrent evaluators em todo o backend (default `10`). Protege contra stampede quando muitos assistentes ativam de uma vez. Configurável via env `EVALUATOR_MAX_CONCURRENT`.

## Testes mínimos

- `test_non_blocking()` — resposta principal sai antes do evaluator concluir.
- `test_off_default()` — com `config_enable_evaluator=false` (default), evaluator nunca é chamado.
- `test_pii_logged()` — PII na resposta produz `issues=["pii_detected"]` e grava em `llm_call_logs`.
- `test_sse_alert()` — evento SSE chega ao dashboard em <5s (integration test).
