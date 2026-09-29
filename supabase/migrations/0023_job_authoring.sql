-- 0023 Creating and editing a job
--
-- Putting work on the calendar is three writes that have to agree: the job,
-- the work days behind it, and who is going. Doing that from a client leaves
-- half-made jobs behind whenever a tab closes at the wrong moment, and leaves
-- each client free to invent its own idea of what a valid job is.
--
-- So it is one function per intent, and the rules sit with the data:
--
--   * a site has to belong to the customer it is booked under;
--   * a multi-day job produces one visit per day, not one visit;
--   * nobody is assigned over approved time off, ever;
--   * a double booking is refused but can be overridden deliberately, because
--     sometimes two short jobs really do fit and only the manager knows.

-- ---------------------------------------------------------------------------
-- Work days
-- ---------------------------------------------------------------------------

-- Rebuilds the visits for a job from its scheduled range: one per calendar
-- day, each keeping the job's own start and end times. A one-day job gets
-- exactly one. Visits that already have work recorded against them are left
-- alone rather than silently replaced.
create or replace function rebuild_job_visits(p_job_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_job jobs;
  v_day date;
  v_last date;
  v_seq int := 0;
  v_start timestamptz;
  v_end timestamptz;
begin
  select * into v_job from jobs where id = p_job_id;
  if not found then
    raise exception 'No such job' using errcode = '02000';
  end if;
  if v_job.scheduled_start is null then
    return 0;
  end if;

  -- Anything already under way keeps its visit; re-cutting the days under a
  -- crew who are standing in the basement is not a scheduling change.
  delete from job_visits
   where job_id = p_job_id
     and status = 'scheduled'
     and not exists (select 1 from time_entries t where t.visit_id = job_visits.id);

  v_day := (v_job.scheduled_start at time zone 'UTC')::date;
  v_last := (coalesce(v_job.scheduled_end, v_job.scheduled_start) at time zone 'UTC')::date;

  while v_day <= v_last loop
    v_seq := v_seq + 1;

    -- Keep the job's clock times, moved onto this day.
    v_start := v_day + (v_job.scheduled_start at time zone 'UTC')::time;
    v_end := v_day + (coalesce(v_job.scheduled_end, v_job.scheduled_start + interval '4 hours')
                      at time zone 'UTC')::time;
    if v_end <= v_start then
      v_end := v_start + interval '4 hours';
    end if;

    insert into job_visits (org_id, job_id, seq, scheduled_start, scheduled_end)
    values (v_job.org_id, p_job_id, v_seq, v_start, v_end)
    on conflict (job_id, seq) do update
      set scheduled_start = excluded.scheduled_start,
          scheduled_end = excluded.scheduled_end;

    v_day := v_day + 1;
  end loop;

  -- A job that got shorter should not keep the days it no longer runs.
  delete from job_visits
   where job_id = p_job_id
     and seq > v_seq
     and status = 'scheduled'
     and not exists (select 1 from time_entries t where t.visit_id = job_visits.id);

  return v_seq;
end;
$fn$;

comment on function rebuild_job_visits(uuid) is
  'One visit per calendar day the job runs, keeping its clock times. Leaves '
  'visits that already have time logged against them.';

-- ---------------------------------------------------------------------------
-- Who is going
-- ---------------------------------------------------------------------------

create or replace function set_job_crew(
  p_job_id uuid,
  p_user_ids uuid[],
  p_force boolean default false
)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_job jobs;
  v_user uuid;
  v_name text;
  v_conflicts text[];
  v_hard text[] := '{}';
  v_soft text[] := '{}';
  v_kept int := 0;
begin
  if not has_permission('job.assign') then
    raise exception 'Not permitted: assigning work needs job.assign'
      using errcode = '42501';
  end if;

  select * into v_job from jobs where id = p_job_id and org_id = auth_org_id()
    and deleted_at is null;
  if not found then
    raise exception 'No such job' using errcode = '02000';
  end if;
  if v_job.scheduled_start is null then
    raise exception 'Put the job on the calendar before putting people on it'
      using errcode = '22023';
  end if;

  -- Check everyone first and report together. Finding out about the second
  -- clash only after fixing the first is how a three-person crew takes three
  -- attempts to book.
  foreach v_user in array coalesce(p_user_ids, '{}'::uuid[]) loop
    select full_name into v_name from profiles
     where id = v_user and org_id = v_job.org_id and is_active;
    if v_name is null then
      raise exception 'That person is not on the staff list' using errcode = '23503';
    end if;

    v_conflicts := scheduling_conflicts(
      v_user, v_job.scheduled_start,
      coalesce(v_job.scheduled_end, v_job.scheduled_start), p_job_id);

    if v_conflicts is not null then
      -- Approved time off is not a judgement call: they are not there.
      if exists (select 1 from unnest(v_conflicts) c where c ilike '%time off%') then
        v_hard := array_append(v_hard, v_name || ': ' ||
          (select string_agg(c, '; ') from unnest(v_conflicts) c where c ilike '%time off%'));
      end if;
      if exists (select 1 from unnest(v_conflicts) c where c not ilike '%time off%') then
        v_soft := array_append(v_soft, v_name || ': ' ||
          (select string_agg(c, '; ') from unnest(v_conflicts) c where c not ilike '%time off%'));
      end if;
    end if;
  end loop;

  if array_length(v_hard, 1) > 0 then
    raise exception 'Approved time off. %', array_to_string(v_hard, ' / ')
      using errcode = '23514';
  end if;
  if array_length(v_soft, 1) > 0 and not p_force then
    raise exception 'Already booked. %', array_to_string(v_soft, ' / ')
      using errcode = '23505';
  end if;

  -- Anyone dropped from the crew loses their row; anyone kept keeps the
  -- acceptance they already gave, so adding a fourth person does not make the
  -- other three answer again.
  delete from job_assignments
   where job_id = p_job_id
     and not (user_id = any (coalesce(p_user_ids, '{}'::uuid[])));

  foreach v_user in array coalesce(p_user_ids, '{}'::uuid[]) loop
    insert into job_assignments (org_id, job_id, user_id, assigned_by)
    values (v_job.org_id, p_job_id, v_user, auth_user_id())
    on conflict (job_id, user_id, visit_id) do nothing;
  end loop;

  select count(*) into v_kept from job_assignments where job_id = p_job_id;

  -- Having people on it is what "assigned" means, so keep the status honest
  -- in both directions.
  if v_kept > 0 and v_job.status = 'scheduled' then
    perform transition_job(p_job_id, 'assigned', 'Crew set');
  elsif v_kept = 0 and v_job.status = 'assigned' then
    perform transition_job(p_job_id, 'scheduled', 'Crew cleared');
  end if;

  return v_kept;
end;
$fn$;

comment on function set_job_crew(uuid, uuid[], boolean) is
  'Replaces a job''s crew. Refuses approved time off outright; refuses a '
  'double booking unless p_force. Keeps the acceptance of anyone already on.';

-- ---------------------------------------------------------------------------
-- Creating
-- ---------------------------------------------------------------------------

create or replace function create_job(
  p_customer_id uuid,
  p_site_id uuid,
  p_title text,
  p_scheduled_start timestamptz,
  p_scheduled_end timestamptz default null,
  p_description text default null,
  p_template_id uuid default null,
  p_priority job_priority default 'normal',
  p_quoted_price numeric default null,
  p_crew uuid[] default '{}'
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
    priority, scheduled_start, scheduled_end, quoted_price, created_by
  ) values (
    v_org, p_customer_id, p_site_id, p_template_id, btrim(p_title),
    nullif(btrim(coalesce(p_description, '')), ''),
    coalesce(p_priority, 'normal'), p_scheduled_start, p_scheduled_end,
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

comment on function create_job(uuid, uuid, text, timestamptz, timestamptz, text, uuid, job_priority, numeric, uuid[]) is
  'Creates a job, cuts its work days, schedules it and optionally assigns a '
  'crew — in one transaction, so a half-made job cannot be left behind.';

-- ---------------------------------------------------------------------------
-- Editing
-- ---------------------------------------------------------------------------

-- Moving a job is not the same edit as renaming one: the work days have to
-- follow, and everyone who agreed to the old time has to agree again.
create or replace function reschedule_job(
  p_job_id uuid,
  p_scheduled_start timestamptz,
  p_scheduled_end timestamptz default null,
  p_reason text default null
)
returns jobs
language plpgsql
security definer
set search_path = public
as $fn$
declare v_job jobs;
begin
  if not has_permission('job.edit') then
    raise exception 'Not permitted: moving a job needs job.edit'
      using errcode = '42501';
  end if;

  select * into v_job from jobs
   where id = p_job_id and org_id = auth_org_id() and deleted_at is null;
  if not found then
    raise exception 'No such job' using errcode = '02000';
  end if;
  if p_scheduled_end is not null and p_scheduled_end < p_scheduled_start then
    raise exception 'The job ends before it starts' using errcode = '22023';
  end if;

  update jobs
     set scheduled_start = p_scheduled_start,
         scheduled_end = p_scheduled_end
   where id = p_job_id;

  perform rebuild_job_visits(p_job_id);

  -- They agreed to a Tuesday. This is a Thursday.
  if p_scheduled_start is distinct from v_job.scheduled_start
     or p_scheduled_end is distinct from v_job.scheduled_end then
    update job_assignments
       set acceptance_status = 'pending', responded_at = null
     where job_id = p_job_id
       and acceptance_status <> 'pending';

    insert into job_status_history (org_id, job_id, from_status, to_status, changed_by, note)
    values (v_job.org_id, p_job_id, v_job.status, v_job.status, auth_user_id(),
            coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Rescheduled'));
  end if;

  select * into v_job from jobs where id = p_job_id;
  return v_job;
end;
$fn$;

comment on function reschedule_job(uuid, timestamptz, timestamptz, text) is
  'Moves a job, re-cuts its work days and resets everyone''s acceptance — '
  'they agreed to the old time, not this one.';
