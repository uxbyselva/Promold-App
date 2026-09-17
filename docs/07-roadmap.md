# Roadmap

Estimates assume one experienced full-stack developer. They are ranges, not
commitments, and exclude App Store review time.

## Phase 0 — Foundations (1–2 weeks)

- Monorepo, Supabase project, CI, migration pipeline
- Auth, `profiles`, `roles`, permission helper, RLS conventions
- Shared types and query layer in `packages/shared`
- Expo and Next.js app shells, navigation, design tokens
- Seed data for development

Exit: a user can log in on both clients and see a screen gated by their role.

## Phase 1 — MVP (8–10 weeks)

The cut line is the four problems in
[01-product-spec.md](01-product-spec.md) §1: schedule churn, lost equipment,
unknown margin, and scope growth given away. Everything here serves one of
them.

**Revised for direct customer billing.** With no insurance work, the quote is
the only revenue number and nothing absorbs an overrun. Two things moved into
this phase as a result: **change orders**, because unpriced scope growth is
the largest margin leak in flat-price work, and the **job costing
dashboard**, because it is the only feedback loop on quoting. The insurance
documentation package moved out.

**Scheduling**
- Customers and sites
- Jobs with multi-day support and visits
- Dispatch board with drag-and-drop, plus day/week/month views
- Crews and per-person assignment
- Conflict detection (double booking, time off, equipment availability)
- Job templates

**Assignment loop**
- Push notifications; accept / request reschedule with a proposed time
- Manager approve / decline
- 12-hour escalation on unaccepted work
- Status history

**Field app**
- List / Kanban / Calendar toggle
- Status progression with geofenced clock in/out
- Photo capture with before/during/after and room tagging
- Job chat
- Completion gates

**Change orders**
- Draft from site with photos, by anyone on the job
- Price and present, manager only
- Customer decision recorded with method (signature / verbal / written)
- Derived contract price = base quote + approved change orders
- Completion blocked while a change order is undecided

**Job costing**
- Labour, materials, purchases, mileage, equipment and rentals against the
  contract price
- Margin per job, and margin by job type
- Owner and manager only

**Purchasing**
- Requests with line items, tagged approver
- Submit / recall, approve / partial / reject with reason
- Threshold routing to the owner
- Append-only audit trail by trigger
- Receive → stock movements

**Inventory**
- Master catalogue admin page
- Stock locations (warehouse + vans), movements, derived levels
- Material usage against a job
- Barcode scanning

**Equipment** — the whole of [06-equipment.md](06-equipment.md) except
utilisation reporting. Register, placements with the overlap constraint,
site staging, rentals, pickup and return alerts. This ships in the MVP
because the completion gate depends on it.

**Vehicles and mileage**
- Vehicle register, odometer-based logs, continuity warnings
- Mileage rate and monthly export

**Cross-cutting**
- Notifications and daily digest
- Audit log
- Offline queue for field writes

Exit: a job can be scheduled, accepted, worked, documented and closed
entirely in the app, with materials, equipment, mileage and any change orders
recorded against it — and the owner can see what it actually cost against
what the customer was charged.

## Phase 2 — Quoting and proof (4–6 weeks)

- **Estimating and quoting**, informed by Phase 1's costing data. With every
  job billed flat and direct, quote accuracy is the profit lever; this is
  where the costing history starts paying for itself.
- Checklists and reading sheets (moisture, humidity, containment, PPE, chain
  of custody) with PDF job reports — now driven by customer trust and
  dispute protection rather than adjuster requirements, so before/after
  evidence matters more than clinical per-room detail
- Customer signature capture, both stages
- Time-off requests and approval
- Low-stock alerts generating draft purchase requests
- Cycle counts and stock adjustments
- Equipment utilisation and rental-spend reports
- Certification tracking with expiry alerts
- Vehicle service, insurance and registration reminders; fuel logs
- CSV / PDF exports for whoever keeps the books, including an approved
  change orders report — the hand-off that stops agreed extra work going
  unbilled
- Change order history as a quoting input: which job types routinely grow,
  and by how much

Phase 2 turns the Phase 1 record into better quotes. A job type whose change
orders run 15% above quote every time is a job type that is underpriced at
the door.

## Phase 3 — Growth (as needed)

- Richer exports for whoever keeps the books — never invoicing itself
  (see the scope boundary in
  [01-product-spec.md](01-product-spec.md) §5)
- Customer portal — job status, reports, photos
- Recurring job automation
- Offline hardening if field reality demands it
- Subcontractor access
- Analytics: revenue per job type, tech productivity, callback rate
- Drying logs with psychrometrics (IICRC S500), lab result import and
  clearance documentation — pulled forward if insurance work ever starts
- Insurance claim handling, if the business takes it on

## Build order rationale

1. **Schema and RLS first.** Authorisation retrofitted onto a working app is
   a rewrite.
2. **The assignment loop before anything else in the UI.** If notify → accept
   is not faster than sending a text, nothing else matters.
3. **Equipment early, not late.** The job completion gate depends on it, and
   it is the feature with the clearest cash return.
   **Change orders for the same reason.** The completion gate depends on
   them too, and unpriced scope growth costs more per job than a forgotten
   scrubber.
4. **Inventory before purchasing receipt.** Receiving must have somewhere to
   land or stock numbers are wrong from day one.
5. **Costing after its inputs exist**, but in the very next phase.

## Adoption risks

| Risk | Mitigation |
|---|---|
| Crew keeps using text messages | Job chat in the MVP; every notification deep-links into the job |
| Forms feel like paperwork | Templates pre-fill; only genuinely required fields are required; voice-to-text on notes |
| Equipment scanning skipped | Eight-second scan flow; the completion gate makes skipping visible |
| Managers keep the spreadsheet | The dispatch board must be better than the spreadsheet at week one, not week ten |
| Data entry with no payoff | Ship the costing dashboard in Phase 2 and show the crew the reports |

## Decisions still open

1. **Internal equipment day rate.** Needs a number per category to make
   costing meaningful. Straight-line depreciation over expected life is a
   reasonable starting basis.
2. ~~Deposits and progress payments.~~ **Answered: no.** This is a management
   app, not a finance system. Money owed and money received are tracked
   separately and stay that way. No payment state of any kind belongs here —
   see the scope boundary in [01-product-spec.md](01-product-spec.md) §5.
3. ~~Insurance / adjuster work volume.~~ **Answered:** none today, 100%
   billed direct to the customer. Documentation package deferred to Phase 2
   and driven by dispute protection rather than adjuster requirements.
4. **Payroll export target.** Which package, so the time export matches it.
5. **Export format.** Which system the books are kept in, so the exports land
   in a shape it can read. An export only — nothing is written back.
6. **Who owns the master catalogue.** Someone has to enter and maintain the
   item list; the app cannot invent it.
7. **Existing data.** Customer, site and inventory history to migrate, or a
   clean start.
8. **Store accounts.** Apple Developer and Google Play enrolment should start
   early — verification can take days to weeks.
