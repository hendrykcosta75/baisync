-- Migration 102: Create skills table
--
-- User-authored capability library scoped per workspace. A skill carries a
-- `{name, description, instructions}` triple. Instructions are surfaced to
-- the LLM as the tool_result of `use_skill_<slug>` when the model decides
-- to invoke it — lazy-loaded context instead of bloating the system prompt.
--
-- Partition key = workspace_id (post-048 convention: all shared resources
-- are workspace-scoped, not user-scoped — workspaces can have N members).
-- Slug uniqueness within a workspace is enforced in Rust pre-insert (no
-- UNIQUE in Cassandra); partition scan cost is bounded by small N skills.

CREATE TABLE IF NOT EXISTS inertial_eclipse.skills (
  workspace_id UUID,
  id UUID,
  slug text,
  name text,
  description text,
  instructions text,
  created_by UUID,
  created_at timestamp,
  updated_at timestamp,
  PRIMARY KEY (workspace_id, id)
);
