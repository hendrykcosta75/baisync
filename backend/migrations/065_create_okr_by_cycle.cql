CREATE TABLE IF NOT EXISTS inertial_eclipse.okr_objectives_by_cycle (
  workspace_id UUID,
  cycle text,
  objective_id UUID,
  title text,
  objective_type text,
  status text,
  progress float,
  confidence float,
  owner_id UUID,
  team_id UUID,
  PRIMARY KEY ((workspace_id, cycle), objective_id)
);
