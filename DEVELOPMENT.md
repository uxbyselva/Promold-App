# Development

## Prerequisites

- Node 22+ and pnpm 10+
- Docker (for the Supabase local stack)
- Supabase CLI (`npm i -g supabase`)

## Setup

```bash
pnpm install
supabase start          # Postgres, Auth, Storage, Studio
supabase db reset       # applies supabase/migrations/* then supabase/seed.sql
```

Studio runs at http://localhost:54323.

## Layout

```
apps/
  mobile/     Expo field app                      (not yet built)
  admin/      Next.js admin web                   (not yet built)
packages/
  shared/     Types, permission flags, state machines, validation
supabase/
  migrations/ SQL migrations — the source of truth for the schema
  tests/      Schema assertions
  seed.sql    Development data
scripts/
  verify-schema.sh
docs/         Specification set
```

## Where the rules live

Business rules are enforced in Postgres, not in the clients. That means:

- **Permissions** are flags on `roles.permissions`, checked by
  `has_permission()` and enforced by row-level security on every table. The
  matching TypeScript in `packages/shared` exists so the UI can hide what a
  user cannot do — it never decides it.
- **Status changes** go through `transition_job()` and the sibling functions,
  driven by the `job_transitions` table. Nothing writes a status column
  directly.
- **Stock** is derived from the `stock_movements` ledger. There is no
  writable quantity anywhere.
- **Equipment custody** is enforced by an exclusion constraint. One unit
  cannot be in two places at once, whatever the client sends.

If you add a rule, add it to the database first and mirror it in
`packages/shared` second.

## Verifying the schema

```bash
pnpm db:verify
```

Applies every migration to a clean database, loads the seed, and runs the
assertions in `supabase/tests/schema_assertions.sql`. It defaults to the
Supabase CLI's local database; override with `PGHOST`, `PGPORT`, `PGUSER`.

Each assertion states what it protects, so a failure explains itself:

```
ok (rejected): overlapping placement for the same unit is rejected
ok: equipment left on site with no pickup blocks job completion
ok: a manager cannot approve above the threshold
```

## Tests

```bash
pnpm --filter @promold/shared test
pnpm --filter @promold/shared typecheck
```

## Adding a migration

Migrations are forward-only and numbered. Never edit an applied migration;
add a new one. `pnpm db:verify` must pass before pushing.

## Conventions

- Every table carries `org_id`, `created_at`, `updated_at`.
- Nothing hard-deletes; soft delete with `deleted_at`, `deleted_by`,
  `delete_reason`.
- History tables are append-only: insert and select policies only, no update
  or delete, for any role including the owner.
- IDs are generated client-side where offline creation is possible, so a
  replayed mutation upserts instead of duplicating.
