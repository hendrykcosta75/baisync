-- Migration 103: Create mcp_servers table
--
-- Model Context Protocol server registry scoped per workspace. Backend
-- acts as MCP client (HTTP streamable or SSE transport) — user registers
-- url + optional auth header; backend caches `tools/list` for 10 minutes
-- and forwards `tools/call` at invocation time.
--
-- auth_header_value is stored AES-GCM encrypted (versioned — same scheme
-- as workspace_api_keys migration 101). key_version is populated only
-- when auth_header_value is set.
--
-- tools_cache holds the JSON array returned by the last successful
-- `tools/list` call; tools_cached_at is the wall-clock timestamp. Cache
-- refresh policy lives in services/mcp/cache.rs.

CREATE TABLE IF NOT EXISTS inertial_eclipse.mcp_servers (
  workspace_id UUID,
  id UUID,
  slug text,
  name text,
  url text,
  transport text,
  auth_header_name text,
  auth_header_value text,
  key_version int,
  tools_cache text,
  tools_cached_at timestamp,
  created_by UUID,
  created_at timestamp,
  updated_at timestamp,
  PRIMARY KEY (workspace_id, id)
);
