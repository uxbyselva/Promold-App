# Field prototype

A clickable prototype of the field app, built to settle layout and flow
before any of it is wired to the database.

**It is not the real app.** It is one self-contained HTML file with sample
data held in memory. Nothing persists, there is no auth, no Supabase, no
camera. The real field app will be Expo (React Native), per
[docs/02-architecture.md](../../docs/02-architecture.md).

## What it covers

- **My Jobs** — list, kanban board and calendar views; accept or ask to move
  a job; status progression from accepted through to complete.
- **Job detail** — the completion gate listing exactly what is outstanding,
  site access notes, photos, equipment on the job, and the contract price
  with its approved change order.
- **Equipment** — where every unit is right now, what is overdue for
  collection, and the rental that is still out.

## Why the data looks familiar

The sample data mirrors `supabase/seed.sql` — same crew, same asset tags,
the same 42 Oak St job mid-remediation. Screens showing the real vernacular
get more useful feedback than screens showing "Job 1 / Customer A".

## What it deliberately fakes

The completion gate in `blockers()` mirrors `job_completion_blockers()` in
SQL, but it is a reimplementation for the prototype, not the real rule. When
the Expo app is built it calls the database function; the logic is not
duplicated there.

## Viewing it

Open `field-prototype.html` in any browser, or use the published link shared
with the team.
