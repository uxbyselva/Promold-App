-- Schema assertions
--
-- These prove the constraints the design depends on actually hold. They run
-- against the seeded database in CI. Each test states what it protects, so a
-- failure explains itself.

\set ON_ERROR_STOP on
set client_min_messages to notice;

create or replace function assert(p_condition boolean, p_what text)
returns void
language plpgsql
as $$
begin
  if not p_condition then
    raise exception 'ASSERTION FAILED: %', p_what;
  end if;
  raise notice 'ok: %', p_what;
end;
$$;

-- Runs a statement and asserts it raises. Used for the constraints whose
-- whole value is that they refuse bad data.
create or replace function assert_raises(p_sql text, p_what text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'ok (rejected): %', p_what;
    return;
  end;
  raise exception 'ASSERTION FAILED: expected rejection: %', p_what;
end;
$$;

do $$
declare
  v_org uuid := '00000000-0000-0000-0000-0000000000a1';
  v_job uuid := '00000000-0000-0000-0000-00000000bb02';
  v_scrubber uuid := '00000000-0000-0000-0000-00000000ee01';
  v_site uuid := '00000000-0000-0000-0000-0000000000e1';
  v_n numeric;
  v_int int;
  v_txt text[];
begin

-- 1. Equipment can never be in two places at once -------------------------
-- The core constraint of the equipment model. One unit serves many sites,
-- but strictly one at a time.
perform assert_raises(format($q$
  insert into equipment_assignments (org_id, equipment_id, kind, site_id, started_at, placed_by)
  values (%L, %L, 'site_staging', %L, now(), null)
$q$, v_org, v_scrubber, v_site),
  'overlapping placement for the same unit is rejected');

-- A placement that starts after the open one ends is fine.
perform assert(
  (select count(*) from equipment_assignments
   where equipment_id = v_scrubber and ended_at is null) = 1,
  'exactly one open placement per deployed unit');

-- 2. Placement target matches its kind ------------------------------------
perform assert_raises(format($q$
  insert into equipment_assignments (org_id, equipment_id, kind, started_at)
  values (%L, %L, 'site_staging', now() + interval '400 days')
$q$, v_org, '00000000-0000-0000-0000-00000000ee03'),
  'site staging without a site is rejected');

perform assert_raises(format($q$
  insert into equipment_assignments (org_id, equipment_id, kind, started_at)
  values (%L, %L, 'checkout', now() + interval '400 days')
$q$, v_org, '00000000-0000-0000-0000-00000000ee03'),
  'checkout without a holder is rejected');

-- 3. Current location is derived, and correct -----------------------------
perform assert(
  (select location_status from equipment_current where equipment_id = v_scrubber)
    = 'staged_at_site',
  'equipment_current derives staged_at_site');

perform assert(
  (select location_status from equipment_current
   where equipment_id = '00000000-0000-0000-0000-00000000ee03') = 'available',
  'equipment_current derives available for an unplaced unit');

-- 4. Overdue pickup is visible --------------------------------------------
-- The dehumidifier in the seed is past its expected collection.
perform assert(
  exists (select 1 from equipment_overdue where source = 'owned' and reference = 'DH-001'),
  'an owned unit past its expected collection shows as overdue');

-- 5. Stock is derived from the ledger and balances ------------------------
-- Opening 9 rolls of poly, 3 used on the job.
select quantity into v_n from stock_levels
where item_id = '00000000-0000-0000-0000-000000000102'
  and location_id = '00000000-0000-0000-0000-000000000c01';
perform assert(v_n = 6, format('poly stock nets to 6 after usage (got %s)', v_n));

-- Material usage wrote its own movement; nothing edits levels directly.
perform assert(
  (select count(*) from stock_movements
   where reference_table = 'material_usage' and kind = 'usage') = 3,
  'each material usage row writes exactly one usage movement');

-- 6. Adjustments require a reason -----------------------------------------
-- An adjustment with no reason is how stock records become fiction.
perform assert_raises(format($q$
  insert into stock_movements (org_id, item_id, kind, from_location_id, quantity)
  values (%L, %L, 'adjustment', %L, 1)
$q$, v_org, '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000c01'),
  'a stock adjustment without a reason is rejected');

-- 7. Purchase request lines lock on submit --------------------------------
perform assert_raises($q$
  insert into purchase_request_lines (org_id, request_id, description, quantity, unit)
  values ('00000000-0000-0000-0000-0000000000a1',
          '00000000-0000-0000-0000-00000000dd01', 'Sneaky extra line', 1, 'each')
$q$, 'lines cannot be added to a submitted request');

-- 8. The purchase audit trail is written by trigger, not by the app -------
update purchase_requests set notes = 'Amended by manager'
where id = '00000000-0000-0000-0000-00000000dd01';

perform assert(
  exists (
    select 1 from purchase_request_audit
    where request_id = '00000000-0000-0000-0000-00000000dd01'
      and field = 'notes' and new_value = 'Amended by manager'
  ),
  'editing a submitted request writes an audit row automatically');

-- 9. Mileage --------------------------------------------------------------
perform assert_raises($q$
  insert into mileage_logs (org_id, vehicle_id, user_id, odometer_start, odometer_end)
  values ('00000000-0000-0000-0000-0000000000a1',
          '00000000-0000-0000-0000-00000000cc01',
          '00000000-0000-0000-0000-00000000a003', 500, 400)
$q$, 'a mileage log ending before it starts is rejected');

-- Distance is generated, and the vehicle odometer follows the log.
perform assert(
  (select distance from mileage_logs
   where vehicle_id = '00000000-0000-0000-0000-00000000cc01'
   order by trip_date desc limit 1) = 28,
  'mileage distance is generated from the odometer readings');

perform assert(
  (select current_odometer from vehicles where id = '00000000-0000-0000-0000-00000000cc01') = 68477,
  'the vehicle odometer advances to the latest closing reading');

-- A gap against the last closing reading is recorded, not refused: vehicles
-- get moved without a log, and a hard block would stop people logging.
insert into mileage_logs (org_id, vehicle_id, user_id, odometer_start, odometer_end, purpose)
values (v_org, '00000000-0000-0000-0000-00000000cc01',
        '00000000-0000-0000-0000-00000000a003', 68500, 68520, 'Gap test');

perform assert(
  (select continuity_gap from mileage_logs where purpose = 'Gap test') = 23,
  'an odometer gap is flagged rather than rejected');

-- 10. One open time entry per person --------------------------------------
insert into time_entries (org_id, job_id, user_id, clock_in_at)
values (v_org, v_job, '00000000-0000-0000-0000-00000000a004', now());

perform assert_raises(format($q$
  insert into time_entries (org_id, job_id, user_id, clock_in_at)
  values (%L, %L, '00000000-0000-0000-0000-00000000a004', now())
$q$, v_org, v_job),
  'a second open time entry for the same person is rejected');

-- 11. Completion gates -----------------------------------------------------
-- The running job has no after photos, no signature, an open time entry and
-- a rental outstanding. Every one of those should be named.
v_txt := job_completion_blockers(v_job);
perform assert(array_length(v_txt, 1) > 0, 'a job missing its evidence cannot complete');
perform assert(
  exists (select 1 from unnest(v_txt) b where b like '%After photos%'),
  'the completion gate names missing after photos');
perform assert(
  exists (select 1 from unnest(v_txt) b where b like '%clocked out%'),
  'the completion gate names open time entries');

-- Equipment staged with a scheduled pickup does not block; equipment staged
-- with no pickup date does. This is the rule that stops scrubbers being
-- forgotten at finished jobs.
update equipment_assignments set expected_end_at = null
where equipment_id = v_scrubber and ended_at is null;

perform assert(
  exists (
    select 1 from unnest(job_completion_blockers(v_job)) b
    where b like '%staged at site with no pickup%'
  ),
  'equipment left on site with no pickup blocks job completion');

update equipment_assignments set expected_end_at = now() + interval '1 day'
where equipment_id = v_scrubber and ended_at is null;

perform assert(
  not exists (
    select 1 from unnest(job_completion_blockers(v_job)) b
    where b like '%staged at site with no pickup%'
  ),
  'equipment with a scheduled pickup does not block completion');

-- 12. Job transitions ------------------------------------------------------
perform assert(
  not exists (select 1 from job_transitions where from_status = 'draft' and to_status = 'closed'),
  'no transition skips from draft straight to closed');

perform assert(
  (select required_permission from job_transitions
   where from_status = 'in_progress' and to_status = 'work_complete') = 'job.complete',
  'completing a job requires job.complete');

-- 13. Scheduling conflicts -------------------------------------------------
-- The crew lead is already on the running job; scheduling over it conflicts.
v_txt := scheduling_conflicts(
  '00000000-0000-0000-0000-00000000a003',
  now(), now() + interval '2 hours');
perform assert(array_length(v_txt, 1) > 0, 'an already-assigned window reports a conflict');

-- Approved time off blocks scheduling outright.
insert into time_off (org_id, user_id, kind, starts_at, ends_at, status)
values (v_org, '00000000-0000-0000-0000-00000000a005', 'vacation',
        now() + interval '10 days', now() + interval '14 days', 'approved');

v_txt := scheduling_conflicts(
  '00000000-0000-0000-0000-00000000a005',
  now() + interval '11 days', now() + interval '11 days 4 hours');
perform assert(
  exists (select 1 from unnest(v_txt) c where c like '%time off%'),
  'approved time off is reported as a scheduling conflict');

-- 14. Equipment availability for the scheduler -----------------------------
select count(*) into v_int
from available_equipment(v_org, 'air_scrubber', now(), now() + interval '4 hours');
perform assert(v_int = 1, format(
  'only the unstaged scrubber is offered for a window during deployment (got %s)', v_int));

-- Once the job is over, the deployed units are available again.
select count(*) into v_int
from available_equipment(v_org, 'air_scrubber',
  now() + interval '30 days', now() + interval '30 days 4 hours');
perform assert(v_int = 3, format('all three scrubbers free once placements end (got %s)', v_int));

-- 15. Job costing ----------------------------------------------------------
-- Costing is owner/manager information; the view is gated on costing.view,
-- so with no JWT claim set it returns nothing at all.
perform assert(
  (select count(*) from job_costs) = 0,
  'job costing is invisible without the costing.view permission');

-- Impersonate the owner and the numbers appear.
perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a001', true);

perform assert(
  (select count(*) from job_costs) > 0,
  'job costing is visible to a user holding costing.view');

select labour_cost into v_n from job_costs where job_id = v_job;
perform assert(v_n > 0, format('labour cost accrues from clocked time (got %s)', v_n));

select equipment_cost into v_n from job_costs where job_id = v_job;
perform assert(v_n > 0, format('equipment days load onto the job (got %s)', v_n));

select rental_cost into v_n from job_costs where job_id = v_job;
perform assert(v_n = 270.00, format('rental cost lands on the job (got %s)', v_n));

perform assert(
  (select round(margin, 2) = round(quoted_price - total_cost, 2) from job_costs where job_id = v_job),
  'margin is the quoted price less total cost');

-- 16. Permission flags -----------------------------------------------------
perform assert(has_permission('purchase.approve_unlimited'),
  'the owner can approve above the threshold');

perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a002', true);
perform assert(has_permission('purchase.approve'),
  'a manager can approve spend');
perform assert(not has_permission('purchase.approve_unlimited'),
  'a manager cannot approve above the threshold');
perform assert(not has_permission('user.view_cost_rates'),
  'a manager cannot see cost rates');

perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a004', true);
perform assert(not has_permission('purchase.approve'),
  'a technician cannot approve spend');
perform assert(has_permission('equipment.place'),
  'a technician can place equipment');
perform assert(not has_permission('costing.view'),
  'a technician cannot see job margin');

-- An override on the profile grants a single exception without a new role.
update profiles
set permission_overrides = '{"purchase.approve": true}'::jsonb
where id = '00000000-0000-0000-0000-00000000a004';

perform assert(has_permission('purchase.approve'),
  'a per-user override grants a permission the role does not');

perform set_config('request.jwt.claim.sub', '', true);

raise notice 'ALL ASSERTIONS PASSED';
end $$;
