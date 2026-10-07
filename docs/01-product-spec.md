# Product Specification

## 1. Problem

A mold remediation contractor coordinates crews, materials, vehicles and
equipment across customer properties. Today this runs on phone calls, text
messages and spreadsheets. Three things break repeatedly:

1. **Schedule churn is invisible.** A job is assigned verbally; if the
   employee can't make it, the reschedule happens over the phone and nobody
   else knows.
2. **Equipment disappears.** Air scrubbers and dehumidifiers are left running
   at sites for days. With no record of what is where, units are forgotten at
   closed jobs and rented units are returned late.
3. **Nobody knows which jobs made money.** Jobs are billed at a flat quoted
   price, direct to the customer, with no insurer absorbing overruns. Labour
   hours, materials, mileage and equipment days are never totalled against
   that price, so quote accuracy — the thing the whole business rests on — is
   never measured.
4. **Scope growth is given away.** More rooms affected than the inspection
   found, rot behind a wall: the extra work gets done, and the flat price
   does not move.

The app exists to fix those four things. Everything else is in service of
them.

**Billing context.** All work is quoted flat and billed direct to the
customer. There is no insurance or adjuster work today. That has two
consequences that shape the whole product: the quote is the only revenue
number, so job costing is a first-class feature rather than a reporting
nicety; and scope growth must be captured as a priced, agreed change order
or it is simply absorbed. The schema keeps nullable `insurance_claim_no` and
`adjuster_contact` fields against the day that changes, but no screen asks
for them.

## 2. Users

| Role | Who | Primary surface |
|---|---|---|
| **Owner** | Business owner | Web (admin) |
| **Manager / Dispatcher** | Schedules work, approves spend | Web (admin) |
| **Crew Lead / Foreman** | Runs a crew on site | Mobile |
| **Technician** | Field employee | Mobile |
| **Bookkeeper** | Read-only, exports | Web (admin) |

Roles are a named bundle of permission flags, not a hardcoded enum branch in
application logic. See [04-permissions.md](04-permissions.md).

## 3. Core objects

```
Customer ──< Site ──< Job ──< JobAssignment >── User
                       │
                       ├──< TimeEntry
                       ├──< JobPhoto
                       ├──< FormSubmission (checklists, readings)
                       ├──< JobComment
                       ├──< MileageLog
                       ├──< MaterialUsage      → decrements stock
                       ├──< PurchaseRequest    → increments stock on receipt
                       ├──< EquipmentAssignment (checkout / site staging)
                       ├──< EquipmentRental    (rented in from a vendor)
                       ├──< ChangeOrder        → adjusts the contract price
                       └──< Signature
```

A **Job** is the unit of billing and the unit of costing. It carries a base
quoted price and may span multiple days. The amount actually owed is the
**contract price**: the base quote plus approved change orders.

## 4. Features

### 4.1 Scheduling and dispatch

- **Dispatch board** — employees as columns, time as rows, with an
  "unassigned jobs" tray. Drag to assign and to reschedule. This is the
  dispatcher's primary view.
- Day / week / month calendar views alongside it.
- **Multi-day jobs.** A job has a start and end; it is not a single calendar
  block. Individual work days within a job are *visits*.
- **Crews.** A job is assigned to a crew or to several individuals. Acceptance
  is tracked per person.
- **Recurring jobs** for scheduled maintenance-type visits.
- **Conflict detection on save** — double booking, overlapping assignments,
  insufficient travel time between sites, assignee on approved time off,
  required equipment unavailable for the window.
- **Job templates** per work type (inspection, containment setup, remediation
  day, post-remediation verification, clearance test) pre-filling duration,
  required checklist, typical materials and typical equipment.
- **Time off / availability calendar.** Requests from the field, approval by a
  manager, and a hard block on scheduling over approved time off.
- **Soft delete only.** Cancelled and deleted jobs are retained with reason
  and actor.

### 4.2 Assignment, acceptance and rescheduling

- Manager assigns → assignee receives a push notification → assignee
  **accepts** or **requests a reschedule**.
- A reschedule request is a **record**, not a message: reason, and a
  *proposed alternative date/time*. The manager approves (the job moves) or
  declines with a reason.
- **Escalation.** A job unaccepted 12 hours before its start notifies the
  manager. Silence must never read as acceptance.
- Full status history per job: who changed what, when.

### 4.3 Job execution (mobile)

- **List / Kanban / Calendar** view toggle for the field user.
- Status progression with clock in/out: *En route → On site → In progress →
  Work complete*. Clock-in is geofenced to the site address (soft warning
  when outside the radius, not a hard block — addresses are imprecise).
- **Photo documentation** in two galleries — before the work and after it —
  with room tagging and timestamps. **Unlimited photos in every phase** — each is its own row,
  and the completion gate asks only for at least one in each required phase,
  never a maximum. A big remediation runs to dozens of before shots across
  several rooms, and that is the normal case, not an edge one.
- **Checklists and forms** per job template: moisture meter readings by room,
  temperature and relative humidity, containment verification, air scrubber
  runtime, PPE and job hazard checks, sample chain of custody. Rendered to a
  PDF job report.
- **Customer signatures** — work authorisation on arrival, completion
  sign-off on departure.
- **Completion gates.** A job cannot reach *Work complete* until the
  template's required evidence exists: required photos, signed checklists,
  customer signature, materials logged, and **all equipment staged at the
  site either collected or explicitly scheduled for later pickup**.

### 4.4 Change orders

Scope growth is the largest margin leak in flat-price work, so it gets a
first-class object rather than a note in the job description.

- **Anyone on site can draft one.** The crew lead who opens a wall and finds
  rot is the person who knows; they draft the change order with photos
  attached, in language the customer will read.
- **Only a manager prices and presents it.** Drafting and pricing are
  deliberately separate permissions.
- **The customer's decision is recorded, with the method** — signature,
  verbal, or written. Residential work is often agreed verbally on site;
  which it was matters if the final bill is questioned later. A verbal
  approval must name who agreed.
- **A negative amount is a credit**, for work descoped.
- **The contract price is derived**: base quote plus approved change orders.
  The original quote stays visible, so the growth over a job is auditable.
- **A job cannot be completed with a change order still undecided.** Once the
  crew drives away, unagreed extra work is never collected.

### 4.5 Material purchase requests

- Any role can raise a request; it tags a manager or the owner as approver.
- Line items: item (from catalogue or free text), quantity, unit, estimated
  cost, optional link to a job.
- Editable while in *Draft*; locked on **submit**, with a "recall to draft"
  action for the requester.
- Approver may **approve, partially approve** (approve 6 of 8 lines),
  **reject with a reason**, or **edit** the request.
- **Every change is an append-only audit row** — actor, timestamp, field,
  old value, new value — visible to manager and owner. History is never
  editable.
- **Approval thresholds** by total value: manager up to a configured amount,
  owner above it.
- Vendor, PO number, expected delivery, receipt photo.
- **On *Received*, stock is incremented automatically** at the receiving
  location. This is the link that keeps inventory trustworthy.

### 4.6 Inventory

- **Master catalogue** on its own admin page: SKU, name, category, unit of
  measure, average cost, preferred supplier, barcode, min/reorder level.
- **Stock locations** — warehouse plus each van as a separate location, with
  transfers between them.
- **Consumption against a job** — the crew logs what was used; stock
  decrements and the cost lands on the job.
- **Low stock alerts** that generate a draft purchase request in one tap.
- **Stock adjustments** with a mandatory reason, and periodic cycle counts.
- **Barcode / QR scanning** via the phone camera for receiving, usage and
  counts.
- Every change writes a `stock_movement` row. Stock level is derived from
  movements, never edited directly.

### 4.7 Equipment

Owned equipment checked out for a job, owned equipment staged at a site for
days, and equipment rented in from a vendor — three distinct flows.
Specified in full in [06-equipment.md](06-equipment.md).

### 4.8 Vehicles and mileage

- **Vehicle register** — plate, make/model, current odometer, insurance and
  registration expiry, service due, assigned driver.
- **Mileage by odometer start/end**, not typed distance. Distance is
  calculated. Harder to fudge, and it maintains the odometer for service
  intervals for free.
- Each mileage log links to a job (or is marked non-job travel).
- **Continuity validation** — end ≥ start, and the next trip for a vehicle
  starts at or after the previous trip's closing reading. Gaps are flagged,
  not blocked.
- Configurable mileage rate → reimbursement totals, exportable monthly per
  employee and per vehicle.
- Fuel receipts and a maintenance log on the vehicle record, with expiry and
  service-due reminders.

### 4.9 Job costing

For each job, against its **contract price** (base quote plus approved change
orders):

| Cost component | Source |
|---|---|
| Labour | `time_entries` × user cost rate |
| Materials | `material_usage` × average cost |
| Purchases | approved purchase request lines billed to the job |
| Mileage | distance × mileage rate |
| Equipment (owned) | placement days × internal day rate |
| Equipment (rented) | actual vendor rental cost |
| Subcontract / other | manual cost entries |

Margin = contract price − total cost.

With every job billed flat and direct to the customer, this is not a
reporting nicety — it is the only feedback loop on quoting, which is where
the profit is won or lost. It is also the payoff for all the logging the
field crew is asked to do; without it, the logging reads as surveillance.
Build it in the same phase as the logging it depends on.

### 4.10 Compliance and documents

- **Certification tracking** per employee — IICRC certifications, respirator
  fit-test dates, insurance certificates — with expiry alerts.
- Document store per job and per site: scope of work, lab results, SDS
  sheets. Insurance claim and adjuster fields exist in the schema but are not
  surfaced while all work is billed direct.

### 4.11 Not surfaced

- **Job chat.** `job_comments` is built and specified but no screen offers it.
  Turning it on needs a screen, not a migration.

### 4.12 Cross-cutting

- **Notifications** — push for assignment, reschedule decisions, approvals,
  equipment pickup due, low stock. Plus a daily digest ("3 jobs tomorrow, 2
  approvals pending, 1 scrubber still at 42 Oak St").
- **Global audit log** across jobs, purchase requests, inventory, equipment
  and schedule changes.
- **Reports and exports** — CSV/PDF for job costing, mileage, inventory
  valuation, equipment utilisation, and approved change orders. Exports feed
  whoever keeps the books; nothing is read back in.

## 5. Scope boundary: management, not finance

This is a management app. It is not a finance system, and it must not grow
into one. Money owed and money received are tracked separately, elsewhere,
and that separation is deliberate.

The line is:

| In scope | Out of scope |
|---|---|
| What a job **cost us** — labour, materials, mileage, equipment days, rentals | What the customer **owes us** |
| The quoted price, as the number margin is measured against | Invoices, statements, receivables |
| Change orders as a record that scope and price were **agreed** | Billing that agreement |
| Purchase approvals, as a spend control | Paying the supplier |
| Exports for whoever does keep the books | Deposits, progress payments, payment status |

The test: **cost to us is in, owed by the customer is out.** Job costing sits
on the "in" side — it exists so the owner can see which jobs made money, not
to work out what to bill.

Two consequences worth stating plainly:

1. **Approving a change order does not bill anything.** It records that the
   customer agreed to extra scope at a price. Someone still keys that into
   whatever tracks the money. A periodic "approved change orders" export
   exists to make that hand-off reliable, because a change order agreed on
   site and never billed is the same loss as one never agreed at all.
2. **No feature may be added that tracks payment state**, however small it
   seems — no "paid" flag, no deposit field, no balance. Once one exists, the
   app becomes a second, worse source of financial truth, and the two drift.

## 6. Also out of scope

- Estimating / quoting workflow. A job carries a base quoted price entered by
  hand. Since the quote is the only revenue number, building the estimate
  moves to Phase 2 once costing data exists to inform it.
- A customer-facing portal.
- Payroll processing. Time data is exported, not processed.
- Insurance claim handling and adjuster documentation packages. Not needed
  today; the schema leaves room for it.
- Multi-company / multi-tenant SaaS. The schema carries an `org_id` so this
  stays possible, but it is not a product goal.

## 7. Design principles

1. **Append-only history for anything people argue about** — schedules,
   approvals, stock, equipment location. Never edit history in place.
2. **Derive, don't store, anything that can drift** — stock level from
   movements, equipment location from placements, job cost from its inputs.
3. **The field app asks for the minimum.** Every required field on a mobile
   form must earn its place; the fastest path to abandonment is a 20-field
   form at the end of a hard day.
4. **Nothing hard-deletes.** Soft delete with actor and reason.
5. **Warn, don't block, on physical-world imprecision** (geofence radius,
   odometer gaps). Hard-block only on spend approval and compliance.
6. **Management, not finance.** The app records what work cost and what was
   agreed. It never records what is owed or what has been paid. See §5.
