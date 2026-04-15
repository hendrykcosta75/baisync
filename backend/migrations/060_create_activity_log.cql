CREATE TABLE IF NOT EXISTS inertial_eclipse.team_activity_log (
  team_id UUID,
  id TIMEUUID,
  actor_id UUID,
  actor_name text,
  action text,
  entity_type text,
  entity_id UUID,
  entity_name text,
  details text,
  created_at timestamp,
  PRIMARY KEY (team_id, id)
) WITH CLUSTERING ORDER BY (id DESC);
