CREATE TABLE IF NOT EXISTS inertial_eclipse.card_charges (
  user_id UUID,
  id UUID,
  assistant_id UUID,
  conversation_id UUID,
  contact_phone text,
  amount double,
  description text,
  card_mode text,
  provider_session_id text,
  checkout_url text,
  status text,
  customer_name text,
  customer_cpf text,
  created_at timestamp,
  updated_at timestamp,
  PRIMARY KEY (user_id, id)
) WITH CLUSTERING ORDER BY (id DESC);
