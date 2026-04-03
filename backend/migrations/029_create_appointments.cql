USE inertial_eclipse;

CREATE TABLE IF NOT EXISTS appointments (
  user_id UUID,
  id UUID,
  assistant_id UUID,
  client_name text,
  client_email text,
  client_phone text,
  date_time timestamp,
  duration_minutes int,
  appointment_type text,
  notes text,
  origin_channel text,
  status text,
  conversation_id UUID,
  is_manual boolean,
  created_at timestamp,
  updated_at timestamp,
  PRIMARY KEY (user_id, id)
) WITH CLUSTERING ORDER BY (id DESC);
