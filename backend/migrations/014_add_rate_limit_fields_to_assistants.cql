-- Migration 014: Add rate limit and max message length config to assistants table

USE inertial_eclipse;

ALTER TABLE assistants ADD config_rate_limit_per_day int;
ALTER TABLE assistants ADD config_max_message_length int;
ALTER TABLE assistants ADD config_rate_limit_message text;
ALTER TABLE assistants ADD config_max_length_message text;
