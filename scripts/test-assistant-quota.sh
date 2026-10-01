#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
TEST_DIR=$(mktemp -d /tmp/jjd-ai-quota-test-XXXXXX)
trap 'rm -rf "$TEST_DIR"' EXIT
export DATABASE_URL="file:$TEST_DIR/test.db"
export ANTHROPIC_API_KEY="test-not-a-real-key"
# Only a brand-new SQLite DB. No seed/import, no production connection.
node_modules/.bin/prisma db push --schema apps/api/prisma/schema.prisma --skip-generate >/dev/null
node --test --import tsx apps/api/test/assistant-quota.integration.ts
