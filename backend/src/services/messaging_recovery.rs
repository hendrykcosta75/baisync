//! W1.3 — Recovery após crash mid-LLM.
//!
//! Quando o backend morre entre `LlmCallLogEvent::Started` e `Finished/Failed`,
//! a linha em `llm_call_logs` fica presa em `status='in_progress'`. A mensagem
//! do usuário que disparou a chamada ficou sem resposta. Este módulo:
//!
//!   1. Faz varredura periódica (60s) por rows presas > 120s.
//!   2. Usa LWT `UPDATE ... IF status='in_progress'` para marcar `failed`
//!      idempotentemente — se outra réplica/poller já cuidou, a aplicação
//!      retorna `applied=false` e este passe é skipado.
//!   3. Valida guards conservadores (ver [`should_send_recovery`]) antes de
//!      enviar qualquer mensagem ao usuário.
//!   4. Envia texto de recovery via provider do canal da conversa.
//!
//! # Multi-tenancy
//! Toda query por `llm_call_logs` carrega o PK completo `(user_id,
//! assistant_id, id)` no UPDATE. A varredura inicial usa `ALLOW FILTERING`
//! por necessidade (não existe índice em `status`) — aceitável porque o set
//! de `in_progress` é tiny a qualquer momento em produção e o filtro
//! adicional `started_at < threshold` torna o scan ainda mais estreito.
//!
//! # Idempotência
//! A replica count está fixa em 1 (docker-compose.coolify.yml), portanto o
//! LWT sozinho basta contra duplicate recovery. Se no futuro escalar para
//! N>1 réplicas, adicionar um lease em tabela dedicada.
//!
//! # Threshold de drift
//! 30_000 ms = 30s — placeholder conservador até I1 acumular 2 semanas de
//! p99 histograma. Se o drift entre `last_message_at` e `started_at`
//! ultrapassar esse valor, assumimos que já houve follow-up do usuário ou
//! que a conversa não está mais no estado crítico de aguardar resposta.

use std::time::Duration;

use chrono::{DateTime, Utc};
use scylla::frame::value::{CqlTimestamp, CqlTimeuuid};
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::config::Config;
use crate::db::DbSession;
use crate::errors::AppError;
use crate::models::integration::AssistantIntegration;
use crate::services::encryption::EncryptionService;

/// Janela mínima antes de considerar uma linha `in_progress` como
/// abandonada. 120s cobre p99 de uma chamada LLM com loop de tool use + o
/// próprio jitter do timeout HTTP (T1.3 = 60s) + uma retry hipotética.
const STALE_IN_PROGRESS_MS: i64 = 120_000;

/// Drift máximo tolerado entre `last_message_at` da conversa e `started_at`
/// da chamada LLM presa. Placeholder conservador — ajustar quando I1 tiver
/// duas semanas de histograma p99.
pub(crate) const RECOVERY_DRIFT_THRESHOLD_MS: i64 = 30_000;

/// Texto enviado ao usuário quando detectamos que a conversa ficou órfã por
/// um crash do backend. Mantido propositalmente genérico para não vazar
/// detalhes de infra.
pub(crate) const RECOVERY_MESSAGE: &str =
    "Tive um problema técnico processando sua mensagem. Pode repetir?";

/// Intervalo entre passes do poller.
const POLL_INTERVAL: Duration = Duration::from_secs(60);

/// Estatísticas agregadas de um único pass — úteis para tracing e futuros
/// testes de integração. Nada sensível: só IDs e contadores.
#[derive(Debug, Default, Clone, Copy)]
pub struct RecoveryStats {
    /// Candidatos lidos do scan inicial.
    pub candidates: u32,
    /// Rows cujo LWT `IF status='in_progress'` aplicou (nós cuidamos).
    pub claimed: u32,
    /// Rows que outro processo/poller pegou antes.
    pub already_handled: u32,
    /// Rows claimadas em que ao menos um guard falhou — não disparamos
    /// recovery, mas a row já ficou `failed`.
    pub guards_failed: u32,
    /// Recoveries efetivamente enviados via provider.
    pub recovered: u32,
    /// Rows onde o envio falhou (logado, não propagado).
    pub send_failed: u32,
}

/// Subset da linha `llm_call_logs` relevante para recovery.
///
/// Multi-tenancy: `user_id` e `assistant_id` vêm do partition key, então
/// nunca são `None`. Os demais são `Option<_>` por política do `backend-rust`
/// skill (colunas não-PK em Cassandra podem ser NULL).
#[derive(Debug, Clone)]
pub(crate) struct StaleCall {
    pub user_id: Uuid,
    pub assistant_id: Uuid,
    pub id: Uuid,
    pub conversation_id: Option<Uuid>,
    pub started_at_ms: i64,
}

/// Snapshot mínimo de uma mensagem — apenas o necessário para os guards.
#[derive(Debug, Clone)]
pub(crate) struct LastMessageSnapshot {
    pub role: String,
    pub created_at_ms: i64,
}

/// Pure function — única forma de tomar a decisão de enviar recovery.
/// Factorada para ser testável sem tocar Cassandra.
///
/// Regras (TODAS precisam passar):
/// 1. `|last_message_at_ms - started_at_ms| <= RECOVERY_DRIFT_THRESHOLD_MS`
/// 2. Última mensagem da conversa é `role == "user"`.
/// 3. Não houve mensagem posterior ao `started_at` (caller garante via
///    `latest_message_after_started == false`).
pub(crate) fn should_send_recovery(
    started_at_ms: i64,
    last_message: &LastMessageSnapshot,
    latest_message_after_started: bool,
) -> bool {
    // Guard 3: se já existe mensagem posterior ao started_at, algo se mexeu
    // na conversa (usuário reenviou, ou o recovery já foi enviado). Não
    // disparamos.
    if latest_message_after_started {
        return false;
    }

    // Guard 2: só fazemos recovery se a última mensagem é do user. Se for
    // `assistant`, ou o LLM respondeu e algum log depois falhou (não é nossa
    // janela), ou foi outro recovery. De qualquer forma, pular.
    if last_message.role != "user" {
        return false;
    }

    // Guard 1: drift — conversa precisa estar "fresca" em torno do started_at.
    let drift_ms = (last_message.created_at_ms - started_at_ms).abs();
    if drift_ms > RECOVERY_DRIFT_THRESHOLD_MS {
        return false;
    }

    true
}

/// Spawna a task de recovery poller. Padrão inspirado em
/// `crate::services::pix::spawn_mp_payment_poller` (services/pix.rs:563):
/// loop infinito, sleep entre passes, logs não-sensíveis.
///
/// Deps injetadas (Config + EncryptionService) são necessárias para
/// `send_message_via_provider`, que descriptografa `config_token` /
/// `config_phone_number` via `EncryptionService::try_decrypt_or_passthrough`
/// ao ler a integration.
pub fn spawn_recovery_poller(
    db: DbSession,
    config: Config,
    encryption: EncryptionService,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        tracing::info!("messaging_recovery: poller started (interval=60s)");
        loop {
            match run_recovery_pass(&db, &config, &encryption).await {
                Ok(stats) => {
                    if stats.candidates > 0 {
                        tracing::info!(
                            event = "messaging_recovery.pass",
                            candidates = stats.candidates,
                            claimed = stats.claimed,
                            already_handled = stats.already_handled,
                            guards_failed = stats.guards_failed,
                            recovered = stats.recovered,
                            send_failed = stats.send_failed,
                            "recovery pass complete"
                        );
                    }
                }
                Err(e) => {
                    tracing::warn!(error = %e, "messaging_recovery: pass failed");
                }
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    })
}

/// Executa um pass de recovery. Retorna estatísticas para tracing.
/// Consumidor esperado: o loop em [`spawn_recovery_poller`]. Exposto também
/// para smoke tests / uso manual em ferramenta de admin.
pub async fn run_recovery_pass(
    db: &DbSession,
    config: &Config,
    encryption: &EncryptionService,
) -> Result<RecoveryStats, AppError> {
    let now_ms = Utc::now().timestamp_millis();
    let threshold_ms = now_ms - STALE_IN_PROGRESS_MS;
    let candidates = scan_stale_in_progress(db, threshold_ms).await?;

    let mut stats = RecoveryStats {
        candidates: candidates.len() as u32,
        ..Default::default()
    };

    for call in candidates {
        match attempt_recover_one(db, config, encryption, &call).await {
            Ok(RecoveryOutcome::Claimed) => stats.recovered += 1,
            Ok(RecoveryOutcome::AlreadyHandled) => stats.already_handled += 1,
            Ok(RecoveryOutcome::GuardsFailed) => {
                stats.claimed += 1;
                stats.guards_failed += 1;
            }
            Ok(RecoveryOutcome::SendFailed) => {
                stats.claimed += 1;
                stats.send_failed += 1;
            }
            Err(e) => {
                // Non-fatal: uma linha falhou; próximo pass tenta de novo.
                tracing::warn!(
                    error = %e,
                    user_id = %call.user_id,
                    assistant_id = %call.assistant_id,
                    call_id = %call.id,
                    "messaging_recovery: attempt failed"
                );
            }
        }

        // `Claimed` já incrementou `recovered` acima; refletir no bucket
        // `claimed` também para auditoria.
        // (evitamos double-counting fazendo a conta aqui).
    }

    // Recorrigir `claimed` somando recovered (claimed = recovered +
    // guards_failed + send_failed).
    stats.claimed = stats.recovered + stats.guards_failed + stats.send_failed;

    Ok(stats)
}

/// Resultado interno de `attempt_recover_one`. Não exposto.
enum RecoveryOutcome {
    /// LWT aplicou E recovery enviado com sucesso.
    Claimed,
    /// LWT não aplicou — outro pass/réplica já tratou.
    AlreadyHandled,
    /// LWT aplicou mas algum guard falhou — row ficou `failed`, nada enviado.
    GuardsFailed,
    /// LWT aplicou, guards passaram, mas o envio ao provider falhou.
    SendFailed,
}

/// Tenta recuperar uma única linha presa. Fluxo:
/// 1. LWT UPDATE ... IF status='in_progress'. Se não aplicou → AlreadyHandled.
/// 2. Valida que a linha tem `conversation_id` (sem isso, não há conversa
///    onde enviar recovery).
/// 3. Fetch da conversa (user_id, assistant_id, conversation_id) →
///    last_message_at.
/// 4. Fetch da última mensagem da conversa.
/// 5. `should_send_recovery(...)` — se `false`, GuardsFailed.
/// 6. Localiza integration do canal. Envia mensagem. Persiste como
///    `assistant` role.
async fn attempt_recover_one(
    db: &DbSession,
    config: &Config,
    encryption: &EncryptionService,
    call: &StaleCall,
) -> Result<RecoveryOutcome, AppError> {
    // (1) LWT — claim exclusivo da row.
    let claimed = claim_stale_row(db, call).await?;
    if !claimed {
        return Ok(RecoveryOutcome::AlreadyHandled);
    }

    // A partir daqui a row está `status='failed'`. Se qualquer guard falhar,
    // só retornamos GuardsFailed — não "desfazemos" o failed.

    let conversation_id = match call.conversation_id {
        Some(id) => id,
        None => {
            tracing::info!(
                event = "messaging_recovery.no_conversation",
                user_id = %call.user_id,
                assistant_id = %call.assistant_id,
                call_id = %call.id,
                "stale row has no conversation_id, skipping recovery"
            );
            return Ok(RecoveryOutcome::GuardsFailed);
        }
    };

    // (3) Fetch conversation.
    let conv = match crate::services::messaging::get_conversation(
        db,
        &call.assistant_id,
        &call.user_id,
        &conversation_id,
    )
    .await
    {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(
                error = %e,
                user_id = %call.user_id,
                conversation_id = %conversation_id,
                "messaging_recovery: conversation lookup failed"
            );
            return Ok(RecoveryOutcome::GuardsFailed);
        }
    };

    // (4) Última mensagem da conversa.
    let last_msg = match fetch_last_message(db, &conversation_id).await? {
        Some(m) => m,
        None => {
            tracing::info!(
                event = "messaging_recovery.no_messages",
                user_id = %call.user_id,
                conversation_id = %conversation_id,
                "stale row points to empty conversation, skipping"
            );
            return Ok(RecoveryOutcome::GuardsFailed);
        }
    };

    // Guard extra (3): qualquer mensagem nova depois do started_at invalida.
    // Como `fetch_last_message` retorna exatamente a última, basta comparar
    // o created_at dela contra started_at.
    let latest_after_started = last_msg.created_at_ms > call.started_at_ms;

    // Drift contra `conversations.last_message_at` — auxiliar para tracing.
    let drift_vs_conv_ms = (conv.last_message_at.timestamp_millis() - call.started_at_ms).abs();

    if !should_send_recovery(call.started_at_ms, &last_msg, latest_after_started) {
        tracing::info!(
            event = "messaging_recovery.guards_rejected",
            user_id = %call.user_id,
            assistant_id = %call.assistant_id,
            call_id = %call.id,
            conversation_id = %conversation_id,
            last_msg_role = %last_msg.role,
            drift_ms = (last_msg.created_at_ms - call.started_at_ms).abs(),
            drift_vs_conv_ms = drift_vs_conv_ms,
            latest_after_started = latest_after_started,
            "guards rejected, skipping recovery"
        );
        return Ok(RecoveryOutcome::GuardsFailed);
    }

    // (6) Localiza integration do canal e envia.
    let integration = match find_integration_by_channel(
        db,
        encryption,
        &call.assistant_id,
        &call.user_id,
        &conv.channel,
    )
    .await
    {
        Ok(i) => i,
        Err(e) => {
            tracing::warn!(
                error = %e,
                user_id = %call.user_id,
                assistant_id = %call.assistant_id,
                channel = %conv.channel,
                "messaging_recovery: no integration found for channel"
            );
            return Ok(RecoveryOutcome::GuardsFailed);
        }
    };

    if let Err(e) = crate::services::messaging::send_message_via_provider_public(
        config,
        &integration,
        &conv.contact_number,
        RECOVERY_MESSAGE,
    )
    .await
    {
        tracing::warn!(
            error = %e,
            user_id = %call.user_id,
            conversation_id = %conversation_id,
            "messaging_recovery: provider send failed"
        );
        return Ok(RecoveryOutcome::SendFailed);
    }

    // Persistir como mensagem `assistant` para que apareça no dashboard
    // e na próxima chamada LLM. Não-fatal: se falhar, a mensagem já chegou
    // ao usuário — só loga e segue.
    if let Err(e) = save_recovery_message(db, &conversation_id).await {
        tracing::warn!(
            error = %e,
            user_id = %call.user_id,
            conversation_id = %conversation_id,
            "messaging_recovery: could not persist recovery message (user already got it)"
        );
    }

    // Atualizar last_message_at da conversa para que o dashboard reordene.
    let now_ms = Utc::now().timestamp_millis();
    let now_ts = CqlTimestamp(now_ms);
    if let Err(e) = db
        .query_unpaged(
            "UPDATE inertial_eclipse.conversations SET last_message_at = ? \
             WHERE assistant_id = ? AND user_id = ? AND id = ?",
            (
                now_ts,
                &call.assistant_id,
                &call.user_id,
                &conversation_id,
            ),
        )
        .await
    {
        tracing::warn!(
            error = %e,
            conversation_id = %conversation_id,
            "messaging_recovery: last_message_at update failed"
        );
    }

    // SSE push para o dashboard do user (real-time sem refresh).
    crate::services::events::publish_global(
        &call.user_id,
        crate::services::events::SseEvent {
            event_type: "conversation_updated".into(),
            data: serde_json::json!({
                "conversationId": conversation_id.to_string(),
                "assistantId": call.assistant_id.to_string(),
                "contactName": conv.contact_name.as_deref().unwrap_or(&conv.contact_number),
                "profilePictureUrl": conv.contact_avatar_url,
                "lastMessage": RECOVERY_MESSAGE,
                "lastMessageAt": DateTime::<Utc>::from_timestamp_millis(now_ms)
                    .unwrap_or_else(Utc::now)
                    .to_rfc3339(),
            })
            .to_string(),
        },
    )
    .await;

    tracing::info!(
        event = "messaging_recovery.sent",
        user_id = %call.user_id,
        assistant_id = %call.assistant_id,
        conversation_id = %conversation_id,
        call_id = %call.id,
        "recovery message sent"
    );

    Ok(RecoveryOutcome::Claimed)
}

/// Scan de `llm_call_logs` por rows presas. Retorna o subset mínimo para
/// processamento.
///
/// Não há índice em `status` (ver discussão em docstring do módulo), então
/// usamos `ALLOW FILTERING`. Esperamos o set de `in_progress` ser muito
/// pequeno em produção — o LLM drain fecha a row em milissegundos quando
/// não há crash.
async fn scan_stale_in_progress(
    db: &DbSession,
    threshold_ms: i64,
) -> Result<Vec<StaleCall>, AppError> {
    let threshold = CqlTimestamp(threshold_ms);
    // allow-filter: W1.3 recovery sweep — scans ALL tenants' in_progress rows
    // to find crashed LLM calls; can't be scoped by user_id by design.
    let result = db
        .query_unpaged(
            "SELECT user_id, assistant_id, id, conversation_id, started_at \
             FROM inertial_eclipse.llm_call_logs \
             WHERE status = 'in_progress' AND started_at < ? \
             ALLOW FILTERING",
            (threshold,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    type Row = (
        Uuid,
        Uuid,
        CqlTimeuuid,
        Option<Uuid>,
        Option<DateTime<Utc>>,
    );

    let rows = result.into_rows_result()?;
    let mut out = Vec::new();
    for row in rows.rows::<Row>()? {
        let r = row.map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let started_at_ms = match r.4 {
            Some(ts) => ts.timestamp_millis(),
            None => {
                // Row sem started_at: não tem como computar drift, ignora.
                continue;
            }
        };
        out.push(StaleCall {
            user_id: r.0,
            assistant_id: r.1,
            id: r.2.into(),
            conversation_id: r.3,
            started_at_ms,
        });
    }
    Ok(out)
}

/// LWT para claimar a row: vira `status='failed'` IF status='in_progress'.
/// Retorna `true` se aplicou (nós cuidamos); `false` se outro processo
/// fechou primeiro.
async fn claim_stale_row(db: &DbSession, call: &StaleCall) -> Result<bool, AppError> {
    let timeuuid = CqlTimeuuid::from(call.id);
    let res = db
        .query_unpaged(
            "UPDATE inertial_eclipse.llm_call_logs \
             SET status = 'failed', error = 'crash_recovery_timeout' \
             WHERE user_id = ? AND assistant_id = ? AND id = ? \
             IF status = 'in_progress'",
            (&call.user_id, &call.assistant_id, &timeuuid),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // LWT retorna [applied] como primeira coluna.
    let applied = res
        .into_rows_result()
        .ok()
        .and_then(|r| r.maybe_first_row::<(bool,)>().ok().flatten())
        .map(|(a,)| a)
        .unwrap_or(false);
    Ok(applied)
}

/// Última mensagem da conversa. A PK de `messages` é `(conversation_id,
/// id)` com clustering `id ASC`, então DESC LIMIT 1 devolve a mais recente.
async fn fetch_last_message(
    db: &DbSession,
    conversation_id: &Uuid,
) -> Result<Option<LastMessageSnapshot>, AppError> {
    // allow-filter: messages PK is (conversation_id, id) — scope is via the
    // conversation's tenant, validated upstream in process_incoming_message.
    let result = db
        .query_unpaged(
            "SELECT role, created_at FROM inertial_eclipse.messages \
             WHERE conversation_id = ? ORDER BY id DESC LIMIT 1",
            (conversation_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    type Row = (Option<String>, Option<DateTime<Utc>>);
    let rows = result.into_rows_result()?;
    if let Some(r) = rows.maybe_first_row::<Row>()? {
        let role = r.0.unwrap_or_default();
        let created_at_ms = r.1.map(|t| t.timestamp_millis()).unwrap_or(0);
        return Ok(Some(LastMessageSnapshot {
            role,
            created_at_ms,
        }));
    }
    Ok(None)
}

/// Busca integration do canal da conversa. Replica a lógica de
/// `messaging::find_integration_for_conversation` (privada) inline, mantendo
/// o mesmo contrato: prefere match exato por canal, fallback por provider.
///
/// Multi-tenancy: WHERE assistant_id=? AND user_id=? — PK completo.
async fn find_integration_by_channel(
    db: &DbSession,
    encryption: &EncryptionService,
    assistant_id: &Uuid,
    user_id: &Uuid,
    channel: &str,
) -> Result<AssistantIntegration, AppError> {
    let integrations =
        crate::services::assistant::list_integrations(db, encryption, assistant_id, user_id)
            .await?;

    // 1) Match exato por canal.
    if let Some(i) = integrations.iter().find(|i| i.channel == channel) {
        return Ok(i.clone());
    }
    // 2) Fallback por provider.
    if let Some(i) = integrations.iter().find(|i| i.provider == channel) {
        return Ok(i.clone());
    }
    // 3) Último recurso: primeira integration disponível (se houver apenas
    //    uma, provavelmente é a certa).
    if let Some(i) = integrations.into_iter().next() {
        return Ok(i);
    }

    Err(AppError::NotFound(format!(
        "No integration found for channel {channel}"
    )))
}

/// Persiste a mensagem de recovery como `assistant`. INSERT simples — não
/// reutilizamos `save_message` porque é privada em `messaging.rs` e o custo
/// de duplicar uma linha de INSERT é baixo demais para justificar refactor.
async fn save_recovery_message(
    db: &DbSession,
    conversation_id: &Uuid,
) -> Result<(), AppError> {
    let now = CqlTimestamp(Utc::now().timestamp_millis());
    // allow-filter: messages PK is (conversation_id, id) — no user_id column.
    db.query_unpaged(
        "INSERT INTO inertial_eclipse.messages \
         (conversation_id, id, role, content, created_at) \
         VALUES (?, now(), 'assistant', ?, ?)",
        (conversation_id, RECOVERY_MESSAGE, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn snap(role: &str, created_at_ms: i64) -> LastMessageSnapshot {
        LastMessageSnapshot {
            role: role.to_string(),
            created_at_ms,
        }
    }

    #[test]
    fn test_guards_reject_when_last_message_not_user() {
        let started_at_ms = 1_000_000_000_000;
        // Role assistant → guard 2 falha.
        let last = snap("assistant", started_at_ms);
        assert!(
            !should_send_recovery(started_at_ms, &last, false),
            "must reject when last message role is assistant"
        );
    }

    #[test]
    fn test_guards_reject_when_drift_too_large() {
        let started_at_ms = 1_000_000_000_000;
        // 60s > threshold de 30s.
        let last = snap("user", started_at_ms + 60_000);
        assert!(
            !should_send_recovery(started_at_ms, &last, false),
            "must reject when drift is 60s (> 30s threshold)"
        );

        // Drift negativo (last_message_at *antes* do started_at) de 60s
        // também precisa ser rejeitado — é o módulo da diferença que conta.
        let last_before = snap("user", started_at_ms - 60_000);
        assert!(
            !should_send_recovery(started_at_ms, &last_before, false),
            "must reject symmetrically on negative drift > 30s"
        );
    }

    #[test]
    fn test_guards_accept_all_conditions_met() {
        let started_at_ms = 1_000_000_000_000;
        // Drift de 5s — dentro do threshold de 30s.
        let last = snap("user", started_at_ms + 5_000);
        assert!(
            should_send_recovery(started_at_ms, &last, false),
            "must accept when role=user, drift=5s, no newer message"
        );
    }

    #[test]
    fn test_guards_reject_when_latest_message_after_started() {
        let started_at_ms = 1_000_000_000_000;
        // Drift OK, role OK, mas houve mensagem depois do started_at →
        // provavelmente usuário já reenviou ou recovery duplicado.
        let last = snap("user", started_at_ms + 1_000);
        assert!(
            !should_send_recovery(started_at_ms, &last, true),
            "must reject when a newer message exists after started_at"
        );
    }

    #[test]
    fn test_guards_accept_at_exact_threshold_boundary() {
        let started_at_ms = 1_000_000_000_000;
        // Drift exatamente no limite (30_000 ms).
        let last = snap("user", started_at_ms + RECOVERY_DRIFT_THRESHOLD_MS);
        assert!(
            should_send_recovery(started_at_ms, &last, false),
            "boundary (==30s) must be accepted (<=, not <)"
        );
    }

    #[test]
    fn test_recovery_message_exact_text() {
        // Bloqueia mudanças acidentais no texto visível ao usuário.
        assert_eq!(
            RECOVERY_MESSAGE,
            "Tive um problema técnico processando sua mensagem. Pode repetir?"
        );
    }

    #[test]
    fn test_drift_threshold_is_30s() {
        // Trava o placeholder enquanto I1 não tem histograma.
        assert_eq!(RECOVERY_DRIFT_THRESHOLD_MS, 30_000);
    }
}
