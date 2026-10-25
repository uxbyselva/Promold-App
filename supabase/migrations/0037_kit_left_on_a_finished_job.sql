-- 0037 Equipment left on a finished job
--
-- Finishing a job warned about rentals still out and said nothing about our
-- own equipment, so a crew could mark a job done and drive away leaving two
-- dehumidifiers in a basement with nothing anywhere recording that anybody
-- should go back for them.
--
-- A warning and not a blocker, on purpose. In this trade the kit is MEANT to
-- stay: dehus run for days after the work is finished, and refusing the
-- completion would teach the crew to leave jobs open instead, which loses
-- the completion date and the settlement note with it. The job finishes; the
-- app just stops being silent about what is still in the building.

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
  v_ours int;
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

  -- And our own, which costs nothing in hire but is the thing that actually
  -- goes missing: a scrubber nobody collected is a scrubber nobody can find
  -- next week.
  --
  -- Staged with no pickup date is NOT counted here, because that case is
  -- already a blocker — the completion is refused outright. Counting it in
  -- both places would have the same job telling the crew "this stops you"
  -- and "this is fine, carry on" at once.
  select count(*) into v_ours
  from equipment_assignments
  where job_id = p_job_id
    and ended_at is null
    and not (kind = 'site_staging' and expected_end_at is null);

  if v_ours > 0 then
    v_warnings := array_append(v_warnings,
      v_ours || ' of our own unit(s) still out on this job — the job keeps '
      || 'showing them until somebody collects them');
  end if;

  return v_warnings;
end;
$$;

comment on function job_completion_warnings(uuid) is
  'True, worth saying, nobody''s reason to stand in a driveway. Definer for '
  'the same reason as the blockers, and gated the same way.';

-- ---------------------------------------------------------------------------
-- What is still in the building
-- ---------------------------------------------------------------------------
--
-- The crew screen needs to list it to offer a Collect button, and reading
-- `equipment_assignments` from the client means an embedded join through a
-- view to get the asset tag — which PostgREST has to infer a relationship
-- for and which cannot be checked without a live PostgREST. One function
-- instead, which the call checker does verify.

create or replace function job_equipment_on_site(p_job_id uuid)
returns table (
  assignment_id uuid,
  equipment_id uuid,
  asset_tag text,
  name text,
  kind equipment_placement_kind,
  started_at timestamptz,
  expected_end_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, e.id, e.asset_tag, e.name, a.kind, a.started_at, a.expected_end_at
  from equipment_assignments a
  join equipment e on e.id = a.equipment_id
  where a.job_id = p_job_id
    and a.ended_at is null
    and (auth_user_id() is null or can_see_job(p_job_id))
  order by e.asset_tag;
$$;

comment on function job_equipment_on_site(uuid) is
  'Our own units still placed against a job, open assignments only. Definer, '
  'and gated by can_see_job() exactly like the completion gate.';
