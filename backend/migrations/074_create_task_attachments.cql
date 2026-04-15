CREATE TABLE IF NOT EXISTS inertial_eclipse.task_attachments (
    task_id UUID,
    id UUID,
    team_id UUID,
    file_name TEXT,
    file_size BIGINT,
    mime_type TEXT,
    file_data BLOB,
    uploaded_by UUID,
    uploader_name TEXT,
    created_at TIMESTAMP,
    PRIMARY KEY (task_id, id)
);
