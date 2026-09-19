# Equipment Tracking

## 1. Why this is its own document

Billing is **flat per job**, and a job may run several days. Equipment days
therefore add no revenue — they consume margin. Tracking exists for two
reasons, and neither is billing:

1. **Physical custody.** Knowing which unit is at which address right now, so
   scrubbers are not forgotten at finished jobs and rented units are returned
   before they go overdue.
2. **True job cost.** Loading equipment cost onto the job so the owner can
   see which flat-priced jobs actually made money.

## 2. The three flows

These are genuinely different and must not be collapsed into one model.

| | **Checked out** | **Staged at site** | **Rented in** |
|---|---|---|---|
| Example | Moisture meter, HEPA vac, hand tools | Air scrubber, dehumidifier, air mover | Extra scrubbers from a rental vendor |
| Owned by | Us | Us | Vendor |
| Duration | Hours — out and back with the crew | Days — left running unattended | Days to weeks |
| Held by | A person / crew | A **site** | A job |
| Ends when | Crew checks it back in | Someone collects it | It is returned to the vendor |
| Cost to job | Internal day rate | Internal day rate × days | Actual vendor charge |
| Main risk | Left in a van, unfindable | **Forgotten at a finished job** | **Returned late — real money** |

A single unit moves between these states over its life, and one unit serves
many sites over time — sequentially, never simultaneously. That last point is
the core constraint of the whole model.

## 3. Data model

### `equipment` — the owned asset register

| Column | Notes |
|---|---|
| `asset_tag` | Printed QR/barcode on the unit — how the field scans it |
| `name` | "Phoenix Guardian R200 #3" |
| `category` | air_scrubber / dehumidifier / air_mover / meter / tool / other |
| `make`, `model`, `serial_no` | |
| `purchase_date`, `purchase_cost` | |
| `internal_day_rate` | Cost loaded onto a job per day deployed |
| `has_hour_meter` | Drives runtime logging |
| `filter_interval_hours` | Scrubbers, dehumidifiers |
| `home_location_id` | Where it lives when idle |
| `lifecycle_status` | active / in_maintenance / retired / lost |
| `notes` | |

`lifecycle_status` is the unit's condition. Its *whereabouts* are never
stored here — they are derived from placements.

### `equipment_assignments` — placement over time

One row per continuous placement of one unit.

| Column | Notes |
|---|---|
| `equipment_id` | |
| `kind` | `checkout` (with a crew) or `site_staging` (left at a site) |
| `job_id` | The job the cost belongs to |
| `site_id` | Required for `site_staging` |
| `assigned_to_user_id` | Required for `checkout` |
| `started_at` | Scan out |
| `expected_end_at` | Planned collection — drives the pickup alert |
| `ended_at` | Null while active |
| `placed_by`, `collected_by` | |
| `condition_out`, `condition_in` | ok / damaged / needs_service |
| `notes` | |

**The critical constraint.** A unit cannot be in two places at once:

```sql
alter table equipment_assignments
  add constraint equipment_no_overlap
  exclude using gist (
    equipment_id with =,
    tstzrange(started_at, coalesce(ended_at, 'infinity')) with &&
  );
```

This single line makes double-booking impossible at the database level, which
is exactly where it belongs — the scheduler, the mobile scan-out screen and
any future import all get it for free.

**Current location is a query, not a column:**

```sql
create view equipment_current as
select e.*, a.kind, a.site_id, a.job_id, a.assigned_to_user_id,
       a.started_at, a.expected_end_at,
       case
         when a.id is null then 'available'
         when a.kind = 'checkout' then 'in_use'
         else 'staged_at_site'
       end as location_status
from equipment e
left join equipment_assignments a
  on a.equipment_id = e.id and a.ended_at is null;
```

A stored `current_location` column would drift within weeks. Derived state
cannot.

### `equipment_rentals` — rented in from a vendor

| Column | Notes |
|---|---|
| `supplier_id` | The rental vendor |
| `job_id`, `site_id` | |
| `description`, `quantity` | Vendor units have no asset tag of ours |
| `rate`, `rate_unit` | day / week |
| `picked_up_at`, `return_due_at`, `returned_at` | |
| `estimated_cost`, `actual_cost` | Actual from the vendor invoice |
| `agreement_no`, `document_path` | |
| `status` | reserved / on_hire / overdue / returned / closed |

Rentals are tracked separately because the risk is different: an owned
scrubber left behind is an inconvenience, a rental left out is an invoice
that grows daily. Alerts fire two days before `return_due_at` and daily once
overdue.

### `equipment_runtime_logs`

`equipment_id`, `job_id`, `reading_hours`, `read_at`, `read_by`.

Hour-meter readings on scrubbers and dehumidifiers. Drives filter-change and
service intervals, and gives a defensible record of how long containment
actually ran — which matters for clearance documentation.

### `equipment_maintenance`

`equipment_id`, `date`, `kind` (filter / service / repair), `description`,
`cost`, `hours_at_service`, `next_due_hours`, `next_due_date`.

## 4. Field workflows

**Stage at site** — scan the asset tag, confirm the job, set the expected
collection date. Takes about eight seconds and creates the placement.

**Collect** — scan the tag, record condition, optionally read the hour meter.
Ends the placement.

**Move between sites** — scan at the new site and choose "move here". The
open placement is closed and a new one opened in one action, so the two never
overlap and the cost splits correctly across both jobs.

**Check out / check in** — same scan flow with `kind = 'checkout'`.

**Rental return** — a crew lead can record the physical return; only a
manager or owner enters the vendor's actual cost.

## 5. Scheduling integration

When a job is scheduled with required equipment types, the scheduler checks
availability across the job's window using the placement ranges. A scrubber
staged at 42 Oak St until Thursday is simply not offered for a Wednesday job,
and the conflict is surfaced at assignment time rather than discovered by a
crew standing in a driveway.

This check runs against the same exclusion-constrained table that enforces
custody — one source of truth, so the plan and the reality cannot disagree.

## 6. Alerts

| Alert | Trigger | Recipients |
|---|---|---|
| Pickup due | `expected_end_at` reached, still placed | Last handler, manager |
| Pickup overdue | 24h past expected end | Manager, owner |
| **Still on site at job completion** | Completion gate | Completing user |
| **Still on site at job close** | Job moving to closed | Manager, owner |
| Rental return due | 2 days before `return_due_at` | Manager, owner |
| Rental overdue | Past due, daily | Manager, owner |
| Filter due | Runtime hours ≥ interval | Manager |
| Service due | Date or hours | Manager |
| Idle too long | Available and unused 30+ days | Owner |

The two bolded rows are the ones that pay for the feature. A job cannot reach
`work_complete` with equipment still staged at its site unless a pickup is
scheduled — see [05-state-machines.md](05-state-machines.md) §1.2.

## 7. Cost allocation

**Owned equipment:**

```
cost_to_job = days(placement ∩ job window) × equipment.internal_day_rate
```

A placement spanning two jobs at the same site splits by day across both.
`internal_day_rate` is set by the owner to recover purchase cost over the
unit's expected life — it is an internal number for margin analysis and never
appears on a customer document.

**Rented equipment:** `actual_cost` from the vendor invoice, falling back to
`estimated_cost` while the invoice is outstanding.

Both feed the equipment line of the `job_costs` view
([03-data-model.md](03-data-model.md) §9).

## 8. Reports

- **Where is everything** — live board of every unit by location status, with
  days deployed. The screen a manager checks each morning.
- **Utilisation** — deployed days ÷ available days per unit. Answers "do we
  need another scrubber or are three of them sitting idle".
- **Rental spend by month and by job** — and specifically, spend on rentals
  made while an owned unit of the same category was idle. That report pays
  for itself.
- **Overdue register** — everything past its expected collection or return.
- **Cost per job** — owned days plus rental cost against the flat quote.
