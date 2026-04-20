# Rate Limit Semantics

Como a quota de mensagens por assistente é debitada, e o que muda quando retries HTTP entrarem (T2.2).

> Plano: [harness-plan-final.md](../../harness-plan-final.md) §T2.2
> Status: débito 1× por mensagem do user **já implementado**; proteção contra re-débito em retry HTTP **pendente** (T2.2).

## Invariante

**Quota é debitada exatamente 1× por mensagem do user**, antes do primeiro attempt de chamada ao LLM. Retries HTTP (T2.2 futuro) **NÃO re-debitam**.

Consequência prática:
- Se o LLM for chamado 3× por causa de 500 transiente do provider, o contador `usage_stats.total_messages` incrementa **1**, não **3**.
- Se o tool loop roda 5 rodadas (5 chamadas ao LLM para uma única mensagem do user), o contador incrementa **1**.
- A unidade de débito é **"mensagem do user recebida"**, não "chamada ao provider".

## Onde

Implementação atual: `backend/src/services/messaging.rs:1781-1847` — função `is_rate_limited()`.

Fluxo:
1. Lê `total_messages` atual de `usage_stats` (partition key `user_id+assistant_id+period`).
2. Se `total_messages + 1 > limit`, retorna `Ok(true)` (bloqueia).
3. Senão, executa `UPDATE ... IF total_messages = ?` (CAS) para incrementar.
4. Se CAS falha (concorrência), retry até **3 vezes**.
5. Após 3 falhas de CAS, **fail-open**: loga warn e retorna `Ok(false)` (deixa passar).

## Semântica do fail-open

Trade-off deliberado:
- **Alternativa rejeitada**: falhar fechado (bloquear no 3° retry). Sob pressure alto, user fica preso a `rate_limited` falso-positivo — péssima UX.
- **Escolhida**: deixar passar. Quota pode vazar marginalmente sob carga alta, mas o erro fica numa métrica observável, não na cara do user.

Invariante operacional: `usage_stats.total_messages` deve bater com `count(*)` em `messages` filtrado por assistente + período, **±5% em 24h**. Desvio maior indica fail-open acontecendo demais — sintoma de contenção no CAS que precisa ser investigado (mais shards de partition, menos concorrência por conversa, etc.).

## Plano T2.2 (retry HTTP)

Quando retry HTTP entrar em `call_llm`:

- O débito continua acontecendo **ANTES do primeiro attempt** (mantém invariante).
- Retries internos do `call_llm` (backoff exponencial, 3 tentativas) **NÃO** voltam a chamar `is_rate_limited`.
- Circuit breaker (W1.1) e retry (T2.2) são ortogonais ao rate limit — eles protegem o **backend** contra provider instável; rate limit protege o **cliente final** contra bot abusivo.
- Alerta pós-T2.2: se `usage_stats.total_messages` divergir de `count(messages)` **>5% em 24h**, abrir investigação. Migração T2.2 inclui teste `test_quota_once()` garantindo que retry não incrementa.

## Período e reset

- Partition key de `usage_stats` inclui `period` (string tipo `"2026-04-20"` ou formato agregado configurado).
- Reset é **natural pela troca de período** — nova chave de partition, contador arranca em 0.
- Não há job de limpeza; TTL em `usage_stats` (se definido) cuida do descarte.

## Interação com circuit breaker (W1.1)

- **Rate limit protege o cliente** (quota consumível) — retorna erro pro user antes de gastar tokens.
- **Circuit breaker protege o backend** — abre quando provider está instável, não conta como uso contra quota.
- Se circuit está aberto e a mensagem do user for bloqueada, quota **não** é debitada (o débito acontece só se `is_rate_limited()` retornou `false` **e** o LLM foi efetivamente chamado).
- Ordem canônica: `is_rate_limited` → se passou → `circuit.check` → se passou → `call_llm` (com retries internos T2.2).

## Testes (T2.2)

- `test_quota_once()` — 1 mensagem do user → 1 incremento, mesmo com 3 retries do LLM dentro.
- `test_fail_open_after_3_cas_retries()` — força CAS concorrente, confirma que após 3 retries passa mas grava warn.
- `test_cas_retries_under_contention()` — contenção moderada (2 concorrentes) resolve sem fail-open.
- `test_circuit_open_no_debit()` — mensagem bloqueada por circuit aberto não incrementa `total_messages`.
