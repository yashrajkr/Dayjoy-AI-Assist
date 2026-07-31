#!/usr/bin/env bash
# ============================================================================
# Dayjoy AI Assist — Database Backup Script
# ============================================================================
# Creates a timestamped backup of the database.
#
# Usage:
#   ./scripts/backup_db.sh
#
# Requires: DATABASE_URL environment variable, pg_dump

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/dayjoy_backup_${TIMESTAMP}.sql.gz"

echo "Dayjoy AI Assist — Database Backup"
echo "===================================="
echo ""

# Check if DATABASE_URL is set
if [ -z "${DATABASE_URL:-}" ]; then
    echo "❌ DATABASE_URL not set."
    exit 1
fi

# Create backup directory
mkdir -p "$BACKUP_DIR"

echo "Database: ${DATABASE_URL%%\?*}"
echo "Backup file: $BACKUP_FILE"
echo ""

# Create backup
echo "Creating backup..."
if pg_dump "$DATABASE_URL" --no-owner --no-privileges | gzip > "$BACKUP_FILE"; then
    SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo "✅ Backup created successfully ($SIZE)"

    # Calculate checksum
    CHECKSUM=$(sha256sum "$BACKUP_FILE" | cut -d' ' -f1)
    echo "   Checksum: $CHECKSUM"

    # Log to backup_records (if backend is running)
    echo "   File: $BACKUP_FILE"
    echo "   Timestamp: $TIMESTAMP"
else
    echo "❌ Backup failed!"
    exit 1
fi

# Cleanup old backups (keep last 30)
echo ""
echo "Cleaning up old backups (keeping last 30)..."
ls -t "${BACKUP_DIR}"/dayjoy_backup_*.sql.gz 2>/dev/null | tail -n +31 | while read -r old_file; do
    rm -f "$old_file"
    echo "  Deleted: $(basename "$old_file")"
done

echo ""
echo "✅ Backup complete."

# Restore instructions
echo ""
echo "To restore:"
echo "  gunzip -c $BACKUP_FILE | psql \$DATABASE_URL"
