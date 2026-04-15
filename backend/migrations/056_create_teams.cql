CREATE TABLE IF NOT EXISTS inertial_eclipse.teams (
  workspace_id UUID,
  id UUID,
  name text,
  description text,
  color text,
  created_by UUID,
  created_at timestamp,
  updated_at timestamp,
  PRIMARY KEY (workspace_id, id)
);
