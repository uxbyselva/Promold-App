-- 0035 What kind of job it is
--
-- There was one classification on a job: `template_id`, the "kind of work",
-- which exists to drive the completion gate — what has to be photographed
-- and filled in before the crew may call it done. It is optional, and most
-- jobs are booked without one.
--
-- That is a checklist, not a category. The business does two different
-- things — it remediates and it inspects — and nothing on a job said which.
-- A question as ordinary as "how many inspections did we do last month" had
-- no answer, and the board could not tell a half-day inspection from a
-- three-day strip-out.
--
-- So the category sits on the job itself and is never null. It is not
-- derived from the template, because a job with no template still has a
-- kind; and templates now carry one too, so choosing Inspection narrows the
-- checklist list to the inspection checklists.
--
-- An enum rather than a table: three values that describe what the company
-- does, which is the sort of thing that changes on the scale of years. A
-- fourth is one line — `alter type job_category add value 'restoration'` —
-- and does not need a table nobody will ever open a screen to manage.

create type job_category as enum ('remediation', 'inspection', 'other');

alter table jobs
  add column if not exists category job_category not null default 'remediation';
alter table job_templates
  add column if not exists category job_category not null default 'remediation';

comment on column jobs.category is
  'What kind of work this is, for the office. Separate from template_id, '
  'which is the completion checklist and may be null.';

-- The checklists that already exist, sorted into the two kinds. Named rather
-- than guessed at: "Mold Inspection" and "Post-Remediation Verification" are
-- both someone going to look at something and write it down.
update job_templates
   set category = 'inspection'
 where name ilike '%inspection%'
    or name ilike '%verification%'
    or name ilike '%assessment%';

-- Adding a column to jobs means re-running BOTH grant helpers, or the new
-- column is readable and writable by everyone while quoted_price quietly
-- becomes so too: both rebuild the whole grant from the column list.
select grant_columns_except('jobs', array['quoted_price']);
select grant_writes_except('jobs', array['quoted_price']);

-- ---------------------------------------------------------------------------
-- And onto the view the clients read
-- ---------------------------------------------------------------------------
--
-- jobs_safe lists its columns explicitly, so a column added to `jobs` does
-- not appear on it. The app then asks for a column the view has never heard
-- of, PostgREST refuses the whole query, and the page reports the job
-- missing. That is how 0032 broke a live job page.
--
-- `category` goes on the END of the list, next to the 0032 columns, and not
-- beside `priority` where it belongs by meaning. `create or replace view`
-- matches the existing columns by position, so inserting one in the middle
-- is read as renaming `scheduled_start` to `category` and refused. New
-- columns append; the tidy order would need the view dropped, and dropping
-- it takes everything built on it with it.

create or replace view jobs_safe as
select
  j.id, j.org_id, j.job_number, j.customer_id, j.site_id, j.template_id,
  j.title, j.description, j.status, j.priority,
  j.scheduled_start, j.scheduled_end, j.actual_start, j.actual_end,
  case when has_permission('price.view') then j.quoted_price end as quoted_price,
  case when has_permission('price.view') then job_contract_price(j.id) end as contract_price,
  case when has_permission('price.view') then job_change_order_total(j.id) end as change_order_total,
  j.insurance_claim_no, j.adjuster_contact, j.recurrence_rule, j.parent_job_id,
  j.blocked_reason, j.cancelled_reason, j.created_by, j.created_at, j.updated_at,
  j.settlement_method, j.settled_at, j.settled_by,
  j.category
from jobs j
where j.deleted_at is null
  and j.org_id = auth_org_id()
  and can_see_job(j.id);

comment on view jobs_safe is
  'Jobs as a field user may read them: price masked unless price.view. Definer '
  'rights, org filter applied explicitly. Adding a column to jobs means adding '
  'it here too — the list is explicit and a missing column reads as a 404.';

-- ---------------------------------------------------------------------------
-- Booking one
-- ---------------------------------------------------------------------------
--
-- Dropped and recreated rather than `create or replace`, because a changed
-- parameter list makes a second function rather than replacing the first,
-- and two overloads differing by one defaulted argument are ambiguous to
-- call — every booking would start failing at once.

drop function if exists create_job_with_site(
  uuid, text, text, uuid, text, text, text, text, text, text,
  timestamptz, timestamptz, text, uuid, job_priority, numeric, uuid[]);
drop function if exists create_job(
  uuid, uuid, text, timestamptz, timestamptz, text, uuid, job_priority, numeric, uuid[]);

create function create_job(
  p_customer_id uuid,
  p_site_id uuid,
  p_title text,
  p_scheduled_start timestamptz,
  p_scheduled_end timestamptz default null,
  p_description text default null,
  p_template_id uuid default null,
  p_priority job_priority default 'normal',
  p_quoted_price numeric default null,
  p_crew uuid[] default '{}',
  p_category job_category default 'remediation'
)
returns jobs
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid := auth_org_id();
  v_job jobs;
  v_ok int;
begin
  if not has_permission('job.edit') then
    raise exception 'Not permitted: creating a job needs job.edit'
      using errcode = '42501';
  end if;

  if p_title is null or btrim(p_title) = '' then
    raise exception 'A job needs a title' using errcode = '22023';
  end if;
  if p_scheduled_start is null then
    raise exception 'A job needs a day' using errcode = '22023';
  end if;
  if p_scheduled_end is not null and p_scheduled_end < p_scheduled_start then
    raise exception 'The job ends before it starts' using errcode = '22023';
  end if;

  -- A site under the wrong customer is the mistake that produces a job
  -- history nobody can trust, so it is refused rather than tidied later.
  select count(*) into v_ok from sites
   where id = p_site_id and customer_id = p_customer_id and org_id = v_org
     and deleted_at is null;
  if v_ok = 0 then
    raise exception 'That site does not belong to that customer'
      using errcode = '23503';
  end if;

  insert into jobs (
    org_id, customer_id, site_id, template_id, title, description,
    priority, category, scheduled_start, scheduled_end, quoted_price, created_by
  ) values (
    v_org, p_customer_id, p_site_id, p_template_id, btrim(p_title),
    nullif(btrim(coalesce(p_description, '')), ''),
    coalesce(p_priority, 'normal'), coalesce(p_category, 'remediation'),
    p_scheduled_start, p_scheduled_end,
    p_quoted_price, auth_user_id()
  )
  returning * into v_job;

  perform rebuild_job_visits(v_job.id);

  -- A job created on the calendar is scheduled, not a draft: the draft state
  -- is for work being quoted, and this screen is for work being booked.
  perform transition_job(v_job.id, 'scheduled', 'Created on the calendar');

  if array_length(p_crew, 1) > 0 then
    perform set_job_crew(v_job.id, p_crew);
  end if;

  select * into v_job from jobs where id = v_job.id;
  return v_job;
end;
$fn$;

comment on function create_job(uuid, uuid, text, timestamptz, timestamptz, text, uuid, job_priority, numeric, uuid[], job_category) is
  'Creates a job, cuts its work days, schedules it and optionally assigns a '
  'crew — in one transaction, so a half-made job cannot be left behind.';

create function create_job_with_site(
  -- An existing customer, or the name and number to make one.
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  -- An existing site, or the label and address to make one.
  p_site_id uuid,
  p_site_label text,
  p_site_address1 text,
  p_site_city text,
  p_site_state text,
  p_site_postal text,
  -- The job itself, passed straight through.
  p_title text,
  p_scheduled_start timestamptz,
  p_scheduled_end timestamptz default null,
  p_description text default null,
  p_template_id uuid default null,
  p_priority job_priority default 'normal',
  p_quoted_price numeric default null,
  p_crew uuid[] default '{}',
  p_category job_category default 'remediation'
)
returns jobs
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid := auth_org_id();
  v_customer uuid := p_customer_id;
  v_site uuid := p_site_id;
begin
  -- Making a customer or a site is the office's job, and a separate one from
  -- booking work. Someone who may book but not manage customers can still
  -- book against the ones that exist.
  if (p_customer_id is null or p_site_id is null)
     and not has_permission('customer.manage') then
    raise exception 'Not permitted: adding a customer or site needs customer.manage'
      using errcode = '42501';
  end if;

  if v_customer is null then
    if p_customer_name is null or btrim(p_customer_name) = '' then
      raise exception 'A new customer needs a name' using errcode = '22023';
    end if;
    insert into customers (org_id, name, phone, created_by)
    values (v_org, btrim(p_customer_name),
            nullif(btrim(coalesce(p_customer_phone, '')), ''), auth_user_id())
    returning id into v_customer;
  else
    -- An id from somewhere else is not a licence to read somebody else's
    -- books: this runs with definer rights, so the org check is ours to make.
    perform 1 from customers
     where id = v_customer and org_id = v_org and deleted_at is null;
    if not found then
      raise exception 'No such customer' using errcode = '02000';
    end if;
  end if;

  if v_site is null then
    if p_site_label is null or btrim(p_site_label) = '' then
      raise exception 'A new site needs a label — what the crew will call it'
        using errcode = '22023';
    end if;
    if p_site_address1 is null or btrim(p_site_address1) = '' then
      raise exception 'A new site needs a street address — the crew have to drive there'
        using errcode = '22023';
    end if;
    insert into sites (org_id, customer_id, label, address_line1, city, state,
                       postal_code, created_by)
    values (v_org, v_customer, btrim(p_site_label), btrim(p_site_address1),
            nullif(btrim(coalesce(p_site_city, '')), ''),
            nullif(btrim(coalesce(p_site_state, '')), ''),
            nullif(btrim(coalesce(p_site_postal, '')), ''),
            auth_user_id())
    returning id into v_site;
  else
    perform 1 from sites
     where id = v_site and customer_id = v_customer and org_id = v_org
       and deleted_at is null;
    if not found then
      raise exception 'That site does not belong to that customer'
        using errcode = '22023';
    end if;
  end if;

  return create_job(
    v_customer, v_site, p_title, p_scheduled_start, p_scheduled_end,
    p_description, p_template_id, p_priority, p_quoted_price, p_crew, p_category
  );
end;
$fn$;

comment on function create_job_with_site(uuid, text, text, uuid, text, text, text, text, text, text, timestamptz, timestamptz, text, uuid, job_priority, numeric, uuid[], job_category) is
  'Books a job, making the customer and the site first if they are new — all '
  'in one transaction, so a refused booking leaves nothing behind.';
