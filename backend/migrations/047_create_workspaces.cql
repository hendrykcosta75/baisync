CREATE TABLE IF NOT EXISTS inertial_eclipse.workspaces (
  id UUID PRIMARY KEY,
  name text,
  type text,
  owner_id UUID,
  created_at timestamp,
  updated_at timestamp
);

CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON inertial_eclipse.workspaces (owner_id);
