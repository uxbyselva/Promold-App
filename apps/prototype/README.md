# Prototypes

Three clickable prototypes, built to settle layout and flow before any of it is
wired to the database. **They are views only** — nothing is saved, nothing is
wired up. The real screens get built once these are approved.

| File | Who it is for | Surface |
|---|---|---|
| `field-prototype.html` | Crew lead, technician | Phone |
| `admin-prototype.html` | Manager, owner | Desktop |
| `flows-prototype.html` | All four roles | Phone drawn inside the web page, plus desktop |

## Flows prototype — the four remaining flows

`flows-prototype.html` covers what the first two did not: mileage and
vehicles, time off, customers and sites, and job costing with its exports. It
carries a persona switcher, because the point is that these are four
different apps rather than one app with things greyed out.

| Persona | Surface | Tabs |
|---|---|---|
| Priya Nair, technician | Phone | My day · Mileage · Time off |
| Marcus Bell, crew lead | Phone | My day (plus the crew clock) · Mileage · Time off |
| Ray Alvarez, manager | Web | Vehicles & mileage · Time off · Customers & sites |
| Helen Osei, bookkeeper | Web | Job costing · Exports |

Under each persona is the list of what that login can and cannot reach. The
flags are the ones `provision_org_roles()` actually writes, so the strip is
checkable against the database rather than decorative.

The two phone personas are drawn inside a phone frame on the web page, so the
field app can be reviewed without installing anything.

### Mileage

Odometer start and end are what gets typed; `distance` is a generated column
in `mileage_logs`, so nobody enters a mileage figure and nobody can round one
up. The opening reading is prefilled from the van's last closing reading, and
if the two do not meet, the difference is written to `continuity_gap` and
shown to the office — a note on the row, never a refusal. Vans do get moved
without a log, and a hard block just stops people logging at all.

The crew see their own trips. `mileage.view_all` is the manager's, the
owner's and the bookkeeper's; the manager's register adds the fleet, the
per-person totals payroll needs, and a correction path that records
`edited_by` and `edited_at`.

### Time off

Only `status = 'approved'` blocks scheduling — that is the partial gist index
in `0002_identity.sql`, and it is what the dispatch board already refuses
drops against. A request on its own blocks nothing.

Both sides are shown the same clash: if the dates cover a job the person is
already on, the phone says so before the request is sent, and the manager
sees it on the approval. Approving does **not** move the booked work. That is
deliberate — reassigning someone else's job is a decision, not a side effect.

### Customers and sites

List, detail, sites under the customer, and the job history at each address.
Access notes live on `sites`, not in a job note, so the crew reads the gate
code in the driveway whatever job brought them there. Nothing on the record
says what is owed or what has been paid.

### Job costing

Four tiles, two charts and the same numbers as a table.

- **Where the money went** — a stacked bar of what each job cost, with the
  contract price as a tick on the same dollar axis. When the bar runs past
  the tick, that job lost money, and you can see which line did it.
- **Margin against the target** — the same jobs as distance from the 35%
  target, above on one side and below on the other.

Colour follows the method in the `dataviz` skill: the categorical slots are
assigned in fixed order and validated against this app's own chart surfaces
(`#FFFFFF` light, `#18211F` dark) rather than the reference ones. Both modes
clear the lightness band, the chroma floor, adjacent CVD separation and the
normal-vision floor. Light mode returns a contrast warning on three slots,
which obliges the relief rule — hence the value labels on every bar and the
full table underneath. Dark mode is its own set of steps, not an inverted
copy.

Two of the exports (job costing, mileage) really do download a CSV built from
what is on screen.

### What it does not have, on purpose

No invoice, no balance, no paid flag, nothing about what the customer owes.
Cost to us is in; owed by the customer is out. See the scope boundary in
[`CLAUDE.md`](../../CLAUDE.md).

## Admin prototype — the manager's day

Dispatch board with crew as columns and hours as rows. Unassigned jobs sit in
a tray on the left and are dragged onto a person.

The drop is where the scheduling rules show themselves. It mirrors
`scheduling_conflicts()` in SQL and refuses a drop that clashes with approved
time off or with a job the person is already on, naming which. Green means it
will take; red means it will not.

"Needs a decision" carries the three things that pile up on a manager:

- **A reschedule request** with the crew member's proposed time, so it is one
  tap rather than a phone call. Approving moves the job and resets everyone's
  acceptance, because the others agreed to a different time.
- **A change order to price.** The crew lead wrote up what he found and
  attached photos; pricing and presenting are the manager's.
- **A purchase request** with per-line ticks. Untick a line and the total
  follows, along with whether it still sits under the manager's approval
  limit — over it, the request routes to the owner.

## Field prototype

A clickable prototype of the field app.

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
