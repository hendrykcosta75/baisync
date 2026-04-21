-- Migration 100: Per-conversation structured handoff summary
--
-- Holds the latest JSON handoff produced by compaction (W2.2).
-- Overwritten on each subsequent compaction. Prepended as
-- system message to the next LLM call for the same conversation.
--
-- Multi-tenancy: PK `((user_id, conversation_id))` scopes every read /
-- write to a single tenant+conversation. One row per conversation — the
-- latest handoff replaces any prior one (last-write-wins).
--
-- Rationale for a dedicated table instead of reusing `sessions.handoff_summary`:
-- T2.1's `messaging.rs` creates a fresh `session_id` per inbound user turn,
-- so `sessions.handoff_summary` would be scoped to a single turn, never to
-- "the current state of this conversation". A per-conversation table is the
-- natural shape for "most recent handoff we want the next LLM call to see".

USE inertial_eclipse;

CREATE TABLE IF NOT EXISTS conversation_handoffs (
  user_id uuid,
  conversation_id uuid,
  handoff_json text,
  updated_at timestamp,
  PRIMARY KEY ((user_id, conversation_id))
);
