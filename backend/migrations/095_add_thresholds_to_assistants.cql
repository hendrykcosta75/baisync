USE inertial_eclipse;
ALTER TABLE assistants ADD config_max_tool_rounds int;
ALTER TABLE assistants ADD config_max_duration_ms int;
-- Defaults aplicados em código: 5 rounds, 30000 ms.
