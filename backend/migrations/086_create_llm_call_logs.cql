-- Migration 086: Create llm_call_logs table
--
-- One row per top-level call_llm_with_tools invocation, capturing provider,
-- model, tokens, duration, tool rounds and any error. Enables per-assistant
-- analytics and provider-filtered log views in the dashboard.

USE inertial_eclipse;

CREATE TABLE IF NOT EXISTS llm_call_logs (
  user_id UUID,
  assistant_id UUID,
  id TIMEUUID,
  conversation_id UUID,
  provider text,
  model text,
  tokens_used int,
  duration_ms int,
  tool_rounds int,
  tool_names list<text>,
  error text,
  created_at timestamp,
  PRIMARY KEY ((user_id, assistant_id), id)
) WITH CLUSTERING ORDER BY (id DESC);
