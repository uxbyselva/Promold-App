# Setting up Supabase

About 15 minutes. At the end you have a real database with the full schema,
your own login, and demo data you can throw away.

## Before you start — which keys are which

Supabase gives you two API keys that look identical: both are long strings
starting `eyJ...`. They are not remotely equivalent.

| Key | What it can do | Where it may go |
|---|---|---|
| **publishable** (`sb_publishable_…`) or legacy **anon public** (`eyJ…`) | Only what the signed-in user may do. Row-level security applies. | Browser bundle, `.env.local`, fine to share with your developer |
| **secret** (`sb_secret_…`) or legacy **service_role** (`eyJ…`) | **Bypasses row-level security completely.** Every table, every row, no permission checks. Reads cost rates and prices regardless of role. | A server-side secret store. Nothing else. |

Supabase is moving from the legacy JWT pair to publishable/secret keys. A
project that has disabled the legacy pair answers every request signed with an
old key with **"Legacy API keys are disabled"** — switch the browser key to
the publishable one and redeploy. Disabling the legacy pair also revokes the
old service_role key, which is the cleanest way to deal with one that leaked.

They are told apart by decoding the middle section, which carries
`"role":"anon"` or `"role":"service_role"`. If you are about to send a key to
anyone, check that first.

**Never paste the `service_role` key or the database password into a chat, an
issue, or a commit.** Nothing in this app needs the service_role key.

### If one leaks

Rotate immediately — a key that has been pasted anywhere is compromised, and
deleting the message does not help.

1. **Project Settings → API → JWT Settings → Generate a new JWT secret.**
2. This invalidates **both** keys and issues new ones, so update
   `.env.local` afterwards.

`./scripts/scan-secrets.sh` checks tracked files for JWTs, service_role
references, committed env files and database URLs carrying a password. CI
runs it on every push.

## 1. Create the project

1. Go to [supabase.com](https://supabase.com) and sign up — signing in with
   GitHub is quickest.
2. **New project**. Fill in:
   - **Name**: `promold`
   - **Database password**: let it generate one, then **save it in your
     password manager**. You cannot see it again, and you need it to connect
     directly.
   - **Region**: `East US (North Virginia)` — closest to Springfield, so the
     app feels quicker.
   - **Plan**: Free.
3. Provisioning takes about two minutes.

## 2. Load the schema

1. In the left sidebar: **SQL Editor** → **New query**.
2. Open `supabase/bootstrap.sql` from this repo, copy all of it, paste it in.
3. **Run**. It takes a few seconds and should finish with no errors.

That creates every table, every row-level security policy, the workflow
functions, and the default roles. Nothing is in it yet.

> The file is every migration concatenated in order. It is generated —
> `./scripts/build-bootstrap.sh` rebuilds it after a schema change. Never
> edit it by hand.

## 3. Create your login

1. **Authentication** → **Users** → **Add user** → **Create new user**.
2. Use your real email and a password you will remember. Tick
   **Auto Confirm User** so you can log in immediately.
3. Repeat for anyone else who needs access — but one is enough to start.

## 4. Turn yourself into the owner

Back in **SQL Editor**, run this, with your email in place of the one below:

```sql
-- Creates the organisation, its five roles and the starting form templates,
-- then makes you its owner.
do $$
declare
  v_org uuid;
  v_user uuid;
begin
  insert into organizations (name, timezone)
  values ('Promold Restoration', 'America/New_York')
  returning id into v_org;

  perform provision_org(v_org);

  select id into v_user from auth.users where email = 'you@example.com';
  if v_user is null then
    raise exception 'No auth user with that email — check step 3';
  end if;

  insert into profiles (id, org_id, role_id, full_name, email)
  select v_user, v_org, r.id, 'Your Name', 'you@example.com'
  from roles r where r.org_id = v_org and r.key = 'owner';

  raise notice 'Organisation % created, you are its owner', v_org;
end $$;
```

## 5. Optional — load the demo data

`supabase/seed.sql` fills the database with the sample company used
throughout the prototype: Helen Brooks at 42 Oak St, the three air scrubbers,
a job mid-remediation. Useful for seeing screens with something in them.

It creates its own users and its own organisation, separate from yours, so it
will not collide with step 4. Delete that organisation later and everything
it owns goes with it:

```sql
delete from organizations where name = 'Promold Restoration'
  and id = '00000000-0000-0000-0000-0000000000a1';
```

## 6. Give the app its keys

**Project Settings** → **API**. You need two values:

| Value | Where it goes | Secret? |
|---|---|---|
| **Project URL** | `.env.local` | No |
| **anon public** key | `.env.local` | Low risk — RLS protects the data |
| **service_role** key | Nowhere yet | **Yes.** Bypasses RLS entirely |

Create `apps/admin/.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

`.env.local` is already gitignored. `./scripts/scan-secrets.sh` will catch it
if that ever stops being true.

## 7. Run it

```bash
pnpm install
pnpm --filter @promold/admin dev
```

Open http://localhost:3000, sign in with the user from step 3, and you land on
the dispatch board for today.

**Empty board, no error** — most likely no jobs on today's date. Step through
with the arrows, or load the demo data from step 5 and navigate to
18 September 2026, which is the day its sample job runs.

**"No profile for this login"** — you are authenticated but step 4 has not been
run for this email, so `auth_org_id()` returns null and row-level security
hides everything. That screen says so rather than showing you a blank page.

## What the free tier gives you

| | Free tier | What it means here |
|---|---|---|
| Database | 500 MB | Years of job records. Not a constraint. |
| File storage | 1 GB | **The real limit.** See below. |
| Monthly active users | 50,000 | Irrelevant at 15 staff. |
| Pausing | After 7 days idle | One click to restore. Fine while building, not for production. |

**Storage is the number to watch.** An uncompressed phone photo is 3–5 MB, so
1 GB is about six jobs' worth. Compressed on the device to 300–500 KB — which
the app will do, and which loses nothing for documentation — it is closer to
50 jobs. Past that, Supabase Pro is $25/month for 100 GB.

Nothing locks you in: it is plain Postgres, and `pg_dump` takes everything
with you.

## If something goes wrong

**"relation already exists"** — the bootstrap was run twice. Either start a
fresh project, or reset first:

```sql
drop schema public cascade;
create schema public;
grant usage on schema public to anon, authenticated;
```

That deletes everything in the database. Only do it while setting up.

**"No auth user with that email"** — step 3 did not complete, or the email
does not match exactly. Check **Authentication → Users**.

**Logged in but every screen is empty** — you have no profile row, so
`auth_org_id()` returns null and row-level security hides everything. Re-run
step 4.
