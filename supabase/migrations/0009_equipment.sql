-- 0009 Equipment: owned register, placements, rentals
--
-- Three distinct flows, per docs/06-equipment.md:
--   checkout      - goes out with a crew and comes back
--   site_staging  - left running at an address for days
--   rental        - rented in from a vendor for a job
--
-- Billing is flat per job, so equipment days add no revenue. Tracking exists
-- to know where a unit physically is, and to load real cost onto the job.

create type equipment_category as enum (
  'air_scrubber', 'dehumidifier', 'air_mover', 'meter', 'hepa_vacuum',
  'negative_air', 'generator', 'tool', 'other'
);

create type equipment_lifecycle as enum ('active', 'in_maintenance', 'retired', 'lost');

create type equipment_condition as enum ('ok', 'damaged', 'needs_service');

create table equipment (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  -- Printed QR/barcode on the unit. This is what the field scans.
  asset_tag text not null,
  name text not null,
  category equipment_category not null default 'other',
  make text,
  model text,
  serial_no text,
  purchase_date date,
  purchase_cost numeric(12,2),
  -- Internal cost loaded onto a job per day deployed. Set by the owner to
  -- recover purchase cost over the unit's expected life. Never shown to a
  -- customer.
  internal_day_rate numeric(10,2) not null default 0,
  has_hour_meter boolean not null default false,
  filter_interval_hours numeric(10,1),
  home_location_id uuid references stock_locations(id),
  lifecycle_status equipment_lifecycle not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, asset_tag)
);

create index on equipment (org_id, category) where lifecycle_status = 'active';

create type equipment_placement_kind as enum ('checkout', 'site_staging');

-- One row per continuous placement of one unit.
create table equipment_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  equipment_id uuid not null references equipment(id) on delete cascade,
  kind equipment_placement_kind not null,
  job_id uuid references jobs(id) on delete set null,
  site_id uuid references sites(id) on delete set null,
  assigned_to_user_id uuid references profiles(id),
  started_at timestamptz not null default now(),
  -- Planned collection. Drives the pickup-due alert.
  expected_end_at timestamptz,
  ended_at timestamptz,
  placed_by uuid references profiles(id),
  collected_by uuid references profiles(id),
  condition_out equipment_condition not null default 'ok',
  condition_in equipment_condition,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint equipment_placement_range_valid check (ended_at is null or ended_at > started_at),
  -- Staging is to a site; checkout is to a person. Enforcing this stops the
  -- two flows quietly collapsing into one ambiguous record.
  constraint equipment_placement_target check (
    (kind = 'site_staging' and site_id is not null)
    or (kind = 'checkout' and assigned_to_user_id is not null)
  )
);

-- THE constraint of this model: one unit can never be in two places at once.
-- Enforced in the database so the scheduler, the mobile scan screen and any
-- future import all inherit it.
alter table equipment_assignments
  add constraint equipment_no_overlap
  exclude using gist (
    equipment_id with =,
    tstzrange(started_at, coalesce(ended_at, 'infinity'::timestamptz)) with &&
  );

create index on equipment_assignments (job_id);
create index on equipment_assignments (site_id) where ended_at is null;
create index equipment_assignments_open on equipment_assignments (equipment_id)
  where ended_at is null;

-- Current whereabouts are derived, never stored. A stored location column
-- drifts within weeks; a view cannot.
create view equipment_current
with (security_invoker = true)
as
select
  e.id            as equipment_id,
  e.org_id,
  e.asset_tag,
  e.name,
  e.category,
  e.lifecycle_status,
  a.id            as assignment_id,
  a.kind,
  a.job_id,
  a.site_id,
  a.assigned_to_user_id,
  a.started_at,
  a.expected_end_at,
  case
    when e.lifecycle_status <> 'active' then e.lifecycle_status::text
    when a.id is null then 'available'
    when a.kind = 'checkout' then 'in_use'
    else 'staged_at_site'
  end as location_status,
  case
    when a.id is null then null
    else greatest(0, extract(epoch from (now() - a.started_at)) / 86400.0)
  end as days_deployed,
  (a.expected_end_at is not null and a.ended_at is null and a.expected_end_at < now())
    as pickup_overdue
from equipment e
left join equipment_assignments a
  on a.equipment_id = e.id and a.ended_at is null;

create type rental_status as enum ('reserved', 'on_hire', 'overdue', 'returned', 'closed', 'cancelled');

-- Rented in from a vendor. Tracked apart from owned equipment because the
-- risk is different: an owned scrubber left behind is an inconvenience, a
-- rental left out is an invoice that grows daily.
create table equipment_rentals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  supplier_id uuid not null references suppliers(id),
  job_id uuid references jobs(id) on delete set null,
  site_id uuid references sites(id) on delete set null,
  description text not null,
  category equipment_category not null default 'other',
  quantity int not null default 1,
  rate numeric(10,2),
  rate_unit text not null default 'day',
  picked_up_at timestamptz,
  return_due_at timestamptz,
  returned_at timestamptz,
  estimated_cost numeric(12,2),
  -- From the vendor invoice. Falls back to estimated_cost in job costing
  -- while the invoice is outstanding.
  actual_cost numeric(12,2),
  agreement_no text,
  document_path text,
  status rental_status not null default 'reserved',
  created_by uuid references profiles(id),
  returned_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rental_quantity_positive check (quantity > 0),
  constraint rental_return_valid check (returned_at is null or picked_up_at is null or returned_at >= picked_up_at)
);

create index on equipment_rentals (job_id);
create index on equipment_rentals (status) where status in ('on_hire', 'overdue');

-- Hour-meter readings on scrubbers and dehumidifiers. Drives filter and
-- service intervals, and gives a defensible record of how long containment
-- actually ran.
create table equipment_runtime_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  equipment_id uuid not null references equipment(id) on delete cascade,
  job_id uuid references jobs(id) on delete set null,
  reading_hours numeric(10,1) not null,
  read_at timestamptz not null default now(),
  read_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  constraint runtime_reading_positive check (reading_hours >= 0)
);

create index on equipment_runtime_logs (equipment_id, read_at desc);

create table equipment_maintenance (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  equipment_id uuid not null references equipment(id) on delete cascade,
  performed_on date not null default current_date,
  kind text not null,
  description text,
  cost numeric(10,2),
  hours_at_service numeric(10,1),
  next_due_hours numeric(10,1),
  next_due_date date,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on equipment_maintenance (equipment_id, performed_on desc);

select attach_updated_at('equipment');
select attach_updated_at('equipment_assignments');
select attach_updated_at('equipment_rentals');
select attach_updated_at('equipment_maintenance');
