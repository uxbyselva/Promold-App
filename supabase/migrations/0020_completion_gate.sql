-- 0020 A completion gate that directs rather than obstructs
--
-- The gate had four items on it at the end of a three-day job, and two of them
-- were not the crew's to resolve:
--
--   "1 person still clocked in" — clocking out is the last thing you do, and
--   so is marking the job complete, so the app demanded one before allowing
--   the other with no obvious order. Worse, a crew lead could not finish the
--   job until two colleagues each remembered to tap a button on their own
--   phones. A blocker that depends on other people's housekeeping is the kind
--   that gets an app uninstalled.
--
--   "Rental still out — set a return" — vendor returns are arranged by the
--   office, not by a crew standing in a driveway at 4pm.
--
-- Completing the job IS the signal that work stopped, so completion now
-- closes the clocks itself, stamped at the completion time — more accurate
-- than whenever each person remembered. What remains blocking is what only
-- the crew can supply and what cannot be reconstructed later: the after
-- photos and the customer's signature.

alter table time_entries
  add column auto_closed boolean not null default false;

comment on column time_entries.auto_closed is
  'Clocked out by job completion rather than by the person. Visible so a '
  'manager can spot and correct a shift that really did run longer.';

-- ---------------------------------------------------------------------------
-- Blocking: only what the crew alone can supply, and only what cannot be
-- reconstructed once they have driven away.
-- ---------------------------------------------------------------------------

create or replace function job_completion_blockers(p_job_id uuid)
returns text[]
language plpgsql
stable
as $$
declare
  v_job jobs;
  v_req jsonb;
  v_blockers text[] := '{}';
  v_form jsonb;
  v_pending int;
begin
  select * into v_job from jobs where id = p_job_id;
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

-- ---------------------------------------------------------------------------
-- Warnings: true, worth saying, nobody's reason to stand in a driveway.
-- ---------------------------------------------------------------------------

create or replace function job_completion_warnings(p_job_id uuid)
returns text[]
language plpgsql
stable
as $$
declare
  v_warnings text[] := '{}';
  v_open int;
  v_rentals int;
begin
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
  'Things worth telling the crew at completion that are not theirs to fix. '
  'Shown as information; never refuses the transition.';

-- ---------------------------------------------------------------------------
-- Completing a job closes the clocks and flags the office
-- ---------------------------------------------------------------------------

create or replace function transition_job(
  p_job_id uuid,
  p_to_status job_status,
  p_note text default null
)
returns jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job jobs;
  v_rule job_transitions;
  v_blockers text[];
  v_pending int;
  v_manager uuid;
begin
  select * into v_job from jobs where id = p_job_id and deleted_at is null
  for update;

  if v_job.id is null then
    raise exception 'Job % not found', p_job_id using errcode = 'P0002';
  end if;

  if v_job.status = p_to_status then
    return v_job;
  end if;

  select * into v_rule from job_transitions
  where from_status = v_job.status and to_status = p_to_status;

  if v_rule.from_status is null then
    raise exception 'Illegal job transition % -> %', v_job.status, p_to_status
      using errcode = 'check_violation';
  end if;

  if not v_rule.enabled then
    raise exception 'Transition % -> % is not enabled for this organisation',
      v_job.status, p_to_status
      using errcode = 'check_violation';
  end if;

  if not has_permission(v_rule.required_permission) then
    raise exception 'Permission % required to move job % -> %',
      v_rule.required_permission, v_job.status, p_to_status
      using errcode = 'insufficient_privilege';
  end if;

  if v_rule.guard = 'reason' and (p_note is null or length(trim(p_note)) = 0) then
    raise exception 'A reason is required to move job % -> %', v_job.status, p_to_status
      using errcode = 'check_violation';
  end if;

  if v_rule.guard = 'scheduled'
     and (v_job.scheduled_start is null or v_job.scheduled_end is null) then
    raise exception 'Job must have a scheduled window before it can be scheduled'
      using errcode = 'check_violation';
  end if;

  if v_rule.guard = 'assigned'
     and not exists (select 1 from job_assignments where job_id = p_job_id) then
    raise exception 'Job must have at least one assignee'
      using errcode = 'check_violation';
  end if;

  if v_rule.guard = 'all_accepted' then
    select count(*) into v_pending
    from job_assignments
    where job_id = p_job_id and acceptance_status <> 'accepted';
    if v_pending > 0 then
      raise exception '% assignee(s) have not accepted', v_pending
        using errcode = 'check_violation';
    end if;
  end if;

  if v_rule.guard = 'completion' then
    v_blockers := job_completion_blockers(p_job_id);
    if array_length(v_blockers, 1) > 0 then
      raise exception 'Job cannot be completed: %', array_to_string(v_blockers, '; ')
        using errcode = 'check_violation';
    end if;
  end if;

  update jobs
  set status = p_to_status,
      blocked_reason   = case when p_to_status = 'blocked' then p_note else null end,
      cancelled_reason = case when p_to_status = 'cancelled' then p_note else cancelled_reason end,
      actual_start = case
        when p_to_status in ('on_site', 'in_progress') and actual_start is null then now()
        else actual_start end,
      actual_end = case
        when p_to_status = 'work_complete' then now()
        else actual_end end
  where id = p_job_id
  returning * into v_job;

  -- Finishing the job is the truthful clock-out moment. Marked auto_closed so
  -- a manager can see which stamps the app supplied and correct any that
  -- really did run longer.
  if p_to_status = 'work_complete' then
    update time_entries
    set clock_out_at = now(), auto_closed = true
    where job_id = p_job_id and clock_out_at is null;

    -- A rental still out is the office's to chase, so tell the office.
    for v_manager in
      select p.id from profiles p
      join roles r on r.id = p.role_id
      where p.org_id = v_job.org_id and p.is_active
        and coalesce((r.permissions ->> 'equipment.rental_manage')::boolean, false)
    loop
      insert into notifications (org_id, user_id, kind, title, body, payload)
      select v_job.org_id, v_manager, 'rental_outstanding',
             'Rental still out on a finished job',
             v_job.job_number || ' is complete with ' || count(*) || ' rental(s) not returned',
             jsonb_build_object('job_id', p_job_id)
      from equipment_rentals
      where job_id = p_job_id and status in ('on_hire', 'overdue')
      having count(*) > 0;
    end loop;
  end if;

  insert into job_status_history (org_id, job_id, from_status, to_status, changed_by, note)
  values (v_job.org_id, p_job_id, v_rule.from_status, p_to_status, auth_user_id(), p_note);

  return v_job;
end;
$$;
