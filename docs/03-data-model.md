# Data Model

Postgres. Every table carries `org_id`, `created_at`, `updated_at`,
`created_by`. Soft-deletable tables carry `deleted_at`, `deleted_by`,
`delete_reason`. IDs are UUIDs generated client-side where offline creation
is possible, so replayed mutations upsert instead of duplicating.

## 1. Identity and organisation

**`organizations`** — `id`, `name`, `settings` (jsonb: mileage rate,
approval thresholds, geofence radius, timezone, plus `job_steps` and
`photo_phases` — which status steps and photo galleries this shop uses).

**`profiles`** — one row per user, keyed to `auth.users.id`. `full_name`,
`phone`, `role_id`, `cost_rate` (internal hourly cost; **unused — crews are
paid per job, see [07-roadmap.md](07-roadmap.md)**),
`is_active`, `push_token`.

**`roles`** — `name`, `permissions` (jsonb flag set). See
[04-permissions.md](04-permissions.md).

**`crews`** — `name`, `lead_user_id`.
**`crew_members`** — `crew_id`, `user_id`.

**`time_off`** — `user_id`, `starts_at`, `ends_at`, `type`
(vacation / sick / unavailable), `status`, `reason`, `approved_by`.
Approved rows hard-block scheduling for that user.

## 2. Customers and sites

**`customers`** — `name`, `type` (residential / commercial / insurance),
`primary_contact`, `phone`, `email`, `billing_address`, `notes`.

**`sites`** — `customer_id`, `label` ("42 Oak St — basement"), `address`,
`lat`, `lng`, `access_notes` (gate codes, key location, dog), `notes`.

A site accumulates job history. "What did we do at this address in 2024" must
be answerable in one query — it is the common question on callbacks and
insurance disputes.

## 3. Jobs

**`job_templates`** — `name`, `default_duration_hours`,
`required_form_template_ids[]`, `default_material_lines` (jsonb),
`default_equipment_types[]`, `completion_requirements` (jsonb: photos
required, signature required, forms required).

**`jobs`**
| Column | Notes |
|---|---|
| `job_number` | Human-readable sequence |
| `customer_id`, `site_id` | |
| `template_id` | Nullable |
| `title`, `description` | |
| `status` | See [05-state-machines.md](05-state-machines.md) |
| `priority` | |
| `scheduled_start`, `scheduled_end` | May span multiple days |
| `actual_start`, `actual_end` | |
| `quoted_price` | The BASE flat price. Amount owed is `job_contract_price()`. Revoked from `authenticated`; read via `jobs_safe` |
| `insurance_claim_no`, `adjuster_contact` | Nullable |
| `recurrence_rule` | RRULE, nullable |
| `parent_job_id` | For recurrence instances |
| `cancelled_reason`, `deleted_at` | Soft delete |

**`job_visits`** — a single work day within a multi-day job: `job_id`,
`scheduled_start`, `scheduled_end`. The dispatch board plots *visits*, not
jobs. A single-day job has exactly one visit.

**`job_assignments`** — `job_id`, `visit_id` (nullable — assignment may cover
the whole job), `user_id`, `crew_id`, `acceptance_status`
(pending / accepted / reschedule_requested / declined), `responded_at`.
Acceptance is per person, so a three-person crew produces three rows.

**`job_status_history`** — append-only: `job_id`, `from_status`, `to_status`,
`changed_by`, `changed_at`, `note`.

**`reschedule_requests`** — `job_id`, `assignment_id`, `requested_by`,
`reason`, `proposed_start`, `proposed_end`, `status`
(pending / approved / declined), `decided_by`, `decided_at`,
`decision_reason`.

The proposed time is what makes this useful. A reason alone still requires a
phone call; a proposed alternative can be approved with one tap.

**`job_comments`** — `job_id`, `author_id`, `body`, `attachments[]`. Built and
specified, not surfaced in any screen today.

**`job_documents`** — `job_id` or `site_id`, `kind` (scope of work, lab
result, SDS, insurance), `storage_path`.

## 4. Field capture

**`time_entries`** — `job_id`, `user_id`, `clock_in_at`, `clock_out_at`,
`clock_in_lat/lng`, `clock_out_lat/lng`, `within_geofence` (bool — recorded,
never enforced), `break_minutes`, `notes`.
Feeds both payroll export and the labour line of job costing.

**`job_photos`** — `job_id`, `storage_path`, `phase`
(before / during / after), `room_label`, `caption`, `taken_at`,
`taken_by`, `lat`, `lng`.

**`form_templates`** / **`form_fields`** — checklist and reading-sheet
definitions: moisture readings, containment verification, PPE check, job
hazard analysis, chain of custody.

**`form_submissions`** — `job_id`, `template_id`, `submitted_by`,
`submitted_at`, `answers` (jsonb), `is_complete`.

**`signatures`** — `job_id`, `kind` (work_authorization / completion),
`signer_name`, `signer_role`, `storage_path`, `signed_at`.

## 5. Materials, inventory and purchasing

**`suppliers`** — `name`, `contact`, `phone`, `email`, `notes`.

**`inventory_items`** — the master catalogue: `sku`, `name`, `category`,
`unit_of_measure`, `barcode`, `average_cost`, `preferred_supplier_id`,
`min_level`, `reorder_quantity`, `is_active`.

**`stock_locations`** — `name`, `kind` (warehouse / van / site),
`vehicle_id` (nullable, when the location *is* a van).

**`stock_movements`** — append-only, the single source of truth for stock:
`item_id`, `from_location_id`, `to_location_id`, `quantity`, `kind`
(receipt / usage / transfer / adjustment / count / return), `job_id`
(nullable), `reference_id` (purchase request line, usage row), `reason`
(required for adjustments), `created_by`.

**`stock_levels`** is a materialised view over `stock_movements`
(item × location → quantity). Never written directly. Levels that can be
edited are levels nobody trusts by month three.

**`material_usage`** — `job_id`, `item_id`, `quantity`, `location_id`,
`logged_by`. Writes a corresponding `usage` stock movement.

**`purchase_requests`** — `request_number`, `requested_by`, `assigned_to`
(the tagged manager/owner), `job_id` (nullable), `status`, `supplier_id`,
`po_number`, `expected_delivery`, `receipt_storage_path`,
`total_estimated_cost`, `decided_by`, `decided_at`, `decision_reason`.

**`purchase_request_lines`** — `request_id`, `item_id` (nullable for free
text), `description`, `quantity`, `unit`, `estimated_unit_cost`,
`line_status` (pending / approved / rejected), `received_quantity`,
`receive_location_id`.

Per-line status is what enables partial approval — approve six of eight lines
rather than rejecting the whole request and forcing it to be retyped.

**`purchase_request_audit`** — append-only: `request_id`, `line_id`
(nullable), `actor_id`, `at`, `action`, `field`, `old_value`, `new_value`.
Written by a database trigger, not by application code, so nothing can bypass
it. Never updatable or deletable — enforced by RLS.

## 5a. Change orders

All work is billed flat and direct to the customer, so scope growth is either
priced and agreed or absorbed. A change order is that agreement.

**`change_orders`** — `job_id`, `seq` (CO-1, CO-2, assigned server-side),
`title`, `description`, `amount` (negative for a descope credit),
`added_hours`, `status`, `presented_at`, `decided_at`, `approval_method`
(signature / verbal / written), `customer_name`, `signature_id`,
`decision_reason`, `created_by`, `presented_by`, `recorded_by`.

**`change_order_photos`** — links the photos that justify the change to it.
The crew lead who opens a wall photographs what they found.

Constraints: a change order cannot be presented without a price; a signature
approval requires the signature; a verbal approval requires a named person.

**Contract price is derived**, not stored:

```
job_contract_price(job) = jobs.quoted_price + Σ approved change_orders.amount
```

The base quote stays visible beside it, so the growth over a job is
auditable, and `job_costs` measures margin against the contract price.

## 6. Vehicles and mileage

**`vehicles`** — `name`, `plate`, `make_model`, `year`,
`current_odometer`, `assigned_user_id`, `insurance_expiry`,
`registration_expiry`, `next_service_odometer`, `next_service_date`,
`is_active`.

**`mileage_logs`** — `vehicle_id`, `user_id`, `job_id` (nullable),
`trip_date`, `odometer_start`, `odometer_end`, `distance` (generated:
`odometer_end - odometer_start`), `purpose`, `is_business`, `notes`.

Constraints: `odometer_end >= odometer_start` is enforced. The continuity
check — this trip's start against the vehicle's last recorded closing reading
— produces a *warning*, not a rejection; vehicles get moved without a log and
a hard block would simply stop people logging.

On insert, the vehicle's `current_odometer` advances to the higher reading.

**`fuel_logs`** — `vehicle_id`, `user_id`, `date`, `litres`, `cost`,
`odometer`, `receipt_storage_path`.

**`vehicle_maintenance`** — `vehicle_id`, `date`, `odometer`, `kind`,
`description`, `cost`, `next_due_date`, `next_due_odometer`.

## 7. Equipment

Detailed in [06-equipment.md](06-equipment.md). Tables:

- **`equipment`** — the owned asset register.
- **`equipment_assignments`** — a unit's placement over a time range, either
  checked out to a crew or staged at a site. Non-overlapping per unit,
  enforced by a Postgres exclusion constraint.
- **`equipment_rentals`** — units rented in from a vendor for a job.
- **`equipment_runtime_logs`** — hour-meter readings for scrubbers and
  dehumidifiers, driving filter and service intervals.
- **`equipment_maintenance`** — service history.

## 8. Compliance

**`certification_types`** — `name`, `issuing_body`, `validity_months`.
**`user_certifications`** — `user_id`, `type_id`, `issued_on`, `expires_on`,
`document_path`. Expiry alerts at 60 / 30 / 7 days.

## 9. Cross-cutting

**`audit_log`** — `table_name`, `record_id`, `actor_id`, `at`, `action`,
`diff` (jsonb). Written by trigger on every business-significant table.

**`notifications`** — `user_id`, `kind`, `title`, `body`, `payload`,
`read_at`, `sent_at`.

**`job_costs`** is a **view**, not a table:

```
labour     = Σ time_entries.hours × profiles.cost_rate   (always 0 today:
             nothing records hours, because crews are paid per job)
materials  = Σ material_usage.quantity × inventory_items.average_cost
purchases  = Σ approved purchase_request_lines billed to the job
mileage    = Σ mileage_logs.distance × org mileage rate
equipment  = Σ owned placement days × internal day rate
           + Σ equipment_rentals.actual_cost
other      = Σ manual cost entries
margin     = job_contract_price(job) − total
```

Deriving rather than storing means the costing model can be reshaped later
without migrating historical rows.

## 9a. Safe read views

Price is manager and owner information. Because RLS is row level and every
Supabase user shares the `authenticated` role, the money columns are revoked
on the base tables and exposed through definer-rights views that check the
flag and repeat the row filter:

| View | Masks | Unless |
|---|---|---|
| `jobs_safe` | `quoted_price`, `contract_price`, `change_order_total` | `price.view` |
| `change_orders_safe` | `amount` | `price.view` |
| `profiles_safe` | `cost_rate` | `user.view_cost_rates` |
| `job_costs` | every row | `costing.view` |

Clients read jobs through `jobs_safe`, never the table. Adding a column to
`jobs`, `change_orders` or `profiles` means re-running
`grant_columns_except()` for it, or the new column is unreadable.

## 10. Constraints worth stating explicitly

1. `stock_levels` is derived from `stock_movements` — always.
2. Equipment placements for one unit may never overlap in time
   (`EXCLUDE USING gist`).
3. `purchase_request_audit` and `job_status_history` are insert-only; RLS
   denies update and delete to every role including the owner.
4. A job cannot reach `work_complete` with equipment still staged at its site
   and no pickup scheduled — enforced in the transition function.
5. Scheduling a user with approved `time_off` overlapping the visit is
   rejected.
6. `jobs.deleted_at` is set, never `DELETE`.
7. The money columns are revoked from `authenticated`; price reaches a client
   only through a safe view that checks `price.view`.
