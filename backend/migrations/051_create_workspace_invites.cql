CREATE TABLE IF NOT EXISTS inertial_eclipse.workspace_invites (
  id UUID,
  workspace_id UUID,
  email text,
  role text,
  invited_by UUID,
  "token" text,
  expires_at timestamp,
  accepted boolean,
  created_at timestamp,
  PRIMARY KEY (workspace_id, id)
);

CREATE INDEX IF NOT EXISTS idx_ws_invites_token ON inertial_eclipse.workspace_invites ("token");
CREATE INDEX IF NOT EXISTS idx_workspace_invites_email ON inertial_eclipse.workspace_invites (email);
