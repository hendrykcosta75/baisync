-- Migration 004: Create assistant_files table

USE inertial_eclipse;

CREATE TABLE IF NOT EXISTS assistant_files (
  assistant_id UUID,
  user_id UUID,
  id UUID,
  name text,
  size int,
  mime_type text,
  content_text text,
  uploaded_at timestamp,
  PRIMARY KEY ((assistant_id, user_id), id)
);
