-- Migration 020: Add ElevenLabs API key to users table

USE inertial_eclipse;

ALTER TABLE users ADD api_key_elevenlabs text;
