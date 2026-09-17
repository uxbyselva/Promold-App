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

The cut line is the three problems in
[01-product-spec.md](01-product-spec.md) §1: schedule churn, lost equipment,
unknown margin. Everything here serves one of them.

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
entirely in the app, with materials, equipment and mileage recorded against
it.

## Phase 2 — Making the data pay (4–6 weeks)

- **Job costing dashboard** — labour, materials, purchases, mileage,
  equipment against the quoted price, with margin per job and per job type
- Checklists and reading sheets (moisture, humidity, containment, PPE, chain
  of custody) with PDF job reports
- Customer signature capture, both stages
- Time-off requests and approval
- Low-stock alerts generating draft purchase requests
- Cycle counts and stock adjustments
- Equipment utilisation and rental-spend reports
- Certification tracking with expiry alerts
- Vehicle service, insurance and registration reminders; fuel logs
- CSV / PDF exports, QuickBooks or Xero format

Phase 2 is where the crew's logging starts producing something the crew's
boss can act on. Do not let it slip far past Phase 1 — logging without a
visible payoff reads as surveillance and adoption decays.

## Phase 3 — Growth (as needed)

- Estimates and quoting, feeding `quoted_price`
- Invoicing or deeper accounting integration
- Customer portal — job status, reports, photos
- Recurring job automation
- Offline hardening if field reality demands it
- Subcontractor access
- Analytics: revenue per job type, tech productivity, callback rate

## Build order rationale

1. **Schema and RLS first.** Authorisation retrofitted onto a working app is
   a rewrite.
2. **The assignment loop before anything else in the UI.** If notify → accept
   is not faster than sending a text, nothing else matters.
3. **Equipment early, not late.** The job completion gate depends on it, and
   it is the feature with the clearest cash return.
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
2. **Insurance / adjuster work volume.** If a large share of work is
   insurance-funded, the checklist and PDF report package moves up into the
   MVP — adjusters ask for documentation in a specific shape.
3. **Payroll export target.** Which package, so the time export matches it.
4. **Accounting package.** QuickBooks and Xero need different export shapes.
5. **Who owns the master catalogue.** Someone has to enter and maintain the
   item list; the app cannot invent it.
6. **Existing data.** Customer, site and inventory history to migrate, or a
   clean start.
7. **Store accounts.** Apple Developer and Google Play enrolment should start
   early — verification can take days to weeks.
