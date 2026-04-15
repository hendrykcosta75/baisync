-- Porter's Five Forces analyses for workspace strategic planning
CREATE TABLE IF NOT EXISTS inertial_eclipse.porter_analyses (
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

-- Porter forces (rivalry, supplier_power, buyer_power, new_entrants, substitutes)
CREATE TABLE IF NOT EXISTS inertial_eclipse.porter_forces (
  analysis_id UUID,
  id UUID,
  force_type text,
  intensity int,
  rationale text,
  factors list<text>,
  created_at timestamp,
  PRIMARY KEY (analysis_id, id)
);
