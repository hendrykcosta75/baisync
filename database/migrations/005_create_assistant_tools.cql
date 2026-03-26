-- Migration 005: Create assistant_tools table

USE inertial_eclipse;

CREATE TABLE IF NOT EXISTS assistant_tools (
  assistant_id UUID,
  id UUID,
  name text,
  description text,
  endpoint text,
  method text,
  schema_json text,
  headers_json text,
  is_enabled boolean,
  PRIMARY KEY (assistant_id, id)
);
