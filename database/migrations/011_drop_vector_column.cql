-- Migration 011: Remove VECTOR type references from keyspace
-- The VECTOR<FLOAT, 1536> type is not supported by scylla-rust 0.15,
-- causing continuous metadata refresh failures that degrade all DB operations.
-- The embedding_vector column and SAI index were already dropped manually.
-- This migration ensures a clean state on fresh installs by not creating them.
-- NOTE: If running on a DB where the column still exists, run manually:
--   DROP INDEX IF EXISTS idx_assistant_files_embedding;
--   ALTER TABLE assistant_files DROP embedding_vector;
--   DELETE FROM system_schema.dropped_columns WHERE keyspace_name = 'inertial_eclipse' AND table_name = 'assistant_files' AND column_name = 'embedding_vector';

USE inertial_eclipse;
