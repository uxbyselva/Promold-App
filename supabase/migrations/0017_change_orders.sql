-- 0017 Change orders
--
-- Every job is billed flat, direct to the customer, with no insurer absorbing
-- overruns. So when scope grows mid-job — more rooms affected than the
-- inspection found, rot behind a wall — the extra work is either agreed and
-- priced, or it is done for free. There is no third outcome.
--
-- A change order is that agreement: extra scope, a price, and the customer's
-- decision recorded. The contract price is then derived from the base quote
-- plus approved change orders, so the original quote stays visible and the
-- growth is auditable.

create type change_order_status as enum (
  'draft', 'presented', 'approved', 'rejected', 'cancelled'
);

-- How the customer's agreement was captured. Residential work is often agreed
-- verbally on site; recording which is which matters if it is ever disputed.
create type change_order_approval as enum ('signature', 'verbal', 'written');

create table change_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  seq int not null,
  title text not null,
  -- What was found and what it takes to put right, in language the customer
  -- will read.
  description text not null,
  -- Negative is legitimate: a descope credit is a change order too.
  amount numeric(12,2),
  added_hours numeric(6,2),
  status change_order_status not null default 'draft',
  presented_at timestamptz,
  decided_at timestamptz,
  approval_method change_order_approval,
  -- Whoever agreed on the customer's side, however it was captured.
  customer_name text,
  signature_id uuid references signatures(id),
  decision_reason text,
  created_by uuid references profiles(id),
  presented_by uuid references profiles(id),
  recorded_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, seq),
  -- A presented change order must carry a price; "we'll sort it out later" is
  -- how the margin disappears.
  constraint change_order_priced check (
    status = 'draft' or status = 'cancelled' or amount is not null
  ),
  constraint change_order_signature_present check (
    approval_method is distinct from 'signature' or signature_id is not null
  ),
  constraint change_order_verbal_named check (
    approval_method is distinct from 'verbal'
      or (customer_name is not null and length(trim(customer_name)) > 0)
  )
);

create index on change_orders (job_id, seq);
create index on change_orders (org_id, status) where status = 'presented';

create table change_order_photos (
  change_order_id uuid not null references change_orders(id) on delete cascade,
  photo_id uuid not null references job_photos(id) on delete cascade,
  primary key (change_order_id, photo_id)
);

select attach_updated_at('change_orders');
select attach_audit('change_orders');

-- Per-job numbering: CO-1, CO-2. Assigned server-side so two people drafting
-- at once cannot collide.
create or replace function change_order_assign_seq()
returns trigger
language plpgsql
as $$
begin
  if new.seq is null or new.seq = 0 then
    select coalesce(max(seq), 0) + 1 into new.seq
    from change_orders where job_id = new.job_id;
  end if;
  return new;
end;
$$;

create trigger trg_change_orders_seq
  before insert on change_orders
  for each row execute function change_order_assign_seq();

alter table change_orders alter column seq set default 0;

-- ---------------------------------------------------------------------------
-- Derived contract price
-- ---------------------------------------------------------------------------

comment on column jobs.quoted_price is
  'The BASE quoted price. The amount actually owed is job_contract_price(), '
  'which adds approved change orders.';

create or replace function job_change_order_total(p_job_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(sum(amount), 0)
  from change_orders
  where job_id = p_job_id and status = 'approved';
$$;

create or replace function job_contract_price(p_job_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce((select quoted_price from jobs where id = p_job_id), 0)
       + job_change_order_total(p_job_id);
$$;

-- Money agreed but not yet decided by the customer. Surfaced so a job is not
-- closed with an open question hanging over it.
create or replace function job_pending_change_order_total(p_job_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(sum(amount), 0)
  from change_orders
  where job_id = p_job_id and status = 'presented';
$$;

-- ---------------------------------------------------------------------------
-- Workflow
-- ---------------------------------------------------------------------------

-- The crew lead on site finds the extra damage and drafts it, with photos.
-- Pricing and presenting is the manager's, which is why the flags differ.
create or replace function present_change_order(
  p_change_order_id uuid,
  p_amount numeric default null
)
returns change_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_co change_orders;
begin
  if not has_permission('changeorder.manage') then
    raise exception 'Permission changeorder.manage required'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_co from change_orders where id = p_change_order_id for update;
  if v_co.id is null then
    raise exception 'Change order % not found', p_change_order_id using errcode = 'P0002';
  end if;
  if v_co.status <> 'draft' then
    raise exception 'Only a draft change order can be presented (currently %)', v_co.status
      using errcode = 'check_violation';
  end if;
  if coalesce(p_amount, v_co.amount) is null then
    raise exception 'A change order needs a price before it is presented'
      using errcode = 'check_violation';
  end if;

  update change_orders
  set amount = coalesce(p_amount, amount),
      status = 'presented',
      presented_at = now(),
      presented_by = auth_user_id()
  where id = p_change_order_id
  returning * into v_co;

  return v_co;
end;
$$;

create or replace function decide_change_order(
  p_change_order_id uuid,
  p_approve boolean,
  p_method change_order_approval default 'verbal',
  p_customer_name text default null,
  p_signature_id uuid default null,
  p_reason text default null
)
returns change_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_co change_orders;
begin
  if not has_permission('changeorder.manage') then
    raise exception 'Permission changeorder.manage required'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_co from change_orders where id = p_change_order_id for update;
  if v_co.id is null then
    raise exception 'Change order % not found', p_change_order_id using errcode = 'P0002';
  end if;
  if v_co.status <> 'presented' then
    raise exception 'Change order is % and cannot be decided', v_co.status
      using errcode = 'check_violation';
  end if;

  if p_approve then
    -- Who agreed, and how, is the whole value of the record. Without it there
    -- is nothing to point at when the final bill is questioned.
    if p_method = 'signature' and p_signature_id is null then
      raise exception 'A signature approval needs the signature'
        using errcode = 'check_violation';
    end if;
    if p_method <> 'signature'
       and (p_customer_name is null or length(trim(p_customer_name)) = 0) then
      raise exception 'Record who agreed on the customer side'
        using errcode = 'check_violation';
    end if;
  elsif p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required when the customer declines'
      using errcode = 'check_violation';
  end if;

  update change_orders
  set status = case when p_approve then 'approved' else 'rejected' end::change_order_status,
      decided_at = now(),
      approval_method = case when p_approve then p_method else null end,
      customer_name = case when p_approve then p_customer_name else customer_name end,
      signature_id = case when p_approve then p_signature_id else null end,
      decision_reason = p_reason,
      recorded_by = auth_user_id()
  where id = p_change_order_id
  returning * into v_co;

  return v_co;
end;
$$;

-- ---------------------------------------------------------------------------
-- Costing against the contract price, not the original quote
-- ---------------------------------------------------------------------------

drop view if exists job_costs;

create view job_costs
with (security_invoker = true)
as
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
  -- Margin is owner, manager and bookkeeper information, not field information.
  and has_permission('costing.view');

comment on view job_costs is
  'Per-job cost rollup against the contract price (base quote plus approved '
  'change orders). All components derived.';

-- ---------------------------------------------------------------------------
-- Completion gate: no closing a job with money still on the table
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
    v_blockers := array_append(v_blockers, 'Customer completion signature required');
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

  if exists (
    select 1 from time_entries where job_id = p_job_id and clock_out_at is null
  ) then
    v_blockers := array_append(v_blockers,
      'Open time entries — everyone must be clocked out');
  end if;

  -- The gate that stops air scrubbers being forgotten at finished jobs.
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
    v_blockers := array_append(v_blockers,
      'Rented equipment outstanding with no return date');
  end if;

  -- Work billed flat and direct to the customer: a change order still waiting
  -- on an answer is money the job will never collect once the crew drives
  -- away. Settle it before the job closes.
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
-- Permissions
-- ---------------------------------------------------------------------------

alter table change_orders enable row level security;
alter table change_orders force row level security;
alter table change_order_photos enable row level security;
alter table change_order_photos force row level security;

create policy change_orders_select on change_orders for select
  using (org_id = auth_org_id() and can_see_job(job_id));

-- The person who finds the extra damage drafts it; only a manager prices and
-- presents it.
create policy change_orders_draft on change_orders for insert
  with check (
    org_id = auth_org_id()
    and status = 'draft'
    and has_permission('changeorder.draft')
    and can_see_job(job_id)
  );

create policy change_orders_own_draft on change_orders for update
  using (created_by = auth_user_id() and status = 'draft')
  with check (created_by = auth_user_id());

create policy change_orders_manage on change_orders for all
  using (org_id = auth_org_id() and has_permission('changeorder.manage'))
  with check (org_id = auth_org_id() and has_permission('changeorder.manage'));

create policy change_order_photos_select on change_order_photos for select
  using (exists (
    select 1 from change_orders co
    where co.id = change_order_id and co.org_id = auth_org_id() and can_see_job(co.job_id)
  ));
create policy change_order_photos_write on change_order_photos for all
  using (exists (
    select 1 from change_orders co
    where co.id = change_order_id and co.org_id = auth_org_id()
      and (has_permission('changeorder.draft') or has_permission('changeorder.manage'))
  ))
  with check (exists (
    select 1 from change_orders co
    where co.id = change_order_id and co.org_id = auth_org_id()
  ));

-- Grant the new flags to existing roles, and to every org provisioned later.
update roles set permissions = permissions || '{"changeorder.draft": true, "changeorder.manage": true}'::jsonb
where key in ('owner', 'manager');

update roles set permissions = permissions || '{"changeorder.draft": true}'::jsonb
where key in ('crew_lead', 'technician');

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
    'costing.view', true, 'export.run', true
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
    'costing.view', true, 'export.run', true
  )),

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

  (p_org_id, 'bookkeeper', 'Bookkeeper', true, jsonb_build_object(
    'job.view_all', true,
    'purchase.view_all', true, 'purchase.view_history', true,
    'mileage.view_all', true, 'time.view_all', true,
    'audit.view', true, 'costing.view', true, 'export.run', true,
    'job.close', true
  ))
  on conflict (org_id, key) do nothing;
end;
$$;
