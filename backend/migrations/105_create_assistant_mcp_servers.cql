-- Migration 105: Create assistant_mcp_servers link table
--
-- M:N between assistants and MCP servers — same shape as
-- assistant_skills (104). Partition key = (assistant_id, workspace_id)
-- keeps cross-workspace reads impossible even with a leaked assistant_id.

CREATE TABLE IF NOT EXISTS inertial_eclipse.assistant_mcp_servers (
  assistant_id UUID,
  workspace_id UUID,
  server_id UUID,
  linked_by UUID,
  linked_at timestamp,
  PRIMARY KEY ((assistant_id, workspace_id), server_id)
);
