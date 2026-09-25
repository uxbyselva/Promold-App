-- 0024 Answering the crew
--
-- The field app lets a crew member ask to move a job and ask for time off.
-- Until now nothing could answer either: `decide_reschedule` existed but
-- moved a job without re-cutting its work days, and time off had no decision
-- function at all — only a raw update that could leave `decided_by` blank and
-- a decline with no reason.
--
-- A request nobody can answer is worse than no request: the crew learn the
-- app does not work and go back to phoning.

-- ---------------------------------------------------------------------------
-- Moving a job un-agrees it
-- ---------------------------------------------------------------------------

-- Accepting is agreeing to a time. Change the time and the agreement lapses,
-- which means the job is back to waiting on people rather than settled.
insert into job_transitions (from_status, to_status, required_permission, guard, enabled)
values ('accepted', 'assigned', 'job.assign', null, true)
on conflict (from_status, to_status) do update
  set required_permission = excluded.required_permission,
      enabled = true;

-- Used wherever a job's time changes. Resets every acceptance — not only the
-- person who asked, because the others agreed to the old time too — and steps
-- the status back if the job had been fully accepted.
create or replace function unaccept_job(p_job_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_status job_status;
begin
  update job_assignments
     set acceptance_status = 'pending', responded_at = null
   where job_id = p_job_id
     and acceptance_status <> 'pending';

  select status into v_status from jobs where id = p_job_id;

  -- Only the office can put a job back to 'assigned'. Anyone else changing a
  -- time still un-agrees it; the status simply stays where it was rather than
  -- the whole decision failing on a permission check.
  if v_status = 'accepted' and has_permission('job.assign') then
    perform transition_job(p_job_id, 'assigned',
                           coalesce(p_note, 'Time changed — everyone re-accepts'));
  end if;
end;
$fn$;

comment on function unaccept_job(uuid, text) is
  'Resets every acceptance on a job and steps it back from accepted to '
  'assigned. Called wherever a job''s time changes.';

-- 0023 reset acceptance itself; route it through the shared rule instead, so
-- the status follows too.
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
declare
  v_job jobs;
  v_moved boolean;
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

  v_moved := p_scheduled_start is distinct from v_job.scheduled_start
          or p_scheduled_end is distinct from v_job.scheduled_end;

  update jobs
     set scheduled_start = p_scheduled_start,
         scheduled_end = p_scheduled_end
   where id = p_job_id;

  perform rebuild_job_visits(p_job_id);

  if v_moved then
    perform unaccept_job(p_job_id, coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Rescheduled'));

    insert into job_status_history (org_id, job_id, from_status, to_status, changed_by, note)
    values (v_job.org_id, p_job_id, v_job.status, v_job.status, auth_user_id(),
            coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Rescheduled'));
  end if;

  select * into v_job from jobs where id = p_job_id;
  return v_job;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Deciding a reschedule request
-- ---------------------------------------------------------------------------

-- Replaces the 0012 version. Two things were wrong with it: approving moved
-- the job without re-cutting its work days, so a three-day job kept the old
-- three days on everyone's calendar; and it wrote `jobs.status` directly,
-- which is the one thing nothing in this schema is allowed to do.
--
-- It also now takes the new time from whoever is deciding. The crew member
-- knows Tuesday does not work; the office is the one who knows what else is
-- booked, so they pick the slot.
create or replace function decide_reschedule(
  p_request_id uuid,
  p_approve boolean,
  p_reason text default null,
  p_new_start timestamptz default null,
  p_new_end timestamptz default null
)
returns reschedule_requests
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_request reschedule_requests;
  v_start timestamptz;
  v_end timestamptz;
begin
  if not has_permission('reschedule.decide') then
    raise exception 'Not permitted: deciding this needs reschedule.decide'
      using errcode = '42501';
  end if;

  select * into v_request from reschedule_requests
   where id = p_request_id and org_id = auth_org_id()
   for update;
  if not found then
    raise exception 'No such request' using errcode = '02000';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'That request was already %', v_request.status
      using errcode = '22023';
  end if;
  if not p_approve and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'Say why, so they are not left guessing'
      using errcode = '22023';
  end if;

  -- The decider's time wins; the requester's proposal is the fallback.
  v_start := coalesce(p_new_start, v_request.proposed_start);
  v_end := coalesce(p_new_end, v_request.proposed_end);

  if p_approve and v_start is null then
    raise exception 'Approving needs a new time — they asked to move it, not to drop it'
      using errcode = '22023';
  end if;

  update reschedule_requests
     set status = case when p_approve then 'approved' else 'declined' end::reschedule_status,
         decided_by = auth_user_id(),
         decided_at = now(),
         decision_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_request_id
   returning * into v_request;

  if p_approve then
    -- Goes through the same door the office uses, so the work days follow and
    -- everyone re-accepts.
    perform reschedule_job(v_request.job_id, v_start, v_end,
                           'Moved after a reschedule request');
  else
    -- Declined: the job stays where it is, and the person who asked still has
    -- to answer it.
    update job_assignments
       set acceptance_status = 'pending', responded_at = null
     where id = v_request.assignment_id;
  end if;

  return v_request;
end;
$fn$;

comment on function decide_reschedule(uuid, boolean, text, timestamptz, timestamptz) is
  'Approve with a new time, or decline with a reason. Approving moves the job '
  'through reschedule_job(), so the work days are re-cut and every acceptance '
  'resets.';

-- ---------------------------------------------------------------------------
-- Deciding time off
-- ---------------------------------------------------------------------------

-- The jobs someone is already booked on inside a window. Shown to the person
-- asking before they send it, and to whoever is deciding — the same list, so
-- neither side is surprised.
create or replace function time_off_clashes(p_request_id uuid)
returns table (
  job_id uuid,
  job_number text,
  title text,
  scheduled_start timestamptz,
  scheduled_end timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare v_req time_off;
begin
  select * into v_req from time_off
   where id = p_request_id and org_id = auth_org_id();
  if not found then
    return;
  end if;

  -- Their own request, or someone whose job it is to decide it.
  if v_req.user_id <> auth_user_id() and not has_permission('timeoff.manage') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;

  return query
  select j.id, j.job_number, j.title, j.scheduled_start, j.scheduled_end
    from job_assignments a
    join jobs j on j.id = a.job_id
   where a.user_id = v_req.user_id
     and j.deleted_at is null
     and j.status not in ('cancelled', 'closed')
     and j.scheduled_start is not null
     and tstzrange(j.scheduled_start, coalesce(j.scheduled_end, j.scheduled_start), '[]')
         && tstzrange(v_req.starts_at, v_req.ends_at, '[]')
   order by j.scheduled_start;
end;
$fn$;

comment on function time_off_clashes(uuid) is
  'The jobs this person is already booked on inside the requested window. '
  'Same list for the requester and the decider.';

create or replace function decide_time_off(
  p_request_id uuid,
  p_approve boolean,
  p_reason text default null
)
returns time_off
language plpgsql
security definer
set search_path = public
as $fn$
declare v_req time_off;
begin
  if not has_permission('timeoff.manage') then
    raise exception 'Not permitted: deciding time off needs timeoff.manage'
      using errcode = '42501';
  end if;

  select * into v_req from time_off
   where id = p_request_id and org_id = auth_org_id()
   for update;
  if not found then
    raise exception 'No such request' using errcode = '02000';
  end if;
  if v_req.status <> 'requested' then
    raise exception 'That request was already %', v_req.status using errcode = '22023';
  end if;

  -- A decline with no reason is how people stop asking, and then stop telling
  -- you they will not be there.
  if not p_approve and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'Say why. They read this on their phone.'
      using errcode = '22023';
  end if;

  -- Deliberately does NOT refuse over a booked job, and deliberately does not
  -- move that job either. Approving records that the person will not be
  -- there; reassigning someone else's work is a decision, not a side effect.
  -- From this moment the scheduling conflict check refuses new bookings for
  -- those dates.
  update time_off
     set status = case when p_approve then 'approved' else 'declined' end::time_off_status,
         decided_by = auth_user_id(),
         decided_at = now(),
         decision_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_request_id
   returning * into v_req;

  return v_req;
end;
$fn$;

comment on function decide_time_off(uuid, boolean, text) is
  'Approve or decline time off, recording who and when. A decline needs a '
  'reason. Never moves work that is already booked — that is a separate '
  'decision.';
