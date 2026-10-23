# Promold App

Field operations app for a mold remediation contractor. See
[`docs/`](docs/README.md) for the full specification and
[`DEVELOPMENT.md`](DEVELOPMENT.md) for how to run it.

## Scope boundary — read before adding a feature

**This is a management app, not a finance system.** Money owed and money
received are tracked in a separate system and must stay there.

- **In:** what a job cost us (labour, materials, mileage, equipment days,
  rentals), the quoted price as the number margin is measured against, change
  orders as a record that scope and price were agreed, purchase approvals as
  a spend control, exports for whoever keeps the books.
- **Out:** invoices, statements, receivables, deposits, progress payments,
  payment status, "paid" flags, balances.

The test: **cost to us is in, owed by the customer is out.**

**Crews are paid per job, not per hour.** Nothing records hours — no clock
in/out, no timesheet, no geofence. `time_entries` and `profiles.cost_rate`
remain in the schema for a future hourly crew, and stay empty until there is
one. The labour cost of a job is `job_crew_pay`: flat amounts the office
records, named or as a lump for the crew. `job_labour_cost()` adds both
sources, so an hourly crew later needs no migration.

Approving a change order records an agreement; it does not bill anything.
Adding any payment state would make this app a second, worse source of
financial truth, and the two would drift. Do not add one.

## One app, two halves

**`apps/web`** is the only deployable app. It serves the office and the crew
from one build, one address and one Vercel project, because this is a dozen
people and keeping two deployments in step was more work than it ever saved.

- **The office** is at the top level — `/calendar`, `/dispatch`, `/jobs`,
  `/customers`, `/equipment`, `/stock`, `/approvals`. Desk-shaped: a top nav
  and tables. There is a second **admin mode** behind `audit.view` for the
  audit trail, a record's history, and restoring something deleted.
- **The crew** is under `/my` — `/my/jobs`, `/my/store`, `/my/mileage`,
  `/my/time-off`. Phone-first: a bottom tab bar, one column, installed to a
  home screen from a link rather than a store.

`/` routes by role (`homeFor()`), so nobody has to learn a URL: whoever
assigns work lands on the calendar, a bookkeeper on the job list, everyone
else on their own jobs. That is a courtesy and not a rule — a technician who
types `/calendar` gets the page and the same three rows RLS would have given
them anyway. **The UI never decides who may see what.**

The two halves share one stylesheet, and their class names do not collide.
Check before adding a generic one.

`packages/app-kit` holds the session, the middleware, the sign-in form and the
design tokens. **Reading `NEXT_PUBLIC_*` does not live there**: Next inlines
those by text substitution at build time, so the app keeps its own
`lib/env.ts` with literal `process.env.NEXT_PUBLIC_X` reads. A computed key
never reaches the browser.

## Where the rules live

Business rules are enforced in **Postgres**, not in the clients:

- **Permissions** are flags on `roles.permissions`, checked by
  `has_permission()` and enforced by RLS on every table. The TypeScript in
  `packages/shared` mirrors this so the UI can hide what a user cannot do —
  it never decides it.
- **Status changes** go through `transition_job()` and its siblings, driven
  by the `job_transitions` table. Nothing writes a status column directly.
- **Stock** is derived from the append-only `stock_movements` ledger. There
  is no writable quantity anywhere.
- **Booking a job** goes through `create_job()`, `reschedule_job()` and
  `set_job_crew()`. A job is three writes that have to agree — the row, its
  work days, its crew — so they happen in one transaction. Approved time off
  is refused outright; a double booking is refused unless forced.
- **Consumables** carry a `consumption_mode`. A bulk item is opened as a
  pack: opening takes one container off the shelf and parks its cost on the
  pack, and finishing splits that cost evenly across the jobs it served. A
  pack is open or finished — there is no part-used state, because asking a
  crew how full a box is produces a guess. An open pack costs nothing yet.
- **Buying** goes through `create_purchase_request()` and
  `decide_purchase_request()`. The spend threshold is read server-side and
  measured against the lines actually being approved, not against everything
  asked for. Once submitted, what was asked for is frozen; the decision and
  the receipt are not.
- **Deleting and restoring** go through `soft_delete_record()` and
  `restore_record()`, driven by the `deletable_tables` registry. A delete is
  refused while live children point at the row; a restore is refused while the
  parent is still deleted. `data.restore` is the owner's alone and is
  deliberately not implied by any delete permission.
- **Equipment custody** is enforced by a gist exclusion constraint: one unit
  cannot be in two places at once, whatever the client sends.
- **Price is read by the office, the bookkeeper and the crew lead; it is
  written by nobody directly.** `jobs.quoted_price`, `change_orders.amount` and
  `profiles.cost_rate` are revoked from the `authenticated` role for **select
  and for insert/update**. `price.view` opens the reading, and a crew lead
  holds it so he can tell the office the work has outgrown the quote; it opens
  nothing else, because `costing.view` (cost and margin) and
  `user.view_cost_rates` (what people are paid) are separate flags he does not
  have.
  Read jobs through `jobs_safe`, change orders through `change_orders_safe`,
  people through `profiles_safe` — never the base table, where `select *`
  fails by design. Write a price through `set_job_price()` or
  `present_change_order()`; nothing writes those columns directly, not even a
  manager, because a column grant cannot tell two signed-in users apart.
  Adding a column to one of those three tables means re-running **both**
  `grant_columns_except()` and `grant_writes_except()` for it.
- **Crew pay** is a cost, so it sits behind `costing.view` with margin rather
  than behind `price.view`. Recording one needs `costing.view` **and**
  `job.edit`, the same pairing `set_job_price()` uses. No masking view is
  needed because the whole row is a cost — that makes it a row-level rule, and
  RLS does it. `job_crew_pay_total()` and `job_labour_cost()` are
  `security definer` and check the flag themselves: `job_labour_cost()` reads
  `profiles.cost_rate`, which is revoked, and it only ever worked because
  Postgres inlined it into `job_costs`. Relying on the planner for a
  permission check is how a costing screen starts returning "permission denied
  for table profiles".
- **Change orders** are drafted by whoever finds the work
  (`create_change_order()`, no price on it), priced and presented by a manager
  (`present_change_order()`), and only move `job_contract_price()` once the
  customer has agreed (`decide_change_order()`). A draft stays a draft: its
  row policy pins the status, so nobody approves their own.

Add a rule to the database first, mirror it in `packages/shared` second.

## Conventions

- Every table carries `org_id`, `created_at`, `updated_at`.
- Nothing hard-deletes: `deleted_at`, `deleted_by`, `delete_reason`.
- History tables are append-only — insert and select policies only, no update
  or delete, for any role including the owner.
- Derive anything that can drift (stock levels, equipment location, contract
  price, job cost) rather than storing it.
- Views are `security_invoker = true` so they cannot bypass RLS.
- Migrations are forward-only and numbered. Never edit an applied migration.

## Before pushing

```bash
pnpm db:verify     # migrations onto a clean database, the assertions, then
                   # every database call the apps make, checked against it
pnpm test          # unit tests
pnpm typecheck     # the app and the packages, then the client boundary
pnpm lint          # prettier --check; `pnpm format` writes
```

`scripts/check-client-boundary.mjs` runs after `typecheck` and is there for
the same reason: **TypeScript cannot see the server/client boundary.** A
server page importing a *function* from a `'use client'` module compiles,
builds, and throws when somebody opens the page. It happened to the office job
editor, which rendered nothing for every user who could edit a job. Put
anything a server component calls in `lib/`, not in a component file.

`scripts/check-db-calls.mjs` is the second half of `db:verify` and exists
because **TypeScript cannot see Postgres**. A mistyped RPC name, a renamed
argument, a column that never existed — all compile and all fail when somebody
opens the page. It reads the call sites out of the source and asks the
database whether each is real. What it cannot check, it says so rather than
skipping quietly: embedded joins (`table!inner(...)`) need checking by hand,
and embedding through one of the `_safe` views asks PostgREST to infer a
relationship for a view with no foreign key — prefer a second query.

On Claude Code on the web these run with no setup: `.claude/hooks/session-start.sh`
installs dependencies and starts a Postgres on 54322, which is the port
`scripts/verify-schema.sh` already looks for.

**To see the app actually work, `scripts/dev-stack.mjs`.** `supabase start`
needs a Docker daemon and the web container has none, so this serves the two
endpoints the app talks to — `/auth/v1/*` and the PostgREST subset of
`/rest/v1/*` — against that same local Postgres:

```bash
node scripts/dev-stack.mjs --db promold_demo --port 3400   # then point the app at it
```

Every request runs as `authenticated` with the caller's id in
`request.jwt.claim.sub`, exactly as PostgREST does, so **RLS, the masking
views and every permission check apply**. Any password is accepted; it is a
development stand-in over seed data. It found the 0030 bug within a minute of
existing, which is what it is for: a screen that renders is the only check
that catches a screen that lies.
