CREATE TABLE IF NOT EXISTS inertial_eclipse.team_members (
  team_id UUID,
  user_id UUID,
  workspace_id UUID,
  role text,
  joined_at timestamp,
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS inertial_eclipse.user_teams (
  user_id UUID,
  workspace_id UUID,
  team_id UUID,
  team_name text,
  role text,
  joined_at timestamp,
  PRIMARY KEY ((user_id, workspace_id), team_id)
);
