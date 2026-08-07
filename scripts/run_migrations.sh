#!/usr/bin/env bash
# ============================================================================
# Dayjoy AI Assist — Database Migration Runner
# ============================================================================
# Applies all SQL migrations in order. Idempotent — safe to re-run.
#
# Usage:
#   ./scripts/run_migrations.sh
#
# Requires: DATABASE_URL environment variable or psql connection config.

set -euo pipefail

MIGRATIONS_DIR="$(dirname "$0")/../"
LOG_FILE="/tmp/dayjoy_migrations.log"

echo "Dayjoy AI Assist — Database Migration Runner"
echo "=============================================="
echo ""

# Check if DATABASE_URL is set
if [ -z "${DATABASE_URL:-}" ]; then
    echo "❌ DATABASE_URL not set. Export it first:"
    echo "   export DATABASE_URL='postgresql://user:pass@host:5432/dbname'"
    exit 1
fi

echo "Database: ${DATABASE_URL%%\?*}"
echo "Log file: $LOG_FILE"
echo ""

# List of migrations in order
MIGRATIONS=(
    "supabase_schema.sql"
    "supabase_schema_v2.sql"
    "supabase_schema_v3.sql"
    "supabase_schema_v4.sql"
    "supabase_schema_v5.sql"
    "supabase_schema_v6_rag.sql"
    "supabase_schema_v7_admin.sql"
    "supabase_schema_v8_distributor.sql"
    "supabase_schema_v9_customer.sql"
    "supabase_schema_v10_analytics.sql"
    "supabase_schema_v11_communication.sql"
    "supabase_schema_v12_workflow.sql"
    "supabase_schema_v13_security.sql"
    "supabase_schema_v14_business_intelligence.sql"
    "supabase_schema_v15_chat_messages_rag_columns.sql"
)

echo "Applying ${#MIGRATIONS[@]} migrations..."
echo ""

SUCCESS=0
FAILED=0
SKIPPED=0

for migration in "${MIGRATIONS[@]}"; do
    FILE="${MIGRATIONS_DIR}${migration}"

    if [ ! -f "$FILE" ]; then
        echo "  ⏭️  SKIP: $migration (file not found)"
        ((SKIPPED++))
        continue
    fi

    echo -n "  → Applying $migration... "

    if psql "$DATABASE_URL" -f "$FILE" > "$LOG_FILE" 2>&1; then
        echo "✅ OK"
        ((SUCCESS++))
    else
        echo "❌ FAILED (check $LOG_FILE)"
        ((FAILED++))
        # Continue with other migrations — they're idempotent
    fi
done

echo ""
echo "=============================================="
echo "Migration Summary:"
echo "  ✅ Applied: $SUCCESS"
echo "  ❌ Failed:  $FAILED"
echo "  ⏭️  Skipped: $SKIPPED"
echo "=============================================="

if [ $FAILED -gt 0 ]; then
    echo ""
    echo "⚠️  Some migrations failed. Check $LOG_FILE for details."
    echo "    Migrations are idempotent — you can re-run this script."
    exit 1
fi

echo ""
echo "✅ All migrations applied successfully!"
