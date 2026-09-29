-- 0005 Field capture: time, photos, forms, signatures

create table time_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  visit_id uuid references job_visits(id) on delete set null,
  user_id uuid not null references profiles(id) on delete cascade,
  clock_in_at timestamptz not null,
  clock_out_at timestamptz,
  clock_in_lat numeric(9,6),
  clock_in_lng numeric(9,6),
  clock_out_lat numeric(9,6),
  clock_out_lng numeric(9,6),
  -- Recorded, never enforced. Site coordinates are approximate and a hard
  -- block would simply stop people clocking in.
  within_geofence boolean,
  break_minutes int not null default 0,
  notes text,
  edited_by uuid references profiles(id),
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_entries_range_valid check (clock_out_at is null or clock_out_at > clock_in_at),
  constraint time_entries_break_valid check (break_minutes >= 0)
);

create index on time_entries (job_id);
create index on time_entries (user_id, clock_in_at desc);
-- One open entry per person: you cannot be clocked in to two jobs at once.
create unique index time_entries_one_open_per_user
  on time_entries (user_id) where clock_out_at is null;

create or replace function time_entry_hours(p time_entries)
returns numeric
language sql
immutable
as $$
  select case
    when p.clock_out_at is null then 0
    else round(
      (extract(epoch from (p.clock_out_at - p.clock_in_at)) / 3600.0)
        - (p.break_minutes / 60.0),
      2)
  end;
$$;

create type photo_phase as enum ('before', 'during', 'after', 'damage', 'equipment', 'other');

create table job_photos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  visit_id uuid references job_visits(id) on delete set null,
  storage_path text not null,
  phase photo_phase not null default 'during',
  room_label text,
  caption text,
  taken_at timestamptz not null default now(),
  taken_by uuid references profiles(id),
  lat numeric(9,6),
  lng numeric(9,6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references profiles(id)
);

create index on job_photos (job_id, phase) where deleted_at is null;

-- Checklist and reading-sheet definitions: moisture readings, containment
-- verification, PPE checks, job hazard analysis, chain of custody.
create table form_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  key text not null,
  name text not null,
  description text,
  -- Field definitions: [{key, label, type, required, options, unit}]
  fields jsonb not null default '[]'::jsonb,
  -- Reading sheets are filled once per room; checklists once per job.
  is_per_room boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, key)
);

create table form_submissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  visit_id uuid references job_visits(id) on delete set null,
  template_id uuid not null references form_templates(id),
  room_label text,
  answers jsonb not null default '{}'::jsonb,
  is_complete boolean not null default false,
  submitted_by uuid references profiles(id),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on form_submissions (job_id, template_id);

create type signature_kind as enum ('work_authorization', 'completion', 'change_order');

create table signatures (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  kind signature_kind not null,
  signer_name text not null,
  signer_role text,
  storage_path text not null,
  signed_at timestamptz not null default now(),
  captured_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on signatures (job_id, kind);

select attach_updated_at('time_entries');
select attach_updated_at('job_photos');
select attach_updated_at('form_templates');
select attach_updated_at('form_submissions');
select attach_updated_at('signatures');
