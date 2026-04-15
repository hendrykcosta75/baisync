-- Strategy map nodes for visual strategic planning
CREATE TABLE IF NOT EXISTS inertial_eclipse.strategy_map_nodes (
  workspace_id UUID,
  id UUID,
  node_type text,
  entity_id UUID,
  label text,
  position_x float,
  position_y float,
  width float,
  height float,
  style_data text,
  bsc_perspective text,
  created_at timestamp,
  updated_at timestamp,
  PRIMARY KEY (workspace_id, id)
);

-- Strategy map edges connecting nodes
CREATE TABLE IF NOT EXISTS inertial_eclipse.strategy_map_edges (
  workspace_id UUID,
  id UUID,
  source_node_id UUID,
  target_node_id UUID,
  edge_type text,
  label text,
  style_data text,
  created_at timestamp,
  PRIMARY KEY (workspace_id, id)
);
