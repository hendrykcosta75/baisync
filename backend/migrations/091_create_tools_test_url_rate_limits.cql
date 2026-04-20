CREATE TABLE IF NOT EXISTS inertial_eclipse.tools_test_url_rate_limits (
    user_id uuid,
    minute_bucket text,
    count counter,
    PRIMARY KEY ((user_id), minute_bucket)
);
