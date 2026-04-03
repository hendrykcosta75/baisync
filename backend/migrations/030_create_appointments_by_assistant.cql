USE inertial_eclipse;

CREATE TABLE IF NOT EXISTS appointments_by_assistant (
  assistant_id UUID,
  date_time timestamp,
  id UUID,
  user_id UUID,
  client_name text,
  client_phone text,
  duration_minutes int,
  status text,
  PRIMARY KEY (assistant_id, date_time, id)
) WITH CLUSTERING ORDER BY (date_time ASC, id ASC);
