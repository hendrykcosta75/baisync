CREATE TABLE IF NOT EXISTS inertial_eclipse.channel_notes (
    channel_id UUID,
    id UUID,
    title TEXT,
    content TEXT,
    created_by UUID,
    updated_by UUID,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    PRIMARY KEY (channel_id, id)
);
