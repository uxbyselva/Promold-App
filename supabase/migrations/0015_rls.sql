-- 0015 Row level security
--
-- The permission matrix in docs/04-permissions.md is enforced here, in the
-- database, not in the clients. A technician calling the REST endpoint
-- directly must not be able to approve a purchase request, and that guarantee
-- cannot live in a React component.

-- Every table is org-scoped and denies by default; policies open specific
-- doors from there.
create or replace function enable_rls(p_table text)
returns void
language plpgsql
as $$
begin
  execute format('alter table %I enable row level security', p_table);
  execute format('alter table %I force row level security', p_table);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'organizations','roles','profiles','crews','crew_members','time_off',
    'customers','sites','job_templates','jobs','job_visits','job_assignments',
    'job_status_history','reschedule_requests','job_comments','job_documents',
    'time_entries','job_photos','form_templates','form_submissions','signatures',
    'suppliers','inventory_items','stock_locations','stock_movements','material_usage',
    'purchase_requests','purchase_request_lines','purchase_request_audit',
    'vehicles','mileage_logs','fuel_logs','vehicle_maintenance',
    'equipment','equipment_assignments','equipment_rentals',
    'equipment_runtime_logs','equipment_maintenance',
    'certification_types','user_certifications','notifications','audit_log'
  ] loop
    perform enable_rls(t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Helper: does the caller have a stake in this job?
-- ---------------------------------------------------------------------------

create or replace function can_see_job(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select has_permission('job.view_all')
      or exists (
        select 1 from job_assignments a
        where a.job_id = p_job_id and a.user_id = auth_user_id()
      )
      or exists (
        -- A crew lead sees the whole crew's work, not only their own row.
        select 1
        from job_assignments a
        join crew_members cm on cm.crew_id = a.crew_id
        join crews c on c.id = a.crew_id
        where a.job_id = p_job_id
          and c.lead_user_id = auth_user_id()
          and cm.user_id is not null
      );
$$;

-- ---------------------------------------------------------------------------
-- Org-wide reference data: readable by the whole org, writable with a flag
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  write_flag text;
begin
  foreach t in array array[
    'customers','sites','job_templates','suppliers','inventory_items',
    'stock_locations','vehicles','equipment','form_templates','certification_types',
    'crews','roles'
  ] loop
    write_flag := case t
      when 'customers' then 'customer.manage'
      when 'sites' then 'customer.manage'
      when 'job_templates' then 'job.manage_templates'
      when 'suppliers' then 'inventory.manage'
      when 'inventory_items' then 'inventory.manage'
      when 'stock_locations' then 'inventory.manage'
      when 'vehicles' then 'vehicle.manage'
      when 'equipment' then 'equipment.manage'
      when 'form_templates' then 'job.manage_templates'
      when 'certification_types' then 'user.manage'
      when 'crews' then 'user.manage'
      when 'roles' then 'role.manage'
    end;

    execute format($p$
      create policy %1$s_select on %1$I for select
        using (org_id = auth_org_id());
    $p$, t);

    execute format($p$
      create policy %1$s_write on %1$I for all
        using (org_id = auth_org_id() and has_permission(%2$L))
        with check (org_id = auth_org_id() and has_permission(%2$L));
    $p$, t, write_flag);
  end loop;
end $$;

-- crew_members carries no org_id of its own; it is scoped through its crew.
create policy crew_members_select on crew_members for select
  using (exists (select 1 from crews c where c.id = crew_id and c.org_id = auth_org_id()));
create policy crew_members_write on crew_members for all
  using (
    has_permission('user.manage')
    and exists (select 1 from crews c where c.id = crew_id and c.org_id = auth_org_id())
  )
  with check (
    has_permission('user.manage')
    and exists (select 1 from crews c where c.id = crew_id and c.org_id = auth_org_id())
  );

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

create policy organizations_select on organizations for select
  using (id = auth_org_id());
create policy organizations_update on organizations for update
  using (id = auth_org_id() and has_permission('org.manage_settings'))
  with check (id = auth_org_id() and has_permission('org.manage_settings'));

-- Everyone can see who their colleagues are; cost_rate is protected by the
-- profiles_safe view rather than by hiding the row.
create policy profiles_select on profiles for select
  using (org_id = auth_org_id());
create policy profiles_self_update on profiles for update
  using (id = auth_user_id())
  with check (id = auth_user_id());
create policy profiles_admin_write on profiles for all
  using (org_id = auth_org_id() and has_permission('user.manage'))
  with check (org_id = auth_org_id() and has_permission('user.manage'));

-- cost_rate is owner-only. Exposing the column through a view keeps the
-- underlying row readable for names and phone numbers.
create view profiles_safe
with (security_invoker = true)
as
select
  id, org_id, role_id, full_name, email, phone, is_active, created_at,
  case when has_permission('user.view_cost_rates') then cost_rate else null end as cost_rate
from profiles;

create policy time_off_select on time_off for select
  using (org_id = auth_org_id() and (user_id = auth_user_id() or has_permission('timeoff.manage')));
create policy time_off_insert on time_off for insert
  with check (org_id = auth_org_id() and user_id = auth_user_id());
create policy time_off_manage on time_off for all
  using (org_id = auth_org_id() and has_permission('timeoff.manage'))
  with check (org_id = auth_org_id() and has_permission('timeoff.manage'));

-- ---------------------------------------------------------------------------
-- Jobs
-- ---------------------------------------------------------------------------

create policy jobs_select on jobs for select
  using (org_id = auth_org_id() and can_see_job(id));
create policy jobs_write on jobs for all
  using (org_id = auth_org_id() and has_permission('job.edit'))
  with check (org_id = auth_org_id() and has_permission('job.edit'));

create policy job_visits_select on job_visits for select
  using (org_id = auth_org_id() and can_see_job(job_id));
create policy job_visits_write on job_visits for all
  using (org_id = auth_org_id() and has_permission('job.edit'))
  with check (org_id = auth_org_id() and has_permission('job.edit'));

create policy job_assignments_select on job_assignments for select
  using (org_id = auth_org_id() and (user_id = auth_user_id() or can_see_job(job_id)));
-- Assignees update only their own acceptance; the transition functions are
-- security definer and bypass this for the legal moves.
create policy job_assignments_self_update on job_assignments for update
  using (user_id = auth_user_id())
  with check (user_id = auth_user_id());
create policy job_assignments_write on job_assignments for all
  using (org_id = auth_org_id() and has_permission('job.assign'))
  with check (org_id = auth_org_id() and has_permission('job.assign'));

-- Append-only: select and insert, never update or delete, for anyone.
create policy job_status_history_select on job_status_history for select
  using (org_id = auth_org_id() and can_see_job(job_id));
create policy job_status_history_insert on job_status_history for insert
  with check (org_id = auth_org_id());

create policy reschedule_select on reschedule_requests for select
  using (org_id = auth_org_id() and (requested_by = auth_user_id() or has_permission('reschedule.decide')));
create policy reschedule_insert on reschedule_requests for insert
  with check (org_id = auth_org_id() and requested_by = auth_user_id());
create policy reschedule_decide on reschedule_requests for update
  using (org_id = auth_org_id() and has_permission('reschedule.decide'))
  with check (org_id = auth_org_id() and has_permission('reschedule.decide'));

create policy job_comments_select on job_comments for select
  using (org_id = auth_org_id() and can_see_job(job_id));
create policy job_comments_insert on job_comments for insert
  with check (org_id = auth_org_id() and author_id = auth_user_id() and can_see_job(job_id));
create policy job_comments_own_update on job_comments for update
  using (author_id = auth_user_id())
  with check (author_id = auth_user_id());

create policy job_documents_select on job_documents for select
  using (org_id = auth_org_id());
create policy job_documents_write on job_documents for all
  using (org_id = auth_org_id() and has_permission('job.edit'))
  with check (org_id = auth_org_id());

-- ---------------------------------------------------------------------------
-- Field capture: log your own work, managers see and correct everything
-- ---------------------------------------------------------------------------

create policy time_entries_select on time_entries for select
  using (org_id = auth_org_id() and (user_id = auth_user_id() or has_permission('time.view_all')));
create policy time_entries_self on time_entries for insert
  with check (org_id = auth_org_id() and (user_id = auth_user_id() or has_permission('time.log_others')));
create policy time_entries_self_update on time_entries for update
  using (user_id = auth_user_id() and clock_out_at is null)
  with check (user_id = auth_user_id());
create policy time_entries_manage on time_entries for all
  using (org_id = auth_org_id() and has_permission('time.edit_all'))
  with check (org_id = auth_org_id() and has_permission('time.edit_all'));

create policy job_photos_select on job_photos for select
  using (org_id = auth_org_id() and can_see_job(job_id));
create policy job_photos_insert on job_photos for insert
  with check (org_id = auth_org_id() and can_see_job(job_id));
create policy job_photos_manage on job_photos for all
  using (org_id = auth_org_id() and has_permission('job.edit'))
  with check (org_id = auth_org_id() and has_permission('job.edit'));

create policy form_submissions_select on form_submissions for select
  using (org_id = auth_org_id() and can_see_job(job_id));
create policy form_submissions_write on form_submissions for all
  using (org_id = auth_org_id() and can_see_job(job_id))
  with check (org_id = auth_org_id() and can_see_job(job_id));

create policy signatures_select on signatures for select
  using (org_id = auth_org_id() and can_see_job(job_id));
create policy signatures_insert on signatures for insert
  with check (org_id = auth_org_id() and can_see_job(job_id));

-- ---------------------------------------------------------------------------
-- Inventory
-- ---------------------------------------------------------------------------

create policy stock_movements_select on stock_movements for select
  using (org_id = auth_org_id());
-- Adjustments and counts need the flag; usage and transfers are field work.
create policy stock_movements_insert on stock_movements for insert
  with check (
    org_id = auth_org_id()
    and (
      (kind in ('usage', 'receipt') and has_permission('inventory.log_usage'))
      or (kind = 'transfer' and has_permission('inventory.transfer'))
      or (kind in ('adjustment', 'count', 'return') and has_permission('inventory.adjust'))
    )
  );

create policy material_usage_select on material_usage for select
  using (org_id = auth_org_id() and can_see_job(job_id));
create policy material_usage_insert on material_usage for insert
  with check (org_id = auth_org_id() and can_see_job(job_id));

-- ---------------------------------------------------------------------------
-- Purchasing
-- ---------------------------------------------------------------------------

create policy purchase_requests_select on purchase_requests for select
  using (
    org_id = auth_org_id()
    and (requested_by = auth_user_id() or assigned_to = auth_user_id()
         or has_permission('purchase.view_all'))
  );
create policy purchase_requests_insert on purchase_requests for insert
  with check (org_id = auth_org_id() and requested_by = auth_user_id());
-- The requester edits their own draft only; approvers edit under review.
create policy purchase_requests_own_draft on purchase_requests for update
  using (requested_by = auth_user_id() and status = 'draft')
  with check (requested_by = auth_user_id());
create policy purchase_requests_approver on purchase_requests for update
  using (org_id = auth_org_id() and has_permission('purchase.approve'))
  with check (org_id = auth_org_id() and has_permission('purchase.approve'));

create policy purchase_lines_select on purchase_request_lines for select
  using (
    org_id = auth_org_id()
    and exists (
      select 1 from purchase_requests r
      where r.id = request_id
        and (r.requested_by = auth_user_id() or r.assigned_to = auth_user_id()
             or has_permission('purchase.view_all'))
    )
  );
create policy purchase_lines_write on purchase_request_lines for all
  using (
    org_id = auth_org_id()
    and exists (
      select 1 from purchase_requests r
      where r.id = request_id
        and (
          (r.requested_by = auth_user_id() and r.status = 'draft')
          or has_permission('purchase.approve')
        )
    )
  )
  with check (org_id = auth_org_id());

-- The edit history. Insert and select only: no update or delete policy is
-- defined, for any role, including the owner. This is deliberate.
create policy purchase_audit_select on purchase_request_audit for select
  using (org_id = auth_org_id() and has_permission('purchase.view_history'));
create policy purchase_audit_insert on purchase_request_audit for insert
  with check (org_id = auth_org_id());

-- ---------------------------------------------------------------------------
-- Vehicles
-- ---------------------------------------------------------------------------

create policy mileage_select on mileage_logs for select
  using (org_id = auth_org_id() and (user_id = auth_user_id() or has_permission('mileage.view_all')));
create policy mileage_insert on mileage_logs for insert
  with check (org_id = auth_org_id() and user_id = auth_user_id());
create policy mileage_manage on mileage_logs for all
  using (org_id = auth_org_id() and has_permission('mileage.edit_all'))
  with check (org_id = auth_org_id() and has_permission('mileage.edit_all'));

create policy fuel_select on fuel_logs for select using (org_id = auth_org_id());
create policy fuel_insert on fuel_logs for insert with check (org_id = auth_org_id());
create policy fuel_manage on fuel_logs for all
  using (org_id = auth_org_id() and has_permission('vehicle.manage'))
  with check (org_id = auth_org_id() and has_permission('vehicle.manage'));

create policy vehicle_maint_select on vehicle_maintenance for select
  using (org_id = auth_org_id());
create policy vehicle_maint_write on vehicle_maintenance for all
  using (org_id = auth_org_id() and has_permission('vehicle.manage'))
  with check (org_id = auth_org_id() and has_permission('vehicle.manage'));

-- ---------------------------------------------------------------------------
-- Equipment: anyone in the field may move a unit, only managers may create
-- rental agreements or enter cost
-- ---------------------------------------------------------------------------

create policy equipment_assignments_select on equipment_assignments for select
  using (org_id = auth_org_id());
create policy equipment_assignments_field on equipment_assignments for all
  using (org_id = auth_org_id() and has_permission('equipment.place'))
  with check (org_id = auth_org_id() and has_permission('equipment.place'));

create policy equipment_rentals_select on equipment_rentals for select
  using (org_id = auth_org_id());
create policy equipment_rentals_write on equipment_rentals for all
  using (org_id = auth_org_id() and has_permission('equipment.rental_manage'))
  with check (org_id = auth_org_id() and has_permission('equipment.rental_manage'));

create policy equipment_runtime_select on equipment_runtime_logs for select
  using (org_id = auth_org_id());
create policy equipment_runtime_insert on equipment_runtime_logs for insert
  with check (org_id = auth_org_id() and has_permission('equipment.place'));

create policy equipment_maint_select on equipment_maintenance for select
  using (org_id = auth_org_id());
create policy equipment_maint_write on equipment_maintenance for all
  using (org_id = auth_org_id() and has_permission('equipment.manage'))
  with check (org_id = auth_org_id() and has_permission('equipment.manage'));

-- ---------------------------------------------------------------------------
-- Compliance, notifications, audit
-- ---------------------------------------------------------------------------

create policy user_certs_select on user_certifications for select
  using (org_id = auth_org_id() and (user_id = auth_user_id() or has_permission('user.manage')));
create policy user_certs_write on user_certifications for all
  using (org_id = auth_org_id() and has_permission('user.manage'))
  with check (org_id = auth_org_id() and has_permission('user.manage'));

create policy notifications_select on notifications for select
  using (user_id = auth_user_id());
create policy notifications_update on notifications for update
  using (user_id = auth_user_id())
  with check (user_id = auth_user_id());
create policy notifications_insert on notifications for insert
  with check (org_id = auth_org_id());

-- Append-only, same as the purchase audit: select and insert, nothing else.
create policy audit_log_select on audit_log for select
  using (org_id = auth_org_id() and has_permission('audit.view'));
create policy audit_log_insert on audit_log for insert
  with check (true);
