-- Migration 026: Create accepted_shares_by_assistant table for reverse lookup by assistant owner

USE inertial_eclipse;

CREATE TABLE IF NOT EXISTS accepted_shares_by_assistant (
  assistant_id UUID,
  user_id UUID,
  share_token text,
  user_email text,
  user_name text,
  permissions list<text>,
  accepted_at timestamp,
  PRIMARY KEY (assistant_id, accepted_at, user_id)
) WITH CLUSTERING ORDER BY (accepted_at DESC, user_id ASC);
