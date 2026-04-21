-- Migration 099: Add evaluator config to assistants (W2.1 harness).
--
-- Opt-in evaluator runs post-turn fire-and-forget using a cheap
-- system-provided LLM (`EVALUATOR_API_KEY`) to detect PII leaks,
-- impossible promises, and contradictions to the assistant's system
-- prompt. The evaluator NEVER blocks the user response — it executes
-- in a `tokio::spawn` guarded by a global semaphore.
--
-- Defaults are applied in Rust code (Cassandra does not support
-- DEFAULT in ALTER ADD — see backend/AGENTS.md):
--   - `config_enable_evaluator` None/false ⇒ evaluator disabled.
--   - `config_evaluator_model` None ⇒ fall back to env `EVALUATOR_MODEL`.
--
-- Audit trail:
--   - `llm_call_logs` row emitted with `kind='evaluator'` via the T1.2
--     mpsc pipeline; issues are joined with "; " and written to the
--     `error` column so the S1.3 `my_recent_errors` endpoint surfaces
--     them automatically.
--   - `session_events` row with `event_type='evaluator_verdict'` via
--     the T2.1 drain (fire-and-forget).
--   - SSE event `evaluator_alert` published on the global event_bus
--     when issues are detected.

USE inertial_eclipse;

ALTER TABLE assistants ADD config_enable_evaluator boolean;
ALTER TABLE assistants ADD config_evaluator_model text;
