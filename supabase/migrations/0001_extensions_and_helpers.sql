-- 0001 Extensions and shared helpers
--
-- btree_gist is required for the equipment placement exclusion constraint
-- (uuid equality combined with a time range overlap test).

create extension if not exists "pgcrypto";
create extension if not exists "btree_gist";

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Attaches the updated_at trigger to a table. Called at the end of each
-- migration that creates tables so the convention cannot be forgotten.
create or replace function attach_updated_at(p_table text)
returns void
language plpgsql
as $$
begin
  execute format(
    'create trigger trg_%s_updated_at before update on %I
       for each row execute function set_updated_at()',
    p_table, p_table
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Request context
--
-- auth.uid() is provided by Supabase. auth_user_id() wraps the JWT claim so
-- the schema can also be verified locally against a plain Postgres, and so
-- tests can impersonate a user by setting the claim directly.
-- ---------------------------------------------------------------------------

create or replace function auth_user_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- auth_org_id() and has_permission() depend on the profiles table and are
-- defined at the end of 0002_identity.sql.
