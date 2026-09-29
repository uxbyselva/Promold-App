-- 0018 Price visibility
--
-- What a job is worth is manager and owner information. The crew needs the
-- address, the scope, the equipment and the evidence to finish the work; they
-- do not need the number the customer is paying, and change order amounts are
-- pricing too.
--
-- Postgres RLS is row level, and under Supabase every signed-in user is the
-- same `authenticated` role, so a column grant cannot tell a manager from a
-- technician. The only enforcement that actually holds is: revoke the money
-- columns from `authenticated` on the base tables, and expose them through
-- definer-rights views that check the permission flag. Those views run as
-- their owner and therefore bypass RLS, so each one re-applies the row filter
-- its base table's policy would have applied.

-- ---------------------------------------------------------------------------
-- The flag
--
-- Deliberately separate from costing.view: seeing the price the customer pays
-- and seeing what the job cost us are different questions, and a role could
-- reasonably have one without the other.
-- ---------------------------------------------------------------------------

update roles
set permissions = permissions || '{"price.view": true}'::jsonb
where key in ('owner', 'manager', 'bookkeeper');

-- ---------------------------------------------------------------------------
-- Money-reading functions become definer, or they break for everyone once the
-- columns are revoked.
-- ---------------------------------------------------------------------------

create or replace function job_change_order_total(p_job_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount), 0)
  from change_orders
  where job_id = p_job_id and status = 'approved';
$$;

create or replace function job_contract_price(p_job_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select quoted_price from jobs where id = p_job_id), 0)
       + job_change_order_total(p_job_id);
$$;

create or replace function job_pending_change_order_total(p_job_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount), 0)
  from change_orders
  where job_id = p_job_id and status = 'presented';
$$;

create or replace function job_purchase_cost(p_job_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(l.quantity * coalesce(l.estimated_unit_cost, 0)), 0)
  from purchase_request_lines l
  join purchase_requests r on r.id = l.request_id
  where r.job_id = p_job_id
    and l.line_status = 'approved'
    and r.status not in ('draft', 'rejected', 'cancelled');
$$;

create or replace function job_labour_cost(p_job_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(time_entry_hours(t) * coalesce(p.cost_rate, 0)), 0)
  from time_entries t
  join profiles p on p.id = t.user_id
  where t.job_id = p_job_id and t.clock_out_at is not null;
$$;

-- ---------------------------------------------------------------------------
-- The safe read paths
-- ---------------------------------------------------------------------------

-- Everything a field user legitimately needs about a job, with the money
-- masked unless they hold price.view. This is what both clients read; the
-- base table keeps the column for writes and for the costing rollup.
create or replace view jobs_safe as
select
  j.id, j.org_id, j.job_number, j.customer_id, j.site_id, j.template_id,
  j.title, j.description, j.status, j.priority,
  j.scheduled_start, j.scheduled_end, j.actual_start, j.actual_end,
  case when has_permission('price.view') then j.quoted_price end as quoted_price,
  case when has_permission('price.view') then job_contract_price(j.id) end as contract_price,
  case when has_permission('price.view') then job_change_order_total(j.id) end as change_order_total,
  j.insurance_claim_no, j.adjuster_contact, j.recurrence_rule, j.parent_job_id,
  j.blocked_reason, j.cancelled_reason, j.created_by, j.created_at, j.updated_at
from jobs j
where j.deleted_at is null
  and j.org_id = auth_org_id()
  and can_see_job(j.id);

comment on view jobs_safe is
  'Jobs as a field user may read them: price masked unless price.view. Definer '
  'rights, so the row filter from the jobs RLS policy is repeated here.';

-- A crew lead drafts a change order describing what they found; the amount is
-- the manager''s to set and to see.
create or replace view change_orders_safe as
select
  co.id, co.org_id, co.job_id, co.seq, co.title, co.description,
  case when has_permission('price.view') then co.amount end as amount,
  co.added_hours, co.status, co.presented_at, co.decided_at,
  co.approval_method, co.customer_name, co.signature_id, co.decision_reason,
  co.created_by, co.presented_by, co.recorded_by, co.created_at, co.updated_at
from change_orders co
where co.org_id = auth_org_id()
  and can_see_job(co.job_id);

comment on view change_orders_safe is
  'Change orders with the amount masked unless price.view.';

-- profiles_safe was security_invoker, which left cost_rate readable straight
-- off the base table. Same treatment: definer rights, explicit row filter.
drop view if exists profiles_safe;

create view profiles_safe as
select
  p.id, p.org_id, p.role_id, p.full_name, p.email, p.phone,
  p.is_active, p.created_at,
  case when has_permission('user.view_cost_rates') then p.cost_rate end as cost_rate
from profiles p
where p.org_id = auth_org_id();

-- job_costs read quoted_price directly and was security_invoker, so the
-- revoke below would have broken it for everyone. Definer rights plus its own
-- org filter, keeping the costing.view gate exactly as it was.
drop view if exists job_costs;

create view job_costs as
select
  j.id as job_id,
  j.org_id,
  j.job_number,
  j.title,
  j.status,
  j.customer_id,
  j.site_id,
  j.template_id,
  coalesce(j.quoted_price, 0)          as base_price,
  job_change_order_total(j.id)         as change_order_total,
  job_contract_price(j.id)             as contract_price,
  job_pending_change_order_total(j.id) as pending_change_orders,
  job_labour_cost(j.id)    as labour_cost,
  job_material_cost(j.id)  as material_cost,
  job_purchase_cost(j.id)  as purchase_cost,
  job_mileage_cost(j.id)   as mileage_cost,
  job_equipment_cost(j.id) as equipment_cost,
  job_rental_cost(j.id)    as rental_cost,
  (
    job_labour_cost(j.id) + job_material_cost(j.id) + job_purchase_cost(j.id)
    + job_mileage_cost(j.id) + job_equipment_cost(j.id) + job_rental_cost(j.id)
  ) as total_cost,
  (
    job_contract_price(j.id) - (
      job_labour_cost(j.id) + job_material_cost(j.id) + job_purchase_cost(j.id)
      + job_mileage_cost(j.id) + job_equipment_cost(j.id) + job_rental_cost(j.id)
    )
  ) as margin
from jobs j
where j.deleted_at is null
  and j.org_id = auth_org_id()
  -- Margin is owner, manager and bookkeeper information, not field information.
  and has_permission('costing.view');

comment on view job_costs is
  'Per-job cost rollup against the contract price. Definer rights, gated on '
  'costing.view, org filter applied explicitly.';

-- ---------------------------------------------------------------------------
-- Close the direct path
--
-- Without this the views are decoration: a technician could read the column
-- straight off the table. Note the cost: `select *` on these tables now fails
-- for app users, which is why clients read jobs through jobs_safe.
-- ---------------------------------------------------------------------------

-- A column-level revoke cannot override an existing table-level SELECT grant:
-- Postgres keeps the broader grant and the revoke silently does nothing. The
-- only way to withhold one column is to drop the table grant and re-grant the
-- columns that remain. Doing it by enumeration would rot the first time
-- someone adds a column, so this derives the list.
create or replace function grant_columns_except(p_table text, p_exclude text[])
returns void
language plpgsql
as $$
declare
  v_cols text;
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    return;
  end if;

  execute format('revoke select on %I from authenticated', p_table);

  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
  into v_cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name = p_table
    and not (column_name = any(p_exclude));

  execute format('grant select (%s) on %I to authenticated', v_cols, p_table);
end;
$$;

comment on function grant_columns_except(text, text[]) is
  'Withholds columns from the authenticated role. Re-run for a table after '
  'adding a column to it, or the new column stays unreadable.';

select grant_columns_except('jobs', array['quoted_price']);
select grant_columns_except('change_orders', array['amount']);
select grant_columns_except('profiles', array['cost_rate']);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select on jobs_safe, change_orders_safe, profiles_safe, job_costs to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on jobs, change_orders, profiles from anon';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Every org provisioned from here on
-- ---------------------------------------------------------------------------

create or replace function provision_org_roles(p_org_id uuid)
returns void
language plpgsql
as $$
begin
  insert into roles (org_id, key, name, is_system, permissions) values
  (p_org_id, 'owner', 'Owner', true, jsonb_build_object(
    'job.view_all', true, 'job.edit', true, 'job.assign', true, 'job.accept', true,
    'job.complete', true, 'job.review', true, 'job.close', true, 'job.manage_templates', true,
    'reschedule.decide', true, 'customer.manage', true,
    'changeorder.draft', true, 'changeorder.manage', true,
    'inventory.manage', true, 'inventory.log_usage', true, 'inventory.transfer', true,
    'inventory.adjust', true,
    'purchase.approve', true, 'purchase.approve_unlimited', true,
    'purchase.view_all', true, 'purchase.view_history', true,
    'vehicle.manage', true, 'mileage.view_all', true, 'mileage.edit_all', true,
    'equipment.manage', true, 'equipment.place', true, 'equipment.rental_manage', true,
    'time.view_all', true, 'time.log_others', true, 'time.edit_all', true,
    'timeoff.manage', true, 'user.manage', true, 'user.view_cost_rates', true,
    'role.manage', true, 'org.manage_settings', true, 'audit.view', true,
    'price.view', true, 'costing.view', true, 'export.run', true
  )),

  (p_org_id, 'manager', 'Manager', true, jsonb_build_object(
    'job.view_all', true, 'job.edit', true, 'job.assign', true, 'job.accept', true,
    'job.complete', true, 'job.review', true, 'job.manage_templates', true,
    'reschedule.decide', true, 'customer.manage', true,
    'changeorder.draft', true, 'changeorder.manage', true,
    'inventory.manage', true, 'inventory.log_usage', true, 'inventory.transfer', true,
    'inventory.adjust', true,
    'purchase.approve', true, 'purchase.view_all', true, 'purchase.view_history', true,
    'vehicle.manage', true, 'mileage.view_all', true, 'mileage.edit_all', true,
    'equipment.manage', true, 'equipment.place', true, 'equipment.rental_manage', true,
    'time.view_all', true, 'time.log_others', true, 'time.edit_all', true,
    'timeoff.manage', true, 'user.manage', true, 'audit.view', true,
    'price.view', true, 'costing.view', true, 'export.run', true
  )),

  -- No price.view: a crew lead runs the work, not the commercials.
  (p_org_id, 'crew_lead', 'Crew Lead', true, jsonb_build_object(
    'job.accept', true, 'job.complete', true,
    'changeorder.draft', true,
    'inventory.log_usage', true, 'inventory.transfer', true,
    'equipment.place', true,
    'time.log_others', true
  )),

  (p_org_id, 'technician', 'Technician', true, jsonb_build_object(
    'job.accept', true, 'job.complete', true,
    'changeorder.draft', true,
    'inventory.log_usage', true,
    'equipment.place', true
  )),

  -- Keeps the books, so needs the price but never the margin conversation.
  (p_org_id, 'bookkeeper', 'Bookkeeper', true, jsonb_build_object(
    'job.view_all', true,
    'purchase.view_all', true, 'purchase.view_history', true,
    'mileage.view_all', true, 'time.view_all', true,
    'audit.view', true, 'price.view', true, 'costing.view', true, 'export.run', true,
    'job.close', true
  ))
  on conflict (org_id, key) do nothing;
end;
$$;
