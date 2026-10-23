-- 0013 Purchase request workflow, audit trigger, receipt into stock

-- ---------------------------------------------------------------------------
-- Append-only audit
--
-- Written by trigger rather than application code so nothing can bypass it.
-- RLS (0015) grants insert and select on the audit table but no update or
-- delete, to any role including the owner.
-- ---------------------------------------------------------------------------

create or replace function purchase_request_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_key text;
  v_request_id uuid;
  v_line_id uuid;
  v_org uuid;
begin
  if tg_table_name = 'purchase_requests' then
    v_request_id := new.id;
    v_line_id := null;
    v_org := new.org_id;
    -- Drafts are the requester's scratch space; auditing starts at submit.
    if tg_op = 'UPDATE' and old.status = 'draft' and new.status = 'draft' then
      return new;
    end if;
  else
    v_request_id := new.request_id;
    v_line_id := new.id;
    v_org := new.org_id;
    if exists (
      select 1 from purchase_requests where id = new.request_id and status = 'draft'
    ) then
      return new;
    end if;
  end if;

  if tg_op = 'INSERT' then
    insert into purchase_request_audit (org_id, request_id, line_id, actor_id, action, field, new_value)
    values (v_org, v_request_id, v_line_id, auth_user_id(), tg_op, null, v_new::text);
    return new;
  end if;

  for v_key in select jsonb_object_keys(v_new) loop
    if v_key not in ('updated_at', 'created_at')
       and (v_old -> v_key) is distinct from (v_new -> v_key) then
      insert into purchase_request_audit (
        org_id, request_id, line_id, actor_id, action, field, old_value, new_value
      )
      values (
        v_org, v_request_id, v_line_id, auth_user_id(), 'update', v_key,
        v_old ->> v_key, v_new ->> v_key
      );
    end if;
  end loop;

  return new;
end;
$$;

create trigger trg_purchase_requests_pr_audit
  after insert or update on purchase_requests
  for each row execute function purchase_request_audit_trigger();

create trigger trg_purchase_request_lines_pr_audit
  after insert or update on purchase_request_lines
  for each row execute function purchase_request_audit_trigger();

-- Editing is locked on submit, not on approval. The requester can recall a
-- request to draft, but only while no approver has picked it up.
create or replace function purchase_request_lock_check()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'purchase_request_lines' then
    if exists (
      select 1 from purchase_requests r
      where r.id = coalesce(new.request_id, old.request_id)
        and r.status not in ('draft', 'under_review')
    ) then
      raise exception 'Lines cannot be changed once the request leaves draft or review'
        using errcode = 'check_violation';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger trg_purchase_request_lines_lock
  before insert or update or delete on purchase_request_lines
  for each row execute function purchase_request_lock_check();

-- ---------------------------------------------------------------------------
-- Transitions
-- ---------------------------------------------------------------------------

create or replace function submit_purchase_request(p_request_id uuid)
returns purchase_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request purchase_requests;
begin
  select * into v_request from purchase_requests where id = p_request_id for update;

  if v_request.id is null then
    raise exception 'Request % not found', p_request_id using errcode = 'P0002';
  end if;
  if v_request.status <> 'draft' then
    raise exception 'Only a draft can be submitted (currently %)', v_request.status
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from purchase_request_lines where request_id = p_request_id) then
    raise exception 'A request needs at least one line' using errcode = 'check_violation';
  end if;

  update purchase_requests
  set status = 'submitted', submitted_at = now()
  where id = p_request_id
  returning * into v_request;

  return v_request;
end;
$$;

create or replace function recall_purchase_request(p_request_id uuid)
returns purchase_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request purchase_requests;
begin
  select * into v_request from purchase_requests where id = p_request_id for update;

  if v_request.status <> 'submitted' then
    raise exception 'Only a submitted request can be recalled (currently %)', v_request.status
      using errcode = 'check_violation';
  end if;
  if v_request.requested_by <> coalesce(auth_user_id(), v_request.requested_by) then
    raise exception 'Only the requester can recall a request'
      using errcode = 'insufficient_privilege';
  end if;

  update purchase_requests set status = 'draft', submitted_at = null
  where id = p_request_id
  returning * into v_request;

  return v_request;
end;
$$;

-- Approve, partially approve, or reject. p_approved_line_ids null means
-- approve everything; a subset approves those and rejects the rest.
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
as $$
declare
  v_request purchase_requests;
  v_total numeric;
  v_threshold numeric;
  v_approved_count int;
begin
  select * into v_request from purchase_requests where id = p_request_id for update;
  if v_request.id is null then
    raise exception 'Request % not found', p_request_id using errcode = 'P0002';
  end if;
  if v_request.status not in ('submitted', 'under_review') then
    raise exception 'Request is % and cannot be decided', v_request.status
      using errcode = 'check_violation';
  end if;

  if not has_permission('purchase.approve') then
    raise exception 'Permission purchase.approve required'
      using errcode = 'insufficient_privilege';
  end if;

  -- The threshold is read server-side. What a manager may approve is never
  -- decided by the client.
  select coalesce((settings ->> 'approval_threshold')::numeric, 0)
  into v_threshold
  from organizations where id = v_request.org_id;

  v_total := purchase_request_total(p_request_id);

  if p_approve
     and v_total > v_threshold
     and not has_permission('purchase.approve_unlimited') then
    raise exception
      'Request total % exceeds the approval threshold % — owner approval required',
      v_total, v_threshold
      using errcode = 'insufficient_privilege';
  end if;

  if not p_approve and (p_reason is null or length(trim(p_reason)) = 0) then
    raise exception 'A reason is required to reject' using errcode = 'check_violation';
  end if;

  if p_approve then
    if p_approved_line_ids is null then
      update purchase_request_lines set line_status = 'approved' where request_id = p_request_id;
    else
      update purchase_request_lines
      set line_status = case when id = any(p_approved_line_ids) then 'approved' else 'rejected' end,
          rejection_reason = case when id = any(p_approved_line_ids) then null else p_reason end
      where request_id = p_request_id;
    end if;

    select count(*) into v_approved_count
    from purchase_request_lines where request_id = p_request_id and line_status = 'approved';

    if v_approved_count = 0 then
      raise exception 'Approving with no approved lines — reject the request instead'
        using errcode = 'check_violation';
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
      decision_reason = p_reason
  where id = p_request_id
  returning * into v_request;

  return v_request;
end;
$$;

-- Receiving is what keeps inventory worth believing: it writes the stock
-- movement and rolls the item's weighted average cost forward.
create or replace function receive_purchase_line(
  p_line_id uuid,
  p_quantity numeric,
  p_location_id uuid,
  p_actual_unit_cost numeric default null
)
returns purchase_request_lines
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line purchase_request_lines;
  v_request purchase_requests;
  v_unit_cost numeric;
  v_on_hand numeric;
  v_outstanding int;
begin
  select * into v_line from purchase_request_lines where id = p_line_id for update;
  if v_line.id is null then
    raise exception 'Line % not found', p_line_id using errcode = 'P0002';
  end if;
  if v_line.line_status <> 'approved' then
    raise exception 'Only an approved line can be received' using errcode = 'check_violation';
  end if;
  if p_quantity <= 0 then
    raise exception 'Received quantity must be positive' using errcode = 'check_violation';
  end if;

  select * into v_request from purchase_requests where id = v_line.request_id for update;
  if v_request.status not in ('approved', 'ordered', 'partially_received') then
    raise exception 'Request is % and cannot receive stock', v_request.status
      using errcode = 'check_violation';
  end if;

  v_unit_cost := coalesce(p_actual_unit_cost, v_line.estimated_unit_cost, 0);

  if v_line.item_id is not null then
    insert into stock_movements (
      org_id, item_id, kind, to_location_id, quantity, unit_cost,
      job_id, reference_table, reference_id, created_by
    )
    values (
      v_line.org_id, v_line.item_id, 'receipt', p_location_id, p_quantity, v_unit_cost,
      v_request.job_id, 'purchase_request_lines', v_line.id, auth_user_id()
    );

    -- Weighted average across existing on-hand and the new receipt.
    select coalesce(sum(quantity), 0) into v_on_hand
    from stock_levels where item_id = v_line.item_id;

    update inventory_items
    set average_cost = case
      when v_on_hand <= 0 then v_unit_cost
      else round(
        ((average_cost * greatest(v_on_hand - p_quantity, 0)) + (v_unit_cost * p_quantity))
        / nullif(greatest(v_on_hand, p_quantity), 0), 4)
      end
    where id = v_line.item_id and v_unit_cost > 0;
  end if;

  update purchase_request_lines
  set received_quantity = received_quantity + p_quantity,
      receive_location_id = p_location_id
  where id = p_line_id
  returning * into v_line;

  select count(*) into v_outstanding
  from purchase_request_lines
  where request_id = v_line.request_id
    and line_status = 'approved'
    and received_quantity < quantity;

  update purchase_requests
  set status = case when v_outstanding = 0 then 'received' else 'partially_received' end::purchase_status
  where id = v_line.request_id;

  return v_line;
end;
$$;
