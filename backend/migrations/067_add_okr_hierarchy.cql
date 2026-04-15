-- Add parent_objective_id to objectives for hierarchy support
ALTER TABLE inertial_eclipse.okr_objectives ADD parent_objective_id UUID;

-- Denormalized table for efficient child objective lookups
CREATE TABLE IF NOT EXISTS inertial_eclipse.okr_objective_children (
  parent_objective_id UUID,
  child_objective_id UUID,
  workspace_id UUID,
  child_title text,
  child_progress float,
  child_confidence float,
  child_team_id UUID,
  PRIMARY KEY (parent_objective_id, child_objective_id)
);
