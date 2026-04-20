-- I2: webhook dedup. No user_id (exceção multi-tenancy — webhook chega antes de resolver user). 24h TTL.
USE inertial_eclipse;
CREATE TABLE IF NOT EXISTS processed_webhooks (
  provider text,
  event_id text,
  processed_at timestamp,
  PRIMARY KEY ((provider, event_id))
) WITH default_time_to_live = 86400;
