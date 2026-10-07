-- 0012 Job state machine, scheduling conflicts, acceptance and rescheduling
--
-- Legal transitions live in a table, not in branching code. Adding a status
-- later is a row, and every guard stays in one readable place.

create table job_transitions (
  from_status job_status not null,
  to_status job_status not null,
  required_permission text not null,
  guard text,
  primary key (from_status, to_status)
);

insert into job_transitions (from_status, to_status, required_permission, guard) values
  ('draft',         'scheduled',     'job.edit',        'scheduled'),
  ('scheduled',     'assigned',      'job.assign',      'assigned'),
  ('scheduled',     'cancelled',     'job.edit',        'reason'),
  ('assigned',      'accepted',      'job.accept',      'all_accepted'),
  ('assigned',      'scheduled',     'job.assign',      null),
  ('assigned',      'cancelled',     'job.edit',        'reason'),
  ('accepted',      'en_route',      'job.accept',      null),
  ('accepted',      'cancelled',     'job.edit',        'reason'),
  ('en_route',      'on_site',       'job.accept',      null),
  ('en_route',      'cancelled',     'job.edit',        'reason'),
  ('on_site',       'in_progress',   'job.accept',      null),
  ('on_site',       'blocked',       'job.accept',      'reason'),
  ('in_progress',   'blocked',       'job.accept',      'reason'),
  ('in_progress',   'work_complete', 'job.complete',    'completion'),
  ('in_progress',   'cancelled',     'job.edit',        'reason'),
  ('blocked',       'in_progress',   'job.accept',      null),
  ('blocked',       'cancelled',     'job.edit',        'reason'),
  ('work_complete', 'in_progress',   'job.review',      'reason'),
  ('work_complete', 'approved',      'job.review',      null),
  ('approved',      'closed',        'job.close',       null);

-- ---------------------------------------------------------------------------
-- Scheduling conflicts
-- ---------------------------------------------------------------------------

-- Returns the reasons a user cannot work the given window. Empty array means
-- no conflict. Surfaced at assignment time rather than discovered by a crew
-- standing in a driveway.
create or replace function scheduling_conflicts(
  p_user_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_exclude_job_id uuid default null
)
returns text[]
language sql
stable
as $$
  select coalesce(array_agg(reason), '{}')
  from (
    select 'Approved time off (' || t.kind || ') ' ||
           to_char(t.starts_at, 'Mon DD') || ' to ' || to_char(t.ends_at, 'Mon DD') as reason
    from time_off t
    where t.user_id = p_user_id
      and t.status = 'approved'
      and tstzrange(t.starts_at, t.ends_at) && tstzrange(p_start, p_end)

    union all

    select 'Already assigned to ' || j.job_number || ' (' || j.title || ')' as reason
    from job_assignments a
    join jobs j on j.id = a.job_id
    left join job_visits v on v.id = a.visit_id
    where a.user_id = p_user_id
      and j.deleted_at is null
      and j.status not in ('cancelled', 'closed')
      and (p_exclude_job_id is null or j.id <> p_exclude_job_id)
      and tstzrange(
            coalesce(v.scheduled_start, j.scheduled_start),
            coalesce(v.scheduled_end, j.scheduled_end)
          ) && tstzrange(p_start, p_end)
  ) c;
$$;

-- Equipment of a given category free for the whole window. Used by the
-- scheduler so a scrubber staged at another site until Thursday is simply not
-- offered for a Wednesday job.
--
-- Custody and planning are different questions and are answered differently.
-- The exclusion constraint on equipment_assignments uses the ACTUAL end, so a
-- unit is in exactly one place until someone physically collects it. Planning
-- uses the EXPECTED end, so a scrubber due back tomorrow can be scheduled for
-- next week. equipment_overdue is what reconciles the two when reality lags
-- the plan.
create or replace function available_equipment(
  p_org_id uuid,
  p_category equipment_category,
  p_start timestamptz,
  p_end timestamptz
)
returns setof equipment
language sql
stable
as $$
  select e.*
  from equipment e
  where e.org_id = p_org_id
    and e.category = p_category
    and e.lifecycle_status = 'active'
    and not exists (
      select 1
      from equipment_assignments a
      where a.equipment_id = e.id
        and tstzrange(
              a.started_at,
              coalesce(a.ended_at, a.expected_end_at, 'infinity'::timestamptz)
            ) && tstzrange(p_start, p_end)
    );
$$;

-- ---------------------------------------------------------------------------
-- Completion gate
-- ---------------------------------------------------------------------------

-- Returns the list of outstanding requirements blocking work_complete. The
-- mobile completion screen renders this directly, so the gate directs rather
-- than merely refuses.
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
    v_blockers := array_append(v_blockers, 'Customer completion signature required');
  end if;

  -- Required forms are listed by template key.
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

  -- Everyone must be clocked out, or the labour cost for this job is wrong
  -- and the person stays on the clock overnight.
  if exists (
    select 1 from time_entries where job_id = p_job_id and clock_out_at is null
  ) then
    v_blockers := array_append(v_blockers, 'Open time entries — everyone must be clocked out');
  end if;

  -- The gate that stops air scrubbers being forgotten at finished jobs:
  -- equipment may remain on site only if a collection is actually scheduled.
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

  if exists (
    select 1 from equipment_rentals
    where job_id = p_job_id
      and status in ('on_hire', 'overdue')
      and return_due_at is null
  ) then
    v_blockers := array_append(v_blockers, 'Rented equipment outstanding with no return date');
  end if;

  return v_blockers;
end;
$$;

-- ---------------------------------------------------------------------------
-- The one way a job status changes
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
        when p_to_status = 'on_site' and actual_start is null then now()
        else actual_start end,
      actual_end = case
        when p_to_status = 'work_complete' then now()
        else actual_end end
  where id = p_job_id
  returning * into v_job;

  insert into job_status_history (org_id, job_id, from_status, to_status, changed_by, note)
  values (v_job.org_id, p_job_id, v_rule.from_status, p_to_status, auth_user_id(), p_note);

  return v_job;
end;
$$;

-- ---------------------------------------------------------------------------
-- Acceptance and rescheduling
-- ---------------------------------------------------------------------------

create or replace function accept_assignment(p_assignment_id uuid)
returns job_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment job_assignments;
  v_pending int;
begin
  update job_assignments
  set acceptance_status = 'accepted', responded_at = now()
  where id = p_assignment_id
    and user_id = coalesce(auth_user_id(), user_id)
  returning * into v_assignment;

  if v_assignment.id is null then
    raise exception 'Assignment % not found for this user', p_assignment_id
      using errcode = 'P0002';
  end if;

  -- Once everyone has accepted, the job advances on its own.
  select count(*) into v_pending
  from job_assignments
  where job_id = v_assignment.job_id and acceptance_status <> 'accepted';

  if v_pending = 0 then
    perform transition_job(v_assignment.job_id, 'accepted');
  end if;

  return v_assignment;
end;
$$;

create or replace function request_reschedule(
  p_assignment_id uuid,
  p_reason text,
  p_proposed_start timestamptz default null,
  p_proposed_end timestamptz default null
)
returns reschedule_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment job_assignments;
  v_request reschedule_requests;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required' using errcode = 'check_violation';
  end if;

  select * into v_assignment from job_assignments where id = p_assignment_id;
  if v_assignment.id is null then
    raise exception 'Assignment % not found', p_assignment_id using errcode = 'P0002';
  end if;

  update job_assignments
  set acceptance_status = 'reschedule_requested', responded_at = now()
  where id = p_assignment_id;

  insert into reschedule_requests (
    org_id, job_id, assignment_id, requested_by, reason, proposed_start, proposed_end
  )
  values (
    v_assignment.org_id, v_assignment.job_id, p_assignment_id,
    coalesce(auth_user_id(), v_assignment.user_id),
    p_reason, p_proposed_start, p_proposed_end
  )
  returning * into v_request;

  return v_request;
end;
$$;

create or replace function decide_reschedule(
  p_request_id uuid,
  p_approve boolean,
  p_reason text default null
)
returns reschedule_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request reschedule_requests;
  v_job jobs;
begin
  if not has_permission('reschedule.decide') then
    raise exception 'Permission reschedule.decide required'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_request from reschedule_requests where id = p_request_id for update;
  if v_request.id is null then
    raise exception 'Reschedule request % not found', p_request_id using errcode = 'P0002';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Request already %', v_request.status using errcode = 'check_violation';
  end if;

  if not p_approve and (p_reason is null or length(trim(p_reason)) = 0) then
    raise exception 'A reason is required to decline' using errcode = 'check_violation';
  end if;

  update reschedule_requests
  set status = case when p_approve then 'approved' else 'declined' end::reschedule_status,
      decided_by = auth_user_id(),
      decided_at = now(),
      decision_reason = p_reason
  where id = p_request_id
  returning * into v_request;

  if p_approve and v_request.proposed_start is not null then
    update jobs
    set scheduled_start = v_request.proposed_start,
        scheduled_end = coalesce(v_request.proposed_end, v_request.proposed_start)
    where id = v_request.job_id
    returning * into v_job;

    -- The move invalidates every acceptance, not just the requester's: the
    -- others agreed to a different time.
    update job_assignments
    set acceptance_status = 'pending', responded_at = null
    where job_id = v_request.job_id;

    if v_job.status in ('accepted', 'assigned') then
      update jobs set status = 'assigned' where id = v_request.job_id;
    end if;
  else
    update job_assignments
    set acceptance_status = 'pending'
    where id = v_request.assignment_id;
  end if;

  return v_request;
end;
$$;
