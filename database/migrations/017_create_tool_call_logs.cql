CREATE TABLE IF NOT EXISTS inertial_eclipse.tool_call_logs (
    assistant_id UUID,
    tool_id UUID,
    id UUID,
    tool_name TEXT,
    arguments TEXT,
    status_code INT,
    response_body TEXT,
    error TEXT,
    duration_ms INT,
    called_at TIMESTAMP,
    PRIMARY KEY ((assistant_id, tool_id), called_at, id)
) WITH CLUSTERING ORDER BY (called_at DESC, id ASC);
