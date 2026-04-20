CREATE TABLE IF NOT EXISTS inertial_eclipse.password_reset_tokens (
    token_hash text PRIMARY KEY,
    user_id uuid,
    expires_at timestamp,
    created_at timestamp
);
