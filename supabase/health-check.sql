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
    (select count(*) from information_schema.tables
      where table_schema = 'public' and table_name = 'job_crew_pay') as m0029,
    -- 0030 creates nothing either; it makes the gate functions definer.
    (select count(*) from pg_proc
      where proname = 'job_completion_blockers' and prosecdef) as m0030,
    (select count(*) from pg_proc where proname = 'create_job_with_site') as m0031,
    -- 0032 is detected on the view rather than the table: the column has to
    -- reach jobs_safe or the clients cannot read it at all.
    (select count(*) from information_schema.columns
      where table_name = 'jobs_safe' and column_name = 'settlement_method') as m0032,
    -- 0033 is detected on the trigger, not the function. The function can sit
    -- there unused; what actually stops a job coming out as J00004 is the
    -- trigger being attached to the table.
    (select count(*) from pg_trigger
      where tgname = 'jobs_number' and not tgisinternal) as m0033,
    -- 0034 on the column DEFAULT, not on the organisation's own row.
    --
    -- It used to read the row, which is wrong in the one case that matters:
    -- an organisation created from the current setup guide is on Toronto
    -- time because the guide says to put it there, migration or no
    -- migration. A database at 0032 then reported "At 0034", and whoever
    -- believed it would run the 0034 catch-up — skipping 0033 and 0034
    -- entirely and leaving the schema quietly half-applied. The default on
    -- the column is set by the migration and by nothing else.
    (select count(*) from information_schema.columns
      where table_name = 'organizations' and column_name = 'timezone'
        and column_default like '%America/Toronto%') as m0034,
    -- 0035 on the view, for the reason 0032 taught: the column has to reach
    -- jobs_safe or the clients cannot read it at all.
    (select count(*) from information_schema.columns
      where table_name = 'jobs_safe' and column_name = 'category') as m0035,
    -- 0036 on add_person(), the one of the three that cannot be done any
    -- other way: it reads auth.users, which no signed-in user can.
    (select count(*) from pg_proc where proname = 'add_person') as m0036,
    (select count(*) from pg_proc where proname = 'job_equipment_on_site') as m0037,
    -- 0038 is detected inside the function body: the signature did not
    -- change, only who supplies a new site's name.
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'create_job_with_site'
        and p.prosrc like '%coalesce(nullif(btrim(coalesce(p_site_label%') as m0038,
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
    case when m0038 > 0 then 'Up to date (0001–0038)'
         when m0037 > 0 then 'At 0037 — run supabase/update-from-0037.sql'
         when m0036 > 0 then 'At 0036 — run supabase/update-from-0036.sql'
         when m0035 > 0 then 'At 0035 — run supabase/update-from-0035.sql'
         when m0034 > 0 then 'At 0034 — run supabase/update-from-0034.sql'
         when m0033 > 0 then 'At 0033 — run supabase/update-from-0033.sql'
         when m0032 > 0 then 'At 0032 — run supabase/update-from-0032.sql'
         when m0031 > 0 then 'At 0031 — run supabase/update-from-0031.sql'
         when m0030 > 0 then 'At 0030 — run supabase/update-from-0030.sql'
         when m0029 > 0 then 'At 0029 — run supabase/update-from-0029.sql'
         when m0028 > 0 then 'At 0028 — run supabase/update-from-0028.sql'
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
  select 7.97, 'Site naming (0038)',
    case when m0038 > 0 then 'Present' else 'Missing' end,
    case when m0038 > 0 then 'Booking a new address does not ask anybody to invent a nickname for it'
         else 'Booking a new address still demands a label before it will save'
         end
  from probe

  union all
  select 7.96, 'Kit left on site (0037)',
    case when m0037 > 0 then 'Present' else 'Missing' end,
    case when m0037 > 0 then 'A finished job keeps showing what is still in the building'
         else 'A job can be finished with our own equipment still on site and nothing saying so'
         end
  from probe

  union all
  select 7.95, 'Office admin (0036)',
    case when m0036 > 0 then 'Present' else 'Missing' end,
    case when m0036 > 0 then 'Staff, settings, roles, registers and checklists are editable in the app'
         else 'Adding a person or moving the spend threshold still needs the SQL editor'
         end
  from probe

  union all
  select 7.94, 'Job kinds (0035)',
    case when m0035 > 0 then 'Present' else 'Missing' end,
    case when m0035 > 0 then 'Jobs are remediation, inspection or other, and the board shows which'
         else 'Every job looks the same kind, so inspections cannot be counted'
         end
  from probe

  union all
  select 7.93, 'Ontario (0034)',
    case when m0034 > 0 then 'Present' else 'Missing' end,
    case when m0034 > 0 then 'Toronto time, dollars as CAD, kilometres, Celsius'
         else 'Still on New York time with US units — check the organisation row'
         end
  from probe

  union all
  select 7.92, 'Job numbers (0033)',
    case when m0033 > 0 then 'Present' else 'Missing' end,
    case when m0033 > 0 then 'New jobs are numbered YYMM-NNNN, which carries no running total'
         else 'New jobs still count upwards from J00001, which tells anyone holding two of them how much work you have had'
         end
  from probe

  union all
  -- 7.91, not 8.0: the organisation row below is 8, and 8.0 ties with it,
  -- so a migration numbered 8.0 sorted into the middle of the setup rows.
  select 7.91, 'Job finish (0032)',
    case when m0032 > 0 then 'Present' else 'Missing' end,
    case when m0032 > 0 then 'The crew record how it was settled and a note when they finish'
         else 'Finishing a job records nothing about how it was settled' end
  from probe

  union all
  select 7.9, 'New customer booking (0031)',
    case when m0031 > 0 then 'Present' else 'Missing' end,
    case when m0031 > 0 then 'A stranger can be booked in without two other screens first'
         else 'Booking needs the customer and site to exist already' end
  from probe

  union all
  select 7.8, 'Completion gate (0030)',
    case when m0030 > 0 then 'Present' else 'Missing — the crew see a false green light' end,
    case when m0030 > 0 then 'The gate tells the crew what is missing before they leave'
         else 'The gate errors for the crew and reads as "nothing outstanding"' end
  from probe

  union all
  select 7.7, 'Crew pay (0029)',
    case when m0029 > 0 then 'Present' else 'Missing' end,
    case when m0029 > 0 then 'Margin counts what the crew were paid'
         else 'Margin is missing the largest cost on every job' end
  from probe

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
