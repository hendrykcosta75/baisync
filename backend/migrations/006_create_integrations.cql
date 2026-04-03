-- Migration 006: Create assistant_integrations table

USE inertial_eclipse;

CREATE TABLE IF NOT EXISTS assistant_integrations (
  assistant_id UUID,
  user_id UUID,
  id UUID,
  channel text,
  provider text,
  status text,
  config_token text,
  config_phone_number text,
  config_chatwoot_url text,
  config_rate_limit_per_day int,
  config_max_message_length int,
  config_audio_response_mode text,
  config_interpret_documents boolean,
  config_split_messages boolean,
  created_at timestamp,
  PRIMARY KEY ((assistant_id, user_id), id)
);
