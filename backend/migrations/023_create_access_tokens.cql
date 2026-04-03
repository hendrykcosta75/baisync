-- Migration 023: Create access_tokens table for assistant access control

USE inertial_eclipse;

CREATE TABLE IF NOT EXISTS access_tokens (
  user_id UUID,
  assistant_id UUID,
  id UUID,
  name text,
  "token" text,
  permission_level text,
  email text,
  expires_at timestamp,
  created_at timestamp,
  is_revoked boolean,
  PRIMARY KEY ((user_id, assistant_id), id)
) WITH CLUSTERING ORDER BY (id DESC);
