-- 0031 Booking work for somebody who is not in the system yet
--
-- Every job here starts with a phone call from a stranger. The booking form
-- asked which customer, which site — and on a fresh organisation both lists
-- were empty, so the one thing an owner wants to do on day one was the one
-- thing the app would not let them do. The way through was Customers → add,
-- then that customer → add a site, then back to Jobs → new: three screens
-- before a single job exists.
--
-- This takes the customer and the site as either an id or the few words it
-- takes to create one, and then hands the actual booking to `create_job()`.
-- Deliberately a wrapper and not a copy: every rule about double bookings,
-- time off, work days and crew lives in that function and must keep living in
-- exactly one place.
--
-- One function means one transaction, which is the point. A refused booking
-- — a crew member already out that day — must not leave a half-made customer
-- behind for somebody to find later and wonder about.

create or replace function create_job_with_site(
  -- An existing customer, or the name and number to make one.
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  -- An existing site, or the label and address to make one.
  p_site_id uuid,
  p_site_label text,
  p_site_address1 text,
  p_site_city text,
  p_site_state text,
  p_site_postal text,
  -- The job itself, passed straight through.
  p_title text,
  p_scheduled_start timestamptz,
  p_scheduled_end timestamptz default null,
  p_description text default null,
  p_template_id uuid default null,
  p_priority job_priority default 'normal',
  p_quoted_price numeric default null,
  p_crew uuid[] default '{}'
)
returns jobs
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid := auth_org_id();
  v_customer uuid := p_customer_id;
  v_site uuid := p_site_id;
begin
  -- Making a customer or a site is the office's job, and a separate one from
  -- booking work. Someone who may book but not manage customers can still
  -- book against the ones that exist.
  if (p_customer_id is null or p_site_id is null)
     and not has_permission('customer.manage') then
    raise exception 'Not permitted: adding a customer or site needs customer.manage'
      using errcode = '42501';
  end if;

  if v_customer is null then
    if p_customer_name is null or btrim(p_customer_name) = '' then
      raise exception 'A new customer needs a name' using errcode = '22023';
    end if;
    insert into customers (org_id, name, phone, created_by)
    values (v_org, btrim(p_customer_name),
            nullif(btrim(coalesce(p_customer_phone, '')), ''), auth_user_id())
    returning id into v_customer;
  else
    -- An id from somewhere else is not a licence to read somebody else's
    -- books: this runs with definer rights, so the org check is ours to make.
    perform 1 from customers
     where id = v_customer and org_id = v_org and deleted_at is null;
    if not found then
      raise exception 'No such customer' using errcode = '02000';
    end if;
  end if;

  if v_site is null then
    if p_site_label is null or btrim(p_site_label) = '' then
      raise exception 'A new site needs a label — what the crew will call it'
        using errcode = '22023';
    end if;
    if p_site_address1 is null or btrim(p_site_address1) = '' then
      raise exception 'A new site needs a street address — the crew have to drive there'
        using errcode = '22023';
    end if;
    insert into sites (org_id, customer_id, label, address_line1, city, state,
                       postal_code, created_by)
    values (v_org, v_customer, btrim(p_site_label), btrim(p_site_address1),
            nullif(btrim(coalesce(p_site_city, '')), ''),
            nullif(btrim(coalesce(p_site_state, '')), ''),
            nullif(btrim(coalesce(p_site_postal, '')), ''),
            auth_user_id())
    returning id into v_site;
  else
    perform 1 from sites
     where id = v_site and customer_id = v_customer and org_id = v_org
       and deleted_at is null;
    if not found then
      raise exception 'That site does not belong to that customer'
        using errcode = '22023';
    end if;
  end if;

  return create_job(
    v_customer, v_site, p_title, p_scheduled_start, p_scheduled_end,
    p_description, p_template_id, p_priority, p_quoted_price, p_crew
  );
end;
$fn$;

comment on function create_job_with_site is
  'Books a job, making the customer and/or the site first when they are new. '
  'A wrapper around create_job(), which keeps every scheduling rule; this '
  'only adds the two rows a first-time caller needs and the transaction that '
  'ties all of it together.';
