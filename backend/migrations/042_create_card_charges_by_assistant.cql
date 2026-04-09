CREATE TABLE IF NOT EXISTS inertial_eclipse.card_charges_by_assistant (
  assistant_id UUID,
  created_at timestamp,
  id UUID,
  user_id UUID,
  amount double,
  status text,
  contact_phone text,
  description text,
  customer_name text,
  customer_cpf text,
  card_mode text,
  PRIMARY KEY (assistant_id, created_at, id)
) WITH CLUSTERING ORDER BY (created_at DESC, id DESC);
