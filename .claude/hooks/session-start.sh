#!/bin/bash
#
# Gets a Claude Code on the web session to the point where the checks in
# CLAUDE.md actually run.
#
# Two things are needed and neither survives a fresh container:
#
#   1. node_modules, for the typecheck and the unit tests.
#   2. A Postgres, for `pnpm db:verify` — which applies every migration to a
#      clean database and runs the assertion suite. That suite is where the
#      real rules of this app are proved, so a session that cannot run it is
#      a session that cannot safely change the schema.
#
# DEVELOPMENT.md reaches for `supabase start`, which needs Docker. There is no
# Docker daemon on the web, so this stands up the bare Postgres that
# scripts/verify-schema.sh actually requires. Auth, Storage and PostgREST are
# not part of it — running the apps end to end still needs a real Supabase
# project.
set -euo pipefail

# Local machines have their own setup; this is only for the web.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$PROJECT_DIR"

# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------

# Not `--frozen-lockfile`: the container image is cached after this hook
# finishes, so a plain install both warms that cache and tolerates a lockfile
# that is mid-change on a branch.
echo "Installing workspace dependencies…"
pnpm install --silent

# ---------------------------------------------------------------------------
# Postgres, on the port scripts/verify-schema.sh already defaults to
# ---------------------------------------------------------------------------

PG_BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"

if [ -z "$PG_BIN" ]; then
  echo "No Postgres found — pnpm db:verify will not run in this session." >&2
  exit 0
fi

PGDATA=/var/lib/postgresql/promold
PGPORT=54322

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "Initialising Postgres at $PGDATA…"
  mkdir -p "$PGDATA"
  chown postgres:postgres "$PGDATA"
  # Trust auth: this database is throwaway, reachable only from inside the
  # container, and gets dropped and rebuilt by every verify run.
  su postgres -c "$PG_BIN/initdb --pgdata='$PGDATA' --username=postgres --auth=trust" >/dev/null
fi

if ! su postgres -c "$PG_BIN/pg_isready -h 127.0.0.1 -p $PGPORT" >/dev/null 2>&1; then
  echo "Starting Postgres on port $PGPORT…"
  su postgres -c "$PG_BIN/pg_ctl --pgdata='$PGDATA' \
    --options='-p $PGPORT -k /tmp -h 127.0.0.1' \
    --log=/tmp/postgres-promold.log --wait start" >/dev/null
fi

# The verify script defaults to exactly these, but spelling them out means a
# stray PGPORT from somewhere else cannot quietly point it at another server.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo 'export PGHOST=127.0.0.1'
    echo 'export PGPORT=54322'
    echo 'export PGUSER=postgres'
  } >> "$CLAUDE_ENV_FILE"
fi

echo "Ready. pnpm db:verify, pnpm test and pnpm typecheck will run."
