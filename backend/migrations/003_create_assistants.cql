-- Migration 003: Create assistants table

USE inertial_eclipse;

CREATE TABLE IF NOT EXISTS assistants (
  user_id UUID,
  id UUID,
  name text,
  description text,
  llm_provider text,
  model text,
  temperature float,
  max_tokens int,
  system_prompt text,
  is_team_lead boolean,
  parent_assistant_id UUID,
  share_token text,
  share_permissions set<text>,
  created_at timestamp,
  updated_at timestamp,
  PRIMARY KEY (user_id, id)
);
