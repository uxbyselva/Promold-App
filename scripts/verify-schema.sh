#!/usr/bin/env bash
# Applies every migration to a clean database and runs the assertion suite.
#
# Used in CI and locally to prove the schema builds from scratch and that the
# constraints the design depends on actually hold. Requires a reachable
# Postgres 16; defaults target the Supabase CLI's local database.
set -euo pipefail

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-54322}"
PGUSER="${PGUSER:-postgres}"
DB="${VERIFY_DB:-promold_verify}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

export PGHOST PGPORT PGUSER

psql -q -d postgres -c "drop database if exists ${DB} with (force);"
psql -q -d postgres -c "create database ${DB};"

# Supabase provides the auth schema in a real project. Locally we stand up the
# minimum surface the migrations reference so the schema can be verified
# without the full Supabase stack.
psql -q -d "${DB}" -v ON_ERROR_STOP=1 <<'EOSQL'
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique
);
EOSQL

for f in "${ROOT}"/supabase/migrations/*.sql; do
  echo "  applying $(basename "$f")"
  psql -q -d "${DB}" -v ON_ERROR_STOP=1 -f "$f" > /dev/null
done

if [ "${SKIP_SEED:-0}" != "1" ]; then
  echo "  applying seed.sql"
  psql -q -d "${DB}" -v ON_ERROR_STOP=1 -f "${ROOT}/supabase/seed.sql" > /dev/null
fi

if [ "${SKIP_TESTS:-0}" != "1" ]; then
  echo "  running assertions"
  psql -q -d "${DB}" -v ON_ERROR_STOP=1 -f "${ROOT}/supabase/tests/schema_assertions.sql"
fi

echo "schema verified"
