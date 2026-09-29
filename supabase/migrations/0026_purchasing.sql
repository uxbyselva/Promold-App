-- 0026 Raising a purchase request, and approving part of one
--
-- Two problems with what was here.
--
-- First, there was no way to raise a request in one go. A client had to
-- insert the request, then its lines, then submit — three writes in an order
-- the lock trigger cares about, and a tab closed in the middle leaves an
-- empty draft nobody will ever find.
--
-- Second, and worse: the approval threshold was checked against the whole
-- request even when the approver had unticked lines. A manager with a $500
-- limit looking at a $900 request could untick the $600 item, leaving $300 —
-- and still be refused. The limit is about what is being spent, so it has to
-- be measured against what is actually being approved.

-- ---------------------------------------------------------------------------
-- The lock was too wide to let anyone approve anything
-- ---------------------------------------------------------------------------
--
-- Lines were frozen outright once a request left draft, which is right for
-- the person who raised it — what was asked for must not change quietly after
-- somebody has looked at it. But approving a request *is* writing to its
-- lines: line_status and rejection_reason live there. So the approve path
-- could never have worked, and receiving a delivered line could not either.
--
-- The rule is really about the ask, not the row: what was requested is
-- frozen; what happened to it afterwards is not.
create or replace function purchase_request_lock_check()
returns trigger
language plpgsql
as $fn$
declare v_status purchase_status;
begin
  select r.status into v_status
    from purchase_requests r
   where r.id = coalesce(new.request_id, old.request_id);

  -- While it is still being written, anything goes.
  if v_status in ('draft', 'under_review') then
    return coalesce(new, old);
  end if;

  -- After that, the decision and the receipt may be recorded; the ask may not
  -- be rewritten, and lines may not appear or vanish.
  if tg_op = 'UPDATE'
     and new.item_id is not distinct from old.item_id
     and new.description is not distinct from old.description
     and new.quantity is not distinct from old.quantity
     and new.unit is not distinct from old.unit
     and new.estimated_unit_cost is not distinct from old.estimated_unit_cost then
    return new;
  end if;

  raise exception 'What was asked for cannot change once the request is submitted'
    using errcode = '23514';
end;
$fn$;

-- What this decision would actually commit to.
create or replace function purchase_request_selected_total(
  p_request_id uuid,
  p_line_ids uuid[] default null
)
returns numeric
language sql
stable
as $fn$
  select coalesce(sum(l.quantity * coalesce(l.estimated_unit_cost, 0)), 0)
  from purchase_request_lines l
  where l.request_id = p_request_id
    and (p_line_ids is null or l.id = any (p_line_ids));
$fn$;

comment on function purchase_request_selected_total(uuid, uuid[]) is
  'The total of the lines actually being approved. A null line list means all '
  'of them.';

create or replace function decide_purchase_request(
  p_request_id uuid,
  p_approve boolean,
  p_reason text default null,
  p_approved_line_ids uuid[] default null
)
returns purchase_requests
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_request purchase_requests;
  v_total numeric;
  v_threshold numeric;
  v_approved_count int;
begin
  select * into v_request from purchase_requests
   where id = p_request_id and org_id = auth_org_id()
   for update;
  if not found then
    raise exception 'No such request' using errcode = '02000';
  end if;
  if v_request.status not in ('submitted', 'under_review') then
    raise exception 'That request is % and cannot be decided now', v_request.status
      using errcode = '22023';
  end if;

  if not has_permission('purchase.approve') then
    raise exception 'Not permitted: approving a purchase needs purchase.approve'
      using errcode = '42501';
  end if;

  if not p_approve and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'Say why, so they know whether to ask differently'
      using errcode = '22023';
  end if;

  -- The threshold is read server-side, never sent by the client, and measured
  -- against the lines being approved rather than everything asked for.
  select coalesce((settings ->> 'approval_threshold')::numeric, 0)
    into v_threshold
    from organizations where id = v_request.org_id;

  v_total := purchase_request_selected_total(p_request_id, p_approved_line_ids);

  if p_approve
     and v_total > v_threshold
     and not has_permission('purchase.approve_unlimited') then
    raise exception
      'That comes to %, over the % you can approve. Take a line off, or send it to the owner.',
      to_char(v_total, 'FM999,999,990.00'), to_char(v_threshold, 'FM999,999,990.00')
      using errcode = '42501';
  end if;

  if p_approve then
    if p_approved_line_ids is null then
      update purchase_request_lines set line_status = 'approved' where request_id = p_request_id;
    else
      update purchase_request_lines
         set line_status = (case when id = any (p_approved_line_ids) then 'approved' else 'rejected' end)::purchase_line_status,
             rejection_reason = case when id = any (p_approved_line_ids) then null else p_reason end
       where request_id = p_request_id;
    end if;

    select count(*) into v_approved_count
      from purchase_request_lines
     where request_id = p_request_id and line_status = 'approved';

    if v_approved_count = 0 then
      raise exception 'Nothing is ticked — reject the request instead'
        using errcode = '22023';
    end if;
  else
    update purchase_request_lines
       set line_status = 'rejected', rejection_reason = p_reason
     where request_id = p_request_id;
  end if;

  update purchase_requests
     set status = case when p_approve then 'approved' else 'rejected' end::purchase_status,
         decided_by = auth_user_id(),
         decided_at = now(),
         decision_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_request_id
   returning * into v_request;

  return v_request;
end;
$fn$;

comment on function decide_purchase_request(uuid, boolean, text, uuid[]) is
  'Approve all or some lines, or reject with a reason. The spend limit is '
  'measured against the lines being approved, not against everything asked '
  'for.';

-- ---------------------------------------------------------------------------
-- Raising one
-- ---------------------------------------------------------------------------

create or replace function create_purchase_request(
  p_lines jsonb,
  p_job_id uuid default null,
  p_assigned_to uuid default null,
  p_needed_by date default null,
  p_notes text default null,
  p_supplier_id uuid default null,
  p_submit boolean default true
)
returns purchase_requests
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid := auth_org_id();
  v_request purchase_requests;
  v_line jsonb;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A request with nothing on it is not a request'
      using errcode = '22023';
  end if;

  insert into purchase_requests (
    org_id, requested_by, assigned_to, job_id, needed_by, notes, supplier_id
  ) values (
    v_org, auth_user_id(), p_assigned_to, p_job_id, p_needed_by,
    nullif(btrim(coalesce(p_notes, '')), ''), p_supplier_id
  )
  returning * into v_request;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    if coalesce(btrim(v_line ->> 'description'), '') = '' then
      raise exception 'Every line needs to say what it is' using errcode = '22023';
    end if;
    if coalesce((v_line ->> 'quantity')::numeric, 0) <= 0 then
      raise exception 'Every line needs a quantity' using errcode = '22023';
    end if;

    insert into purchase_request_lines (
      org_id, request_id, item_id, description, quantity, unit, estimated_unit_cost
    ) values (
      v_org, v_request.id,
      nullif(v_line ->> 'item_id', '')::uuid,
      btrim(v_line ->> 'description'),
      (v_line ->> 'quantity')::numeric,
      coalesce(nullif(btrim(coalesce(v_line ->> 'unit', '')), ''), 'each'),
      nullif(v_line ->> 'estimated_unit_cost', '')::numeric
    );
  end loop;

  -- Lines go on while it is still a draft, because the lock trigger stops a
  -- submitted request growing quietly after someone has looked at it.
  if p_submit then
    perform submit_purchase_request(v_request.id);
  end if;

  select * into v_request from purchase_requests where id = v_request.id;
  return v_request;
end;
$fn$;

comment on function create_purchase_request(jsonb, uuid, uuid, date, text, uuid, boolean) is
  'Raises a request with its lines and submits it, in one transaction — so a '
  'closed tab cannot leave an empty draft behind.';
