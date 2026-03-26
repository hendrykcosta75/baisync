-- Migration 007: Create conversations table

USE inertial_eclipse;

CREATE TABLE IF NOT EXISTS conversations (
  assistant_id UUID,
  user_id UUID,
  id UUID,
  contact_number text,
  channel text,
  started_at timestamp,
  last_message_at timestamp,
  summary text,
  PRIMARY KEY ((assistant_id, user_id), id)
) WITH CLUSTERING ORDER BY (id DESC);
