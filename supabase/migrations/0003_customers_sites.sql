-- 0003 Customers and sites
--
-- A job is never free-floating: it belongs to a customer at a property. Site
-- history is what answers "what did we do at this address last year", which
-- is the common question on a callback or an insurance dispute.

create type customer_kind as enum ('residential', 'commercial', 'insurance', 'property_manager');

create table customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  kind customer_kind not null default 'residential',
  primary_contact text,
  phone text,
  email text,
  billing_address text,
  notes text,
  is_active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references profiles(id),
  delete_reason text
);

create index on customers (org_id) where deleted_at is null;

create table sites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  label text not null,
  address_line1 text not null,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  lat numeric(9,6),
  lng numeric(9,6),
  -- Gate codes, key location, dog on premises. The crew reads this in the
  -- driveway, so it lives on the site rather than buried in job notes.
  access_notes text,
  notes text,
  is_active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references profiles(id),
  delete_reason text
);

create index on sites (customer_id) where deleted_at is null;
create index on sites (org_id) where deleted_at is null;

select attach_updated_at('customers');
select attach_updated_at('sites');
