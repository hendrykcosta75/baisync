-- Migration 096: Create sessions table
--
-- Stores one row per session (logical conversation turn group across
-- possibly many messages). Foundation for Harness session model.

USE inertial_eclipse;

CREATE TABLE IF NOT EXISTS sessions (
  user_id uuid,
  session_id timeuuid,
  conversation_id uuid,
  assistant_id uuid,
  status text,
  handoff_summary text,
  checkpoint_at timestamp,
  created_at timestamp,
  PRIMARY KEY ((user_id), session_id)
) WITH CLUSTERING ORDER BY (session_id DESC);
