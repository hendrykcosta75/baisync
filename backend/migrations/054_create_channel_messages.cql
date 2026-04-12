CREATE TABLE IF NOT EXISTS inertial_eclipse.channel_messages (
  channel_id UUID,
  id TIMEUUID,
  sender_id UUID,
  sender_name text,
  content text,
  message_type text,
  edited_at timestamp,
  created_at timestamp,
  PRIMARY KEY (channel_id, id)
) WITH CLUSTERING ORDER BY (id DESC);
