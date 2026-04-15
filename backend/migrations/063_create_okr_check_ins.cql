CREATE TABLE IF NOT EXISTS inertial_eclipse.okr_check_ins (
  key_result_id UUID,
  id TIMEUUID,
  previous_value float,
  new_value float,
  confidence float,
  note text,
  blockers text,
  author_id UUID,
  author_name text,
  created_at timestamp,
  PRIMARY KEY (key_result_id, id)
) WITH CLUSTERING ORDER BY (id DESC);
