-- 0039 Your own name and number
--
-- Settings grew a profile section: the name the rest of the app shows you by,
-- and the phone number the office rings when a job changes. Both are already
-- columns on `profiles`, and `profiles_self_update` already let you write
-- your own row — which is exactly the problem.
--
-- RLS is row-level. `using (id = auth_user_id())` says "this row is yours",
-- and a row grant cannot say "except these two columns". `profiles` is
-- granted to `authenticated` for every column but `cost_rate`, so that policy
-- also let any signed-in user write their own `role_id` — a technician could
-- make themselves the owner with one PATCH, and nothing in the database would
-- have refused it. Nothing in the app ever used the policy: the only client
-- writes to `profiles` are the People screen's, which go through
-- `profiles_admin_write` and `user.manage`.
--
-- So the policy goes, and editing your own details goes through a function
-- that can name the two columns it touches. The same shape as `set_cost_rate`
-- in 0036 and `set_job_price` in 0018, and for the same reason.

drop policy if exists profiles_self_update on profiles;

create or replace function update_my_profile(p_full_name text, p_phone text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_name text := btrim(coalesce(p_full_name, ''));
begin
  if v_name = '' then
    raise exception 'A name is required' using errcode = '22023';
  end if;

  update profiles
     set full_name = v_name,
         -- A blank box means "I have no number", not an empty string.
         phone = nullif(btrim(coalesce(p_phone, '')), ''),
         updated_at = now()
   where id = auth_user_id();

  if not found then
    raise exception 'No profile for this login' using errcode = '02000';
  end if;
end;
$fn$;

comment on function update_my_profile(text, text) is
  'Lets a signed-in user change their own name and phone number, and nothing '
  'else. It replaces the profiles_self_update row policy, which could not '
  'stop the same user writing their own role_id.';
