# Backend — Agent Guide

> Guia LLM-friendly para futuros agentes modificarem o backend Rust do Inertial Eclipse
> com segurança. Ler **antes** de qualquer change. Complementa `CLAUDE.md` na raiz e
> as skills `development-rules` + `backend-rust`.

## Visão geral

Backend Rust + Axum servindo em `:3001`. Expõe REST + SSE para o frontend Next.js,
integra com Cassandra (keyspace `inertial_eclipse`), Baileys (WhatsApp multi-device),
providers LLM (OpenAI, Claude, Gemini, Grok, DeepSeek), Meta Cloud API, Telegram Bot
API e Mercado Pago. Multi-tenant por `user_id` em todas as tabelas de negócio.
Migrations aplicadas automaticamente no startup.

## Princípios invioláveis

1. **Multi-tenancy**: toda query `SELECT`/`UPDATE`/`DELETE` em tabela multi-tenant
   filtra por `user_id` em `WHERE`. Partition key é SEMPRE `user_id` (ou começa por
   `user_id` num PK composto) nessas tabelas.
2. **Exceção única documentada**: `processed_webhooks` (a ser criada em I2) não tem
   `user_id` na PK, porque o webhook chega antes de resolvermos o tenant.
3. **Idempotência**: webhooks (6 vetores — Baileys, Meta, Telegram, MP pagamentos, MP
   cartão, TBD) devem ser idempotentes. Retry de LLM NUNCA envolve loop de tool
   execution (veja §5).
4. **Encryption at rest**: API keys e tokens sensíveis NUNCA aparecem em plaintext em
   logs, tracing events ou respostas HTTP (redactar com `••••••••`).
5. **Rate limit / quota**: débito da quota acontece 1× **antes** do primeiro attempt
   de LLM — retries não voltam a debitar.
6. **Separação Sophie ↔ user backend**: handlers Sophie (`handlers/baisync*.rs`) NUNCA
   chamam `workspace::get_decrypted_api_key` — só o backend do próprio produto
   (Sophie usa a key do Anthropic configurada no `.env`, não a do cliente).

## Estrutura de módulos

```
src/
  main.rs            — Router, CORS, tracing, pollers (SSE event_bus)
  app.rs             — Build router compartilhado (tests + prod)
  config/            — Config from .env (DB, JWT, SMTP, encryption, Baileys)
  db/                — Cassandra (scylla LegacySession), run_migrations
  handlers/          — HTTP handlers (auth, assistants, tools, integrations, ...)
  services/          — Business logic (llm, messaging, encryption, pix, ...)
  middleware/        — JWT auth (extrai AuthUser { user_id })
  models/            — Data structs (user, assistant, conversation, usage, ...)
  errors.rs          — AppError + IntoResponse
  bin/               — setup_test_keyspace e outros binários one-shot
tests/
  helpers/           — TestApp, fixtures
  auth_tests.rs, health_test.rs, ...
migrations/          — *.cql numerados (001..091 hoje; 092+ livres)
```

## Pattern `Result<Json<T>, AppError>`

Todos os handlers HTTP retornam esse tipo. `AppError` deriva `thiserror::Error` e
implementa `IntoResponse` para virar resposta HTTP correta. NÃO usar `anyhow` em
handlers — só em scripts/bin.

Variants canônicos (ver `errors.rs`):
- `NotFound(String)` → 404
- `Unauthorized(String)` → 401
- `BadRequest(String)` → 400
- `Forbidden(String)` → 403
- `InternalServerError(String)` → 500 (logado automaticamente)
- `DatabaseError(String)` → 500

```rust
pub async fn handler(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Response>, AppError> {
    let obj = get_thing(&db, &auth_user.user_id, &id).await?;
    Ok(Json(obj.into()))
}
```

## Fluxo `call_llm_with_tools_ctx`

Assinatura em `services/llm.rs:643`. Chamada de `services/messaging.rs:700` e `:2536`.

- Recebe assistant config + conversation history + tools disponíveis.
- **Loop**: chama provider → parseia resposta → se há `tool_calls`, executa cada tool
  em série → adiciona o resultado (role=tool) à conversa → chama provider de novo
  até `max_rounds` ou ausência de novas `tool_calls`.
- Side-effects acontecem DENTRO do loop de tool execution: `send_document`,
  `pix_payment` (→ `spawn_mp_payment_poller`), `card_payment`
  (→ `spawn_card_payment_poller`), `notify_human`, `schedule_appointment`,
  `notify_appointment_event`.
- **NUNCA** aplicar retry em todo o loop de tool execution — duplicaria side-effects,
  spawns de poller e `event_bus.publish` (mensagens duplicadas pro cliente).
- Retry HTTP (T2.2 futuro) ficará restrito ao POST do provider individual (camada
  mais baixa), antes de parsear tool_calls.
- Quota é debitada **uma vez** antes do primeiro chamado ao provider.

## Encryption

- `services/encryption.rs` implementa AES-256-GCM. Nonce de 12 bytes aleatório por
  payload, prefixado ao ciphertext.
- **Hoje** só `workspace_api_keys` (migration 050) usa `encryption.encrypt()` — veja
  `services/workspace.rs:649,726,756`.
- **Pendente S0** (ainda plaintext — NÃO é aceitável logar/tracerar):
  `assistant_integrations.config_token`, `assistant_integrations.config_webhook_verify_token`,
  `users.api_key_elevenlabs`, `users.api_key_mercadopago`, `users.api_key_stripe`,
  `users.api_key_grok`, `users.api_key_deepseek`.
- `ENCRYPTION_KEY` hoje vem de `.env` (32 bytes hex). O default de dev é sequencial
  (`0123...`) — fraco, rotacionar em produção (S0b). Quando rotacionar, re-encriptar
  rows afetadas em migração online.

## Pattern `spawn_*_poller`

Tasks assíncronas de background disparadas com `tokio::spawn`. Usadas para pollar
status de integração externa (pagamento, mídia, etc). Devem ser idempotentes e
resistentes a crash do backend.

Exemplos hoje:
- `spawn_mp_payment_poller` — `services/pix.rs:563` (polla status de Pix no MP)
- `spawn_card_payment_poller` — `services/card_payment.rs:608` (polla status de
  cartão no MP)

Integrações futuras (W1.3 recovery-after-crash, T3.3 background curation) seguirão o
mesmo pattern, registradas no `main.rs`. Cada poller deve ter:
- Timeout absoluto (max attempts OU max duration).
- Logging estruturado (`tracing::info!`/`warn!`) com IDs relevantes.
- Sem acesso a plaintext de API keys — receber por parâmetro já decriptado (ou por
  `Arc<DbSession>` + helpers que encapsulam a decriptação).

## Testes

### Unit tests

```bash
cargo test --lib
```

Não precisam de Cassandra. Rodam em CI a cada PR (workflow
`.github/workflows/backend-tests.yml`, G8).

### Integration tests

```bash
cargo test --test <name>            # ex: auth_tests, health_test
cargo test                          # todos
```

Usam `TestApp` em `tests/helpers/mod.rs`. Precisam de Cassandra up. Carregam
`.env.test` se existir; senão caem no `.env` default.

### Keyspace isolado de testes

`CASSANDRA_KEYSPACE=inertial_eclipse_test` em `.env.test`. Aplicar migrations **uma
vez** com `cargo run --bin setup_test_keyspace` — isso drop+recria o keyspace de
teste e roda todas as migrations.

### Mock de providers LLM

`wiremock = "0.6"` já em `[dev-dependencies]` (`Cargo.toml:44`). Usar para stub de
OpenAI/Claude/Gemini em testes de `services/llm.rs` sem custo e sem rede.

## Migrations

- Arquivos em `backend/migrations/*.cql`, numerados sequencialmente. Último hoje:
  `091_create_tools_test_url_rate_limits.cql`. Próximos livres: `092+`.
- Aplicadas automaticamente pelo backend no startup via `db::run_migrations` (idempotente —
  rastreia em tabela `schema_migrations`).
- Cassandra **NÃO suporta `DEFAULT`** em `ALTER TABLE ADD` — aplicar defaults em
  código Rust quando ler a row (campo `Option<T>` → `unwrap_or(...)`).
- Novas tabelas **DEVEM** ter `user_id` como partition key (ou primeiro elemento do
  PK composto). Exceção única: `processed_webhooks` (I2).
- Nunca editar migration já aplicada em prod — criar nova migration de correção.

## Antes de cada change (checklist)

- [ ] Invocar skills `development-rules` + `backend-rust` (esta guide não substitui
      as skills — as skills têm o detalhe operacional).
- [ ] Grep por `user_id` em todo `SELECT`/`UPDATE`/`DELETE` novo (ou documentar
      exceção explícita neste arquivo).
- [ ] Rodar `cargo check` antes de commitar (pré-commit já roda via lefthook).
- [ ] Rodar `bash tests/consistency/check.sh` e garantir verde.
- [ ] Para PRs que tocam `services/encryption.rs` OU campos sensíveis
      (`config_token`, `*_key`, `*_secret`, qualquer webhook verify token): invocar
      a skill `security-review` e anexar o resultado no PR.
- [ ] Para PRs que tocam `services/llm.rs` ou o loop de tool execution em
      `services/messaging.rs`: revisar §5 e garantir que retries não duplicam
      side-effects.
- [ ] Para PRs que adicionam tabela nova: confirmar que PK começa por `user_id`, ou
      justificar.
