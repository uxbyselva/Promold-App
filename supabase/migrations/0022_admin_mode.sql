-- 0022 Admin mode: the audit trail, record history, and getting a deleted
--      record back
--
-- Nothing in this app hard-deletes, which is only half a promise: until now
-- there was no way to see what had been deleted or to put it back. This
-- migration finishes the job.
--
-- Three rules live here, and they live here rather than in the admin screen:
--
--   1. A delete is refused while live children still point at the row. You
--      cannot delete a customer out from under its sites.
--   2. A restore is refused while the parent is still deleted. Putting a job
--      back under a deleted site would produce a row nobody can reach.
--   3. Restoring is its own permission, separate from deleting. Whoever can
--      remove a job is not automatically the person who decides it comes back.

-- ---------------------------------------------------------------------------
-- Finish the soft-delete columns
-- ---------------------------------------------------------------------------

alter table job_photos   add column if not exists delete_reason text;
alter table job_comments add column if not exists deleted_by uuid references profiles(id);
alter table job_comments add column if not exists delete_reason text;

-- The three registers with money attached. is_active already says "retired"
-- or "off the road"; deleted_at says "this should not have been created", and
-- conflating the two loses the difference.
alter table equipment       add column if not exists deleted_at timestamptz;
alter table equipment       add column if not exists deleted_by uuid references profiles(id);
alter table equipment       add column if not exists delete_reason text;
alter table vehicles        add column if not exists deleted_at timestamptz;
alter table vehicles        add column if not exists deleted_by uuid references profiles(id);
alter table vehicles        add column if not exists delete_reason text;
alter table inventory_items add column if not exists deleted_at timestamptz;
alter table inventory_items add column if not exists deleted_by uuid references profiles(id);
alter table inventory_items add column if not exists delete_reason text;

create index if not exists equipment_live on equipment (org_id) where deleted_at is null;
create index if not exists vehicles_live on vehicles (org_id) where deleted_at is null;
create index if not exists inventory_items_live on inventory_items (org_id) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- A deleted row stops being ordinary data
--
-- Filtering in the client would leave the row one forgotten `.is('deleted_at',
-- null)` away from reappearing on a board. The select policy drops it instead,
-- and only audit.view — the flag admin mode itself runs on — sees it again.
-- ---------------------------------------------------------------------------

drop policy if exists jobs_select on jobs;
create policy jobs_select on jobs for select
  using (
    org_id = auth_org_id() and can_see_job(id)
    and (deleted_at is null or has_permission('audit.view'))
  );

drop policy if exists customers_select on customers;
create policy customers_select on customers for select
  using (
    org_id = auth_org_id()
    and (deleted_at is null or has_permission('audit.view'))
  );

drop policy if exists sites_select on sites;
create policy sites_select on sites for select
  using (
    org_id = auth_org_id()
    and (deleted_at is null or has_permission('audit.view'))
  );

drop policy if exists equipment_select on equipment;
create policy equipment_select on equipment for select
  using (
    org_id = auth_org_id()
    and (deleted_at is null or has_permission('audit.view'))
  );

drop policy if exists vehicles_select on vehicles;
create policy vehicles_select on vehicles for select
  using (
    org_id = auth_org_id()
    and (deleted_at is null or has_permission('audit.view'))
  );

drop policy if exists inventory_items_select on inventory_items;
create policy inventory_items_select on inventory_items for select
  using (
    org_id = auth_org_id()
    and (deleted_at is null or has_permission('audit.view'))
  );

-- ---------------------------------------------------------------------------
-- What can be deleted, and what hangs off what
--
-- A registry rather than a CASE statement in four functions. Adding a table to
-- the recycle bin is one insert, and the delete guard, the restore guard and
-- the admin screen all pick it up at once.
-- ---------------------------------------------------------------------------

create table deletable_tables (
  table_name text primary key,
  label text not null,
  -- The column that reads as this row's name in a list.
  title_column text not null,
  -- A short code shown beside it, where the table has one.
  ref_column text,
  -- The flag that lets someone delete one. Restoring is data.restore for all
  -- of them, on purpose.
  write_permission text not null,
  -- The row this one cannot outlive.
  parent_table text references deletable_tables(table_name),
  parent_fk text,
  sort int not null default 100,
  constraint deletable_parent_complete check (
    (parent_table is null and parent_fk is null) or
    (parent_table is not null and parent_fk is not null)
  )
);

comment on table deletable_tables is
  'Schema metadata, not org data: which tables soft-delete, how to name a row '
  'and which parent it depends on. Read by soft_delete_record(), '
  'restore_record() and deleted_records().';

insert into deletable_tables
  (table_name, label, title_column, ref_column, write_permission, parent_table, parent_fk, sort)
values
  ('customers',       'Customer',   'name',    null,        'customer.manage',  null,        null,          10),
  ('sites',           'Site',       'label',   null,        'customer.manage',  'customers', 'customer_id', 20),
  ('jobs',            'Job',        'title',   'job_number','job.edit',         'sites',     'site_id',     30),
  ('job_photos',      'Job photo',  'caption', null,        'job.edit',         'jobs',      'job_id',      40),
  ('job_comments',    'Job note',   'body',    null,        'job.edit',         'jobs',      'job_id',      50),
  ('equipment',       'Equipment',  'name',    'asset_tag', 'equipment.manage', null,        null,          60),
  ('vehicles',        'Vehicle',    'name',    'plate',     'vehicle.manage',   null,        null,          70),
  ('inventory_items', 'Stock item', 'name',    'sku',       'inventory.manage', null,        null,          80);

select enable_rls('deletable_tables');

-- Readable by anyone signed in; writable by nobody. Changing the recycle bin's
-- shape is a migration, not an afternoon.
create policy deletable_tables_select on deletable_tables for select using (true);

-- ---------------------------------------------------------------------------
-- Deleting
-- ---------------------------------------------------------------------------

create or replace function soft_delete_record(
  p_table text,
  p_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid := auth_org_id();
  v_me uuid := auth_user_id();
  v_meta deletable_tables;
  v_child deletable_tables;
  v_count int;
  v_blocked text[] := '{}';
  v_title text;
  v_live int;
begin
  select * into v_meta from deletable_tables where table_name = p_table;
  if not found then
    raise exception 'Not something this app deletes: %', p_table
      using errcode = '22023';
  end if;

  if not has_permission(v_meta.write_permission) then
    raise exception 'Not permitted: deleting a % needs %',
      lower(v_meta.label), v_meta.write_permission
      using errcode = '42501';
  end if;

  -- A delete with no reason is the one nobody can explain six months later.
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Say why this % is being deleted', lower(v_meta.label)
      using errcode = '22023';
  end if;

  execute format(
    'select count(*), max(%I::text) from %I where id = $1 and org_id = $2 and deleted_at is null',
    v_meta.title_column, p_table)
    into v_live, v_title using p_id, v_org;

  if v_live = 0 then
    raise exception 'No % of that id is live here', lower(v_meta.label)
      using errcode = '02000';
  end if;

  -- Rule 1: live children keep the parent alive.
  for v_child in
    select * from deletable_tables where parent_table = p_table order by sort
  loop
    execute format(
      'select count(*) from %I where %I = $1 and org_id = $2 and deleted_at is null',
      v_child.table_name, v_child.parent_fk)
      into v_count using p_id, v_org;
    if v_count > 0 then
      v_blocked := array_append(
        v_blocked,
        v_count::text || ' ' || lower(v_child.label) || case when v_count = 1 then '' else 's' end);
    end if;
  end loop;

  if array_length(v_blocked, 1) > 0 then
    raise exception 'This % still has %. Deal with those first.',
      lower(v_meta.label), array_to_string(v_blocked, ' and ')
      using errcode = '23503';
  end if;

  execute format(
    'update %I set deleted_at = now(), deleted_by = $1, delete_reason = $2
      where id = $3 and org_id = $4 and deleted_at is null', p_table)
    using v_me, btrim(p_reason), p_id, v_org;

  insert into audit_log (org_id, table_name, record_id, actor_id, action, diff)
  values (v_org, p_table, p_id, v_me, 'soft_delete',
          jsonb_build_object('title', v_title, 'reason', btrim(p_reason)));

  return jsonb_build_object(
    'table', p_table, 'label', v_meta.label, 'id', p_id, 'title', v_title);
end;
$fn$;

comment on function soft_delete_record(text, uuid, text) is
  'Soft-deletes one row, gated on that table''s own write permission. Refuses '
  'while live children point at it, and refuses without a reason.';

-- ---------------------------------------------------------------------------
-- Getting it back
-- ---------------------------------------------------------------------------

create or replace function restore_record(
  p_table text,
  p_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid := auth_org_id();
  v_me uuid := auth_user_id();
  v_meta deletable_tables;
  v_parent deletable_tables;
  v_parent_name text;
  v_title text;
  v_gone int;
begin
  select * into v_meta from deletable_tables where table_name = p_table;
  if not found then
    raise exception 'Not something this app deletes: %', p_table
      using errcode = '22023';
  end if;

  -- Deliberately not the delete permission. Putting a record back into live
  -- data is its own decision.
  if not has_permission('data.restore') then
    raise exception 'Not permitted: restoring a record needs data.restore'
      using errcode = '42501';
  end if;

  execute format(
    'select count(*), max(%I::text) from %I where id = $1 and org_id = $2 and deleted_at is not null',
    v_meta.title_column, p_table)
    into v_gone, v_title using p_id, v_org;

  if v_gone = 0 then
    raise exception 'No deleted % of that id here', lower(v_meta.label)
      using errcode = '02000';
  end if;

  -- Rule 2: a row cannot come back under a parent that is still deleted.
  if v_meta.parent_table is not null then
    select * into v_parent from deletable_tables where table_name = v_meta.parent_table;
    execute format(
      'select coalesce(nullif(p.%I::text, %L), %L)
         from %I c join %I p on p.id = c.%I
        where c.id = $1 and c.org_id = $2 and p.deleted_at is not null',
      v_parent.title_column, '', '(no name)',
      p_table, v_meta.parent_table, v_meta.parent_fk)
      into v_parent_name using p_id, v_org;

    if v_parent_name is not null then
      raise exception 'Restore the % first: % is deleted too',
        lower(v_parent.label), v_parent_name
        using errcode = '23503';
    end if;
  end if;

  execute format(
    'update %I set deleted_at = null, deleted_by = null, delete_reason = null
      where id = $1 and org_id = $2 and deleted_at is not null', p_table)
    using p_id, v_org;

  insert into audit_log (org_id, table_name, record_id, actor_id, action, diff)
  values (v_org, p_table, p_id, v_me, 'restore',
          jsonb_build_object('title', v_title, 'reason', nullif(btrim(coalesce(p_reason, '')), '')));

  return jsonb_build_object(
    'table', p_table, 'label', v_meta.label, 'id', p_id, 'title', v_title);
end;
$fn$;

comment on function restore_record(text, uuid, text) is
  'Clears the soft delete, gated on data.restore. Refuses while the parent row '
  'is still deleted, which would otherwise produce an unreachable record.';

-- ---------------------------------------------------------------------------
-- The recycle bin
--
-- One list across every table that soft-deletes, newest first, each row
-- carrying what stands between it and being restored.
-- ---------------------------------------------------------------------------

create or replace function deleted_records(
  p_table text default null,
  p_limit int default 200
)
returns table (
  table_name text,
  label text,
  record_id uuid,
  title text,
  ref text,
  deleted_at timestamptz,
  deleted_by uuid,
  deleted_by_name text,
  delete_reason text,
  blocked_by text
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  r record;
  v_sql text := '';
  v_org uuid := auth_org_id();
begin
  if not has_permission('audit.view') then
    raise exception 'Not permitted: seeing deleted records needs audit.view'
      using errcode = '42501';
  end if;

  for r in
    select d.*, p.label as parent_label, p.title_column as parent_title
    from deletable_tables d
    left join deletable_tables p on p.table_name = d.parent_table
    where (p_table is null or d.table_name = p_table)
    order by d.sort
  loop
    v_sql := v_sql
      || case when v_sql = '' then '' else ' union all ' end
      || format($q$
           select %L::text as table_name,
                  %L::text as label,
                  t.id as record_id,
                  nullif(t.%I::text, '') as title,
                  %s as ref,
                  t.deleted_at,
                  t.deleted_by,
                  pr.full_name as deleted_by_name,
                  t.delete_reason,
                  %s as blocked_by
             from %I t
             left join profiles pr on pr.id = t.deleted_by
            where t.org_id = $1 and t.deleted_at is not null
         $q$,
         r.table_name,
         r.label,
         r.title_column,
         case when r.ref_column is null then 'null::text'
              else format('t.%I::text', r.ref_column) end,
         case when r.parent_table is null then 'null::text'
              else format(
                $p$(select %L || ' - ' || coalesce(nullif(pp.%I::text, ''), '(no name)')
                      from %I pp
                     where pp.id = t.%I and pp.deleted_at is not null)$p$,
                r.parent_label, r.parent_title, r.parent_table, r.parent_fk)
         end,
         r.table_name);
  end loop;

  if v_sql = '' then return; end if;

  return query execute
    'select * from (' || v_sql || ') z order by z.deleted_at desc limit $2'
    using v_org, p_limit;
end;
$fn$;

comment on function deleted_records(text, int) is
  'Everything soft-deleted in this org, newest first, with the parent that '
  'blocks a restore where there is one. Gated on audit.view.';

-- ---------------------------------------------------------------------------
-- History
-- ---------------------------------------------------------------------------

-- What has happened to one record, ever.
create or replace function record_history(
  p_table text,
  p_id uuid,
  p_limit int default 200
)
returns table (
  id bigint,
  at timestamptz,
  action text,
  actor_id uuid,
  actor_name text,
  fields text[],
  diff jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not has_permission('audit.view') then
    raise exception 'Not permitted: record history needs audit.view'
      using errcode = '42501';
  end if;
  return query
  select
    a.id,
    a.at,
    a.action,
    a.actor_id,
    coalesce(p.full_name, 'System') as actor_name,
    case when a.action = 'update'
      then array(select k from jsonb_object_keys(coalesce(a.diff, '{}'::jsonb)) k order by k)
      else '{}'::text[] end as fields,
    a.diff
  from audit_log a
  left join profiles p on p.id = a.actor_id
  where a.org_id = auth_org_id()
    and a.table_name = p_table
    and a.record_id = p_id
  order by a.at desc, a.id desc
  limit p_limit;
end;
$fn$;

comment on function record_history(text, uuid, int) is
  'The full trail for one record: who changed what, when. Gated on audit.view.';

-- Everything, filtered and paged. p_before_id is the cursor: pass the last id
-- you were given to get the next page, rather than an offset that shifts under
-- you as new rows land.
create or replace function audit_feed(
  p_table text default null,
  p_actor uuid default null,
  p_action text default null,
  p_since timestamptz default null,
  p_before_id bigint default null,
  p_limit int default 100
)
returns table (
  id bigint,
  at timestamptz,
  table_name text,
  label text,
  record_id uuid,
  action text,
  actor_id uuid,
  actor_name text,
  fields text[],
  diff jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not has_permission('audit.view') then
    raise exception 'Not permitted: the audit trail needs audit.view'
      using errcode = '42501';
  end if;
  return query
  select
    a.id,
    a.at,
    a.table_name,
    coalesce(d.label, a.table_name) as label,
    a.record_id,
    a.action,
    a.actor_id,
    coalesce(p.full_name, 'System') as actor_name,
    case when a.action = 'update'
      then array(select k from jsonb_object_keys(coalesce(a.diff, '{}'::jsonb)) k order by k)
      else '{}'::text[] end as fields,
    a.diff
  from audit_log a
  left join profiles p on p.id = a.actor_id
  left join deletable_tables d on d.table_name = a.table_name
  where a.org_id = auth_org_id()
    and (p_table is null or a.table_name = p_table)
    and (p_actor is null or a.actor_id = p_actor)
    and (p_action is null or a.action = p_action)
    and (p_since is null or a.at >= p_since)
    and (p_before_id is null or a.id < p_before_id)
  order by a.id desc
  limit least(coalesce(p_limit, 100), 500);
end;
$fn$;

comment on function audit_feed(text, uuid, text, timestamptz, bigint, int) is
  'The org''s audit trail, filtered and cursor-paged on id. Gated on audit.view.';

-- What the filter dropdown offers, so it lists only what has actually happened.
create or replace function audit_tables()
returns table (table_name text, label text, entries bigint)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not has_permission('audit.view') then
    raise exception 'Not permitted: the audit trail needs audit.view'
      using errcode = '42501';
  end if;
  return query
  select a.table_name,
         coalesce(d.label, a.table_name) as label,
         count(*) as entries
  from audit_log a
  left join deletable_tables d on d.table_name = a.table_name
  where a.org_id = auth_org_id()
  group by a.table_name, d.label
  order by 2;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Audit the rest of what an owner edits
--
-- The trail is only worth opening if the things people actually change are in
-- it. Customers, sites, the day a job runs, approved time off and the two
-- registers were all missing.
-- ---------------------------------------------------------------------------

select attach_audit('customers');
select attach_audit('sites');
select attach_audit('job_visits');
select attach_audit('time_off');
select attach_audit('vehicles');
select attach_audit('equipment');

-- ---------------------------------------------------------------------------
-- data.restore
--
-- Separate from every delete permission on purpose. A manager who can delete a
-- customer record should not be the one who quietly puts it back.
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

-- Orgs that already exist get the flag too, or the owner locks themselves out
-- of the screen this migration is for.
update roles
   set permissions = permissions || jsonb_build_object('data.restore', true)
 where key = 'owner'
   and coalesce((permissions ->> 'data.restore')::boolean, false) = false;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select on deletable_tables to authenticated';
  end if;
end $$;
