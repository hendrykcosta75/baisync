-- Migration 022: Add voice_id to audio config in assistants table

USE inertial_eclipse;

ALTER TABLE assistants ADD config_audio_voice_id text;
