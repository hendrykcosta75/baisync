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

Tool execution hoje roda **no mesmo processo Rust** com `ENCRYPTION_KEY` em memória. Se um tool for comprometido (ex: injection via LLM output), teoricamente pode ler a chave. Cenário teórico hoje; pentest define se é exploitable.

Opções de sandbox (decisão sob evidência):

- **A — Processo separado + IPC**: tools num binário isolado, comunicação via pipe/socket. Baixo esforço de refactor; custo operacional alto (2× binários, 2× health checks).
- **B — WASM runtime (wasmtime)**: tools como módulos `.wasm` compilados. Bom isolation, mas todo tool precisa ser reescrito para WASM ou wrapping. Alto esforço inicial, baixo custo runtime.
- **C — Container per-request (Firecracker/gVisor)**: isolation forte, custo operacional muito alto, latência +50ms típica. Só justificável se pentest mostrar breach real.

## T3.2 Fase 1 — Key versioning (pendente)

Quando T3.2 Fase 1 executar:
- Adicionar `key_version INT DEFAULT 1` na tabela `workspace_api_keys` (única tabela com ciphertext **nativo** após S0).
- Refactor `services/encryption.rs` → `KeyResolver` que seleciona chave por `key_version`. Lê `ENCRYPTION_KEY_V1`, `ENCRYPTION_KEY_V2` de env.
- **Teste OBRIGATÓRIO**: `test_old_ciphertext_readable_after_adding_v2()` — grava row com v1, depois adiciona v2, lê row original e confirma plaintext correto.

Sem esse teste, qualquer rotação de chave arrisca perder dados.

## Invariante de logging

**Nunca** logar key, token, ciphertext ou secret em `tracing::*` (info/debug/error/warn). Reforçado em `backend/AGENTS.md`. Em caso de debugging, usar hash parcial (primeiros 4 chars) ou flag booleano indicando presença.
