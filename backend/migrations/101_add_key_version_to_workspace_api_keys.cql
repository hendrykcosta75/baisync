-- Migration 101: Add key_version column to workspace_api_keys
--
-- T3.2 F1 — enables versioned encryption: ciphertext for a row is
-- decrypted using ENCRYPTION_KEY_V{key_version}. Default in code is 1
-- (Cassandra ALTER ADD has no DEFAULT, so existing rows read back NULL
-- and the application maps NULL -> 1). Future online rotation writes new
-- rows with key_version=2 without rewriting old rows — reads pick the
-- right key per row.
--
-- Scope restriction (T3.2 F1): ONLY workspace_api_keys gets versioning.
-- assistant_integrations and the legacy users.* columns encrypted in S0
-- continue to use the single global ENCRYPTION_KEY. Rotating those
-- requires S0b (re-encrypt rows under the new key).

USE inertial_eclipse;

ALTER TABLE workspace_api_keys ADD key_version int;
