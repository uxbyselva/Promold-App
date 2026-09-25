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

-- Relative to what the job already has, not a hardcoded 1: the seed carries
-- an agreed change order on this job, and "the next number" is the thing
-- being asserted anyway.
select coalesce(max(seq), 0) into v_int from change_orders where job_id = v_job;

insert into change_orders (id, org_id, job_id, title, description, created_by)
values ('00000000-0000-0000-0000-00000000ca01', v_org, v_job,
        'Rot behind north wall',
        'Framing behind the north wall is rotted through; removal and replacement of 3 studs.',
        '00000000-0000-0000-0000-00000000a003');

perform assert(
  (select seq from change_orders where id = '00000000-0000-0000-0000-00000000ca01')
    = v_int + 1,
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

-- What the job is worth before this one is agreed. The seed already carries
-- an agreed change order, so the figures below are movements, not totals —
-- which is what the rule actually says.
v_n := job_contract_price(v_job);

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
  job_contract_price(v_job) = v_n + 1250.00,
  'the contract price is the base quote plus approved change orders');

perform assert(
  (select base_price from job_costs where job_id = v_job)
    = (select quoted_price from jobs where id = v_job),
  'the original quote stays visible alongside the contract price');

perform assert(
  (select contract_price from job_costs where job_id = v_job) = job_contract_price(v_job),
  'job costing measures margin against the contract price');

v_n := job_contract_price(v_job);

-- A rejected change order changes nothing.
insert into change_orders (id, org_id, job_id, title, description, amount, created_by)
values ('00000000-0000-0000-0000-00000000ca02', v_org, v_job, 'Repaint affected rooms',
        'Customer asked about repainting.', 900.00,
        '00000000-0000-0000-0000-00000000a002');
perform present_change_order('00000000-0000-0000-0000-00000000ca02');
perform decide_change_order('00000000-0000-0000-0000-00000000ca02', false, 'verbal',
                            null, null, 'Customer will handle painting themselves');

perform assert(
  job_contract_price(v_job) = v_n,
  'a declined change order does not move the contract price');

-- A descope credit is a change order too.
insert into change_orders (id, org_id, job_id, title, description, amount, created_by)
values ('00000000-0000-0000-0000-00000000ca03', v_org, v_job, 'Crawlspace removed from scope',
        'Customer had the crawlspace handled separately.', -400.00,
        '00000000-0000-0000-0000-00000000a002');
perform present_change_order('00000000-0000-0000-0000-00000000ca03');
perform decide_change_order('00000000-0000-0000-0000-00000000ca03', true, 'verbal', 'Helen Brooks');

perform assert(
  job_contract_price(v_job) = v_n - 400.00,
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
-- What a job is worth stops at the crew lead. He needs it to tell the office
-- the work has outgrown the quote (0028); a technician gets the address, the
-- scope and the evidence, and not the number the customer pays.
perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a002', true);
perform assert(has_permission('price.view'), 'a manager can see the price');

perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a001', true);
perform assert(has_permission('price.view'), 'the owner can see the price');

perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a006', true);
perform assert(has_permission('price.view'),
  'the bookkeeper can see the price, since they keep the books');

perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a003', true);
perform assert(has_permission('price.view'),
  'a crew lead can see the price, so he can report work that outgrew it');

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

-- Technician: the masked view gives them the job without the money. This is
-- the role the masking is tested through now — the crew lead reads the price
-- since 0028, so asserting the mask against him would assert nothing.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a004', false);

do $$
declare v_price numeric; v_n int;
begin
  select quoted_price into v_price from jobs_safe
  where job_number = 'J00102';
  perform assert(v_price is null, 'jobs_safe masks the price from a technician');

  select count(*) into v_n from jobs_safe where job_number = 'J00102';
  perform assert(v_n = 1, 'a technician still sees the job itself, just not its price');

  select amount into v_price from change_orders_safe where seq = 1
    and job_id = (select id from jobs where job_number = 'J00102');
  perform assert(v_price is null, 'change order amounts are masked too');

  select count(*) into v_n from job_costs;
  perform assert(v_n = 0, 'a technician sees no costing rows at all');
end $$;

-- Crew lead: the price comes through, and nothing else does.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a003', false);

do $$
declare v_price numeric; v_n int;
begin
  select quoted_price into v_price from jobs_safe where job_number = 'J00102';
  perform assert(v_price = 8600.00, 'jobs_safe shows the quote to a crew lead');

  -- Against the quote rather than a fixed total: the assertions above agree
  -- and decline change orders on this job, so the total is theirs to move.
  select contract_price into v_price from jobs_safe where job_number = 'J00102';
  perform assert(v_price > 8600.00,
    'and the contract price — what the job is worth after agreed extras');

  select amount into v_price from change_orders_safe where seq = 1
    and job_id = (select id from jobs where job_number = 'J00102');
  perform assert(v_price = 1250.00,
    'and what an extra was priced at, so he can see it was taken seriously');

  -- The line the flag draws. Price is not cost, and cost is not his.
  select count(*) into v_n from job_costs;
  perform assert(v_n = 0, 'but still no costing rows: the price is not the margin');

  select cost_rate into v_price from profiles_safe
   where id = '00000000-0000-0000-0000-00000000a005';
  perform assert(v_price is null, 'and no colleague''s cost rate');
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
  perform assert(v_price > 8600.00,
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

-- ---------------------------------------------------------------------------
-- Putting work on the calendar
-- ---------------------------------------------------------------------------

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a002', false);

do $$
declare
  v_d1 uuid := '00000000-0000-0000-0000-0000000000d1';  -- Helen Brooks
  v_d2 uuid := '00000000-0000-0000-0000-0000000000d2';  -- Cardinal Property Group
  v_e1 uuid := '00000000-0000-0000-0000-0000000000e1';  -- 42 Oak St, under d1
  v_priya uuid := '00000000-0000-0000-0000-00000000a005';
  v_marcus uuid := '00000000-0000-0000-0000-00000000a003';
  v_job jobs;
  v_n int;
  v_pending int;
begin
  perform assert_raises(
    format('select create_job(%L, %L, ''Wrong pairing'', ''2026-11-02T08:00:00Z'')', v_d2, v_e1),
    'a site cannot be booked under a customer it does not belong to');

  perform assert_raises(
    format('select create_job(%L, %L, ''   '', ''2026-11-02T08:00:00Z'')', v_d1, v_e1),
    'a job needs a title');

  perform assert_raises(
    format('select create_job(%L, %L, ''Backwards'', ''2026-11-04T08:00:00Z'', ''2026-11-02T16:00:00Z'')',
           v_d1, v_e1),
    'a job cannot end before it starts');

  -- Three days, one job, three work days behind it.
  v_job := create_job(v_d1, v_e1, 'Three day strip out',
                      '2026-11-02T08:00:00Z', '2026-11-04T16:00:00Z');
  select count(*) into v_n from job_visits where job_id = v_job.id;
  perform assert(v_n = 3, 'a three-day job produces three visits, not one');
  perform assert(v_job.status = 'scheduled',
    'a job booked on the calendar is scheduled, not left as a draft');

  -- Approved time off is not negotiable, so a job inside the window is the
  -- case worth testing.
  --
  -- The window is READ from the row rather than written here. The seed dates
  -- it relative to now(), so a literal date passes on the day it is written
  -- and quietly stops testing anything a week later — which is exactly what
  -- happened to the first version of this.
  declare
    v_away jobs;
    v_off_start timestamptz;
    v_off_end timestamptz;
  begin
    select starts_at, ends_at into v_off_start, v_off_end
      from time_off
     where user_id = v_priya and status = 'approved'
     order by starts_at limit 1;
    perform assert(v_off_start is not null,
      'the seed still has approved time off to test against');

    v_away := create_job(v_d1, v_e1, 'While she is away',
                         v_off_start + interval '1 day',
                         v_off_start + interval '1 day 8 hours');
    perform assert_raises(
      format('select set_job_crew(%L, array[%L]::uuid[])', v_away.id, v_priya),
      'nobody is assigned over approved time off');
    perform assert_raises(
      format('select set_job_crew(%L, array[%L]::uuid[], true)', v_away.id, v_priya),
      'and forcing it does not help: approved time off is not a judgement call');
    perform soft_delete_record('jobs', v_away.id, 'test fixture');
  end;

  perform set_job_crew(v_job.id, array[v_marcus]::uuid[]);
  select count(*) into v_n from job_assignments where job_id = v_job.id;
  perform assert(v_n = 1, 'the crew went on');

  select status into v_job.status from jobs where id = v_job.id;
  perform assert(v_job.status = 'assigned',
    'a job with people on it is assigned, without anyone setting the column');

  -- A second job over the same hours is refused, then allowed deliberately.
  declare v_clash jobs;
  begin
    v_clash := create_job(v_d1, v_e1, 'Same window',
                          '2026-11-02T09:00:00Z', '2026-11-02T12:00:00Z');
    perform assert_raises(
      format('select set_job_crew(%L, array[%L]::uuid[])', v_clash.id, v_marcus),
      'a double booking is refused');
    perform set_job_crew(v_clash.id, array[v_marcus]::uuid[], true);
    select count(*) into v_n from job_assignments where job_id = v_clash.id;
    perform assert(v_n = 1, 'and goes through when the manager insists');
    perform soft_delete_record('jobs', v_clash.id, 'test fixture');
  end;

  -- Moving it re-cuts the days and un-agrees everyone.
  update job_assignments set acceptance_status = 'accepted' where job_id = v_job.id;
  perform reschedule_job(v_job.id, '2026-11-09T08:00:00Z', '2026-11-10T16:00:00Z', 'Customer moved it');

  select count(*) into v_n from job_visits where job_id = v_job.id;
  perform assert(v_n = 2, 'a shorter job loses the day it no longer runs');

  select count(*) into v_pending from job_assignments
   where job_id = v_job.id and acceptance_status = 'pending';
  perform assert(v_pending = 1,
    'everyone re-accepts after a move: they agreed to the old time');

  perform soft_delete_record('jobs', v_job.id, 'test fixture');
end $$;

-- A crew lead cannot book work, whatever they send.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a003', false);

do $$
declare
  v_d1 uuid := '00000000-0000-0000-0000-0000000000d1';
  v_e1 uuid := '00000000-0000-0000-0000-0000000000e1';
begin
  perform assert_raises(
    format('select create_job(%L, %L, ''Not mine to make'', ''2026-12-01T08:00:00Z'')', v_d1, v_e1),
    'creating a job is refused without job.edit');
  perform assert_raises(
    format('select set_job_crew(%L, array[]::uuid[])', '00000000-0000-0000-0000-00000000bb03'),
    'setting a crew is refused without job.assign');
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo 'JOB AUTHORING ASSERTIONS PASSED'

-- ---------------------------------------------------------------------------
-- Answering the crew
-- ---------------------------------------------------------------------------

set role authenticated;

-- A crew lead asks to move a job he is on.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a003', false);

do $$
declare
  v_job uuid := '00000000-0000-0000-0000-00000000bb03';
  v_assignment uuid;
  v_req reschedule_requests;
  v_n int;
begin
  select id into v_assignment from job_assignments
   where job_id = v_job and user_id = '00000000-0000-0000-0000-00000000a003';

  perform assert_raises(
    format('select request_reschedule(%L, '''')', v_assignment),
    'asking to move a job without saying why is refused');

  v_req := request_reschedule(v_assignment, 'Van is in the shop that morning');

  select count(*) into v_n from job_assignments
   where id = v_assignment and acceptance_status = 'reschedule_requested';
  perform assert(v_n = 1, 'asking to move it shows on the assignment');

  -- Deciding is not his to do.
  perform assert_raises(
    format('select decide_reschedule(%L, true, null, ''2026-10-05T08:00:00Z'')', v_req.id),
    'a crew lead cannot decide his own reschedule request');
end $$;

-- The office decides it.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a002', false);

do $$
declare
  v_job uuid := '00000000-0000-0000-0000-00000000bb03';
  v_req uuid;
  v_n int;
  v_start timestamptz;
begin
  select id into v_req from reschedule_requests
   where job_id = v_job and status = 'pending'
   order by created_at desc limit 1;

  perform assert_raises(
    format('select decide_reschedule(%L, false)', v_req),
    'declining without a reason is refused');
  perform assert_raises(
    format('select decide_reschedule(%L, true)', v_req),
    'approving with no new time is refused — they asked to move it, not drop it');

  perform decide_reschedule(v_req, true, 'Moved to the Monday',
                            '2026-10-05T08:00:00Z', '2026-10-06T16:00:00Z');

  select scheduled_start into v_start from jobs where id = v_job;
  perform assert(v_start = '2026-10-05T08:00:00Z'::timestamptz,
    'approving moves the job to the time the office picked');

  -- The bug this migration exists for: the work days have to follow.
  select count(*) into v_n from job_visits where job_id = v_job;
  perform assert(v_n = 2, 'the work days are re-cut to the new dates');

  select count(*) into v_n from job_assignments
   where job_id = v_job and acceptance_status <> 'pending';
  perform assert(v_n = 0,
    'everyone re-accepts, not only the person who asked');

  perform assert_raises(
    format('select decide_reschedule(%L, true, null, ''2026-10-07T08:00:00Z'')', v_req),
    'a request cannot be decided twice');
end $$;

-- Time off.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a003', false);

do $$
declare v_id uuid;
begin
  insert into time_off (org_id, user_id, kind, starts_at, ends_at, reason)
  values ('00000000-0000-0000-0000-0000000000a1',
          '00000000-0000-0000-0000-00000000a003',
          'vacation', '2026-10-05T00:00:00Z', '2026-10-06T23:59:59Z', 'Long weekend')
  returning id into v_id;

  -- He can see his own clash before he sends it — the job just moved onto
  -- exactly these days.
  perform assert((select count(*) from time_off_clashes(v_id)) = 1,
    'the person asking sees the job they are already booked on');

  perform assert_raises(
    format('select decide_time_off(%L, true)', v_id),
    'deciding time off is refused without timeoff.manage');
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a002', false);

do $$
declare
  v_id uuid;
  v_job uuid := '00000000-0000-0000-0000-00000000bb03';
  v_before timestamptz;
  v_after timestamptz;
  v_row time_off;
begin
  select id into v_id from time_off
   where user_id = '00000000-0000-0000-0000-00000000a003' and status = 'requested'
   order by created_at desc limit 1;

  perform assert((select count(*) from time_off_clashes(v_id)) = 1,
    'and the office sees the same clash');

  perform assert_raises(
    format('select decide_time_off(%L, false)', v_id),
    'declining time off without a reason is refused');

  select scheduled_start into v_before from jobs where id = v_job;
  v_row := decide_time_off(v_id, true);
  select scheduled_start into v_after from jobs where id = v_job;

  perform assert(v_row.status = 'approved', 'approved');
  perform assert(v_row.decided_by = '00000000-0000-0000-0000-00000000a002',
    'and it records who decided it');
  perform assert(v_before = v_after,
    'approving does not move work already booked — that is a separate decision');

  perform assert_raises(
    format('select decide_time_off(%L, false, ''changed my mind'')', v_id),
    'time off cannot be decided twice');

  -- And from now on the scheduling check refuses new bookings for those days.
  perform assert(
    (select scheduling_conflicts('00000000-0000-0000-0000-00000000a003',
       '2026-10-05T09:00:00Z', '2026-10-05T12:00:00Z') is not null),
    'approved time off starts blocking the calendar');
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo 'DECISION ASSERTIONS PASSED'

-- ---------------------------------------------------------------------------
-- Packs: the box of bags problem
-- ---------------------------------------------------------------------------

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a003', false);

do $$
declare
  v_poly uuid := '00000000-0000-0000-0000-000000000102';  -- 6 mil sheeting
  v_suit uuid := '00000000-0000-0000-0000-000000000104';  -- coveralls, counted
  v_wh uuid := '00000000-0000-0000-0000-000000000c01';
  v_van2 uuid := '00000000-0000-0000-0000-000000000c03';  -- nothing on it
  v_j1 uuid := '00000000-0000-0000-0000-00000000bb02';
  v_j2 uuid := '00000000-0000-0000-0000-00000000bb03';
  v_pack stock_packs;
  v_before numeric;
  v_after numeric;
  v_cost1 numeric;
  v_cost2 numeric;
  v_result jsonb;
  v_n int;
begin
  -- Only a bulk item is a pack. A coverall is counted out, one per person.
  perform assert_raises(
    format('select open_pack(%L, %L)', v_suit, v_wh),
    'something counted out cannot be opened as a pack');

  perform assert_raises(
    format('select open_pack(%L, %L)', v_poly, v_van2),
    'a pack cannot be opened where there is none');

  select quantity into v_before from stock_levels
   where item_id = v_poly and location_id = v_wh;

  v_pack := open_pack(v_poly, v_wh);

  select quantity into v_after from stock_levels
   where item_id = v_poly and location_id = v_wh;
  perform assert(v_after = v_before - 1,
    'opening a pack takes exactly one container off the shelf');

  select count(*) into v_n from stock_movements
   where reference_table = 'stock_packs' and reference_id = v_pack.id;
  perform assert(v_n = 1, 'and it goes through the ledger like everything else');

  -- An open pack costs nothing yet: how many jobs it will serve is unknown,
  -- and a number that changes weekly is not a cost.
  perform use_pack_on_job(v_pack.id, v_j1);
  perform assert(job_pack_cost(v_j1) = 0,
    'an open pack has not landed on any job yet');

  -- Saying it twice is not using it twice.
  perform use_pack_on_job(v_pack.id, v_j1);
  select count(*) into v_n from stock_pack_jobs where pack_id = v_pack.id;
  perform assert(v_n = 1, 'logging the same job twice does not double it');

  perform use_pack_on_job(v_pack.id, v_j2);

  v_result := finish_pack(v_pack.id);
  perform assert((v_result ->> 'jobs')::int = 2, 'it served two jobs');

  v_cost1 := job_pack_cost(v_j1);
  v_cost2 := job_pack_cost(v_j2);
  perform assert(v_cost1 = v_cost2, 'the split is even');
  perform assert(round(v_cost1 + v_cost2, 2) = round(v_pack.unit_cost, 2),
    'and the two halves are the whole pack, not more and not less');

  -- It reaches the costing the same way counted materials do.
  perform assert(job_material_cost(v_j1) >= v_cost1,
    'the share lands on the job''s materials line');

  perform assert_raises(
    format('select finish_pack(%L)', v_pack.id),
    'a pack cannot be finished twice');

  perform assert((select count(*) from open_packs where pack_id = v_pack.id) = 0,
    'and it leaves the open list');

  -- A pack nobody logged against a job costs the business, not a job — worth
  -- seeing rather than quietly absorbing.
  declare v_orphan stock_packs; v_orphan_result jsonb;
  begin
    v_orphan := open_pack(v_poly, v_wh);
    v_orphan_result := finish_pack(v_orphan.id);
    perform assert((v_orphan_result ->> 'jobs')::int = 0, 'it served no job');
    perform assert(v_orphan_result ->> 'each' is null,
      'so there is nothing to split it across, and it says so');
  end;
end $$;

-- Moving one needs the transfer flag, which a technician does not have.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a005', false);

do $$
declare v_pack uuid;
begin
  select pack_id into v_pack from open_packs limit 1;
  if v_pack is not null then
    perform assert_raises(
      format('select move_pack(%L, %L)', v_pack, '00000000-0000-0000-0000-000000000c03'),
      'a technician cannot move stock between vans');
  end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo 'PACK ASSERTIONS PASSED'

-- ---------------------------------------------------------------------------
-- Asking to buy something, and approving part of it
-- ---------------------------------------------------------------------------

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a003', false);

do $$
declare
  v_job uuid := '00000000-0000-0000-0000-00000000bb02';
  v_req purchase_requests;
  v_n int;
begin
  perform assert_raises(
    'select create_purchase_request(''[]''::jsonb)',
    'a request with nothing on it is refused');
  perform assert_raises(
    'select create_purchase_request(''[{"description":"","quantity":2}]''::jsonb)',
    'a line that does not say what it is is refused');
  perform assert_raises(
    'select create_purchase_request(''[{"description":"Bags","quantity":0}]''::jsonb)',
    'a line with no quantity is refused');

  -- $600 of filters and $300 of bags: over a manager's $500 limit together,
  -- under it separately. This is the case the threshold bug got wrong.
  v_req := create_purchase_request(
    jsonb_build_array(
      jsonb_build_object('description', 'HEPA filters H14', 'quantity', 6,
                         'unit', 'each', 'estimated_unit_cost', 100),
      jsonb_build_object('description', 'Contractor bags', 'quantity', 10,
                         'unit', 'box', 'estimated_unit_cost', 30)
    ),
    v_job);

  perform assert(v_req.status = 'submitted',
    'raising one submits it — a draft nobody sees helps nobody');

  select count(*) into v_n from purchase_request_lines where request_id = v_req.id;
  perform assert(v_n = 2, 'both lines went on');

  perform assert(purchase_request_selected_total(v_req.id) = 900,
    'the whole request is 900');

  perform assert_raises(
    format('select decide_purchase_request(%L, true)', v_req.id),
    'a crew lead cannot approve his own request');

  -- Two guards, one rule. Row-level security stops the requester touching
  -- their own lines once it is out of draft, so the update simply finds
  -- nothing rather than raising.
  update purchase_request_lines set quantity = 99 where request_id = v_req.id;
  get diagnostics v_n = row_count;
  perform assert(v_n = 0,
    'the person who asked cannot rewrite the ask after submitting it');
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a002', false);

do $$
declare
  v_req uuid;
  v_bags uuid;
  v_filters uuid;
  v_row purchase_requests;
  v_n int;
begin
  select id into v_req from purchase_requests where status = 'submitted'
   order by created_at desc limit 1;
  select id into v_bags from purchase_request_lines
   where request_id = v_req and description = 'Contractor bags';
  select id into v_filters from purchase_request_lines
   where request_id = v_req and description = 'HEPA filters H14';

  -- The manager can reach these rows, so the trigger is what stops the ask
  -- being rewritten under them.
  perform assert_raises(
    format('update purchase_request_lines set quantity = 99 where request_id = %L', v_req),
    'even an approver cannot change what was asked for');
  perform assert_raises(
    format('insert into purchase_request_lines (org_id, request_id, description, quantity) '
           'values (%L, %L, ''One more thing'', 1)',
           '00000000-0000-0000-0000-0000000000a1', v_req),
    'and nothing can be slipped on after it was submitted');

  -- The whole thing is over what a manager may approve.
  perform assert_raises(
    format('select decide_purchase_request(%L, true)', v_req),
    'the full request is over the manager''s limit');

  -- Unticking the expensive line brings it under. This is the fix: the limit
  -- is about what is being spent, not what was asked for.
  perform assert(purchase_request_selected_total(v_req, array[v_bags]) = 300,
    'the ticked lines come to 300');

  v_row := decide_purchase_request(v_req, true, 'Filters can wait', array[v_bags]);
  perform assert(v_row.status = 'approved', 'so it goes through');

  select count(*) into v_n from purchase_request_lines
   where request_id = v_req and line_status = 'approved';
  perform assert(v_n = 1, 'one line approved');

  select count(*) into v_n from purchase_request_lines
   where request_id = v_req and line_status = 'rejected'
     and rejection_reason = 'Filters can wait';
  perform assert(v_n = 1, 'and the other carries the reason it was not');

  perform assert_raises(
    format('select decide_purchase_request(%L, true, null, array[%L]::uuid[])', v_req, v_bags),
    'a decided request cannot be decided again');
end $$;

-- The owner has no limit.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a001', false);

do $$
declare v_req purchase_requests; v_row purchase_requests;
begin
  v_req := create_purchase_request(
    jsonb_build_array(
      jsonb_build_object('description', 'Replacement dehumidifier', 'quantity', 1,
                         'unit', 'each', 'estimated_unit_cost', 2400)
    ));
  v_row := decide_purchase_request(v_req.id, true);
  perform assert(v_row.status = 'approved',
    'the owner approves above the threshold, which is what unlimited means');

  perform assert_raises(
    format('select decide_purchase_request(%L, false)', v_req.id),
    'and a rejection still needs a reason');
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo 'PURCHASING ASSERTIONS PASSED'

-- ---------------------------------------------------------------------------
-- Price is manager information to write, not only to read
--
-- 0018 hid the price columns from the signed-in role. It only revoked SELECT,
-- and the policy on a draft change order did not pin its status — so a crew
-- lead could draft one, put fifty thousand on it and approve it himself,
-- moving job_contract_price() and the owner's margin without ever seeing a
-- number. These prove both halves are shut.
-- ---------------------------------------------------------------------------

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a003', false);

do $$
declare
  v_job uuid := '00000000-0000-0000-0000-00000000bb02';
  v_id uuid;
  v_n int;
begin
  -- Drafting is his job and still works.
  v_id := create_change_order(v_job, 'Rot behind the north wall',
                              'Found pulling the vanity out', 4);
  perform assert(v_id is not null, 'a crew lead can still raise a change order');

  select count(*) into v_n from change_orders where id = v_id and status = 'draft';
  perform assert(v_n = 1, 'it lands as a draft');

  -- Pricing it is not.
  perform assert_raises(
    format('update change_orders set amount = 50000 where id = %L', v_id),
    'he cannot put a price on it — the column is not writable by his role');

  -- Nor is approving it.
  perform assert_raises(
    format('update change_orders set status = ''approved'' where id = %L', v_id),
    'he cannot approve his own draft');

  perform assert_raises(
    format('select present_change_order(%L, 50000)', v_id),
    'and the front door needs changeorder.manage');

  perform assert_raises(
    format('select decide_change_order(%L, true)', v_id),
    'as does deciding it');

  -- The same guard on the job's own price.
  perform assert_raises(
    format('update jobs set quoted_price = 50000 where id = %L', v_job),
    'he cannot set the job price directly either');
  perform assert_raises(
    format('select set_job_price(%L, 50000)', v_job),
    'and the function refuses him too');

  -- Editing his own draft's words is still his to do.
  update change_orders set description = 'Worse than it looked' where id = v_id;
  select count(*) into v_n from change_orders
   where id = v_id and description = 'Worse than it looked';
  perform assert(v_n = 1, 'he can still correct what he wrote');
end $$;

-- The manager does all of it.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a002', false);

do $$
declare
  v_job uuid := '00000000-0000-0000-0000-00000000bb02';
  v_id uuid;
  v_before numeric;
  v_after numeric;
  v_amount numeric;
begin
  select id into v_id from change_orders
   where job_id = v_job and status = 'draft' and title = 'Rot behind the north wall';

  v_before := job_contract_price(v_job);

  perform present_change_order(v_id, 1800);
  select amount into v_amount from change_orders_safe where id = v_id;
  perform assert(v_amount = 1800, 'the manager prices it');

  -- Presented is not agreed: the contract price must not move yet.
  perform assert(job_contract_price(v_job) = v_before,
    'presenting it does not change what the job is worth');

  perform decide_change_order(v_id, true, 'verbal', 'Helen Brooks');
  v_after := job_contract_price(v_job);
  perform assert(v_after = v_before + 1800,
    'agreeing it does, and by exactly the amount agreed');

  -- And the office can still set a job price, through the one door that is left.
  perform set_job_price(v_job, 8600);
  perform assert((select quoted_price from jobs_safe where id = v_job) = 8600,
    'the office sets a price through set_job_price()');
  perform assert_raises(
    format('update jobs set quoted_price = 9999 where id = %L', v_job),
    'but not by writing the column, even as a manager — nobody writes it directly');
end $$;

-- ---------------------------------------------------------------------------
-- 0028: the crew lead reads the price, and still cannot move it
--
-- The two halves are asserted together on purpose. Reading it is the whole
-- point of 0028; the moment reading implies writing, 0027 has been undone.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a003', false);

do $$
declare
  v_job uuid := '00000000-0000-0000-0000-00000000bb02';
  v_price numeric;
  v_contract numeric;
  v_id uuid;
begin
  perform assert(has_permission('price.view'),
    'the crew lead holds price.view');

  select quoted_price, contract_price into v_price, v_contract
    from jobs_safe where id = v_job;
  perform assert(v_price is not null,
    'he reads the quoted price off jobs_safe');
  perform assert(v_contract is not null and v_contract >= v_price,
    'and the contract price, which is what the job is now worth');

  -- What he must NOT have gained along with it.
  perform assert(not has_permission('costing.view'),
    'but not what the job cost us');
  perform assert(not has_permission('user.view_cost_rates'),
    'nor what anybody is paid');
  perform assert((select cost_rate from profiles_safe
                   where id = '00000000-0000-0000-0000-00000000a005') is null,
    'a colleague''s cost rate is still masked');
  perform assert(not has_permission('job.edit'),
    'and no job.edit, which set_job_price() also requires');

  -- Every door onto the number, still shut.
  perform assert_raises(
    format('update jobs set quoted_price = 99999 where id = %L', v_job),
    'he cannot write the price column');
  perform assert_raises(
    format('select set_job_price(%L, 99999)', v_job),
    'nor go through set_job_price(), which needs job.edit');

  select create_change_order(v_job, 'Wall is worse than quoted',
                             'Rot runs past the corner.') into v_id;
  perform assert_raises(
    format('update change_orders set amount = 50000 where id = %L', v_id),
    'nor price the change order he just raised');
  perform assert_raises(
    format('select present_change_order(%L, 50000)', v_id),
    'nor present it, which needs changeorder.manage');
  perform assert_raises(
    format('update change_orders set status = ''approved'' where id = %L', v_id),
    'nor approve his own draft');
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo 'PRICE WRITE ASSERTIONS PASSED'
