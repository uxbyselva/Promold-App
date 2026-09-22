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

Approving a change order records an agreement; it does not bill anything.
Adding any payment state would make this app a second, worse source of
financial truth, and the two would drift. Do not add one.

## The two apps

- **`apps/admin`** — the office. Owner and manager: the calendar, booking and
  editing work, customers and sites. It has a second **admin mode** behind
  `audit.view` for the audit trail, a record's history, and restoring
  something deleted.
- **`apps/field`** — the crew. Phone-first, installed from a link rather than
  a store. Their jobs, the completion gate, photos, mileage, time off.

`packages/app-kit` holds what both need — session, middleware, the sign-in
form, the design tokens. **Reading `NEXT_PUBLIC_*` is not shared**: Next
inlines those by text substitution at build time, so each app keeps its own
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
pnpm typecheck     # both apps and both packages
pnpm lint          # prettier --check; `pnpm format` writes
```

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
`scripts/verify-schema.sh` already looks for. Locally, `supabase start` gives
you the same thing plus Auth, Storage and PostgREST — which the web container
cannot run, since there is no Docker daemon there. That is also why the apps
cannot be run end to end from a web session: they need a real Supabase
project.
