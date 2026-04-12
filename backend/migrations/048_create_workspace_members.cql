CREATE TABLE IF NOT EXISTS inertial_eclipse.workspace_members (
  workspace_id UUID,
  user_id UUID,
  role text,
  invited_by UUID,
  joined_at timestamp,
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS inertial_eclipse.user_workspaces (
  user_id UUID,
  workspace_id UUID,
  workspace_name text,
  workspace_type text,
  role text,
  joined_at timestamp,
  PRIMARY KEY (user_id, workspace_id)
);
