CREATE TABLE IF NOT EXISTS inertial_eclipse.pix_charges_by_mp_id (
  mp_payment_id text PRIMARY KEY,
  user_id UUID,
  charge_id UUID,
  assistant_id UUID
);
