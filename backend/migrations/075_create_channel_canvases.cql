CREATE TABLE IF NOT EXISTS inertial_eclipse.channel_canvases (
    channel_id UUID,
    id UUID,
    title TEXT,
    canvas_data TEXT,
    created_by UUID,
    updated_by UUID,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    PRIMARY KEY (channel_id, id)
);
