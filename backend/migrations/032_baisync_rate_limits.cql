CREATE TABLE IF NOT EXISTS inertial_eclipse.baisync_rate_limits (
    user_id uuid,
    hour_bucket text,
    count counter,
    PRIMARY KEY (user_id, hour_bucket)
);
