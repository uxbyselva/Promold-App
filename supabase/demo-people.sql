-- Demo logins, one per role
--
-- Creates four people in YOUR organisation so you can sign in as each and see
-- what they see.
--
-- THE PASSWORD IS NOT IN THIS FILE. It used to be, and this repository is
-- public, which meant a working manager login for anyone who read it. Leave
-- v_password as null and the script invents a strong one and prints it in the
-- output — copy it from there. Set it yourself only if you would rather
-- choose, and do not commit what you choose.
--
-- These are demo people on demo email addresses that cannot receive mail
-- (.test is reserved for exactly this). Do not give them to anyone real, and
-- delete them with the query at the bottom when you are done.
--
-- Safe to run twice. Running it again resets the password to a new one.
--
-- If this errors on auth.users or auth.identities, Supabase has changed those
-- tables: create the four users by hand in Authentication → Users (tick Auto
-- Confirm), then run just the profiles block at the end.

do $$
declare
  v_owner_email text := 'uxbyselva@gmail.com';  -- <<< your login, to find the org
  v_password    text := null;                   -- <<< leave null: one is made for you
  v_org   uuid;
  v_uid   uuid;
  v_role  uuid;
  p       record;
begin
  select org_id into v_org from profiles where email = v_owner_email;
  if v_org is null then
    raise exception 'No profile for %. Run the owner step first.', v_owner_email;
  end if;

  -- 18 random characters. Printed once, below, and stored only as a hash.
  if v_password is null then
    v_password := translate(encode(gen_random_bytes(14), 'base64'), '+/=', 'xyz');
  end if;

  for p in
    select * from (values
      ('ray@promold.test',    'Ray Alvarez',  'manager',    42.00),
      ('marcus@promold.test', 'Marcus Bell',  'crew_lead',  34.00),
      ('priya@promold.test',  'Priya Nair',   'technician', 27.50),
      ('helen@promold.test',  'Helen Osei',   'bookkeeper',  0.00)
    ) as t(email, full_name, role_key, cost_rate)
  loop
    select id into v_role from roles where org_id = v_org and key = p.role_key;
    if v_role is null then
      raise exception 'No % role. Did provision_org() run?', p.role_key;
    end if;

    -- Reuse the auth user if it already exists, so re-running does not
    -- duplicate people or orphan their profile.
    select id into v_uid from auth.users where email = p.email;

    if v_uid is null then
      v_uid := gen_random_uuid();

      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data
      ) values (
        '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
        p.email, crypt(v_password, gen_salt('bf')),
        now(), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', p.full_name)
      );

      -- Supabase will not sign a user in without a matching identity row.
      insert into auth.identities (
        id, user_id, identity_data, provider, provider_id,
        last_sign_in_at, created_at, updated_at
      ) values (
        gen_random_uuid(), v_uid,
        jsonb_build_object('sub', v_uid::text, 'email', p.email),
        'email', v_uid::text, now(), now(), now()
      );
    else
      -- Already there: just make sure the password is the demo one.
      update auth.users
      set encrypted_password = crypt(v_password, gen_salt('bf')),
          email_confirmed_at = coalesce(email_confirmed_at, now())
      where id = v_uid;
    end if;

    insert into profiles (id, org_id, role_id, full_name, email, cost_rate, is_active)
    values (v_uid, v_org, v_role, p.full_name, p.email, p.cost_rate, true)
    on conflict (id) do update
      set org_id = excluded.org_id,
          role_id = excluded.role_id,
          full_name = excluded.full_name,
          cost_rate = excluded.cost_rate,
          is_active = true;

    raise notice '%  (%)', p.email, p.role_key;
  end loop;

  raise notice '----------------------------------------------------------';
  raise notice 'PASSWORD FOR ALL FOUR: %', v_password;
  raise notice 'Copy it now — it is stored only as a hash and cannot be read';
  raise notice 'back. Re-run this script to set a new one.';
  raise notice '----------------------------------------------------------';
end $$;

-- Who exists now, and what each may do.
select
  p.full_name,
  p.email,
  r.name as role,
  (r.permissions ->> 'job.assign')::boolean  as gets_the_dispatch_board,
  (r.permissions ->> 'price.view')::boolean  as sees_prices,
  (r.permissions ->> 'costing.view')::boolean as sees_margin
from profiles p
join roles r on r.id = p.role_id
order by p.created_at;

-- To remove them again:
--   delete from auth.users where email like '%@promold.test';
--   (profiles go with them — the foreign key cascades)
