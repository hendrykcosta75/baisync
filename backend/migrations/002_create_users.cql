-- Migration 002: Create users table

USE inertial_eclipse;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email text,
  password_hash text,
  name text,
  two_factor_enabled boolean,
  two_factor_secret text,
  api_key_openai text,
  api_key_claude text,
  api_key_gemini text,
  created_at timestamp,
  updated_at timestamp
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
