-- 0007 Material purchase requests
--
-- Editing is locked on submit rather than on approval, with a recall action
-- for the requester. Every change from submit onward is captured by an
-- append-only audit trigger (0012) that no role may update or delete.

create type purchase_status as enum (
  'draft', 'submitted', 'under_review', 'approved', 'rejected',
  'ordered', 'partially_received', 'received', 'closed', 'cancelled'
);

create type purchase_line_status as enum ('pending', 'approved', 'rejected');

create sequence purchase_request_number_seq;

create table purchase_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  request_number text not null
    default 'PR' || lpad(nextval('purchase_request_number_seq')::text, 5, '0'),
  requested_by uuid not null references profiles(id),
  -- The manager or owner tagged to action it.
  assigned_to uuid references profiles(id),
  job_id uuid references jobs(id) on delete set null,
  status purchase_status not null default 'draft',
  needed_by date,
  notes text,
  supplier_id uuid references suppliers(id),
  po_number text,
  expected_delivery date,
  receipt_storage_path text,
  decided_by uuid references profiles(id),
  decided_at timestamptz,
  decision_reason text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, request_number)
);

create index on purchase_requests (org_id, status);
create index on purchase_requests (requested_by);
create index on purchase_requests (assigned_to) where status in ('submitted', 'under_review');

create table purchase_request_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  request_id uuid not null references purchase_requests(id) on delete cascade,
  -- Nullable: the field often asks for something not yet in the catalogue.
  item_id uuid references inventory_items(id),
  description text not null,
  quantity numeric(12,3) not null,
  unit text not null default 'each',
  estimated_unit_cost numeric(12,4),
  -- Per-line status is what makes partial approval possible: approve six of
  -- eight lines instead of rejecting the lot and making someone retype it.
  line_status purchase_line_status not null default 'pending',
  rejection_reason text,
  received_quantity numeric(12,3) not null default 0,
  receive_location_id uuid references stock_locations(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_line_quantity_positive check (quantity > 0),
  constraint purchase_line_received_valid check (received_quantity >= 0)
);

create index on purchase_request_lines (request_id);

create or replace function purchase_request_total(p_request_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(sum(quantity * coalesce(estimated_unit_cost, 0)), 0)
  from purchase_request_lines
  where request_id = p_request_id;
$$;

create or replace function purchase_request_approved_total(p_request_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(sum(quantity * coalesce(estimated_unit_cost, 0)), 0)
  from purchase_request_lines
  where request_id = p_request_id and line_status = 'approved';
$$;

-- Append-only. Written by trigger only (0012); RLS in 0013 grants insert and
-- select but no update or delete, to any role including the owner.
create table purchase_request_audit (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  request_id uuid not null references purchase_requests(id) on delete cascade,
  line_id uuid,
  actor_id uuid references profiles(id),
  at timestamptz not null default now(),
  action text not null,
  field text,
  old_value text,
  new_value text
);

create index on purchase_request_audit (request_id, at desc);

select attach_updated_at('purchase_requests');
select attach_updated_at('purchase_request_lines');
