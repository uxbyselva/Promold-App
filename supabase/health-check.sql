-- Promold — what state is this database in?
--
-- READ ONLY. Changes nothing, creates nothing, safe to run any number of
-- times and safe to run on production.
--
-- Paste into the Supabase SQL editor and run. Every row comes back with a
-- verdict and, where something is missing, what to do about it.

with probe as (
  select
    -- Each migration is detected by something only it creates, so this reads
    -- the database's actual shape rather than a version number somebody could
    -- have set by hand.
    (select count(*) from information_schema.tables
      where table_schema = 'public' and table_name = 'organizations') as m0002,
    (select count(*) from information_schema.tables
      where table_schema = 'public' and table_name = 'jobs') as m0004,
    (select count(*) from information_schema.tables
      where table_schema = 'public' and table_name = 'stock_movements') as m0006,
    (select count(*) from information_schema.tables
      where table_schema = 'public' and table_name = 'equipment_assignments') as m0009,
    (select count(*) from information_schema.tables
      where table_schema = 'public' and table_name = 'audit_log') as m0010,
    (select count(*) from pg_proc where proname = 'transition_job') as m0012,
    (select count(*) from pg_policies where tablename = 'jobs') as m0015,
    (select count(*) from information_schema.tables
      where table_schema = 'public' and table_name = 'change_orders') as m0017,
    (select count(*) from information_schema.views
      where table_schema = 'public' and table_name = 'jobs_safe') as m0018,
    (select count(*) from information_schema.tables
      where table_schema = 'public' and table_name = 'deletable_tables') as m0022,
    (select count(*) from pg_proc where proname = 'create_job') as m0023,
    (select count(*) from pg_proc where proname = 'decide_time_off') as m0024,
    (select count(*) from information_schema.tables
      where table_schema = 'public' and table_name = 'stock_packs') as m0025,
    (select count(*) from pg_proc where proname = 'create_purchase_request') as m0026,
    (select count(*) from pg_proc where proname = 'set_job_price') as m0027,
    -- 0028 creates nothing; it grants price.view to the crew lead. The flag on
    -- the system role is the only thing there is to look at. -1 when the roles
    -- table does not exist yet, same trick as the rows below.
    (select case
       when to_regclass('public.roles') is null then -1
       else (xpath('/row/c/text()', query_to_xml(
              'select count(*) as c from public.roles where key = ''crew_lead''
                 and is_system and (permissions ->> ''price.view'')::boolean',
              false, true, '')))[1]::text::int
     end) as m0028,
    (select count(*) from information_schema.tables
      where table_schema = 'public') as tables,
    (select count(*) from pg_policies where schemaname = 'public') as policies,
    -- Same trick for these: on an empty project none of them exist, and an
    -- empty project is exactly when you most need this script to run.
    (select case when to_regclass('public.organizations') is null then -1
       else (xpath('/row/c/text()', query_to_xml(
              'select count(*) as c from public.organizations', false, true, '')))[1]::text::int
     end) as orgs,
    (select case when to_regclass('public.profiles') is null then -1
       else (xpath('/row/c/text()', query_to_xml(
              'select count(*) as c from public.profiles', false, true, '')))[1]::text::int
     end) as people,
    (select case when to_regclass('auth.users') is null then -1
       else (xpath('/row/c/text()', query_to_xml(
              'select count(*) as c from auth.users', false, true, '')))[1]::text::int
     end) as logins,
    -- storage.buckets only exists on a real Supabase project, so this is
    -- read through a dynamic query: naming the table directly would make the
    -- whole script fail to parse anywhere else. -1 means "no storage here".
    (select case
       when to_regclass('storage.buckets') is null then -1
       else (xpath('/row/c/text()', query_to_xml(
              'select count(*) as c from storage.buckets where id = ''job-photos''',
              false, true, '')))[1]::text::int
     end) as bucket
)
select * from (
  select 1::numeric as n, 'Schema' as part,
    -- Each migration in turn, so a database that stopped cleanly between two
    -- of them is told which one to run rather than "something failed halfway".
    -- The old version collapsed everything from 0022 to 0027 into one alarming
    -- verdict, which said "get help" to an owner whose database was fine and
    -- one file behind.
    case when m0028 > 0 then 'Up to date (0001–0028)'
         when m0027 > 0 then 'At 0027 — run supabase/update-from-0027.sql'
         when m0026 > 0 then 'At 0026 — run supabase/update-from-0026.sql (includes a security fix)'
         when m0025 > 0 then 'At 0025 — ask for a catch-up from 0025'
         when m0024 > 0 then 'At 0024 — ask for a catch-up from 0024'
         when m0023 > 0 then 'At 0023 — ask for a catch-up from 0023'
         when m0022 > 0 then 'At 0022 — ask for a catch-up from 0022'
         when m0018 > 0 then 'At 0021 — run supabase/update.sql'
         when m0002 > 0 then 'Older than 0018 — run supabase/bootstrap.sql on a fresh project'
         else 'Empty — run supabase/bootstrap.sql' end as verdict,
    tables::text || ' tables, ' || policies::text || ' security policies' as detail
  from probe

  union all
  select 2, 'Core (0001–0021)',
    case when m0002>0 and m0004>0 and m0006>0 and m0009>0 and m0010>0
              and m0012>0 and m0015>0 and m0017>0 and m0018>0
         then 'All present' else 'INCOMPLETE — see detail' end,
    concat_ws(', ',
      case when m0002=0 then 'missing organizations' end,
      case when m0004=0 then 'missing jobs' end,
      case when m0006=0 then 'missing stock ledger' end,
      case when m0009=0 then 'missing equipment' end,
      case when m0010=0 then 'missing audit log' end,
      case when m0012=0 then 'missing transition_job()' end,
      case when m0015=0 then 'NO ROW-LEVEL SECURITY ON JOBS' end,
      case when m0017=0 then 'missing change orders' end,
      case when m0018=0 then 'missing jobs_safe (price masking)' end)
  from probe

  union all
  select 3, 'Admin mode (0022)',
    case when m0022>0 then 'Present' else 'Missing' end,
    case when m0022>0 then 'Audit trail, record history, recycle bin'
         else 'The Admin switch will not appear' end from probe
  union all
  select 4, 'Job authoring (0023)',
    case when m0023>0 then 'Present' else 'Missing' end,
    case when m0023>0 then 'Booking a job from the calendar'
         else 'Creating a job will fail' end from probe
  union all
  select 5, 'Decisions (0024)',
    case when m0024>0 then 'Present' else 'Missing' end,
    case when m0024>0 then 'Answering reschedule and time-off requests'
         else 'Waiting on you will fail' end from probe
  union all
  select 6, 'Consumables (0025)',
    case when m0025>0 then 'Present' else 'Missing' end,
    case when m0025>0 then 'Packs, and the Stock screens'
         else 'Stock screens will fail' end from probe
  union all
  select 7, 'Purchasing (0026)',
    case when m0026>0 then 'Present' else 'Missing' end,
    case when m0026>0 then 'Asking to buy, and approving it'
         else 'Purchase approvals will fail' end from probe

  union all
  select 7.6, 'Crew lead price (0028)',
    case when m0028 > 0 then 'Present' else 'Missing' end,
    case when m0028 > 0 then 'The crew lead sees what a job is worth, and cannot change it'
         else 'The crew lead cannot see the quote, so cannot say when work outgrew it' end
  from probe

  union all
  select 7.5, 'Price guard (0027)',
    case when m0027>0 then 'Present' else 'MISSING — security fix' end,
    case when m0027>0 then 'Prices are not writable by the field'
         else 'Without it a crew lead can price and approve a change order' end from probe

  union all
  select 8, 'Your organisation',
    case when orgs<0 then 'No schema yet' when orgs>0 then 'Created' else 'NOT CREATED' end,
    case when orgs<0 then 'Load the schema first'
         when orgs>0 then orgs::text || ' organisation(s)'
         else 'Run step 4 of docs/SUPABASE-SETUP.md — without it the app says "signed in, but not set up yet"'
    end from probe
  union all
  select 9, 'Your profile',
    case when people<0 then 'No schema yet' when people>0 then 'Created' else 'NOT CREATED' end,
    case when people<0 then 'Load the schema first'
         else people::text || ' staff record(s) against ' ||
              greatest(logins, 0)::text || ' login(s)' end
    from probe
  union all
  select 10, 'Photo storage',
    case when bucket < 0 then 'Not applicable'
         when bucket > 0 then 'Ready' else 'Not set up' end,
    case when bucket < 0 then 'No storage schema — this is not a Supabase project'
         when bucket > 0 then 'job-photos bucket exists'
         else 'Run supabase/storage.sql — until then the crew cannot add photos' end
    from probe
) rows
order by n;
