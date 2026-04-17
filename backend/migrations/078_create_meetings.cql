USE inertial_eclipse;

CREATE TABLE IF NOT EXISTS meetings (
  workspace_id UUID,
  id TIMEUUID,
  code text,
  title text,
  host_user_id UUID,
  created_by UUID,
  participant_mode text,
  status text,
  livekit_room_name text,
  scheduled_start timestamp,
  started_at timestamp,
  ended_at timestamp,
  expires_at timestamp,
  link_uses_remaining int,
  created_at timestamp,
  updated_at timestamp,
  PRIMARY KEY (workspace_id, id)
) WITH CLUSTERING ORDER BY (id DESC);
