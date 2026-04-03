-- Migration 019: Add index on assistant_integrations.status for health check queries

USE inertial_eclipse;

CREATE INDEX IF NOT EXISTS idx_integrations_status ON assistant_integrations (status);
