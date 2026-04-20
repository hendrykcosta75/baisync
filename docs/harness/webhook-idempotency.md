# Webhook Idempotency

Como duplicação de webhooks é detectada hoje (shadow mode — I2) e como ficará bloqueante (T1.4).

> Plano: [harness-plan-final.md](../../harness-plan-final.md) §I2 / T1.4
> Status: **shadow mode ativo** (I2 implementado); flip para `Mode::Block` **pendente** (T1.4, depende de ≥1 semana de dados).

## Estado atual (I2 shadow)

Código: `backend/src/services/webhook_dedup.rs`, com constante `CURRENT_MODE = Mode::Observe`.

Mecânica:
- Tabela `processed_webhooks ((provider, event_id))` com TTL 24h (migration 094).
- Em cada webhook recebido, `INSERT IF NOT EXISTS` com o `event_id` do provider.
- Se `applied=false` (duplicata), loga `tracing::warn!(event="webhook.duplicate_detected", provider=?, event_id=?)` e **CONTINUA processando** (modo observe).
- Se `applied=true`, segue processamento normal.

O modo observe mede a taxa de duplicação real antes de decidir bloquear — evita falso positivo em vetores que nunca duplicam.

## 6 vetores instrumentados

| Vetor | Handler | Event ID usado |
|---|---|---|
| **baileys** (WhatsApp non-oficial) | `handlers/messages.rs` | `msg.key.id` |
| **meta** (WhatsApp oficial) | `handlers/messages.rs` | `msg.id` |
| **telegram** | `handlers/messages.rs` | `chat_id:message_id` (composto) |
| **mercadopago_pix** | `handlers/pix.rs` | `type:data.id` (composto) |
| **stripe** (cards) | `handlers/card_payment.rs` | `payload.id` |
| **mercadopago_card** | `handlers/card_payment.rs` | `type:data.id` (composto) |

Webhook de **verify** (`GET /webhooks/meta` handshake) está fora — não é mensagem, é challenge response.

## T1.4 — Flip para bloqueante (pendente)

Ação:
- Trocar `const CURRENT_MODE: Mode = Mode::Observe` → `Mode::Block` em `services/webhook_dedup.rs`.
- Em duplicata, retornar `200 OK` imediatamente **sem processar** (e sem chamar LLM, sem cobrar quota, sem emitir SSE).
- Manter log `warn!` para visibilidade.

**Dependência**: ≥1 semana de dados de I2 coletados. Threshold de decisão:
- **Zero duplicatas em 7d** num vetor → omitir esse vetor da lista bloqueante (ex: Stripe com Event ID único garantido pode não precisar).
- **Alguma duplicata após >24h** (TTL atual) → ajustar TTL para 48h ou 72h antes de flipar.
- **Taxa esperada normal** (ex: 0.1-2% em baileys por retry do WhatsApp) → flip seguro.

**PLACEHOLDER: taxa por vetor pendente — coleta iniciada [data de deploy I2 em produção].**

## Multi-tenancy — exceção documentada

`processed_webhooks` **não tem `user_id` como partition key** — partition é `(provider, event_id)`. É exceção deliberada à regra do projeto (toda tabela filtra por `user_id`).

Razão: o webhook chega **antes** de resolver o `user_id` (a resolução user depende de lookup por `phone_number` / `token`, que é o próprio processamento que queremos dedupar). Dedupar após resolver user seria tarde demais — já teria custo de DB + parse.

Risco residual: um atacante com conhecimento de `event_id` de provider poderia, em tese, "gastar" o dedup de outro tenant. Mitigação: `event_id` inclui provider prefix, TTL 24h limita janela, e o provider em si não expõe event IDs de terceiros. Aceito até T1.4 ser flipado.

## Testes

- **I2 (shadow)**: `test_shadow_logs_but_continues()` — duplicata loga warn mas retorna normal.
- **T1.4 (block)**: `test_block_mode_returns_200_fast()` + 6 testes de replay por vetor (`test_baileys_replay_blocked()`, etc.) — cada vetor tem seu teste de replay usando Cassandra real.
