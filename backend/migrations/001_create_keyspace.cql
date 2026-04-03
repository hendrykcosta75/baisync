-- Migration 001: Create keyspace inertial_eclipse
-- SimpleStrategy with replication_factor 1 (development environment)

CREATE KEYSPACE IF NOT EXISTS inertial_eclipse
WITH replication = {
  'class': 'SimpleStrategy',
  'replication_factor': 1
};
