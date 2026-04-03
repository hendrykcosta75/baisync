-- Migration 015: Add webhook verify token column for Meta Official WhatsApp API

USE inertial_eclipse;

ALTER TABLE assistant_integrations ADD config_webhook_verify_token text;
