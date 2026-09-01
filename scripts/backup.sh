#!/usr/bin/env bash
#
# scripts/backup.sh — a date-stamped pg_dump into supabase/backups/.
#
#   ./scripts/backup.sh              # schema + data, public schema
#   ./scripts/backup.sh --schema     # schema only, no rows
#   ./scripts/backup.sh --full       # every schema, including auth
#
# A DUMP CONTAINS CNIC NUMBERS, PHONE NUMBERS AND HOME ADDRESSES.
# supabase/backups/ is in .gitignore and must stay there. Do not email one, do
# not put one in shared cloud storage unencrypted, and do not leave one on a
# laptop that leaves the house.
#
# Supabase also takes its own automated backups on the hosted plan. This script
# is not a replacement for those — it is the copy that survives losing access
# to the Supabase account itself, which is the failure the automated backups
# cannot cover.

set -euo pipefail

cd "$(dirname "$0")/.."

# ---- credentials ------------------------------------------------------------
if [ -z "${SUPABASE_DB_URL:-}" ]; then
  if [ -f .env.local ]; then
    # Read only the one variable, rather than sourcing the file: .env.local
    # holds service-role keys, and sourcing it exports them into every child
    # process this script starts.
    SUPABASE_DB_URL="$(grep -m1 '^SUPABASE_DB_URL=' .env.local | cut -d= -f2- | tr -d '"'"'"'')"
  fi
fi

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "✗ SUPABASE_DB_URL is not set and was not found in .env.local" >&2
  exit 1
fi

# ---- pg_dump ----------------------------------------------------------------
# The server is PostgreSQL 17. A pg_dump older than the server refuses to run,
# which is a good refusal — an older dump format can silently omit newer object
# types. If yours is older, install 17 or use the docker fallback printed below.
PG_DUMP="${PG_DUMP:-pg_dump}"
if ! command -v "$PG_DUMP" >/dev/null 2>&1; then
  for candidate in \
    "/c/Program Files/PostgreSQL/17/bin/pg_dump.exe" \
    "/usr/lib/postgresql/17/bin/pg_dump" \
    "/opt/homebrew/opt/postgresql@17/bin/pg_dump"; do
    if [ -x "$candidate" ]; then PG_DUMP="$candidate"; break; fi
  done
fi

if ! command -v "$PG_DUMP" >/dev/null 2>&1 && [ ! -x "$PG_DUMP" ]; then
  echo "✗ pg_dump 17 not found. Either install it, or run:" >&2
  echo "    docker run --rm -e PGURL=\"\$SUPABASE_DB_URL\" postgres:17 \\" >&2
  echo "      sh -c 'pg_dump \"\$PGURL\" --schema=public --no-owner --no-privileges' > backup.sql" >&2
  exit 1
fi

mkdir -p supabase/backups

MODE="${1:-}"
STAMP="$(date +%Y%m%d-%H%M%S)"

case "$MODE" in
  --schema)
    OUT="supabase/backups/schema-${STAMP}.sql"
    ARGS=(--schema=public --schema-only --no-owner --no-privileges)
    ;;
  --full)
    # auth.users included. This is the one that can restore accounts.
    OUT="supabase/backups/full-${STAMP}.sql"
    ARGS=(--no-owner --no-privileges)
    ;;
  *)
    OUT="supabase/backups/public-${STAMP}.sql"
    ARGS=(--schema=public --no-owner --no-privileges)
    ;;
esac

echo "→ dumping to ${OUT}"
"$PG_DUMP" "$SUPABASE_DB_URL" "${ARGS[@]}" -f "$OUT"

SIZE="$(du -h "$OUT" | cut -f1)"
echo "✓ ${OUT} (${SIZE})"

# ---- retention --------------------------------------------------------------
# Keep the eight most recent of each kind. Weekly, that is two months of
# history; more than that on a laptop is a liability, not a safety net.
for prefix in public schema full; do
  # shellcheck disable=SC2012
  ls -1t supabase/backups/${prefix}-*.sql 2>/dev/null | tail -n +9 | while read -r old; do
    echo "  pruning $(basename "$old")"
    rm -f "$old"
  done
done

echo
echo "Reminder: this file contains personal data. Keep it off shared storage."
