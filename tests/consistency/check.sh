#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONSISTENCY_DIR="$SCRIPT_DIR"

FAILED=0

echo "=== Running Consistency Checks ==="
echo ""

# Ensure dependencies are installed
if [ ! -d "$CONSISTENCY_DIR/node_modules" ]; then
  echo "Installing consistency test dependencies..."
  cd "$CONSISTENCY_DIR" && npm install --silent
  cd "$ROOT_DIR"
fi

echo "--- Routes Consistency ---"
npx --prefix "$CONSISTENCY_DIR" tsx "$CONSISTENCY_DIR/routes-consistency.ts" || FAILED=1
echo ""

echo "--- Environment Variables ---"
npx --prefix "$CONSISTENCY_DIR" tsx "$CONSISTENCY_DIR/env-vars.ts" || FAILED=1
echo ""

echo "--- Navigation Routes ---"
npx --prefix "$CONSISTENCY_DIR" tsx "$CONSISTENCY_DIR/nav-routes.ts" || FAILED=1
echo ""

echo "--- Baisync Agent Coverage ---"
npx --prefix "$CONSISTENCY_DIR" tsx "$CONSISTENCY_DIR/baisync-coverage.ts" || FAILED=1
echo ""

echo "--- Baisync Sophie Endpoints (S1.3) ---"
npx --prefix "$CONSISTENCY_DIR" tsx "$CONSISTENCY_DIR/baisync-endpoints.ts" || FAILED=1
echo ""

echo "--- Multi-tenancy (T2.1) ---"
npx --prefix "$CONSISTENCY_DIR" tsx "$CONSISTENCY_DIR/multi-tenancy.ts" || FAILED=1
echo ""

if [ $FAILED -eq 0 ]; then
  echo "=== All Consistency Checks Passed ==="
else
  echo "=== Some Consistency Checks Failed ==="
  exit 1
fi
