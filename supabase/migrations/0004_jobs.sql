-- 0004 Jobs, visits, assignments, scheduling
--
-- A job is the unit of billing and the unit of costing. It carries a flat
-- quoted price and may span several days; the individual work days are
-- visits, and the dispatch board plots visits rather than jobs.

create type job_status as enum (
  'draft', 'scheduled', 'assigned', 'accepted', 'en_route', 'on_site',
  'in_progress', 'blocked', 'work_complete', 'approved', 'closed', 'cancelled'
);

create type job_priority as enum ('low', 'normal', 'high', 'emergency');

create type acceptance_status as enum (
  'pending', 'accepted', 'reschedule_requested', 'declined'
);

create type visit_status as enum ('scheduled', 'on_site', 'in_progress', 'done', 'cancelled');

create table job_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  description text,
  default_duration_hours numeric(5,2) not null default 4,
  default_crew_size int not null default 1,
  -- Equipment categories this work normally needs, used by the scheduler's
  -- availability check.
  default_equipment_categories text[] not null default '{}',
  default_material_lines jsonb not null default '[]'::jsonb,
  -- What must exist before the job may be marked work_complete. Read by the
  -- completion gate in 0012.
  completion_requirements jsonb not null default jsonb_build_object(
    'photos_before', true,
    'photos_after', true,
    'customer_signature', true,
    'materials_logged', true,
    'forms', jsonb_build_array()
  ),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence job_number_seq;

create table jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  job_number text not null default 'J' || lpad(nextval('job_number_seq')::text, 5, '0'),
  customer_id uuid not null references customers(id),
  site_id uuid not null references sites(id),
  template_id uuid references job_templates(id),
  title text not null,
  description text,
  status job_status not null default 'draft',
  priority job_priority not null default 'normal',
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  actual_start timestamptz,
  actual_end timestamptz,
  -- The flat price billed for the whole job, however many days it runs.
  quoted_price numeric(12,2),
  insurance_claim_no text,
  adjuster_contact text,
  recurrence_rule text,
  parent_job_id uuid references jobs(id),
  blocked_reason text,
  cancelled_reason text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references profiles(id),
  delete_reason text,
  unique (org_id, job_number),
  constraint jobs_schedule_valid check (
    scheduled_end is null or scheduled_start is null or scheduled_end >= scheduled_start
  )
);

create index on jobs (org_id, status) where deleted_at is null;
create index on jobs (site_id) where deleted_at is null;
create index on jobs (scheduled_start) where deleted_at is null;

-- A single work day within a job. A one-day job has exactly one visit.
create table job_visits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  seq int not null,
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  status visit_status not null default 'scheduled',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, seq),
  constraint job_visits_range_valid check (scheduled_end > scheduled_start)
);

create index on job_visits (scheduled_start);

-- Acceptance is tracked per person, so a three-person crew produces three
-- rows and one non-responder is visible rather than averaged away.
create table job_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  visit_id uuid references job_visits(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  crew_id uuid references crews(id),
  acceptance_status acceptance_status not null default 'pending',
  responded_at timestamptz,
  decline_reason text,
  escalated_at timestamptz,
  assigned_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, user_id, visit_id)
);

create index on job_assignments (user_id, acceptance_status);

-- Append-only. This table is what people refer back to when they disagree
-- about what was scheduled and when it changed.
create table job_status_history (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  from_status job_status,
  to_status job_status not null,
  changed_by uuid references profiles(id),
  changed_at timestamptz not null default now(),
  note text
);

create index on job_status_history (job_id, changed_at desc);

create type reschedule_status as enum ('pending', 'approved', 'declined', 'withdrawn');

-- The proposed time is what makes this useful. A reason alone still requires
-- a phone call; a proposed alternative can be approved with one tap.
create table reschedule_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  assignment_id uuid references job_assignments(id) on delete cascade,
  requested_by uuid not null references profiles(id),
  reason text not null,
  proposed_start timestamptz,
  proposed_end timestamptz,
  status reschedule_status not null default 'pending',
  decided_by uuid references profiles(id),
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reschedule_proposal_valid check (
    proposed_end is null or proposed_start is null or proposed_end > proposed_start
  )
);

create index on reschedule_requests (job_id, status);

-- The job chat. This replaces the WhatsApp group and is the main reason
-- crews open the app daily.
create table job_comments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  author_id uuid not null references profiles(id),
  body text not null,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index on job_comments (job_id, created_at desc);

create type document_kind as enum (
  'scope_of_work', 'lab_result', 'sds', 'insurance', 'permit', 'photo_report', 'other'
);

create table job_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  job_id uuid references jobs(id) on delete cascade,
  site_id uuid references sites(id) on delete cascade,
  kind document_kind not null default 'other',
  title text not null,
  storage_path text not null,
  uploaded_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_documents_target check (job_id is not null or site_id is not null)
);

select attach_updated_at('job_templates');
select attach_updated_at('jobs');
select attach_updated_at('job_visits');
select attach_updated_at('job_assignments');
select attach_updated_at('reschedule_requests');
select attach_updated_at('job_comments');
select attach_updated_at('job_documents');
