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
  web/        The app — Next.js. The office at the top level, the crew
              under /my. One build, one address.        (port 3000)
  prototype/  Clickable HTML mocks, no database
packages/
  shared/     Types, permission flags, state machines, validation
  app-kit/    Session, middleware, sign-in form, design tokens
supabase/
  migrations/ SQL migrations — the source of truth for the schema
  tests/      Schema assertions
  seed.sql    Development data
  storage.sql One-time setup for the job photo bucket
scripts/
  verify-schema.sh
docs/         Specification set
```

## One app, two halves

| | The office | The crew |
|---|---|---|
| Who | Owner, manager, bookkeeper | Crew lead, technician |
| Where | A desk | A phone, installed from a link |
| Routes | `/calendar`, `/jobs`, `/customers`, … | `/my/jobs`, `/my/store`, … |
| Frame | Top nav, tables | Bottom tab bar, one column |

It was two separate deployments once, on the theory that two jobs want two
apps. For a dozen people that was two of everything to keep in step —
projects, environment variables, addresses — to save work nobody was doing.
One app now, and `/` routes by role so nobody types a path.

**None of that is the security boundary.** Row-level security is: a technician
who opens `/calendar` gets the page and the same three rows they would have
seen anyway, because `jobs_safe` masks the price and RLS limits the rows. The
split exists so each person's screen suits the thing they are holding.

**The office has two modes.** *Office* is the day job — the calendar, booking
work, customers. *Admin* is the other question: what happened to this record,
who changed it, and can I get back the thing I deleted. The switch is in the
masthead and appears only for `audit.view`.

### What is shared, and what deliberately is not

`packages/app-kit` holds session loading, the auth middleware, the sign-in
form and the design tokens.

Reading the environment variables is **not** in there. Next.js inlines
`process.env.NEXT_PUBLIC_…` by substituting the literal text at build time,
which only works on a static reference inside the app being built, so
`lib/env.ts` lives in the app. An earlier version read them through a helper
and the values silently never reached the browser.

## Claude Code on the web

Sessions there run `.claude/hooks/session-start.sh` at startup: it installs
dependencies and initialises a Postgres on port 54322, so `pnpm db:verify`,
`pnpm test`, `pnpm typecheck` and `pnpm lint` all work without any setup.

What it cannot give you is the rest of Supabase. There is no Docker daemon in
that container, so Auth, Storage and PostgREST are not there, and the app
cannot be run end to end from a web session — it needs a real Supabase
project. Schema work, unit tests and builds are all fine; seeing the apps work
means deploying, or running locally.

## Running it

```bash
pnpm --filter @promold/web dev   # http://localhost:3000
```

Needs `apps/web/.env.local` — copy the `.env.example` beside it.

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
