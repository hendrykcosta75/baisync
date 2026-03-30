-- Migration 021: Add audio configuration fields to assistants table

USE inertial_eclipse;

ALTER TABLE assistants ADD config_audio_provider text;
ALTER TABLE assistants ADD config_audio_mode text;
ALTER TABLE assistants ADD config_audio_transcribe boolean;
ALTER TABLE assistants ADD config_audio_fallback_to_text boolean;
ALTER TABLE assistants ADD config_audio_transcription_failure_message text;
