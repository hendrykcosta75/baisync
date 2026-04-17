USE inertial_eclipse;

CREATE TABLE IF NOT EXISTS meetings_by_code (
  code text PRIMARY KEY,
  workspace_id UUID,
  meeting_id TIMEUUID,
  status text,
  host_user_id UUID,
  participant_mode text,
  livekit_room_name text,
  title text,
  workspace_member_count int,
  expires_at timestamp
);
