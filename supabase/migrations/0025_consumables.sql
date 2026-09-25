-- 0025 Consumables: what a pack is, and where its cost lands
--
-- The schema had two kinds of thing: counted stock and serialised assets. A
-- box of contractor bags is neither. It is counted like stock but it travels
-- and gets used up like equipment, and nobody on a crew can tell you how many
-- bags are left in the box.
--
-- Three modes, one column:
--
--   single_use  masks, gloves, coveralls     counted out, costed to the job
--   bulk        bags, poly sheeting, chemical one container, opened once,
--                                            cost split across what it served
--   returnable  cords, buckets               counted out, counted back, costs
--                                            nothing because it comes home
--
-- THREE ASSUMPTIONS ARE BAKED IN HERE. They were open questions; they are
-- answered this way because the alternatives produce numbers that are not
-- true. Say so and they change — each is a small migration, not a rewrite.
--
--   1. A pack is open or finished. There is no part-used state and no "how
--      full is it" prompt. That question produces a guess, and the whole
--      reason for the pack model is to stop asking it.
--
--   2. PPE is costed to the job, never to the person. What a coverall cost
--      belongs on the job's margin. Who wore it is a payroll and safety
--      question that this app is not the place for.
--
--   3. A pack lives at a stock location — in practice a van — and can be
--      moved. "Which van has an open box of bags" is the question actually
--      asked on a Tuesday morning.

create type consumption_mode as enum ('single_use', 'bulk', 'returnable');

alter table inventory_items
  add column if not exists consumption_mode consumption_mode not null default 'single_use';

comment on column inventory_items.consumption_mode is
  'How this item is consumed: counted per job, opened as a pack, or returned.';

-- ---------------------------------------------------------------------------
-- Open packs
-- ---------------------------------------------------------------------------

create table stock_packs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  item_id uuid not null references inventory_items(id),
  -- Where the physical container is right now.
  location_id uuid not null references stock_locations(id),
  opened_at timestamptz not null default now(),
  opened_by uuid references profiles(id),
  -- What the container cost, snapshotted when it came off the shelf. The
  -- item's average cost moves with every receipt; this one must not, or a
  -- pack opened in March gets re-costed in July.
  unit_cost numeric(12,4) not null default 0,
  finished_at timestamptz,
  finished_by uuid references profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on stock_packs (org_id, location_id) where finished_at is null;
create index on stock_packs (item_id);

-- Which jobs a pack served. Append-only: a job that used a pack used it, and
-- un-saying that later would quietly move money between jobs.
create table stock_pack_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  pack_id uuid not null references stock_packs(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  first_used_at timestamptz not null default now(),
  logged_by uuid references profiles(id),
  unique (pack_id, job_id)
);

create index on stock_pack_jobs (job_id);

select attach_updated_at('stock_packs');
select enable_rls('stock_packs');
select enable_rls('stock_pack_jobs');

create policy stock_packs_select on stock_packs for select
  using (org_id = auth_org_id());
create policy stock_packs_write on stock_packs for all
  using (org_id = auth_org_id() and has_permission('inventory.log_usage'))
  with check (org_id = auth_org_id() and has_permission('inventory.log_usage'));

-- Append-only, like every other history table here.
create policy stock_pack_jobs_select on stock_pack_jobs for select
  using (org_id = auth_org_id());
create policy stock_pack_jobs_insert on stock_pack_jobs for insert
  with check (org_id = auth_org_id() and has_permission('inventory.log_usage'));

select attach_audit('stock_packs');

-- ---------------------------------------------------------------------------
-- Opening, using, finishing
-- ---------------------------------------------------------------------------

-- Opening a pack is the moment the stock leaves the shelf. One movement, no
-- job attached — which job pays is not known yet and pretending otherwise is
-- how the first job to touch a box ends up wearing all of it.
create or replace function open_pack(
  p_item_id uuid,
  p_location_id uuid,
  p_job_id uuid default null,
  p_notes text default null
)
returns stock_packs
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid := auth_org_id();
  v_item inventory_items;
  v_pack stock_packs;
  v_on_hand numeric;
begin
  if not has_permission('inventory.log_usage') then
    raise exception 'Not permitted: opening a pack needs inventory.log_usage'
      using errcode = '42501';
  end if;

  select * into v_item from inventory_items
   where id = p_item_id and org_id = v_org and deleted_at is null;
  if not found then
    raise exception 'No such item' using errcode = '02000';
  end if;
  if v_item.consumption_mode <> 'bulk' then
    raise exception '% is not something you open — it is counted out', v_item.name
      using errcode = '22023';
  end if;

  select coalesce(quantity, 0) into v_on_hand from stock_levels
   where item_id = p_item_id and location_id = p_location_id;
  if coalesce(v_on_hand, 0) < 1 then
    raise exception 'No % left at that location to open', v_item.name
      using errcode = '23514';
  end if;

  insert into stock_packs (org_id, item_id, location_id, opened_by, unit_cost, notes)
  values (v_org, p_item_id, p_location_id, auth_user_id(), v_item.average_cost,
          nullif(btrim(coalesce(p_notes, '')), ''))
  returning * into v_pack;

  insert into stock_movements (
    org_id, item_id, kind, from_location_id, quantity, unit_cost,
    reference_table, reference_id, reason, created_by
  ) values (
    v_org, p_item_id, 'usage', p_location_id, 1, v_item.average_cost,
    'stock_packs', v_pack.id, 'Pack opened', auth_user_id()
  );

  if p_job_id is not null then
    perform use_pack_on_job(v_pack.id, p_job_id);
  end if;

  return v_pack;
end;
$fn$;

comment on function open_pack(uuid, uuid, uuid, text) is
  'Takes one container off the shelf and starts a pack. The cost parks on the '
  'pack until it is finished, because which jobs pay is not known yet.';

-- Says this job used that pack. Cheap, idempotent, and the only thing the
-- crew are ever asked about a pack.
create or replace function use_pack_on_job(p_pack_id uuid, p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_pack stock_packs;
begin
  if not has_permission('inventory.log_usage') then
    raise exception 'Not permitted: logging use needs inventory.log_usage'
      using errcode = '42501';
  end if;

  select * into v_pack from stock_packs
   where id = p_pack_id and org_id = auth_org_id();
  if not found then
    raise exception 'No such pack' using errcode = '02000';
  end if;
  if v_pack.finished_at is not null then
    raise exception 'That pack was finished on %', v_pack.finished_at::date
      using errcode = '22023';
  end if;

  insert into stock_pack_jobs (org_id, pack_id, job_id, logged_by)
  values (v_pack.org_id, p_pack_id, p_job_id, auth_user_id())
  on conflict (pack_id, job_id) do nothing;
end;
$fn$;

-- Finishing is the only quantity judgement anyone makes about a pack, and it
-- is a yes/no one: is it empty. That splits its cost across what it served.
create or replace function finish_pack(p_pack_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_pack stock_packs;
  v_jobs int;
begin
  if not has_permission('inventory.log_usage') then
    raise exception 'Not permitted: finishing a pack needs inventory.log_usage'
      using errcode = '42501';
  end if;

  select * into v_pack from stock_packs
   where id = p_pack_id and org_id = auth_org_id();
  if not found then
    raise exception 'No such pack' using errcode = '02000';
  end if;
  if v_pack.finished_at is not null then
    raise exception 'That pack is already finished' using errcode = '22023';
  end if;

  update stock_packs
     set finished_at = now(), finished_by = auth_user_id()
   where id = p_pack_id
   returning * into v_pack;

  select count(*) into v_jobs from stock_pack_jobs where pack_id = p_pack_id;

  return jsonb_build_object(
    'pack_id', p_pack_id,
    'jobs', v_jobs,
    'cost', v_pack.unit_cost,
    -- A pack nobody logged against a job costs the business, not a job. That
    -- is worth seeing rather than silently absorbing.
    'each', case when v_jobs > 0 then round(v_pack.unit_cost / v_jobs, 2) else null end
  );
end;
$fn$;

comment on function finish_pack(uuid) is
  'Marks a pack empty. Its cost then splits evenly across the jobs it served; '
  'a pack logged against no job lands on the business rather than a job.';

create or replace function move_pack(p_pack_id uuid, p_location_id uuid)
returns stock_packs
language plpgsql
security definer
set search_path = public
as $fn$
declare v_pack stock_packs;
begin
  if not has_permission('inventory.transfer') then
    raise exception 'Not permitted: moving stock needs inventory.transfer'
      using errcode = '42501';
  end if;

  update stock_packs
     set location_id = p_location_id
   where id = p_pack_id and org_id = auth_org_id() and finished_at is null
   returning * into v_pack;

  if not found then
    raise exception 'No open pack of that id here' using errcode = '02000';
  end if;
  return v_pack;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Where the cost lands
-- ---------------------------------------------------------------------------

-- An even split across the jobs a finished pack served. An open pack costs
-- nothing yet, because how many jobs it will serve is not known — and a
-- number that changes every week is not a cost, it is a rumour.
create or replace function job_pack_cost(p_job_id uuid)
returns numeric
language sql
stable
as $fn$
  select coalesce(sum(p.unit_cost / greatest(n.jobs, 1)), 0)
  from stock_pack_jobs pj
  join stock_packs p on p.id = pj.pack_id
  join lateral (
    select count(*) as jobs from stock_pack_jobs x where x.pack_id = p.id
  ) n on true
  where pj.job_id = p_job_id
    and p.finished_at is not null;
$fn$;

comment on function job_pack_cost(uuid) is
  'This job''s share of every finished pack it used. Derived, never stored.';

-- Folded into the materials line rather than added as a seventh column: a
-- pack is materials, and the costing screens and the export keep their shape.
create or replace function job_material_cost(p_job_id uuid)
returns numeric
language sql
stable
as $fn$
  select
    coalesce((
      select sum(mu.quantity * i.average_cost)
      from material_usage mu
      join inventory_items i on i.id = mu.item_id
      where mu.job_id = p_job_id
    ), 0)
    + job_pack_cost(p_job_id);
$fn$;

comment on function job_material_cost(uuid) is
  'Counted materials logged against the job, plus its share of any finished '
  'pack that served it.';

-- ---------------------------------------------------------------------------
-- What is open, and where
-- ---------------------------------------------------------------------------

create view open_packs
with (security_invoker = true)
as
select
  p.id as pack_id,
  p.org_id,
  p.item_id,
  i.sku,
  i.name,
  p.location_id,
  loc.name as location_name,
  p.opened_at,
  p.opened_by,
  p.unit_cost,
  p.notes,
  (select count(*) from stock_pack_jobs pj where pj.pack_id = p.id) as jobs_served
from stock_packs p
join inventory_items i on i.id = p.item_id
join stock_locations loc on loc.id = p.location_id
where p.finished_at is null;

comment on view open_packs is
  'Every container currently open, and which van it is on.';

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select on open_packs to authenticated';
  end if;
end $$;
