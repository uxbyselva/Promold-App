-- Demo data for an existing organisation
--
-- supabase/seed.sql creates its own organisation with its own users, so its
-- jobs are invisible to you — row-level security scopes everything to the
-- organisation you belong to, and that is a different one. This script adds
-- data to YOUR organisation instead, so it shows up on your board.
--
-- Change the email on the first line of the block below if you sign in as
-- someone else. Safe to run twice: it removes its own demo rows first.

do $$
declare
  v_email text := 'uxbyselva@gmail.com';   -- <<< your login
  v_org  uuid;
  v_me   uuid;
  v_cust uuid;
  v_site uuid;
  v_site2 uuid;
  v_tmpl uuid;
  v_job  uuid;
  v_today date := current_date;
begin
  select org_id, id into v_org, v_me
  from profiles where email = v_email;

  if v_org is null then
    raise exception
      'No profile for %. Run the owner step in docs/SUPABASE-SETUP.md first.', v_email;
  end if;

  -- Clear anything this script created before, so re-running is harmless.
  delete from customers where org_id = v_org and name in
    ('Helen Brooks', 'Cardinal Property Group');
  delete from equipment where org_id = v_org and asset_tag in
    ('AS-001', 'AS-002', 'AS-003', 'DH-001', 'MM-001');

  -- Customers and their properties -----------------------------------------
  insert into customers (org_id, name, kind, primary_contact, phone, email)
  values (v_org, 'Helen Brooks', 'residential', 'Helen Brooks',
          '555-0201', 'hbrooks@example.test')
  returning id into v_cust;

  insert into sites (org_id, customer_id, label, address_line1, city, state,
                     postal_code, access_notes)
  values (v_org, v_cust, '42 Oak St — basement', '42 Oak St', 'Springfield',
          'MA', '01103', 'Side gate code 4471. Dog in the yard.')
  returning id into v_site;

  insert into customers (org_id, name, kind, primary_contact, phone)
  values (v_org, 'Cardinal Property Group', 'property_manager', 'Nina Cross',
          '555-0202')
  returning id into v_cust;

  insert into sites (org_id, customer_id, label, address_line1, city, state,
                     postal_code, access_notes)
  values (v_org, v_cust, 'Larkspur Apts — unit 3B', '118 Larkspur Ave',
          'Springfield', 'MA', '01104', 'Keys at the leasing office, 9-5.')
  returning id into v_site2;

  -- A job type, so the completion gate has something to ask for -------------
  insert into job_templates (org_id, name, default_duration_hours, default_crew_size,
                             completion_requirements)
  values (v_org, 'Remediation Day', 8, 3,
          jsonb_build_object('photos_before', true, 'photos_after', true,
                             'customer_signature', true, 'materials_logged', true,
                             'forms', jsonb_build_array()))
  returning id into v_tmpl;

  -- Today's work -------------------------------------------------------------
  -- Assigned to you, so it lands in your column on the board.
  insert into jobs (org_id, customer_id, site_id, template_id, title, description,
                    status, priority, scheduled_start, scheduled_end, quoted_price)
  select v_org, c.id, v_site, v_tmpl, 'Basement remediation — day 3 of 3',
         'Containment, removal and treatment of affected framing and drywall.',
         'assigned', 'high',
         v_today + time '08:00', v_today + time '16:00', 8600.00
  from customers c where c.org_id = v_org and c.name = 'Helen Brooks'
  returning id into v_job;

  insert into job_assignments (org_id, job_id, user_id, acceptance_status, assigned_by)
  values (v_org, v_job, v_me, 'accepted', v_me);

  -- Unassigned, so the dispatch tray has something in it.
  insert into jobs (org_id, customer_id, site_id, title, status, priority,
                    scheduled_start, scheduled_end, quoted_price)
  select v_org, c.id, v_site2, 'Unit 3B containment setup', 'scheduled', 'normal',
         v_today + time '13:00', v_today + time '17:00', 2200.00
  from customers c where c.org_id = v_org and c.name = 'Cardinal Property Group';

  -- Tomorrow, so the date arrows do something visible.
  insert into jobs (org_id, customer_id, site_id, title, status, priority,
                    scheduled_start, scheduled_end, quoted_price)
  select v_org, c.id, v_site, 'Post-remediation verification', 'scheduled', 'normal',
         v_today + 1 + time '10:00', v_today + 1 + time '13:00', 600.00
  from customers c where c.org_id = v_org and c.name = 'Helen Brooks';

  -- Equipment ---------------------------------------------------------------
  insert into equipment (org_id, asset_tag, name, category, make, model,
                         purchase_cost, internal_day_rate, has_hour_meter)
  values
    (v_org, 'AS-001', 'Air scrubber #1', 'air_scrubber', 'Phoenix', 'Guardian R200',
     1450.00, 18.00, true),
    (v_org, 'AS-002', 'Air scrubber #2', 'air_scrubber', 'Phoenix', 'Guardian R200',
     1450.00, 18.00, true),
    (v_org, 'AS-003', 'Air scrubber #3', 'air_scrubber', 'BlueDri', 'AS-550',
     1180.00, 16.00, true),
    (v_org, 'DH-001', 'Dehumidifier #1', 'dehumidifier', 'Dri-Eaz', 'LGR 7000XLi',
     2380.00, 26.00, true),
    (v_org, 'MM-001', 'Moisture meter', 'meter', 'Delmhorst', 'BD-2100',
     320.00, 2.00, false);

  -- Two scrubbers left at the site, one of them overdue for collection, so
  -- the equipment alerts have something real to point at.
  insert into equipment_assignments (org_id, equipment_id, kind, job_id, site_id,
                                     started_at, expected_end_at, placed_by)
  select v_org, e.id, 'site_staging', v_job, v_site,
         now() - interval '2 days',
         case when e.asset_tag = 'DH-001' then now() - interval '6 hours'
              else now() + interval '1 day' end,
         v_me
  from equipment e
  where e.org_id = v_org and e.asset_tag in ('AS-001', 'AS-002', 'DH-001');

  raise notice 'Demo data added to your organisation. Reload the dispatch board.';
end $$;
