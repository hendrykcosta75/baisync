CREATE TABLE IF NOT EXISTS inertial_eclipse.channel_members (
  channel_id UUID,
  user_id UUID,
  workspace_id UUID,
  role text,
  last_read_at timestamp,
  joined_at timestamp,
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS inertial_eclipse.user_channels (
  user_id UUID,
  workspace_id UUID,
  channel_id UUID,
  channel_name text,
  channel_type text,
  unread_count int,
  last_message_at timestamp,
  PRIMARY KEY ((user_id, workspace_id), last_message_at, channel_id)
) WITH CLUSTERING ORDER BY (last_message_at DESC, channel_id ASC);
