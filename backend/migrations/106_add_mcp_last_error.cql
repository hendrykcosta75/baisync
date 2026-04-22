-- Migration 106: Add last_error + last_error_at to mcp_servers
--
-- Context: when `tools/list` fails (unreachable URL, non-MCP endpoint,
-- auth rejected, etc.) `services/mcp/cache.rs::ensure_tools_cached`
-- returns `Ok(Vec::new())` and logs a warning, so the LLM silently
-- sees zero tools from that server. Users have no way to know an MCP
-- they registered is broken — the assistant just answers "I don't
-- have that tool" without explanation.
--
-- These columns let the cache layer record the last failure message
-- (plaintext, bounded), which the API surfaces on /api/mcp-servers
-- so the UI can show a red badge + tooltip with the error.

USE inertial_eclipse;

ALTER TABLE mcp_servers ADD last_error text;
ALTER TABLE mcp_servers ADD last_error_at timestamp;
