#!/usr/bin/env bash
# Refuses anything that looks like a credential in tracked files.
#
# Added after a service_role key was pasted into a chat: cheap to run, and the
# failure mode it guards against is one you cannot take back.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail=0
report() { echo "  $1"; fail=1; }

echo "scanning tracked files for credentials"

# Supabase and other JWTs: the header for {"alg":"HS256","typ":"JWT"}
while IFS= read -r line; do
  [ -z "$line" ] && continue
  report "JWT-shaped string: $line"
done < <(git grep -lE 'eyJhbGciOi[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{20,}' -- . ':!scripts/scan-secrets.sh' 2>/dev/null)

# service_role in any form
while IFS= read -r line; do
  [ -z "$line" ] && continue
  report "service_role reference: $line"
done < <(git grep -lE 'service_role["'"'"']?\s*[:=]\s*["'"'"']?eyJ' -- . 2>/dev/null)

# A committed env file with something in it
while IFS= read -r f; do
  [ -z "$f" ] && continue
  [ "$f" = "apps/admin/.env.example" ] && continue
  report "env file is tracked: $f"
done < <(git ls-files | grep -E '(^|/)\.env' 2>/dev/null)

# Postgres connection strings carrying a password
while IFS= read -r line; do
  [ -z "$line" ] && continue
  report "database URL with a password: $line"
done < <(git grep -lE 'postgres(ql)?://[^:]+:[^@]+@' -- . ':!scripts/scan-secrets.sh' 2>/dev/null)

if [ "$fail" -eq 1 ]; then
  echo
  echo "FAILED — remove the value, then rotate it. A key that reached a commit"
  echo "is compromised even after the commit is amended."
  exit 1
fi

echo "clean"
