ALTER TABLE inertial_eclipse.workspace_api_keys ADD grok_api_key text;
ALTER TABLE inertial_eclipse.workspace_api_keys ADD deepseek_api_key text;
ALTER TABLE inertial_eclipse.users ADD api_key_grok text;
ALTER TABLE inertial_eclipse.users ADD api_key_deepseek text;
