-- Reverse lookup: key_result_id -> objective_id + workspace_id
-- Eliminates ALLOW FILTERING queries in find_objective_for_kr and recompute_objective_progress
CREATE TABLE IF NOT EXISTS inertial_eclipse.okr_kr_objective_lookup (
  key_result_id UUID,
  objective_id UUID,
  workspace_id UUID,
  PRIMARY KEY (key_result_id)
);
