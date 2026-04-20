-- Migration 093: Add session-tracking columns to llm_call_logs (T1.2 harness).
--
-- Turns llm_call_logs into a two-phase session log to support:
--   * T1.2 fire-and-forget drain (Started on HTTP-start, Finished/Failed on end)
--   * W1.3 crash recovery (find stale status='in_progress' rows > N seconds)
--
-- Cassandra does not support DEFAULT in ALTER ADD, so defaults are applied
-- from application code: status='in_progress' on insert, kind='primary',
-- retry_count=0. Status transitions: in_progress -> {completed, failed}.
--
-- messages_digest: SHA-256 of serialized prompt messages, hex-truncated,
-- used to correlate retries/compactions without storing plaintext user data.

USE inertial_eclipse;

ALTER TABLE llm_call_logs ADD status text;
ALTER TABLE llm_call_logs ADD started_at timestamp;
ALTER TABLE llm_call_logs ADD messages_digest text;
ALTER TABLE llm_call_logs ADD kind text;
ALTER TABLE llm_call_logs ADD retry_count int;
