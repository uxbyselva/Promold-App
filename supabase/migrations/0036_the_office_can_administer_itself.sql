-- 0036 The office can administer itself
--
-- An audit of the 39 permission flags against the screens found eleven that
-- the database enforces and no screen exercises. `user.manage`,
-- `org.manage_settings` and `role.manage` were the worst of them: the Owner
-- holds all three and had nothing to click, so adding a member of staff or
-- changing the spend threshold meant someone opening the SQL editor.
--
-- Almost all of that gap is screens, not schema — the row policies for every
-- one of those tables already exist and already check the right flag. Three
-- things genuinely need the database, and they are here.

-- ---------------------------------------------------------------------------
-- What somebody is paid
-- ---------------------------------------------------------------------------
--
-- `profiles.cost_rate` is revoked from `authenticated` for select AND for
-- update, so no client can write it however the policy reads — a column grant
-- cannot tell two signed-in users apart. Reading is already solved:
-- `profiles_safe` masks it behind `user.view_cost_rates`. Writing needs a
-- definer function, the same shape as `set_job_price()`.
--
-- Two flags, deliberately: managing people is not the same as being shown
-- what they are paid, and the pairing mirrors how crew pay works.

create or replace function set_cost_rate(p_user_id uuid, p_cost_rate numeric)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not has_permission('user.manage') then
    raise exception 'Not permitted: changing a person needs user.manage'
      using errcode = '42501';
  end if;
  if not has_permission('user.view_cost_rates') then
    raise exception 'Not permitted: setting a cost rate needs user.view_cost_rates'
      using errcode = '42501';
  end if;
  if p_cost_rate is not null and p_cost_rate < 0 then
    raise exception 'A cost rate cannot be negative' using errcode = '22023';
  end if;

  update profiles
     set cost_rate = p_cost_rate
   where id = p_user_id and org_id = auth_org_id();

  if not found then
    raise exception 'No such person here' using errcode = '02000';
  end if;
end;
$fn$;

comment on function set_cost_rate(uuid, numeric) is
  'Sets what somebody is paid. Needs user.manage AND user.view_cost_rates; '
  'the column is revoked from the client so nothing else can write it.';

-- ---------------------------------------------------------------------------
-- Adding a member of staff
-- ---------------------------------------------------------------------------
--
-- Signing in and being known to the app are two different things. Supabase
-- Authentication owns the password; `profiles` says who that person is here.
-- A client cannot create the login — that needs the service key, which must
-- never reach a browser — so the flow stays two steps: the login is made in
-- the Supabase dashboard, and this attaches it to the company.
--
-- Definer rights, because `auth.users` is not readable by a signed-in user.
-- That is also why this takes an email rather than an id: the person doing it
-- has no way to look the id up.
--
-- It refuses to create a second organisation, and it cannot: v_org is the
-- caller's own. That was the trap in the old add-a-person.sql.

create or replace function add_person(
  p_email text,
  p_full_name text,
  p_role_key text,
  p_phone text default null
)
returns profiles
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org     uuid := auth_org_id();
  v_user    uuid;
  v_role_id uuid;
  v_known   text;
  v_person  profiles;
begin
  if not has_permission('user.manage') then
    raise exception 'Not permitted: adding a person needs user.manage'
      using errcode = '42501';
  end if;
  if p_full_name is null or btrim(p_full_name) = '' then
    raise exception 'A person needs a name' using errcode = '22023';
  end if;

  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  if v_user is null then
    raise exception
      'Nobody can sign in as % yet. Create the login first: Supabase '
      '-> Authentication -> Users -> Add user, with Auto Confirm ticked.',
      btrim(p_email)
      using errcode = '02000';
  end if;

  select id into v_role_id from roles where org_id = v_org and key = p_role_key;
  if v_role_id is null then
    select string_agg(key, ', ' order by key) into v_known from roles where org_id = v_org;
    raise exception 'No role called "%". The roles here are: %.', p_role_key, v_known
      using errcode = '22023';
  end if;

  -- Someone already here, being re-added: treat it as putting them back
  -- rather than refusing. Re-running this with a different role is how a
  -- promotion is recorded.
  insert into profiles (id, org_id, role_id, full_name, email, phone, is_active)
  values (v_user, v_org, v_role_id, btrim(p_full_name), lower(btrim(p_email)),
          nullif(btrim(coalesce(p_phone, '')), ''), true)
  on conflict (id) do update
     set org_id    = excluded.org_id,
         role_id   = excluded.role_id,
         full_name = excluded.full_name,
         email     = excluded.email,
         phone     = coalesce(excluded.phone, profiles.phone),
         is_active = true
  returning * into v_person;

  return v_person;
end;
$fn$;

comment on function add_person(text, text, text, text) is
  'Attaches an existing Supabase login to this organisation as a member of '
  'staff. Cannot create the login itself — that needs the service key — and '
  'cannot reach another organisation, because the org is the caller''s own.';

-- ---------------------------------------------------------------------------
-- The settings
-- ---------------------------------------------------------------------------
--
-- `organizations` already has an update policy checking org.manage_settings,
-- so a client could merge the jsonb itself. It should not: a client that
-- sends the whole `settings` object overwrites every key it did not know
-- about, so a screen written today silently deletes a setting added next
-- year. This takes the fields one at a time and leaves the rest alone.
--
-- Nulls mean "leave it", which is what lets one screen save only what it
-- shows.

create or replace function update_org_settings(
  p_name text default null,
  p_timezone text default null,
  p_mileage_rate numeric default null,
  p_approval_threshold numeric default null
)
returns organizations
language plpgsql
security definer
set search_path = public
as $fn$
declare v_org organizations;
begin
  if not has_permission('org.manage_settings') then
    raise exception 'Not permitted: changing settings needs org.manage_settings'
      using errcode = '42501';
  end if;
  if p_mileage_rate is not null and p_mileage_rate < 0 then
    raise exception 'A mileage rate cannot be negative' using errcode = '22023';
  end if;
  if p_approval_threshold is not null and p_approval_threshold < 0 then
    raise exception 'An approval threshold cannot be negative' using errcode = '22023';
  end if;
  -- A timezone the database does not recognise would make every date on every
  -- screen wrong at once, so it is checked rather than trusted.
  if p_timezone is not null
     and not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'There is no timezone called "%"', p_timezone using errcode = '22023';
  end if;

  update organizations
     set name     = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
         timezone = coalesce(p_timezone, timezone),
         settings = settings
                    || case when p_mileage_rate is null then '{}'::jsonb
                            else jsonb_build_object('mileage_rate', p_mileage_rate) end
                    || case when p_approval_threshold is null then '{}'::jsonb
                            else jsonb_build_object('approval_threshold', p_approval_threshold) end
   where id = auth_org_id()
  returning * into v_org;

  return v_org;
end;
$fn$;

comment on function update_org_settings(text, text, numeric, numeric) is
  'Changes the organisation''s name, timezone and money settings one field at '
  'a time. Merges into settings rather than replacing it, so a screen cannot '
  'delete a key it was never told about.';
