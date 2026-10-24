-- 0033 Job numbers that do not announce how much work we have
--
-- They were a global sequence: J00001, J00002, J00003. Every job carried a
-- running total of every job the company had ever booked, and it was printed
-- at the top of the screen a customer is looking over your shoulder at. The
-- second job we ever quoted said so.
--
-- The new shape is YYMM-NNNN — 2610-4827 for October 2026 — where the last
-- four digits are random. It still sorts and groups by month, which is what
-- the office actually uses a job number for, and it is four digits anybody
-- can read down a phone line. What it no longer carries is a count.
--
-- The month comes from the day the work is booked for, in the organisation's
-- own timezone, not the server's. A job booked at 8pm in Springfield on the
-- 31st belongs to that month, and `now()` in UTC would have said the next.
--
-- Numbers already issued in the old format are renumbered below. Nothing
-- points at a job number — it is a label for people, and the foreign keys all
-- use the id — so this is safe, and leaving two formats side by side would
-- only invite someone to read meaning into the difference.

-- ---------------------------------------------------------------------------
-- Minting one
-- ---------------------------------------------------------------------------

create or replace function next_job_number(p_org uuid, p_when timestamptz default null)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_zone text;
  v_stem text;
  v_try  text;
begin
  select timezone into v_zone from organizations where id = p_org;
  v_stem := to_char(coalesce(p_when, now()) at time zone coalesce(v_zone, 'UTC'), 'YYMM');

  -- Definer rights on purpose: the uniqueness check has to see every job in
  -- the organisation, and the person booking one generally cannot. Under the
  -- caller's rights a technician would be checking against the three jobs
  -- they can see and handing out a number already in use.
  for _ in 1..200 loop
    v_try := v_stem || '-' || lpad((floor(random() * 10000))::int::text, 4, '0');
    if not exists (select 1 from jobs where org_id = p_org and job_number = v_try) then
      return v_try;
    end if;
  end loop;

  -- Two hundred misses means the month is close to full at four digits —
  -- several thousand jobs in one month, which is not this company, but a
  -- number has to come back. Widen rather than fail or loop forever.
  return v_stem || '-' || lpad((floor(random() * 100000))::int::text, 5, '0');
end;
$fn$;

comment on function next_job_number(uuid, timestamptz) is
  'A free job number for an organisation, as YYMM-NNNN in that organisation''s '
  'timezone. Random within the month so the number carries no running total.';

-- ---------------------------------------------------------------------------
-- Handing it out
-- ---------------------------------------------------------------------------
--
-- A trigger rather than a column default, because a default cannot read
-- another column of the row being inserted and this one needs two: the
-- organisation, to be unique within it, and the scheduled start, to know
-- which month it belongs to.
--
-- It only fills a number that was not given, so the seed data keeps its own
-- readable J00101-style numbers and the assertions that name them keep
-- working.

create or replace function set_job_number()
returns trigger
language plpgsql
as $fn$
begin
  if new.job_number is null or btrim(new.job_number) = '' then
    new.job_number := next_job_number(new.org_id, new.scheduled_start);
  end if;
  return new;
end;
$fn$;

alter table jobs alter column job_number drop default;
alter table jobs alter column job_number drop not null;
drop sequence if exists job_number_seq;

drop trigger if exists jobs_number on jobs;
create trigger jobs_number before insert on jobs
  for each row execute function set_job_number();

-- Dropping NOT NULL above is what lets an insert leave the column out; the
-- trigger has filled it by the time the row lands, and this puts the
-- guarantee back so a later trigger change cannot quietly start writing
-- nameless jobs.
alter table jobs add constraint jobs_job_number_present
  check (job_number is not null and btrim(job_number) <> '');

-- ---------------------------------------------------------------------------
-- The ones already out there
-- ---------------------------------------------------------------------------

do $$
declare r record;
begin
  for r in
    select id, org_id, coalesce(scheduled_start, created_at) as booked_for
      from jobs
     where job_number ~ '^J[0-9]+$'
     order by created_at
  loop
    update jobs
       set job_number = next_job_number(r.org_id, r.booked_for)
     where id = r.id;
  end loop;
end $$;
