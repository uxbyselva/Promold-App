-- 0002 Organisations, roles, users, crews, time off

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'America/New_York',
  -- Operational settings kept as jsonb so the owner can tune them without a
  -- migration: mileage_rate, approval_threshold, geofence_radius_m,
  -- acceptance_escalation_hours.
  settings jsonb not null default jsonb_build_object(
    'mileage_rate', 0.67,
    'approval_threshold', 500,
    'geofence_radius_m', 150,
    'acceptance_escalation_hours', 12
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  key text not null,
  name text not null,
  -- Flat map of permission flag -> boolean. See docs/04-permissions.md.
  permissions jsonb not null default '{}'::jsonb,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, key)
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  role_id uuid not null references roles(id),
  full_name text not null,
  email text,
  phone text,
  -- Internal hourly cost, used for the labour line of job costing. Visible to
  -- the owner only.
  cost_rate numeric(10,2),
  -- Per-user grants layered on top of the role, for the inevitable exception.
  permission_overrides jsonb not null default '{}'::jsonb,
  push_token text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on profiles (org_id) where is_active;

create table crews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  lead_user_id uuid references profiles(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table crew_members (
  crew_id uuid not null references crews(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (crew_id, user_id)
);

create type time_off_status as enum ('requested', 'approved', 'declined', 'cancelled');
create type time_off_kind as enum ('vacation', 'sick', 'unavailable', 'other');

create table time_off (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  kind time_off_kind not null default 'vacation',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status time_off_status not null default 'requested',
  reason text,
  decided_by uuid references profiles(id),
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_off_range_valid check (ends_at > starts_at)
);

-- Approved time off is what blocks scheduling, so it is the case worth
-- indexing for the conflict check.
create index time_off_approved_range on time_off using gist (
  user_id,
  tstzrange(starts_at, ends_at)
) where status = 'approved';

select attach_updated_at('organizations');
select attach_updated_at('roles');
select attach_updated_at('profiles');
select attach_updated_at('crews');
select attach_updated_at('time_off');

-- ---------------------------------------------------------------------------
-- Context helpers that depend on profiles
-- ---------------------------------------------------------------------------

create or replace function auth_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from profiles where id = auth_user_id();
$$;

-- Checking a flag rather than a role name is what lets a single user be
-- granted an exception later without touching application code.
create or replace function has_permission(p_flag text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select coalesce((r.permissions ->> p_flag)::boolean, false)
          or coalesce((p.permission_overrides ->> p_flag)::boolean, false)
      from profiles p
      join roles r on r.id = p.role_id
      where p.id = auth_user_id() and p.is_active
    ),
    false
  );
$$;

comment on function has_permission(text) is
  'True when the caller''s role grants the flag, or their profile carries an explicit override.';
