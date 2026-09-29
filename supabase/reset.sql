-- Promold — start the schema over
--
-- DESTRUCTIVE. Drops every table, view, function and policy in the public
-- schema, then leaves it empty and ready for supabase/bootstrap.sql.
--
-- This is the rollback for a project that has not gone into real use yet: if
-- the schema was empty before it was loaded, dropping it costs nothing and
-- puts you exactly back. Once there are real jobs in it, this is the wrong
-- tool — restore a backup instead.
--
-- It refuses on its own if there is real work in the database. That guard is
-- the point: pasting the wrong script into the wrong tab should not be able
-- to destroy anything.

do $$
declare
  v_jobs int := 0;
  v_customers int := 0;
  v_photos int := 0;
begin
  if to_regclass('public.jobs') is not null then
    execute 'select count(*) from public.jobs' into v_jobs;
  end if;
  if to_regclass('public.customers') is not null then
    execute 'select count(*) from public.customers' into v_customers;
  end if;
  if to_regclass('public.job_photos') is not null then
    execute 'select count(*) from public.job_photos' into v_photos;
  end if;

  if v_jobs > 0 or v_customers > 0 or v_photos > 0 then
    raise exception
      'Refusing: this database has % job(s), % customer(s) and % photo(s) in it.%',
      v_jobs, v_customers, v_photos,
      chr(10) || 'If that is only demo data you are sure you want gone, delete this '
              || 'guard block and run the rest. If it is real work, restore a backup '
              || 'instead — this script cannot put data back.'
      using errcode = '23514';
  end if;

  -- The drop happens INSIDE this block, on purpose.
  --
  -- Written as a separate statement after the block, the guard does not
  -- guard: psql and several other clients carry on to the next statement
  -- after an error, so the raise above prints and the schema is dropped
  -- anyway. Keeping them in one block means the exception genuinely stops it,
  -- in every client.
  raise notice 'Nothing of value found. Dropping the schema.';

  execute 'drop schema public cascade';
  execute 'create schema public';
end $$;

-- Supabase's own grants on a fresh public schema. Without these, PostgREST
-- cannot see the schema at all and every request 404s.
--
-- Each role is granted only if it exists, so this also runs on a plain
-- Postgres — which is where it gets tested.
do $$
declare r text;
begin
  foreach r in array array['postgres', 'anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('grant usage on schema public to %I', r);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'postgres') then
    execute 'grant all on schema public to postgres';
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'alter default privileges in schema public '
         || 'grant select, insert, update, delete on tables to authenticated';
    execute 'alter default privileges in schema public '
         || 'grant usage, select on sequences to authenticated';
  end if;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'alter default privileges in schema public '
         || 'grant execute on functions to anon, authenticated';
  end if;
end $$;

-- Now run supabase/bootstrap.sql, then steps 3 and 4 of docs/SUPABASE-SETUP.md.
