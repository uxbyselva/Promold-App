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
- **Equipment custody** is enforced by a gist exclusion constraint: one unit
  cannot be in two places at once, whatever the client sends.
- **Price is manager and owner information.** `jobs.quoted_price`,
  `change_orders.amount` and `profiles.cost_rate` are revoked from the
  `authenticated` role. Read jobs through `jobs_safe`, change orders through
  `change_orders_safe`, people through `profiles_safe` — never the base
  table, where `select *` now fails by design. Adding a column to one of
  those three tables means re-running `grant_columns_except()` for it.

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
pnpm db:verify                              # migrations + seed + assertions
pnpm --filter @promold/shared test
pnpm --filter @promold/shared typecheck
```
