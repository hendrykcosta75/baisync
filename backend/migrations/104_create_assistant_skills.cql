-- Migration 104: Create assistant_skills link table
--
-- M:N between assistants and skills. Both sides live in the same workspace
-- (the link handler validates assistant.workspace_id == skill.workspace_id
-- before inserting). Partition key = (assistant_id, workspace_id) makes
-- every lookup carry the workspace — an attacker who guesses an
-- assistant_id still can't read another workspace's links.
--
-- NOTE: the legacy `assistants` table (migration 003) uses column name
-- `user_id` but stores workspace_id values (see project_multitenancy_workspace
-- memory). Here we name the column `workspace_id` explicitly per post-048
-- convention. Values match — the link is consistent.

CREATE TABLE IF NOT EXISTS inertial_eclipse.assistant_skills (
  assistant_id UUID,
  workspace_id UUID,
  skill_id UUID,
  linked_by UUID,
  linked_at timestamp,
  PRIMARY KEY ((assistant_id, workspace_id), skill_id)
);
