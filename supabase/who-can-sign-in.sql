-- Promold — who can sign in, and who the app recognises
--
-- Read-only. Run this when somebody signs in and lands on "No profile for
-- this login", or before adding people, to see what is already there.
--
-- Signing in and being known to the app are two different things. Supabase
-- Authentication decides whether the password is right; `profiles` decides
-- who that person is at Promold — their organisation and their role. An auth
-- user with no profile row can sign in perfectly and then see nothing at all,
-- because row-level security scopes every table to an organisation and that
-- link is where the organisation comes from.
--
-- Fix a "NO PROFILE" row with supabase/add-a-person.sql.

select
  u.email,
  case
    when p.id is null then '>> NO PROFILE — signs in, sees nothing'
    when not p.is_active then 'deactivated'
    else coalesce(r.name, 'profile with no role')
  end as "the app sees",
  p.full_name as "known as",
  o.name as "organisation"
from auth.users u
left join profiles p on p.id = u.id
left join roles r on r.id = p.role_id
left join organizations o on o.id = p.org_id
order by (p.id is null) desc, u.email;

-- And what organisations exist. There should be exactly one. A second one
-- usually means the owner step in docs/SUPABASE-SETUP.md was run twice, and
-- it is worth sorting out before adding anyone else: people in different
-- organisations cannot see each other's work, by design and with no warning.

select
  o.name as "organisation",
  (select count(*) from profiles p where p.org_id = o.id and p.is_active) as "people",
  (select count(*) from jobs j where j.org_id = o.id and j.deleted_at is null) as "jobs",
  (select count(*) from customers c where c.org_id = o.id and c.deleted_at is null) as "customers",
  o.id
from organizations o
order by o.created_at;
