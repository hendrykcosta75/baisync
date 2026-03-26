#!/usr/bin/env bash
# Run all CQL migration scripts in order using cqlsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CQLSH="${CQLSH:-cqlsh}"
CQLSH_HOST="${CQLSH_HOST:-localhost}"
CQLSH_PORT="${CQLSH_PORT:-9042}"

echo "Running Cassandra migrations against ${CQLSH_HOST}:${CQLSH_PORT}..."

for cql_file in "$SCRIPT_DIR"/[0-9]*.cql; do
  filename="$(basename "$cql_file")"
  echo "  Applying ${filename}..."
  "$CQLSH" "$CQLSH_HOST" "$CQLSH_PORT" -f "$cql_file"
done

echo "All migrations applied successfully."
