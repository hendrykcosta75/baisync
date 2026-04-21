-- Migration 097: Create session_events table
--
-- Append-only log of events within a session. Composite PK with
-- (user_id, session_id) as partition, event_id as clustering.
-- Cluster ASC for natural append order; queries may reverse if
-- they need newest first.

USE inertial_eclipse;

CREATE TABLE IF NOT EXISTS session_events (
  user_id uuid,
  session_id timeuuid,
  event_id timeuuid,
  event_type text,
  payload text,
  created_at timestamp,
  PRIMARY KEY ((user_id, session_id), event_id)
) WITH CLUSTERING ORDER BY (event_id ASC)
  AND default_time_to_live = 7776000;
