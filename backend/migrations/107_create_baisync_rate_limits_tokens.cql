-- Migration 107: Token-based rate limit for Sophie (Baisync)
--
-- Until now, `baisync_rate_limits` counted *messages* per user per hour
-- (default 150 msgs/h). Messages are a poor proxy for cost: a 3-word
-- "ok" and a 2000-token planning response both count as 1.
--
-- This migration introduces a parallel counter table keyed on tokens
-- used (sum of `usageMetadata.totalTokenCount` from each Gemini SSE
-- response). The handler reads this table, Gemini writes its final
-- token count into it per turn, and `BAISYNC_RATE_LIMIT_PER_HOUR`
-- default is raised to 1000 tokens/h. The legacy table can stay for
-- historical lookback but is no longer consulted.
--
-- Counter tables are the natural fit — many concurrent requests
-- per user are fine, writes are commutative, and the partition
-- naturally garbage-collects as hour buckets rotate.

CREATE TABLE IF NOT EXISTS inertial_eclipse.baisync_rate_limits_tokens (
  user_id UUID,
  hour_bucket text,
  tokens_used counter,
  PRIMARY KEY ((user_id, hour_bucket))
);
