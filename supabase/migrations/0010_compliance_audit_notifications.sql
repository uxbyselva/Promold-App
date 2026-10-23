-- 0010 Certifications, notifications, global audit log

create table certification_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  issuing_body text,
  validity_months int,
  is_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name)
);

create table user_certifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  type_id uuid not null references certification_types(id),
  reference_no text,
  issued_on date,
  expires_on date,
  document_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on user_certifications (user_id);
create index on user_certifications (expires_on) where expires_on is not null;

create table notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index on notifications (user_id, created_at desc) where read_at is null;

-- Written by trigger on every business-significant table. Append-only; RLS
-- grants select and insert but never update or delete.
create table audit_log (
  id bigserial primary key,
  org_id uuid,
  table_name text not null,
  record_id uuid,
  actor_id uuid,
  action text not null,
  diff jsonb,
  at timestamptz not null default now()
);

create index on audit_log (table_name, record_id, at desc);
create index on audit_log (org_id, at desc);

-- Generic row auditor. Records only the fields that actually changed, so the
-- log stays readable rather than a wall of unchanged columns.
create or replace function audit_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_diff jsonb := '{}'::jsonb;
  v_key text;
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_diff := jsonb_build_object('new', v_new);
  elsif tg_op = 'DELETE' then
    v_old := to_jsonb(old);
    v_diff := jsonb_build_object('old', v_old);
  else
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key not in ('updated_at') and (v_old -> v_key) is distinct from (v_new -> v_key) then
        v_diff := v_diff || jsonb_build_object(
          v_key,
          jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key)
        );
      end if;
    end loop;
    if v_diff = '{}'::jsonb then
      return coalesce(new, old);
    end if;
  end if;

  insert into audit_log (org_id, table_name, record_id, actor_id, action, diff)
  values (
    coalesce((to_jsonb(coalesce(new, old)) ->> 'org_id')::uuid, null),
    tg_table_name,
    (to_jsonb(coalesce(new, old)) ->> 'id')::uuid,
    auth_user_id(),
    lower(tg_op),
    v_diff
  );

  return coalesce(new, old);
end;
$$;

create or replace function attach_audit(p_table text)
returns void
language plpgsql
as $$
begin
  execute format(
    'create trigger trg_%s_audit after insert or update or delete on %I
       for each row execute function audit_row()',
    p_table, p_table
  );
end;
$$;

select attach_audit('jobs');
select attach_audit('job_assignments');
select attach_audit('purchase_requests');
select attach_audit('purchase_request_lines');
select attach_audit('equipment_assignments');
select attach_audit('equipment_rentals');
select attach_audit('inventory_items');
select attach_audit('mileage_logs');
select attach_audit('time_entries');
select attach_audit('profiles');
select attach_audit('roles');

select attach_updated_at('certification_types');
select attach_updated_at('user_certifications');
