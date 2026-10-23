-- 0030 The completion gate has to be readable by the person it is for
--
-- `job_completion_blockers()` and `job_completion_warnings()` both start with
--
--   select * into v_job from jobs where id = p_job_id;
--
-- and 0027 revoked the price columns on `jobs` from the signed-in role, which
-- makes `select *` there fail by design. Both functions are invoker-rights, so
-- since 0027 every client call has raised
--
--   permission denied for table jobs
--
-- The write path was never affected: `transition_job()` is security definer,
-- so when it checks the gate internally the check runs with its own rights. A
-- job missing its photos could not be completed and still cannot be.
--
-- What broke is the screen that exists to tell a crew what is missing *before
-- they drive away*. The error came back as a null list, the app read that as
-- an empty list, and the completion card said "Nothing outstanding" over an
-- enabled button. Tapping it got a refusal from the server naming a photo
-- nobody had been asked for. The gate was never open; it just stopped
-- explaining itself.
--
-- Definer rights, and a visibility check of their own — a definer function is
-- reachable with any job id, and `can_see_job()` is the same test RLS applies
-- to the row.

create or replace function job_completion_blockers(p_job_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_job jobs;
  v_req jsonb;
  v_blockers text[] := '{}';
  v_form jsonb;
  v_pending int;
begin
  -- Only a client call needs checking. A direct database session — a
  -- migration, a maintenance query, the assertion suite — has no jwt claim at
  -- all, and refusing those would make the function unusable from psql for no
  -- gain: anyone with a database session can read the table anyway.
  if auth_user_id() is not null and not can_see_job(p_job_id) then
    return array['Job not found'];
  end if;

  select * into v_job from jobs where id = p_job_id and deleted_at is null;
  if v_job.id is null then
    return array['Job not found'];
  end if;

  select coalesce(t.completion_requirements, '{}'::jsonb) into v_req
  from job_templates t where t.id = v_job.template_id;
  v_req := coalesce(v_req, '{}'::jsonb);

  if coalesce((v_req ->> 'photos_before')::boolean, false)
     and not exists (
       select 1 from job_photos
       where job_id = p_job_id and phase = 'before' and deleted_at is null
     ) then
    v_blockers := array_append(v_blockers, 'Before photos required');
  end if;

  if coalesce((v_req ->> 'photos_after')::boolean, false)
     and not exists (
       select 1 from job_photos
       where job_id = p_job_id and phase = 'after' and deleted_at is null
     ) then
    v_blockers := array_append(v_blockers, 'After photos required');
  end if;

  if coalesce((v_req ->> 'customer_signature')::boolean, false)
     and not exists (
       select 1 from signatures where job_id = p_job_id and kind = 'completion'
     ) then
    v_blockers := array_append(v_blockers, 'Customer sign-off required');
  end if;

  for v_form in select * from jsonb_array_elements(coalesce(v_req -> 'forms', '[]'::jsonb)) loop
    if not exists (
      select 1
      from form_submissions s
      join form_templates ft on ft.id = s.template_id
      where s.job_id = p_job_id
        and ft.key = (v_form #>> '{}')
        and s.is_complete
    ) then
      v_blockers := array_append(v_blockers, 'Form not complete: ' || (v_form #>> '{}'));
    end if;
  end loop;

  -- Equipment left at a site with no collection arranged stays blocking. It is
  -- the one thing on this list that becomes invisible the moment the crew
  -- leaves, and a forgotten scrubber costs more than the tap it takes to set
  -- a date. The completion screen offers "schedule pickup" inline.
  if exists (
    select 1
    from equipment_assignments a
    where a.job_id = p_job_id
      and a.kind = 'site_staging'
      and a.ended_at is null
      and a.expected_end_at is null
  ) then
    v_blockers := array_append(v_blockers,
      'Equipment still staged at site with no pickup scheduled');
  end if;

  -- Money the customer has not answered on yet. Once the crew drives away it
  -- is never collected, so this one is worth the friction.
  select count(*) into v_pending
  from change_orders where job_id = p_job_id and status in ('draft', 'presented');

  if v_pending > 0 then
    v_blockers := array_append(v_blockers,
      v_pending || ' change order(s) not yet agreed with the customer');
  end if;

  return v_blockers;
end;
$$;

comment on function job_completion_blockers(uuid) is
  'What stands between this job and done. Definer rights because it reads '
  'jobs, whose price columns are revoked from the signed-in role; gated on '
  'can_see_job(), which is the same test RLS applies to the row.';

create or replace function job_completion_warnings(p_job_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_warnings text[] := '{}';
  v_open int;
  v_rentals int;
begin
  -- Same as the blockers: a session with no jwt claim is not a client call.
  if auth_user_id() is not null and not can_see_job(p_job_id) then
    return '{}';
  end if;

  select count(*) into v_open
  from time_entries where job_id = p_job_id and clock_out_at is null;

  if v_open > 0 then
    v_warnings := array_append(v_warnings,
      v_open || ' person(s) will be clocked out now');
  end if;

  -- Any rental still with us at completion, date set or not. "Job finished,
  -- vendor still has gear out" is the signal the office needs; whether a
  -- return date exists is a detail.
  select count(*) into v_rentals
  from equipment_rentals
  where job_id = p_job_id
    and status in ('on_hire', 'overdue');

  if v_rentals > 0 then
    v_warnings := array_append(v_warnings,
      v_rentals || ' rental(s) still out — the office will be told');
  end if;

  return v_warnings;
end;
$$;

comment on function job_completion_warnings(uuid) is
  'True, worth saying, nobody''s reason to stand in a driveway. Definer for '
  'the same reason as the blockers, and gated the same way.';
