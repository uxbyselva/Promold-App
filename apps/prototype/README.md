# Field prototype

A clickable prototype of the field app, built to settle layout and flow
before any of it is wired to the database.

**It is not the real app.** It is one self-contained HTML file with sample
data held in memory. Nothing persists, there is no auth, no Supabase, no
camera. The real field app will be Expo (React Native), per
[docs/02-architecture.md](../../docs/02-architecture.md).

## What it covers

- **Jobs** — a monthly calendar (the default) and a list; tap a date to see
  that day's work. Multi-day jobs mark every day they run.
- **Board** — its own tab: to do, working, blocked, done.
- **Job detail** — the completion gate listing exactly what is outstanding,
  site access notes, photos, equipment on the job, and the contract price
  with its approved change order.
- **Store** — serialised assets and where each one is, what is overdue for
  collection, the rental still out, open bulk packs, counted stock, and a
  purchase request form.

## The consumables proposal

The Store tab is also where a design question is being worked out: the
schema today has counted stock and serialised assets, and a box of
contractor bags is neither. It is counted like stock but travels and returns
like equipment.

The prototype proposes a `consumption_mode` on every stocked item:

| Mode | Examples | Tracked as | Cost lands |
|---|---|---|---|
| `single_use` | Masks, gloves, coveralls | Count per location, logged against a job | That job |
| `bulk` | Bags, poly sheeting, chemical drums | The container itself, until marked finished | Split across the jobs it served |
| `returnable` | Cords, buckets | Counted out, counted back | Nowhere — it returns |

The bulk pack is the interesting case. Nobody counts bags, so asking a tech
for a quantity produces a number that is not true. Instead the pack is the
record: it goes on a van, serves whatever job comes next, and someone marks
it finished when it runs out. That disposal splits its cost across the jobs
it served and puts a replacement on the reorder list.

Not yet in the database — the migration waits on this model being confirmed.

## Why the data looks familiar

The sample data mirrors `supabase/seed.sql` — same crew, same asset tags,
the same 42 Oak St job mid-remediation. Screens showing the real vernacular
get more useful feedback than screens showing "Job 1 / Customer A".

## What it deliberately fakes

The completion gate in `blockers()` mirrors `job_completion_blockers()` in
SQL, but it is a reimplementation for the prototype, not the real rule. When
the Expo app is built it calls the database function; the logic is not
duplicated there.

## Typography

One superfamily, three roles:

| Role | Face | Used for |
|---|---|---|
| UI and body | **IBM Plex Sans** | Titles, body, form fields |
| Dense labels | **IBM Plex Sans Condensed** | Uppercase section labels, status pills |
| Values read character by character | **IBM Plex Mono** | Asset tags, job numbers, quantities, money, calendar dates |

Plex Mono is the reason for the choice. In Barlow, Inter, Roboto and Public
Sans, a lowercase `l` and a capital `I` are the same bare stroke, and `0` and
`O` are near-identical — so `AS-001` can be read as `AS-OO1`. Plex Mono has a
slashed zero and fixed widths, which makes an asset tag unmistakable and lets
tags stack in a column. Plex Sans also gives its `l` a tail, which the others
do not.

The cost is width: Plex runs about 5–8% wider than Barlow, so slightly less
text fits per line. If space gets tight, Plex Sans Condensed can take over
body text too.

Mono is deliberately *not* applied to `.num`, which lands on mixed content
like "3 days" — a monospace face there just looks loose. Tabular figures are
what that class is for.

Licence: SIL OFL 1.1, free commercially and bundleable in the Expo app. Five
weights carry the whole system: Plex Sans 400/500/600, Plex Sans Condensed
600, Plex Mono 500.

## Viewing it

Open `field-prototype.html` in any browser, or use the published link shared
with the team.
