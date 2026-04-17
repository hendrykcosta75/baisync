USE inertial_eclipse;

CREATE TABLE IF NOT EXISTS meeting_participants (
  meeting_id TIMEUUID,
  participant_id UUID,
  user_id UUID,
  display_name text,
  role text,
  join_status text,
  joined_at timestamp,
  left_at timestamp,
  PRIMARY KEY (meeting_id, participant_id)
);
