CREATE TABLE IF NOT EXISTS inertial_eclipse.card_charges_by_provider_id (
  provider_session_id text PRIMARY KEY,
  user_id UUID,
  charge_id UUID,
  assistant_id UUID,
  card_mode text
);
