CREATE TABLE IF NOT EXISTS inertial_eclipse.channels (
  workspace_id UUID,
  id UUID,
  name text,
  description text,
  type text,
  created_by UUID,
  created_at timestamp,
  updated_at timestamp,
  PRIMARY KEY (workspace_id, id)
);
