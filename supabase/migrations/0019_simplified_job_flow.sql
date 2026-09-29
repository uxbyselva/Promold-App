-- 0019 A shorter job flow, without closing the door on the longer one
--
-- The crew wants three steps: accept, on site and working, done. The full
-- lifecycle stays in the enum — en_route, on_site and blocked are all still
-- valid values, and any history already recorded against them stays readable.
-- What changes is which moves are offered, and that is now data.
--
-- To bring a step back later:
--
--   update job_transitions set enabled = true
--   where (from_status, to_status) in (('accepted','en_route'), ('en_route','on_site'));
--   update organizations set settings = jsonb_set(
--     settings, '{job_steps}',
--     '["accepted","en_route","on_site","in_progress","work_complete"]');
--
-- One UPDATE. No migration, no deploy, no app release.

alter table job_transitions
  add column enabled boolean not null default true;

comment on column job_transitions.enabled is
  'Whether this move is offered. Disabled moves stay in the table so the '
  'longer flow can be switched back on without a migration.';

-- Accept straight into work, skipping the en-route and arrival steps.
insert into job_transitions (from_status, to_status, required_permission, guard, enabled)
values ('accepted', 'in_progress', 'job.accept', null, true)
on conflict (from_status, to_status) do update set enabled = true;

-- The steps this crew does not use. Nothing is deleted.
update job_transitions
set enabled = false
where (from_status, to_status) in (
  ('accepted',    'en_route'),
  ('en_route',    'on_site'),
  ('en_route',    'cancelled'),
  ('on_site',     'in_progress'),
  ('on_site',     'blocked'),
  ('in_progress', 'blocked'),
  ('blocked',     'in_progress'),
  ('blocked',     'cancelled')
);

-- Which steps the crew's progress track shows, in order. Read by the clients;
-- the enabled column above is what actually enforces it.
update organizations
set settings = settings || jsonb_build_object(
  'job_steps', jsonb_build_array('accepted', 'in_progress', 'work_complete'),
  -- Two galleries: what it looked like before, and what it looked like after.
  -- 'during' stays a valid photo_phase, it is simply not offered.
  'photo_phases', jsonb_build_array('before', 'after')
);

-- ---------------------------------------------------------------------------
-- The transition function honours it
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

  -- A move that exists but is switched off for this org.
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
      -- Arrival is whichever of these the org's flow reaches first: with the
      -- short flow there is no separate on-site step, so starting work is
      -- when the crew got there.
      actual_start = case
        when p_to_status in ('on_site', 'in_progress') and actual_start is null then now()
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

-- What the clients should offer from here, already filtered.
create or replace function job_next_steps(p_job_id uuid)
returns table (to_status job_status, required_permission text, guard text)
language sql
stable
as $$
  select t.to_status, t.required_permission, t.guard
  from job_transitions t
  join jobs j on j.id = p_job_id
  where t.from_status = j.status and t.enabled;
$$;
