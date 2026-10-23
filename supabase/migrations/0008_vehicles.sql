-- 0008 Vehicles, mileage, fuel and maintenance
--
-- Mileage is captured as odometer start/end rather than typed distance. It is
-- harder to fudge and it keeps the vehicle's odometer current for service
-- intervals at no extra cost to the person logging it.

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  plate text,
  make_model text,
  year int,
  current_odometer numeric(10,1) not null default 0,
  assigned_user_id uuid references profiles(id),
  insurance_expiry date,
  registration_expiry date,
  next_service_odometer numeric(10,1),
  next_service_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on vehicles (org_id) where is_active;

-- A van is both a vehicle and a stock location; this is the link.
alter table stock_locations
  add constraint stock_locations_vehicle_fk
  foreign key (vehicle_id) references vehicles(id) on delete set null;

create table mileage_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id),
  user_id uuid not null references profiles(id),
  job_id uuid references jobs(id) on delete set null,
  trip_date date not null default current_date,
  odometer_start numeric(10,1) not null,
  odometer_end numeric(10,1) not null,
  distance numeric(10,1) generated always as (odometer_end - odometer_start) stored,
  purpose text,
  is_business boolean not null default true,
  -- Set when the opening reading does not match the vehicle's last closing
  -- reading. A warning, not a rejection: vehicles get moved without a log,
  -- and a hard block would simply stop people logging at all.
  continuity_gap numeric(10,1),
  notes text,
  edited_by uuid references profiles(id),
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mileage_odometer_valid check (odometer_end >= odometer_start)
);

create index on mileage_logs (vehicle_id, trip_date desc);
create index on mileage_logs (user_id, trip_date desc);
create index on mileage_logs (job_id) where job_id is not null;

create table fuel_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id),
  user_id uuid references profiles(id),
  filled_on date not null default current_date,
  volume numeric(10,3),
  volume_unit text not null default 'gal',
  cost numeric(10,2),
  odometer numeric(10,1),
  receipt_storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on fuel_logs (vehicle_id, filled_on desc);

create table vehicle_maintenance (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id),
  performed_on date not null default current_date,
  odometer numeric(10,1),
  kind text not null,
  description text,
  cost numeric(10,2),
  next_due_date date,
  next_due_odometer numeric(10,1),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on vehicle_maintenance (vehicle_id, performed_on desc);

select attach_updated_at('vehicles');
select attach_updated_at('mileage_logs');
select attach_updated_at('fuel_logs');
select attach_updated_at('vehicle_maintenance');
