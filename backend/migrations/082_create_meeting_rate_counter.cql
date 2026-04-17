USE inertial_eclipse;

CREATE TABLE IF NOT EXISTS meeting_rate (
  user_id UUID,
  hour_bucket text,
  count counter,
  PRIMARY KEY (user_id, hour_bucket)
);
