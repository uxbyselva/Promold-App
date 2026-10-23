-- 0021 Read the JWT the way Supabase actually provides it
--
-- auth_user_id() read `request.jwt.claim.sub`, a per-claim setting PostgREST
-- deprecated. Current Supabase sets `request.jwt.claims` — the whole payload
-- as one JSON string — and leaves the old one empty.
--
-- The failure was silent and total: the function returned null, so
-- auth_org_id() returned null, so every row-level security policy compared
-- org_id to null, which is never true. A correctly signed-in user saw an
-- empty application and no error anywhere, because nothing had gone wrong
-- exactly — every policy did its job on a caller the database could not
-- identify.
--
-- This matches what Supabase's own auth.uid() does: try the old setting,
-- fall back to the JSON payload. Keeping both means the local verification
-- harness, which sets the per-claim form, still works.

create or replace function auth_user_id()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

comment on function auth_user_id() is
  'The signed-in user, from either the legacy per-claim setting or the JSON '
  'claims payload. Returns null when called outside a request, which makes '
  'every RLS policy deny — fail closed, by design.';
