-- Migration 009: Create usage_stats table

USE inertial_eclipse;

CREATE TABLE IF NOT EXISTS usage_stats (
  user_id UUID,
  assistant_id UUID,
  period text,
  total_tokens bigint,
  total_messages bigint,
  total_conversations int,
  PRIMARY KEY ((user_id, assistant_id), period)
) WITH CLUSTERING ORDER BY (period DESC);
