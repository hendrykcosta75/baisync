USE inertial_eclipse;

ALTER TABLE appointments ADD meeting_id UUID;
ALTER TABLE appointments ADD meeting_code text;
ALTER TABLE appointments ADD meeting_url text;

ALTER TABLE appointments_by_assistant ADD meeting_id UUID;
ALTER TABLE appointments_by_assistant ADD meeting_code text;
