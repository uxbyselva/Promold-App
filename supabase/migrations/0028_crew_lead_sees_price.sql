-- 0028 A crew lead sees what the job is worth
--
-- The crew lead is the person standing in the basement when the wall comes
-- off and there is twice as much rot behind it as anybody quoted for. Until
-- now he could write that up but not see the number it was being measured
-- against, so "this is bigger than the job" was a feeling rather than a
-- figure. Giving him the contract price makes the report he sends the office
-- worth acting on: not "there's more here", but "there's more here and we
-- quoted 8,600 for it".
--
-- Reading a price and moving one are different things, and after 0027 they
-- are enforced differently. Nothing here lets him move it:
--
--   * `jobs.quoted_price` and `change_orders.amount` are not writable by the
--     signed-in role at all — 0027 dropped the table grant and re-granted
--     every other column. No permission flag brings that back.
--   * `set_job_price()` needs job.edit AND price.view. A crew lead has
--     neither job.edit nor any way to get it.
--   * `present_change_order()` and `decide_change_order()` need
--     changeorder.manage. He has changeorder.draft, which raises a draft with
--     no price on it, and the row policy pins it there.
--
-- Three things price.view deliberately does NOT open, because they are
-- separate flags and stay that way:
--
--   * `costing.view` — what the job cost us, and the margin. Still manager
--     and owner only. He sees the price, not the profit.
--   * `user.view_cost_rates` — what his colleagues are paid. Owner only.
--   * The technician role. This is the lead's job, not the whole crew's.

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
    'data.restore', true,
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

  -- price.view, so he can tell the office the work has outgrown the quote.
  -- No costing.view: the price is not the margin.
  (p_org_id, 'crew_lead', 'Crew Lead', true, jsonb_build_object(
    'job.accept', true, 'job.complete', true,
    'changeorder.draft', true,
    'inventory.log_usage', true, 'inventory.transfer', true,
    'equipment.place', true,
    'time.log_others', true,
    'price.view', true
  )),

  -- Still no price. A technician is told what to do, not what it is worth.
  (p_org_id, 'technician', 'Technician', true, jsonb_build_object(
    'job.accept', true, 'job.complete', true,
    'changeorder.draft', true,
    'inventory.log_usage', true,
    'equipment.place', true
  )),

  -- Keeps the books, so needs the price but never the margin conversation.
  -- audit.view lets them read the trail; nothing here lets them change it.
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

-- Orgs that already exist. Only the system crew_lead role, and only where the
-- flag is not already set — an owner who turned it off by hand meant it.
update roles
   set permissions = permissions || '{"price.view": true}'::jsonb
 where key = 'crew_lead'
   and is_system
   and coalesce((permissions ->> 'price.view')::boolean, false) = false;
