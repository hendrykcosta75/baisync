# Tool Errors — Formato LLM-friendly

Toda mensagem de erro retornada pro LLM (dentro do tool loop ou no retorno de `call_llm_with_tools_ctx`) deve ser acionável pelo modelo, não um stack trace.

> Plano: [harness-plan-final.md](../../harness-plan-final.md) §T1.3 / W1.1 / quota / tool args
> Status: invariante definido aqui; aplicação gradual ao longo de T1.3 (timeout), W1.1 (circuit), T1.4 (dedup) e quota (existente).

## Invariante

Toda mensagem de erro ao LLM segue o formato **verbo + correção**: diz em português o que aconteceu e o que o LLM deve fazer na próxima iteração. Sem jargão de HTTP, sem IDs internos, sem stack traces.

Exemplos:

- Timeout — correto:
  - `"A chamada ao provider openai excedeu 60s. Tente resposta mais concisa ou reduza max_tokens."`
- Timeout — **errado** (não acionável):
  - `"timeout error: upstream elapsed 60000ms"`
- Tool arg faltando — correto:
  - `"Documento não enviado: o campo 'conversation_id' é obrigatório. Passe o ID da conversa atual."`
- Tool arg faltando — **errado** (sem verbo nem correção):
  - `"BadRequest"`

## Formato específico por categoria

| Categoria | Template (pt-BR) | Origem |
|---|---|---|
| **Timeout de provider** | `"A chamada ao provider {X} excedeu {N}s. Tente {ação} (ex: resposta mais concisa, reduzir max_tokens)."` | T1.3 em `services/llm.rs` |
| **Circuit open** | `"Provider {X} temporariamente instável (circuito aberto). Tente outro provider no assistente ou aguarde."` | W1.1 em `services/llm.rs` |
| **Tool arg obrigatório faltando** | `"Tool '{nome}' não executada: campo '{f}' é obrigatório. Adicione '{f}' ao JSON da chamada."` | tool dispatch em `services/messaging.rs` |
| **Tool arg com tipo errado** | `"Tool '{nome}' não executada: campo '{f}' espera {tipo}, recebido {tipo_recebido}. Ajuste o tipo."` | tool dispatch |
| **Rate limit (quota)** | `"Quota do assistente esgotada ({N}/hora). Aguarde {reset_seconds}s ou aumente o limite nas configurações do assistente."` | `is_rate_limited` em `services/messaging.rs` |
| **Webhook duplicado (T1.4)** | não gera erro pro LLM — 200 OK silencioso é correto pro cliente webhook. | `services/webhook_dedup.rs` |

## Onde aplicar

- Todo `Err(...)` retornado de dentro do tool execution loop deve ser transformado em mensagem no formato acima antes de ser injetado como `tool_result` no próximo turno do LLM.
- Todo retorno terminal de `call_llm_with_tools_ctx` que fala com o cliente final (WhatsApp, Telegram, etc.) deve também seguir o formato — a mensagem vai direto pro usuário do bot, então precisa ser natural.
- **Não aplicar** em `tracing::*` — logs internos mantêm o formato técnico (stack traces, códigos de erro, IDs). Só o que o LLM ou o end-user vê precisa do formato acionável.

## Por que este formato

- **LLMs reagem a instrução explícita melhor que a código de erro.** `"Adicione 'conversation_id' ao JSON"` é seguido na próxima iteração; `"BadRequest"` vira confabulação.
- **End-users do bot leem isso.** Timeout/rate_limit muitas vezes chegam como fallback text pro WhatsApp. Português natural é requisito UX, não extra.
- **Idioma**: pt-BR em tudo que pode chegar ao cliente final. Logs internos (tracing) em inglês continuam — separação entre o que vira prompt/UI e o que vira observability.

## Anti-padrões a evitar

- `Err(AppError::Internal("...").into())` propagado cru pro LLM — vaza tipo de erro interno.
- Concatenação de `format!("{:?}", err)` na mensagem — vaza debug-print de structs internos.
- Strings que começam com `"Error:"`, `"Failed to"`, códigos HTTP crus (`"500"`, `"429"`).
- Mensagens em inglês quando o assistente fala pt-BR (inconsistência de idioma no histórico polui o contexto do LLM).

## Testes mínimos

- `test_timeout_string_format()` — regex casa com `"A chamada ao provider {x} excedeu \\d+s\\."` (T1.3).
- `test_consistent_error_prefix()` — todas as mensagens começam com substantivo/verbo capitalizado, não com `"Error:"` ou `"500"`.
- `test_no_debug_struct_leak()` — nenhuma mensagem contém `"{"` ou `"..}"` que indicaria format!("{:?}", ...).
