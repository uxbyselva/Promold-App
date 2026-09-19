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
-- Open clocks used to block. They are now a warning: finishing the job is
-- itself the clock-out, so demanding one before the other was a loop.
perform assert(
  not exists (select 1 from unnest(v_txt) b where b like '%clocked out%'),
  'open time entries do not block completion');
perform assert(
  exists (select 1 from unnest(job_completion_warnings(v_job)) w where w like '%clocked out%'),
  'open time entries are surfaced as a warning instead');

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
  (select round(margin, 2) = round(contract_price - total_cost, 2) from job_costs where job_id = v_job),
  'margin is the contract price less total cost');

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

-- 17. Change orders ---------------------------------------------------------
-- Work is billed flat and direct to the customer, so scope growth is either
-- agreed and priced or done for free.
perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a002', true);

insert into change_orders (id, org_id, job_id, title, description, created_by)
values ('00000000-0000-0000-0000-00000000ca01', v_org, v_job,
        'Rot behind north wall',
        'Framing behind the north wall is rotted through; removal and replacement of 3 studs.',
        '00000000-0000-0000-0000-00000000a003');

perform assert(
  (select seq from change_orders where id = '00000000-0000-0000-0000-00000000ca01') = 1,
  'change orders are numbered per job, assigned server side');

-- An unpriced change order cannot be put in front of the customer.
perform assert_raises($q$
  select present_change_order('00000000-0000-0000-0000-00000000ca01')
$q$, 'presenting a change order without a price is rejected');

perform present_change_order('00000000-0000-0000-0000-00000000ca01', 1250.00);

perform assert(
  (select status from change_orders where id = '00000000-0000-0000-0000-00000000ca01')
    = 'presented',
  'a priced change order can be presented');

-- Money still awaiting an answer blocks completion: once the crew drives away
-- it will never be collected.
perform assert(
  exists (
    select 1 from unnest(job_completion_blockers(v_job)) b
    where b like '%change order%'
  ),
  'an undecided change order blocks job completion');

-- Approval has to record who agreed and how.
perform assert_raises($q$
  select decide_change_order('00000000-0000-0000-0000-00000000ca01', true, 'verbal')
$q$, 'a verbal approval without a named person is rejected');

perform assert_raises($q$
  select decide_change_order('00000000-0000-0000-0000-00000000ca01', true, 'signature')
$q$, 'a signature approval without the signature is rejected');

perform assert_raises($q$
  select decide_change_order('00000000-0000-0000-0000-00000000ca01', false, 'verbal')
$q$, 'declining without a reason is rejected');

perform decide_change_order('00000000-0000-0000-0000-00000000ca01', true, 'verbal',
                            'Helen Brooks');

perform assert(
  (select approval_method from change_orders where id = '00000000-0000-0000-0000-00000000ca01')
    = 'verbal',
  'how the customer agreed is recorded, not just that they did');

perform assert(
  not exists (
    select 1 from unnest(job_completion_blockers(v_job)) b
    where b like '%change order%'
  ),
  'a decided change order no longer blocks completion');

-- 18. Contract price ---------------------------------------------------------
perform assert(
  job_contract_price(v_job) = 8600.00 + 1250.00,
  'the contract price is the base quote plus approved change orders');

perform assert(
  (select base_price from job_costs where job_id = v_job) = 8600.00,
  'the original quote stays visible alongside the contract price');

perform assert(
  (select contract_price from job_costs where job_id = v_job) = 9850.00,
  'job costing measures margin against the contract price');

-- A rejected change order changes nothing.
insert into change_orders (id, org_id, job_id, title, description, amount, created_by)
values ('00000000-0000-0000-0000-00000000ca02', v_org, v_job, 'Repaint affected rooms',
        'Customer asked about repainting.', 900.00,
        '00000000-0000-0000-0000-00000000a002');
perform present_change_order('00000000-0000-0000-0000-00000000ca02');
perform decide_change_order('00000000-0000-0000-0000-00000000ca02', false, 'verbal',
                            null, null, 'Customer will handle painting themselves');

perform assert(
  job_contract_price(v_job) = 9850.00,
  'a declined change order does not move the contract price');

-- A descope credit is a change order too.
insert into change_orders (id, org_id, job_id, title, description, amount, created_by)
values ('00000000-0000-0000-0000-00000000ca03', v_org, v_job, 'Crawlspace removed from scope',
        'Customer had the crawlspace handled separately.', -400.00,
        '00000000-0000-0000-0000-00000000a002');
perform present_change_order('00000000-0000-0000-0000-00000000ca03');
perform decide_change_order('00000000-0000-0000-0000-00000000ca03', true, 'verbal', 'Helen Brooks');

perform assert(
  job_contract_price(v_job) = 9450.00,
  'a negative change order credits the contract price');

-- 19. Who may do what with change orders -------------------------------------
perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a003', true);
perform assert(has_permission('changeorder.draft'),
  'a crew lead can draft a change order from site');
perform assert(not has_permission('changeorder.manage'),
  'a crew lead cannot price or present one');

perform assert_raises($q$
  select present_change_order('00000000-0000-0000-0000-00000000ca01', 100)
$q$, 'a crew lead cannot present a change order');

perform set_config('request.jwt.claim.sub', '', true);

-- 20. Price visibility ------------------------------------------------------
-- What a job is worth is manager and owner information. The crew gets the
-- address, the scope and the evidence; not the number the customer pays.
perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a002', true);
perform assert(has_permission('price.view'), 'a manager can see the price');

perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a001', true);
perform assert(has_permission('price.view'), 'the owner can see the price');

perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a006', true);
perform assert(has_permission('price.view'),
  'the bookkeeper can see the price, since they keep the books');

perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a003', true);
perform assert(not has_permission('price.view'), 'a crew lead cannot see the price');

perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a004', true);
perform assert(not has_permission('price.view'), 'a technician cannot see the price');

-- Price visibility is its own flag: seeing what the customer pays and seeing
-- what the job cost us are different questions.
perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a006', true);
perform assert(has_permission('price.view') and has_permission('costing.view'),
  'the two money flags are separate and the bookkeeper holds both');

-- 22. The short job flow ----------------------------------------------------
-- Three steps for the crew: accept, on site and working, done. The longer
-- flow stays in the table, switched off, so it costs an UPDATE to restore.
perform assert(
  (select enabled from job_transitions
   where from_status = 'accepted' and to_status = 'in_progress'),
  'accepting a job leads straight into work');

perform assert(
  not (select enabled from job_transitions
       where from_status = 'accepted' and to_status = 'en_route'),
  'the en-route step is switched off rather than deleted');

perform assert(
  exists (select 1 from job_transitions where to_status = 'en_route'),
  'the en-route transition is still on the table, ready to switch back on');

perform assert(
  exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
          where t.typname = 'job_status' and e.enumlabel = 'blocked'),
  'every status stays in the enum, so history recorded against one still reads');

perform assert(
  (select count(*) from job_next_steps(v_job)) > 0,
  'a running job offers at least one next step');

perform assert(
  not exists (select 1 from job_next_steps(v_job) where to_status = 'blocked'),
  'a switched-off step is not offered to the client');

perform assert(
  (select settings -> 'job_steps' from organizations where id = v_org)
    = '["accepted", "in_progress", "work_complete"]'::jsonb,
  'the visible steps are org settings, not hardcoded');

perform assert(
  (select settings -> 'photo_phases' from organizations where id = v_org)
    = '["before", "after"]'::jsonb,
  'two photo galleries: before the work and after it');

perform assert(
  exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
          where t.typname = 'photo_phase' and e.enumlabel = 'during'),
  'the during phase survives in the enum, so existing photos keep their label');

-- 23. The completion gate directs rather than obstructs --------------------
-- Two of the four old blockers were not the crew's to resolve. Clocking out
-- is the last thing you do and so is finishing the job, and a crew lead could
-- not finish until two colleagues tapped buttons on their own phones.
perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a003', true);

perform assert(
  not exists (select 1 from unnest(job_completion_blockers(v_job)) b where b like '%clocked in%'),
  'being clocked in no longer blocks finishing the job');

perform assert(
  not exists (select 1 from unnest(job_completion_blockers(v_job)) b where b like '%Rental%'),
  'a rental the office has not chased no longer blocks the crew');

-- Still true, still said, just not in the way.
perform assert(
  exists (select 1 from unnest(job_completion_warnings(v_job)) w where w like '%clocked out%'),
  'the crew is told their clocks are about to close');

perform assert(
  exists (select 1 from unnest(job_completion_warnings(v_job)) w where w like '%rental%'),
  'the crew is told the rental is outstanding');

-- What remains is what only the crew can supply and what cannot be
-- reconstructed once they have driven away.
perform assert(
  exists (select 1 from unnest(job_completion_blockers(v_job)) b where b like '%After photos%'),
  'after photos still block');
perform assert(
  exists (select 1 from unnest(job_completion_blockers(v_job)) b where b like '%sign-off%'),
  'the customer signature still blocks');

-- 25. JWT claims, both shapes -----------------------------------------------
-- Supabase sets request.jwt.claims (the whole payload as JSON). PostgREST
-- deprecated the per-claim request.jwt.claim.sub that this once relied on.
-- Reading only the old one returned null, which made every policy deny
-- silently — a signed-in user saw an empty app and no error anywhere.
perform set_config('request.jwt.claim.sub', '', true);
perform set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000a002","role":"authenticated"}', true);

perform assert(
  auth_user_id() = '00000000-0000-0000-0000-00000000a002',
  'the user is read from the JSON claims payload Supabase provides');

perform assert(
  auth_org_id() = v_org,
  'and the organisation resolves from it, so policies can match');

perform assert(has_permission('price.view'),
  'permission flags work when identity comes from the JSON payload');

-- The legacy form still works, so the local harness keeps passing.
perform set_config('request.jwt.claims', '', true);
perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a003', true);
perform assert(
  auth_user_id() = '00000000-0000-0000-0000-00000000a003',
  'the legacy per-claim setting is still honoured');

-- No request context at all must deny rather than leak.
perform set_config('request.jwt.claim.sub', '', true);
perform assert(auth_user_id() is null, 'no request context means no identity');
perform assert(not has_permission('price.view'), 'and no permissions — fail closed');

raise notice 'ALL ASSERTIONS PASSED';
end $$;


-- 21. The revoke actually holds ---------------------------------------------
-- Every signed-in Supabase user is the same `authenticated` role, so these
-- checks run as that role. A superuser bypasses column privileges entirely
-- and would report a false pass.

-- 24. Finishing a job closes the clocks -------------------------------------
do $$
declare
  v_job uuid := '00000000-0000-0000-0000-00000000bb02';
  v_org uuid := '00000000-0000-0000-0000-0000000000a1';
  v_open int;
  v_auto int;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a003', true);

  -- Satisfy everything that genuinely blocks, and leave someone on the clock.
  insert into job_photos (org_id, job_id, storage_path, phase, room_label, taken_by)
  values (v_org, v_job, 'before/1.jpg', 'before', 'North wall', '00000000-0000-0000-0000-00000000a003'),
         (v_org, v_job, 'after/1.jpg',  'after',  'North wall', '00000000-0000-0000-0000-00000000a003');

  insert into signatures (org_id, job_id, kind, signer_name, storage_path)
  values (v_org, v_job, 'completion', 'Helen Brooks', 'sig/1.png');

  insert into form_submissions (org_id, job_id, template_id, answers, is_complete, submitted_by, submitted_at)
  select v_org, v_job, ft.id, '{"respirator": true}'::jsonb, true,
         '00000000-0000-0000-0000-00000000a003', now()
  from form_templates ft where ft.org_id = v_org and ft.key = 'ppe_safety';

  select count(*) into v_open
  from time_entries where job_id = v_job and clock_out_at is null;
  perform assert(v_open > 0, 'someone is still on the clock going in');

  perform assert(array_length(job_completion_blockers(v_job), 1) is null,
    'nothing blocks completion once the photos and signature are in');

  perform transition_job(v_job, 'work_complete');

  select count(*) into v_open
  from time_entries where job_id = v_job and clock_out_at is null;
  perform assert(v_open = 0, 'finishing the job clocked everyone out');

  select count(*) into v_auto
  from time_entries where job_id = v_job and auto_closed;
  perform assert(v_auto > 0,
    'the app-supplied stamps are marked, so a manager can correct them');

  perform assert(
    (select actual_end is not null from jobs where id = v_job),
    'the job records when it actually finished');

  -- And the office hears about the rental the crew could not deal with.
  perform assert(
    exists (select 1 from notifications
            where kind = 'rental_outstanding' and payload ->> 'job_id' = v_job::text),
    'the outstanding rental is pushed to whoever manages rentals');

  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- A switched-off step is refused by the server, not merely hidden by the UI.
do $$
declare v_job uuid := '00000000-0000-0000-0000-00000000bb02';
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a003', true);
  perform assert_raises(
    format('select transition_job(%L, ''blocked'', ''waiting on parts'')', v_job),
    'a disabled transition is refused even when asked for directly');
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

set role authenticated;

-- Crew lead: the masked view gives them the job without the money.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a003', false);

do $$
declare v_price numeric; v_n int;
begin
  select quoted_price into v_price from jobs_safe
  where job_number = 'J00102';
  perform assert(v_price is null, 'jobs_safe masks the price from a crew lead');

  select count(*) into v_n from jobs_safe where job_number = 'J00102';
  perform assert(v_n = 1, 'a crew lead still sees the job itself, just not its price');

  select amount into v_price from change_orders_safe where seq = 1
    and job_id = (select id from jobs where job_number = 'J00102');
  perform assert(v_price is null, 'change order amounts are masked too');

  select count(*) into v_n from job_costs;
  perform assert(v_n = 0, 'a crew lead sees no costing rows at all');
end $$;

-- And the direct path is closed, or the view would be decoration.
do $$
begin
  perform assert_raises('select quoted_price from jobs',
    'reading the price straight off the jobs table is refused');
  perform assert_raises('select amount from change_orders',
    'reading a change order amount straight off the table is refused');
  perform assert_raises('select cost_rate from profiles',
    'reading a cost rate straight off the profiles table is refused');
end $$;

-- Manager: same views, money present.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a002', false);

do $$
declare v_price numeric;
begin
  select quoted_price into v_price from jobs_safe where job_number = 'J00102';
  perform assert(v_price = 8600.00, 'jobs_safe shows the price to a manager');

  select contract_price into v_price from jobs_safe where job_number = 'J00102';
  perform assert(v_price = 9450.00,
    'the contract price reaches a manager through the safe view');

  select amount into v_price from change_orders_safe where seq = 1
    and job_id = (select id from jobs where job_number = 'J00102');
  perform assert(v_price = 1250.00, 'a manager sees change order amounts');
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);
\echo 'PRICE VISIBILITY ASSERTIONS PASSED'

-- ---------------------------------------------------------------------------
-- Admin mode: deleting, restoring, and the trail both leave behind
-- ---------------------------------------------------------------------------

set role authenticated;

-- Manager: may delete a customer, may not put one back.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a002', false);

do $$
declare
  v_d1 uuid := '00000000-0000-0000-0000-0000000000d1';  -- Helen Brooks, has a site
  v_d3 uuid := '00000000-0000-0000-0000-0000000000d3';  -- Statewide Mutual, has none
  v_n int;
begin
  perform assert_raises(
    format('select soft_delete_record(''customers'', %L, ''tidying up'')', v_d1),
    'a customer with a live site cannot be deleted');

  perform assert_raises(
    format('select soft_delete_record(''customers'', %L, ''   '')', v_d3),
    'a delete with no reason is refused');

  perform assert_raises(
    'select soft_delete_record(''organizations'', gen_random_uuid(), ''why not'')',
    'a table that does not soft-delete cannot be deleted through this door');

  perform soft_delete_record('customers', v_d3, 'duplicate of an older record');

  select count(*) into v_n from deleted_records()
   where table_name = 'customers' and record_id = v_d3;
  perform assert(v_n = 1, 'a deleted customer shows up in the recycle bin');

  select count(*) into v_n from deleted_records()
   where record_id = v_d3 and blocked_by is null;
  perform assert(v_n = 1, 'with no deleted parent, nothing blocks the restore');

  perform assert_raises(
    format('select restore_record(''customers'', %L)', v_d3),
    'a manager cannot restore: that is data.restore, and they do not have it');
end $$;

-- Crew lead: the row is simply gone, not merely hidden by a client filter.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a003', false);

do $$
declare v_n int;
begin
  select count(*) into v_n from customers
   where id = '00000000-0000-0000-0000-0000000000d3';
  perform assert(v_n = 0, 'a deleted customer is invisible without audit.view');

  perform assert_raises('select * from deleted_records()',
    'the recycle bin is refused without audit.view');
  perform assert_raises('select * from audit_feed()',
    'the audit trail is refused without audit.view');
end $$;

-- Owner: restores, and the parent rule holds on the way back.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a001', false);

do $$
declare
  v_org uuid := '00000000-0000-0000-0000-0000000000a1';
  v_d3 uuid := '00000000-0000-0000-0000-0000000000d3';
  v_cust uuid;
  v_site uuid;
  v_n int;
begin
  perform restore_record('customers', v_d3, 'not a duplicate after all');
  select count(*) into v_n from customers where id = v_d3 and deleted_at is null;
  perform assert(v_n = 1, 'the owner can put a deleted customer back');

  -- A customer and site of its own, so the parent rule can be exercised
  -- without disturbing the seeded job history.
  insert into customers (org_id, name, kind)
  values (v_org, 'Test Holdings', 'commercial') returning id into v_cust;
  insert into sites (org_id, customer_id, label, address_line1)
  values (v_org, v_cust, 'Test yard', '1 Test Row') returning id into v_site;

  perform soft_delete_record('sites', v_site, 'never actually ours');
  perform soft_delete_record('customers', v_cust, 'opened in error');

  select count(*) into v_n from deleted_records()
   where record_id = v_site and blocked_by is not null;
  perform assert(v_n = 1, 'the bin says which deleted parent blocks a restore');

  perform assert_raises(
    format('select restore_record(''sites'', %L)', v_site),
    'a site cannot be restored under a customer that is still deleted');

  perform restore_record('customers', v_cust);
  perform restore_record('sites', v_site);

  select count(*) into v_n from sites where id = v_site and deleted_at is null;
  perform assert(v_n = 1, 'parent first, then child: both come back');

  -- The trail records both directions, not just the destructive one.
  select count(*) into v_n from record_history('customers', v_cust)
   where action = 'soft_delete';
  perform assert(v_n = 1, 'the delete is on the record');

  select count(*) into v_n from record_history('customers', v_cust)
   where action = 'restore';
  perform assert(v_n = 1, 'so is the restore');

  select count(*) into v_n from audit_feed(p_table => 'customers')
   where record_id = v_cust and action = 'insert';
  perform assert(v_n = 1, 'customers are audited now, which they were not before');

  -- Leave the seed as it was found.
  perform soft_delete_record('sites', v_site, 'test fixture');
  perform soft_delete_record('customers', v_cust, 'test fixture');
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);

do $$
declare v_n int;
begin
  select count(*) into v_n from roles
   where key = 'owner' and (permissions ->> 'data.restore')::boolean = true;
  perform assert(v_n > 0, 'every owner role carries data.restore');

  select count(*) into v_n from roles
   where key <> 'owner' and coalesce((permissions ->> 'data.restore')::boolean, false);
  perform assert(v_n = 0, 'and nobody else does');
end $$;

\echo 'ADMIN MODE ASSERTIONS PASSED'
