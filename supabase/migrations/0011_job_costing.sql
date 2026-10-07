-- 0011 Job costing
--
-- Derived from source rows rather than stored, so the costing model can be
-- reshaped later without migrating historical data.
--
-- This is the payoff for everything the field crew is asked to log. Without
-- it the logging reads as surveillance; with it the owner can see which
-- flat-quoted jobs actually made money.

create or replace function job_labour_cost(p_job_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(sum(time_entry_hours(t) * coalesce(p.cost_rate, 0)), 0)
  from time_entries t
  join profiles p on p.id = t.user_id
  where t.job_id = p_job_id and t.clock_out_at is not null;
$$;

create or replace function job_material_cost(p_job_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(sum(mu.quantity * i.average_cost), 0)
  from material_usage mu
  join inventory_items i on i.id = mu.item_id
  where mu.job_id = p_job_id;
$$;

-- Only approved lines count, and only on requests that were not rejected or
-- cancelled outright.
create or replace function job_purchase_cost(p_job_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(sum(l.quantity * coalesce(l.estimated_unit_cost, 0)), 0)
  from purchase_request_lines l
  join purchase_requests r on r.id = l.request_id
  where r.job_id = p_job_id
    and l.line_status = 'approved'
    and r.status not in ('draft', 'rejected', 'cancelled');
$$;

create or replace function job_mileage_cost(p_job_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(
    sum(m.distance) * coalesce((o.settings ->> 'mileage_rate')::numeric, 0),
    0
  )
  from mileage_logs m
  join organizations o on o.id = m.org_id
  where m.job_id = p_job_id and m.is_business
  group by o.settings;
$$;

-- Owned equipment: days deployed against this job times the unit's internal
-- day rate. A placement still open is counted to now, so a job with a
-- scrubber sitting at the site keeps accruing cost and the margin visibly
-- erodes.
create or replace function job_equipment_cost(p_job_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(sum(
    ceil(
      extract(epoch from (coalesce(a.ended_at, now()) - a.started_at)) / 86400.0
    ) * e.internal_day_rate
  ), 0)
  from equipment_assignments a
  join equipment e on e.id = a.equipment_id
  where a.job_id = p_job_id;
$$;

-- Rented equipment: the vendor's actual charge, falling back to the estimate
-- while the invoice is outstanding.
create or replace function job_rental_cost(p_job_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(sum(coalesce(actual_cost, estimated_cost, 0)), 0)
  from equipment_rentals
  where job_id = p_job_id and status <> 'cancelled';
$$;

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
  j.quoted_price,
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
    coalesce(j.quoted_price, 0) - (
      job_labour_cost(j.id) + job_material_cost(j.id) + job_purchase_cost(j.id)
      + job_mileage_cost(j.id) + job_equipment_cost(j.id) + job_rental_cost(j.id)
    )
  ) as margin
from jobs j
where j.deleted_at is null
  -- Margin is owner, manager and bookkeeper information, not field information.
  and has_permission('costing.view');

comment on view job_costs is
  'Per-job cost rollup against the flat quoted price. All components derived.';
