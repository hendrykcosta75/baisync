CREATE TABLE IF NOT EXISTS inertial_eclipse.okr_key_results (
  objective_id UUID,
  id UUID,
  title text,
  kr_type text,
  start_value float,
  target_value float,
  current_value float,
  unit text,
  confidence float,
  status text,
  owner_id UUID,
  created_at timestamp,
  updated_at timestamp,
  PRIMARY KEY (objective_id, id)
);
