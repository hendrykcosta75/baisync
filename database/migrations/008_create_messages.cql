-- Migration 008: Create messages table

USE inertial_eclipse;

CREATE TABLE IF NOT EXISTS messages (
  conversation_id UUID,
  id TIMEUUID,
  role text,
  content text,
  media_url text,
  media_type text,
  tokens_used int,
  sub_agent_id UUID,
  created_at timestamp,
  PRIMARY KEY (conversation_id, id)
) WITH CLUSTERING ORDER BY (id ASC);
