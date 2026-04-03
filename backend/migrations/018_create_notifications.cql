-- Migration 018: Create notifications table

USE inertial_eclipse;

CREATE TABLE IF NOT EXISTS notifications (
  user_id UUID,
  id UUID,
  assistant_id UUID,
  integration_id UUID,
  notification_type text,
  title text,
  message text,
  is_read boolean,
  created_at timestamp,
  PRIMARY KEY (user_id, id)
) WITH CLUSTERING ORDER BY (id DESC);
