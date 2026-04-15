CREATE TABLE IF NOT EXISTS inertial_eclipse.okr_objectives (
  workspace_id UUID,
  id UUID,
  title text,
  description text,
  objective_type text,
  cycle text,
  status text,
  owner_id UUID,
  team_id UUID,
  progress float,
  confidence float,
  created_at timestamp,
  updated_at timestamp,
  PRIMARY KEY (workspace_id, id)
);
