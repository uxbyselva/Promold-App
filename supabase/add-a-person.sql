-- Promold — give somebody who can sign in a place in the company
--
-- Use this when a person signs in and gets "No profile for this login", and
-- to add each new member of staff.
--
-- Two steps, and the first one is not here:
--
--   1. Supabase → Authentication → Users → Add user → Create new user.
--      Their email, a password, and tick **Auto Confirm User**. That is what
--      lets them sign in.
--   2. Edit the three values below and run this. That is what makes the app
--      know who they are.
--
-- Why both: Authentication knows the password, `profiles` knows the person.
-- Row-level security scopes every table to an organisation, and the profile
-- row is where the organisation comes from — so an auth user without one
-- signs in fine and then sees nothing anywhere.
--
-- This deliberately joins the organisation that already exists rather than
-- making one, and stops if it cannot tell which. The failure it is avoiding
-- is quiet: a second organisation gives a working login that shares no
-- customers, jobs or equipment with anybody, and nothing on screen says so.
--
-- Safe to run twice. Run it again with a different role to change somebody's
-- role.

do $$
declare
  -- ----------------------------------------------------------------- edit me
  v_email text := 'uxbyselva@gmail.com';
  v_name  text := 'Selva';
  v_role  text := 'owner';   -- owner, manager, bookkeeper, crew_lead, technician
  -- -------------------------------------------------------------------------
  v_org     uuid;
  v_user    uuid;
  v_role_id uuid;
  v_orgs    int;
  v_known   text;
begin
  select count(*) into v_orgs from organizations;
  if v_orgs = 0 then
    raise exception
      'No organisation yet. Run section 4 of docs/SUPABASE-SETUP.md first.';
  elsif v_orgs > 1 then
    raise exception
      'There are % organisations, so I cannot tell which one to add % to. '
      'Run supabase/who-can-sign-in.sql, decide which is the real one, and '
      'set v_org by hand.', v_orgs, v_email;
  end if;
  select id into v_org from organizations;

  select id into v_user from auth.users where lower(email) = lower(v_email);
  if v_user is null then
    raise exception
      'Nobody can sign in as % yet. Add them under Authentication -> Users '
      '(tick Auto Confirm User), then run this again.', v_email;
  end if;

  select id into v_role_id from roles where org_id = v_org and key = v_role;
  if v_role_id is null then
    select string_agg(key, ', ' order by key) into v_known
      from roles where org_id = v_org;
    raise exception 'No role called "%". The roles here are: %.', v_role, v_known;
  end if;

  insert into profiles (id, org_id, role_id, full_name, email, is_active)
  values (v_user, v_org, v_role_id, v_name, lower(v_email), true)
  on conflict (id) do update
     set org_id    = excluded.org_id,
         role_id   = excluded.role_id,
         full_name = excluded.full_name,
         email     = excluded.email,
         is_active = true;

  raise notice '% can now use the app as %.', v_email, v_role;
end $$;

-- What the app will see on the next sign-in.
select
  p.full_name as "known as",
  p.email,
  r.name as "role",
  o.name as "organisation"
from profiles p
join roles r on r.id = p.role_id
join organizations o on o.id = p.org_id
where p.is_active
order by r.name, p.full_name;
