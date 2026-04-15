-- SWOT analyses for workspace strategic planning
CREATE TABLE IF NOT EXISTS inertial_eclipse.swot_analyses (
  workspace_id UUID,
  id UUID,
  title text,
  description text,
  cycle text,
  created_by UUID,
  created_at timestamp,
  updated_at timestamp,
  PRIMARY KEY (workspace_id, id)
);

-- SWOT items within each quadrant
CREATE TABLE IF NOT EXISTS inertial_eclipse.swot_items (
  analysis_id UUID,
  id UUID,
  quadrant text,
  content text,
  priority int,
  linked_objective_id UUID,
  author_id UUID,
  position int,
  created_at timestamp,
  PRIMARY KEY (analysis_id, id)
);
