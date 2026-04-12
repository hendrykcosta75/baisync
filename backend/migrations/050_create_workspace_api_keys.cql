CREATE TABLE IF NOT EXISTS inertial_eclipse.workspace_api_keys (
  workspace_id UUID PRIMARY KEY,
  openai_api_key text,
  claude_api_key text,
  gemini_api_key text,
  elevenlabs_api_key text,
  mercadopago_access_token text,
  mercadopago_public_key text,
  stripe_secret_key text,
  stripe_public_key text,
  updated_at timestamp
);
