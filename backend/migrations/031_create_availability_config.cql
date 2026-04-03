USE inertial_eclipse;

CREATE TABLE IF NOT EXISTS assistant_availability (
  assistant_id UUID,
  user_id UUID,
  timezone text,
  default_duration_minutes int,
  buffer_minutes int,
  max_per_day int,
  blocked_dates set<text>,
  schedule_json text,
  PRIMARY KEY (assistant_id)
);
