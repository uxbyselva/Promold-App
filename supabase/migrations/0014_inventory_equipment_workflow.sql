-- 0014 Material usage, mileage continuity, equipment placement workflow

-- ---------------------------------------------------------------------------
-- Material usage writes the ledger entry
-- ---------------------------------------------------------------------------

create or replace function material_usage_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into stock_movements (
    org_id, item_id, kind, from_location_id, quantity,
    unit_cost, job_id, reference_table, reference_id, created_by
  )
  select
    new.org_id, new.item_id, 'usage', new.location_id, new.quantity,
    i.average_cost, new.job_id, 'material_usage', new.id, new.logged_by
  from inventory_items i where i.id = new.item_id;

  return new;
end;
$$;

create trigger trg_material_usage_movement
  after insert on material_usage
  for each row execute function material_usage_movement();

-- ---------------------------------------------------------------------------
-- Mileage: odometer continuity
--
-- A gap is recorded, not rejected. Vehicles get moved without a log, and a
-- hard block would simply stop people logging at all.
-- ---------------------------------------------------------------------------

create or replace function mileage_continuity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last numeric;
begin
  select current_odometer into v_last from vehicles where id = new.vehicle_id;

  if v_last is not null and new.odometer_start <> v_last then
    new.continuity_gap := new.odometer_start - v_last;
  else
    new.continuity_gap := null;
  end if;

  return new;
end;
$$;

create trigger trg_mileage_continuity
  before insert on mileage_logs
  for each row execute function mileage_continuity();

create or replace function mileage_advance_odometer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update vehicles
  set current_odometer = greatest(current_odometer, new.odometer_end)
  where id = new.vehicle_id;
  return new;
end;
$$;

create trigger trg_mileage_advance_odometer
  after insert on mileage_logs
  for each row execute function mileage_advance_odometer();

-- ---------------------------------------------------------------------------
-- Equipment placement
--
-- Three verbs the field actually uses: stage, check out, collect. Moving
-- between sites is one call, so the old placement always closes as the new
-- one opens and the two can never overlap.
-- ---------------------------------------------------------------------------

create or replace function stage_equipment(
  p_equipment_id uuid,
  p_job_id uuid,
  p_site_id uuid,
  p_expected_end_at timestamptz default null,
  p_notes text default null
)
returns equipment_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_equipment equipment;
  v_open equipment_assignments;
  v_row equipment_assignments;
begin
  select * into v_equipment from equipment where id = p_equipment_id for update;
  if v_equipment.id is null then
    raise exception 'Equipment % not found', p_equipment_id using errcode = 'P0002';
  end if;
  if v_equipment.lifecycle_status <> 'active' then
    raise exception 'Equipment % is %', v_equipment.asset_tag, v_equipment.lifecycle_status
      using errcode = 'check_violation';
  end if;

  -- Close any open placement first. This is what makes "move it to this
  -- site" a single scan for the person holding the unit.
  select * into v_open from equipment_assignments
  where equipment_id = p_equipment_id and ended_at is null
  for update;

  if v_open.id is not null then
    update equipment_assignments
    set ended_at = now(), collected_by = auth_user_id()
    where id = v_open.id;
  end if;

  insert into equipment_assignments (
    org_id, equipment_id, kind, job_id, site_id,
    started_at, expected_end_at, placed_by, notes
  )
  values (
    v_equipment.org_id, p_equipment_id, 'site_staging', p_job_id, p_site_id,
    now(), p_expected_end_at, auth_user_id(), p_notes
  )
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function checkout_equipment(
  p_equipment_id uuid,
  p_user_id uuid,
  p_job_id uuid default null,
  p_expected_end_at timestamptz default null
)
returns equipment_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_equipment equipment;
  v_open equipment_assignments;
  v_row equipment_assignments;
begin
  select * into v_equipment from equipment where id = p_equipment_id for update;
  if v_equipment.id is null then
    raise exception 'Equipment % not found', p_equipment_id using errcode = 'P0002';
  end if;
  if v_equipment.lifecycle_status <> 'active' then
    raise exception 'Equipment % is %', v_equipment.asset_tag, v_equipment.lifecycle_status
      using errcode = 'check_violation';
  end if;

  select * into v_open from equipment_assignments
  where equipment_id = p_equipment_id and ended_at is null;

  -- Checking out a unit that is staged at a site would silently pull it off
  -- a running job, so this one refuses rather than reassigning.
  if v_open.id is not null then
    raise exception 'Equipment % is currently % — collect it first',
      v_equipment.asset_tag, v_open.kind
      using errcode = 'check_violation';
  end if;

  insert into equipment_assignments (
    org_id, equipment_id, kind, job_id, assigned_to_user_id,
    started_at, expected_end_at, placed_by
  )
  values (
    v_equipment.org_id, p_equipment_id, 'checkout', p_job_id, p_user_id,
    now(), p_expected_end_at, auth_user_id()
  )
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function collect_equipment(
  p_equipment_id uuid,
  p_condition equipment_condition default 'ok',
  p_runtime_hours numeric default null,
  p_notes text default null
)
returns equipment_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row equipment_assignments;
begin
  update equipment_assignments
  set ended_at = now(),
      collected_by = auth_user_id(),
      condition_in = p_condition,
      notes = coalesce(p_notes, notes)
  where equipment_id = p_equipment_id and ended_at is null
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Equipment % is not currently placed', p_equipment_id
      using errcode = 'P0002';
  end if;

  if p_runtime_hours is not null then
    insert into equipment_runtime_logs (org_id, equipment_id, job_id, reading_hours, read_by)
    values (v_row.org_id, p_equipment_id, v_row.job_id, p_runtime_hours, auth_user_id());
  end if;

  -- A unit that came back damaged should not be schedulable until someone
  -- looks at it.
  if p_condition = 'needs_service' then
    update equipment set lifecycle_status = 'in_maintenance' where id = p_equipment_id;
  end if;

  return v_row;
end;
$$;

-- Everything past its expected collection or return date, owned and rented
-- together. This is the morning list.
create view equipment_overdue
with (security_invoker = true)
as
select
  'owned'::text        as source,
  e.asset_tag          as reference,
  e.name               as description,
  a.org_id,
  a.job_id,
  a.site_id,
  a.expected_end_at    as due_at,
  extract(epoch from (now() - a.expected_end_at)) / 86400.0 as days_overdue
from equipment_assignments a
join equipment e on e.id = a.equipment_id
where a.ended_at is null
  and a.expected_end_at is not null
  and a.expected_end_at < now()

union all

select
  'rental'::text,
  coalesce(r.agreement_no, 'rental'),
  r.description,
  r.org_id,
  r.job_id,
  r.site_id,
  r.return_due_at,
  extract(epoch from (now() - r.return_due_at)) / 86400.0
from equipment_rentals r
where r.returned_at is null
  and r.return_due_at is not null
  and r.return_due_at < now()
  and r.status not in ('cancelled', 'returned', 'closed');

-- Deployed days against available days. Answers "do we need another scrubber
-- or are three of them sitting idle".
create or replace function equipment_utilisation(
  p_org_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  equipment_id uuid,
  asset_tag text,
  name text,
  category equipment_category,
  deployed_days numeric,
  window_days numeric,
  utilisation_pct numeric
)
language sql
stable
as $$
  select
    e.id,
    e.asset_tag,
    e.name,
    e.category,
    round(coalesce(sum(
      extract(epoch from (
        least(coalesce(a.ended_at, p_to), p_to) - greatest(a.started_at, p_from)
      )) / 86400.0
    ), 0)::numeric, 2) as deployed_days,
    round((extract(epoch from (p_to - p_from)) / 86400.0)::numeric, 2) as window_days,
    round((coalesce(sum(
      extract(epoch from (
        least(coalesce(a.ended_at, p_to), p_to) - greatest(a.started_at, p_from)
      )) / 86400.0
    ), 0) / nullif(extract(epoch from (p_to - p_from)) / 86400.0, 0) * 100)::numeric, 1)
  from equipment e
  left join equipment_assignments a
    on a.equipment_id = e.id
   and tstzrange(a.started_at, coalesce(a.ended_at, 'infinity'::timestamptz))
       && tstzrange(p_from, p_to)
  where e.org_id = p_org_id and e.lifecycle_status = 'active'
  group by e.id, e.asset_tag, e.name, e.category;
$$;
