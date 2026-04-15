CREATE TABLE IF NOT EXISTS inertial_eclipse.task_comments (
  task_id UUID,
  id TIMEUUID,
  author_id UUID,
  author_name text,
  content text,
  created_at timestamp,
  PRIMARY KEY (task_id, id)
) WITH CLUSTERING ORDER BY (id DESC);
