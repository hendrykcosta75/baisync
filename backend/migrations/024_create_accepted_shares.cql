-- Migration 024: Create accepted_shares table for tracking imported/accepted shared assistants per user

USE inertial_eclipse;

CREATE TABLE IF NOT EXISTS accepted_shares (
  user_id UUID,
  assistant_id UUID,
  share_token text,
  assistant_name text,
  assistant_description text,
  permissions list<text>,
  accepted_at timestamp,
  PRIMARY KEY (user_id, assistant_id)
);
