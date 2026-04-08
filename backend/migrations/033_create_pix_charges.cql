CREATE TABLE IF NOT EXISTS inertial_eclipse.pix_charges (
  user_id UUID,
  id UUID,
  assistant_id UUID,
  conversation_id UUID,
  contact_phone text,
  amount double,
  description text,
  pix_key text,
  pix_key_type text,
  mp_payment_id text,
  mp_qr_code_base64 text,
  mp_copia_e_cola text,
  status text,
  created_at timestamp,
  updated_at timestamp,
  expires_at timestamp,
  PRIMARY KEY (user_id, id)
) WITH CLUSTERING ORDER BY (id DESC);
