USE inertial_eclipse;

CREATE TABLE IF NOT EXISTS meeting_messages (
  meeting_id TIMEUUID,
  id TIMEUUID,
  participant_id UUID,
  display_name text,
  body text,
  created_at timestamp,
  PRIMARY KEY (meeting_id, id)
) WITH CLUSTERING ORDER BY (id ASC);
