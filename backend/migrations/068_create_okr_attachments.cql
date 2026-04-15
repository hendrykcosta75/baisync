-- Attachments for goal verification on key results and check-ins
CREATE TABLE IF NOT EXISTS inertial_eclipse.okr_attachments (
  entity_id UUID,
  id UUID,
  entity_type text,
  workspace_id UUID,
  file_name text,
  file_size bigint,
  mime_type text,
  file_data blob,
  uploaded_by UUID,
  uploader_name text,
  created_at timestamp,
  PRIMARY KEY (entity_id, id)
);
