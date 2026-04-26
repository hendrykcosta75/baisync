-- Add deterministic HMAC-SHA256 fingerprints of config_phone_number and
-- config_token so webhook routing can do indexed equality lookups against
-- the encrypted columns. The plaintext columns remain AES-GCM encrypted;
-- the fingerprint columns hold a stable HMAC of the plaintext (see
-- backend/src/services/lookup_fp.rs).
ALTER TABLE inertial_eclipse.assistant_integrations ADD config_phone_fp blob;
ALTER TABLE inertial_eclipse.assistant_integrations ADD config_token_fp blob;
CREATE INDEX IF NOT EXISTS idx_integrations_phone_fp ON inertial_eclipse.assistant_integrations (config_phone_fp);
CREATE INDEX IF NOT EXISTS idx_integrations_token_fp ON inertial_eclipse.assistant_integrations (config_token_fp);
