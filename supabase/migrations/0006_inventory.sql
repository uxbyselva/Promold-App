-- 0006 Suppliers, item catalogue, stock locations and movements
--
-- Stock level is derived from movements and never written directly. A level
-- that can be edited is a level nobody trusts by month three.

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  contact_name text,
  phone text,
  email text,
  account_no text,
  -- Rental vendors are suppliers too; equipment_rentals points here.
  is_rental_vendor boolean not null default false,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table inventory_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  sku text not null,
  name text not null,
  category text,
  unit_of_measure text not null default 'each',
  barcode text,
  -- Weighted average, recalculated on receipt. Used for the materials line
  -- of job costing.
  average_cost numeric(12,4) not null default 0,
  preferred_supplier_id uuid references suppliers(id),
  min_level numeric(12,3) not null default 0,
  reorder_quantity numeric(12,3) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, sku)
);

create index on inventory_items (org_id) where is_active;
create unique index inventory_items_barcode on inventory_items (org_id, barcode)
  where barcode is not null;

create type stock_location_kind as enum ('warehouse', 'van', 'site', 'supplier');

-- Van stock is the reason locations exist. "How much Concrobium is in Van 2"
-- is the question actually asked.
create table stock_locations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  kind stock_location_kind not null default 'warehouse',
  vehicle_id uuid,           -- FK added in 0008, once vehicles exists
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create type stock_movement_kind as enum (
  'receipt', 'usage', 'transfer', 'adjustment', 'count', 'return'
);

-- Append-only ledger. Every change to stock lands here and nowhere else.
create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  item_id uuid not null references inventory_items(id),
  kind stock_movement_kind not null,
  from_location_id uuid references stock_locations(id),
  to_location_id uuid references stock_locations(id),
  quantity numeric(12,3) not null,
  unit_cost numeric(12,4),
  job_id uuid references jobs(id) on delete set null,
  reference_table text,
  reference_id uuid,
  reason text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  constraint stock_movements_quantity_positive check (quantity > 0),
  constraint stock_movements_has_endpoint check (
    from_location_id is not null or to_location_id is not null
  ),
  -- An adjustment with no reason is how stock records become fiction.
  constraint stock_movements_adjustment_reason check (
    kind <> 'adjustment' or (reason is not null and length(trim(reason)) > 0)
  )
);

create index on stock_movements (item_id, created_at desc);
create index on stock_movements (job_id) where job_id is not null;

-- Derived stock on hand. A plain view keeps it always-correct; if read
-- volume ever justifies it this becomes a materialised view refreshed on
-- movement insert.
create view stock_levels
with (security_invoker = true)
as
select
  m.org_id,
  m.item_id,
  loc.id as location_id,
  sum(
    case
      when m.to_location_id = loc.id then m.quantity
      when m.from_location_id = loc.id then -m.quantity
      else 0
    end
  ) as quantity
from stock_movements m
join stock_locations loc
  on loc.id in (m.from_location_id, m.to_location_id)
group by m.org_id, m.item_id, loc.id;

-- Materials consumed on a job. Writes a matching 'usage' movement via
-- trigger in 0012, so the ledger stays the single source of truth.
create table material_usage (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  visit_id uuid references job_visits(id) on delete set null,
  item_id uuid not null references inventory_items(id),
  location_id uuid not null references stock_locations(id),
  quantity numeric(12,3) not null,
  logged_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint material_usage_quantity_positive check (quantity > 0)
);

create index on material_usage (job_id);

select attach_updated_at('suppliers');
select attach_updated_at('inventory_items');
select attach_updated_at('stock_locations');
select attach_updated_at('material_usage');
