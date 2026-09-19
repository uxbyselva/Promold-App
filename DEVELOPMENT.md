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
  admin/      The office app — Next.js, desktop      (port 3000)
  field/      The crew's app — Next.js, phone-first  (port 3001)
  prototype/  Clickable HTML mocks, no database
packages/
  shared/     Types, permission flags, state machines, validation
  app-kit/    Session, middleware, sign-in form, design tokens — shared
              by both apps
supabase/
  migrations/ SQL migrations — the source of truth for the schema
  tests/      Schema assertions
  seed.sql    Development data
  storage.sql One-time setup for the job photo bucket
scripts/
  verify-schema.sh
docs/         Specification set
```

## Two apps, one database

| | `apps/admin` | `apps/field` |
|---|---|---|
| Who | Owner, manager, bookkeeper | Crew lead, technician |
| Where | A desk | A phone, installed from a link |
| Deployed as | Its own Vercel project, root `apps/admin` | Its own Vercel project, root `apps/field` |

They are separate deployments because they are separate jobs, not because the
data differs. Row-level security is what actually divides them: a crew lead
signing into the office app would see the same nothing they see in the field
app, because `jobs_safe` masks the price and RLS limits the rows.

**The office app has two modes.** *Office* is the day job — the calendar,
booking work, customers. *Admin* is the other question: what happened to this
record, who changed it, and can I get back the thing I deleted. The switch is
in the masthead and appears only for `audit.view`.

### What is shared, and what deliberately is not

`packages/app-kit` holds session loading, the auth middleware, the sign-in
form and the design tokens — two apps on one database is two chances to get
auth subtly different.

Reading the environment variables is **not** shared. Next.js inlines
`process.env.NEXT_PUBLIC_…` by substituting the literal text at build time,
which only works on a static reference inside the app being built. Each app
keeps its own `lib/env.ts`. An earlier version read them through a helper and
the values silently never reached the browser.

## Running both

```bash
pnpm --filter @promold/admin dev   # http://localhost:3000
pnpm --filter @promold/field dev   # http://localhost:3001
```

Both need `.env.local` in their own directory — copy the `.env.example` beside
it.

## Photos

Job photos go to a private Supabase Storage bucket. Run `supabase/storage.sql`
once in the SQL editor to create it and its policies. Until then the gallery
says so rather than failing silently.

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
