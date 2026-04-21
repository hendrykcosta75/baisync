-- Migration 098: Auto-compaction opt-in (T2.3).
--
-- (1) Per-assistant flag (ALTER). Default is applied in Rust code via
--     `Option<bool>::unwrap_or(false)` because Cassandra does not support
--     DEFAULT in ALTER ADD (see backend/AGENTS.md).
-- (2) Per-conversation rate-limit table with 1-hour TTL.
--
--     Rate-limit semantics: at most one compaction per
--     (user_id, conversation_id) per `default_time_to_live` window. The row
--     is written with `INSERT ... IF NOT EXISTS` (LWT) so a lost race between
--     two concurrent webhooks can only claim the slot once; the loser falls
--     through to the recent-history path. The row self-deletes after 3600s,
--     re-enabling future compactions.
--
--     Dynamic per-assistant TTLs are intentionally not supported — the table
--     TTL is fixed. If we ever need a tunable cadence, we'd add a clustering
--     key on `compacted_at` and filter; partition-level idempotency-with-TTL
--     is simpler for the MVP.

USE inertial_eclipse;

ALTER TABLE assistants ADD config_auto_compact boolean;

CREATE TABLE IF NOT EXISTS compaction_rate_limits (
  user_id uuid,
  conversation_id uuid,
  compacted_at timestamp,
  PRIMARY KEY ((user_id, conversation_id))
) WITH default_time_to_live = 3600;
