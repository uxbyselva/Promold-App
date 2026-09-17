-- Development seed: one organisation with a realistic day of work.
--
-- Deterministic UUIDs so tests and fixtures can reference rows directly.

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a001', 'owner@promold.test'),
  ('00000000-0000-0000-0000-00000000a002', 'manager@promold.test'),
  ('00000000-0000-0000-0000-00000000a003', 'lead@promold.test'),
  ('00000000-0000-0000-0000-00000000a004', 'tech1@promold.test'),
  ('00000000-0000-0000-0000-00000000a005', 'tech2@promold.test'),
  ('00000000-0000-0000-0000-00000000a006', 'books@promold.test')
on conflict do nothing;

insert into organizations (id, name, timezone) values
  ('00000000-0000-0000-0000-0000000000a1', 'Promold Restoration', 'America/New_York');

select provision_org('00000000-0000-0000-0000-0000000000a1');

insert into profiles (id, org_id, role_id, full_name, email, phone, cost_rate)
select u.id, '00000000-0000-0000-0000-0000000000a1', r.id, v.name, u.email, v.phone, v.rate
from (values
  ('00000000-0000-0000-0000-00000000a001'::uuid, 'owner',      'Dana Whitfield', '555-0101', 0),
  ('00000000-0000-0000-0000-00000000a002'::uuid, 'manager',    'Ray Alvarez',    '555-0102', 42.00),
  ('00000000-0000-0000-0000-00000000a003'::uuid, 'crew_lead',  'Marcus Bell',    '555-0103', 34.00),
  ('00000000-0000-0000-0000-00000000a004'::uuid, 'technician', 'Tomas Reyes',    '555-0104', 27.50),
  ('00000000-0000-0000-0000-00000000a005'::uuid, 'technician', 'Priya Nair',     '555-0105', 27.50),
  ('00000000-0000-0000-0000-00000000a006'::uuid, 'bookkeeper', 'Helen Osei',     '555-0106', 0)
) as v(uid, role_key, name, phone, rate)
join auth.users u on u.id = v.uid
join roles r on r.key = v.role_key and r.org_id = '00000000-0000-0000-0000-0000000000a1';

insert into crews (id, org_id, name, lead_user_id) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1',
   'Crew A', '00000000-0000-0000-0000-00000000a003');

insert into crew_members (crew_id, user_id) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000a003'),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000a004'),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000a005');

-- Customers and sites ------------------------------------------------------

insert into customers (id, org_id, name, kind, primary_contact, phone, email) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1',
   'Helen Brooks', 'residential', 'Helen Brooks', '555-0201', 'hbrooks@example.test'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1',
   'Cardinal Property Group', 'property_manager', 'Nina Cross', '555-0202', 'nina@cardinal.test'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a1',
   'Statewide Mutual (claims)', 'insurance', 'Adjuster desk', '555-0203', 'claims@statewide.test');

insert into sites (id, org_id, customer_id, label, address_line1, city, state, postal_code, lat, lng, access_notes) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1',
   '00000000-0000-0000-0000-0000000000d1', '42 Oak St — basement', '42 Oak St',
   'Springfield', 'MA', '01103', 42.101500, -72.589600, 'Side gate code 4471. Dog in the yard.'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1',
   '00000000-0000-0000-0000-0000000000d2', 'Larkspur Apts — unit 3B', '118 Larkspur Ave',
   'Springfield', 'MA', '01104', 42.118200, -72.571900, 'Keys at the leasing office, 9-5.');

-- Job templates ------------------------------------------------------------

insert into job_templates (id, org_id, name, default_duration_hours, default_crew_size,
                           default_equipment_categories, completion_requirements) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1',
   'Mold Inspection', 2, 1, '{meter}',
   jsonb_build_object('photos_before', true, 'photos_after', false,
     'customer_signature', false, 'materials_logged', false,
     'forms', jsonb_build_array('moisture_readings'))),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a1',
   'Containment Setup', 6, 2, '{air_scrubber,negative_air}',
   jsonb_build_object('photos_before', true, 'photos_after', true,
     'customer_signature', false, 'materials_logged', true,
     'forms', jsonb_build_array('containment_check', 'ppe_safety'))),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000a1',
   'Remediation Day', 8, 3, '{air_scrubber,dehumidifier,hepa_vacuum}',
   jsonb_build_object('photos_before', true, 'photos_after', true,
     'customer_signature', true, 'materials_logged', true,
     'forms', jsonb_build_array('ppe_safety'))),
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000a1',
   'Post-Remediation Verification', 3, 1, '{meter}',
   jsonb_build_object('photos_before', false, 'photos_after', true,
     'customer_signature', true, 'materials_logged', false,
     'forms', jsonb_build_array('moisture_readings', 'chain_of_custody')));

-- Inventory ----------------------------------------------------------------

insert into suppliers (id, org_id, name, phone, is_rental_vendor) values
  ('00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-0000000000a1', 'Restoration Supply Co', '555-0301', false),
  ('00000000-0000-0000-0000-000000000b02', '00000000-0000-0000-0000-0000000000a1', 'Northside Equipment Rental', '555-0302', true);

insert into stock_locations (id, org_id, name, kind) values
  ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-0000000000a1', 'Warehouse', 'warehouse'),
  ('00000000-0000-0000-0000-000000000c02', '00000000-0000-0000-0000-0000000000a1', 'Van 1', 'van'),
  ('00000000-0000-0000-0000-000000000c03', '00000000-0000-0000-0000-0000000000a1', 'Van 2', 'van');

insert into inventory_items (id, org_id, sku, name, category, unit_of_measure, average_cost,
                             preferred_supplier_id, min_level, reorder_quantity, barcode) values
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000a1', 'CHEM-001',
   'Antimicrobial concentrate', 'Chemicals', 'gal', 38.5000,
   '00000000-0000-0000-0000-000000000b01', 6, 12, '0810000000011'),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-0000000000a1', 'CONT-006',
   '6 mil poly sheeting 10x100', 'Containment', 'roll', 62.0000,
   '00000000-0000-0000-0000-000000000b01', 4, 10, '0810000000028'),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-0000000000a1', 'FLT-H14',
   'HEPA filter H14', 'Filters', 'each', 88.0000,
   '00000000-0000-0000-0000-000000000b01', 4, 8, '0810000000035'),
  ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-0000000000a1', 'PPE-SUIT',
   'Disposable coverall XL', 'PPE', 'each', 9.7500,
   '00000000-0000-0000-0000-000000000b01', 20, 50, '0810000000042'),
  ('00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-0000000000a1', 'TAPE-DUC',
   'Contractor tape', 'Containment', 'roll', 7.2000,
   '00000000-0000-0000-0000-000000000b01', 12, 24, '0810000000059');

-- Opening stock, as receipts so the ledger is the only source of truth.
insert into stock_movements (org_id, item_id, kind, to_location_id, quantity, unit_cost, reason)
select '00000000-0000-0000-0000-0000000000a1', v.item, 'receipt', v.loc, v.qty, v.cost, 'Opening balance'
from (values
  ('00000000-0000-0000-0000-000000000101'::uuid, '00000000-0000-0000-0000-000000000c01'::uuid, 14, 38.50),
  ('00000000-0000-0000-0000-000000000102'::uuid, '00000000-0000-0000-0000-000000000c01'::uuid, 9,  62.00),
  ('00000000-0000-0000-0000-000000000103'::uuid, '00000000-0000-0000-0000-000000000c01'::uuid, 6,  88.00),
  ('00000000-0000-0000-0000-000000000104'::uuid, '00000000-0000-0000-0000-000000000c01'::uuid, 60,  9.75),
  ('00000000-0000-0000-0000-000000000105'::uuid, '00000000-0000-0000-0000-000000000c01'::uuid, 30,  7.20),
  ('00000000-0000-0000-0000-000000000101'::uuid, '00000000-0000-0000-0000-000000000c02'::uuid, 3,  38.50),
  ('00000000-0000-0000-0000-000000000104'::uuid, '00000000-0000-0000-0000-000000000c02'::uuid, 12,  9.75)
) as v(item, loc, qty, cost);

-- Vehicles -----------------------------------------------------------------

insert into vehicles (id, org_id, name, plate, make_model, year, current_odometer,
                      assigned_user_id, insurance_expiry, next_service_odometer) values
  ('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-0000000000a1',
   'Van 1', 'MA-4471', 'Ford Transit 250', 2021, 68420.0,
   '00000000-0000-0000-0000-00000000a003', '2026-04-30', 72000.0),
  ('00000000-0000-0000-0000-00000000cc02', '00000000-0000-0000-0000-0000000000a1',
   'Van 2', 'MA-9182', 'RAM ProMaster 2500', 2019, 104880.0,
   '00000000-0000-0000-0000-00000000a004', '2026-02-28', 108000.0);

update stock_locations set vehicle_id = '00000000-0000-0000-0000-00000000cc01'
  where id = '00000000-0000-0000-0000-000000000c02';
update stock_locations set vehicle_id = '00000000-0000-0000-0000-00000000cc02'
  where id = '00000000-0000-0000-0000-000000000c03';

-- Equipment ----------------------------------------------------------------

insert into equipment (id, org_id, asset_tag, name, category, make, model,
                       purchase_date, purchase_cost, internal_day_rate, has_hour_meter,
                       filter_interval_hours, home_location_id) values
  ('00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-0000000000a1',
   'AS-001', 'Air scrubber #1', 'air_scrubber', 'Phoenix', 'Guardian R200',
   '2022-03-11', 1450.00, 18.00, true, 500, '00000000-0000-0000-0000-000000000c01'),
  ('00000000-0000-0000-0000-00000000ee02', '00000000-0000-0000-0000-0000000000a1',
   'AS-002', 'Air scrubber #2', 'air_scrubber', 'Phoenix', 'Guardian R200',
   '2022-03-11', 1450.00, 18.00, true, 500, '00000000-0000-0000-0000-000000000c01'),
  ('00000000-0000-0000-0000-00000000ee03', '00000000-0000-0000-0000-0000000000a1',
   'AS-003', 'Air scrubber #3', 'air_scrubber', 'BlueDri', 'AS-550', 
   '2023-07-02', 1180.00, 16.00, true, 500, '00000000-0000-0000-0000-000000000c01'),
  ('00000000-0000-0000-0000-00000000ee04', '00000000-0000-0000-0000-0000000000a1',
   'DH-001', 'Dehumidifier #1', 'dehumidifier', 'Dri-Eaz', 'LGR 7000XLi',
   '2021-11-20', 2380.00, 26.00, true, 1000, '00000000-0000-0000-0000-000000000c01'),
  ('00000000-0000-0000-0000-00000000ee05', '00000000-0000-0000-0000-0000000000a1',
   'MM-001', 'Moisture meter', 'meter', 'Delmhorst', 'BD-2100',
   '2023-01-15', 320.00, 2.00, false, null, '00000000-0000-0000-0000-000000000c02');

-- Jobs ---------------------------------------------------------------------

insert into jobs (id, org_id, job_number, customer_id, site_id, template_id, title, description,
                  status, priority, scheduled_start, scheduled_end, quoted_price) values
  ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-0000000000a1', 'J00101',
   '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1',
   '00000000-0000-0000-0000-0000000000f1', 'Basement mold inspection',
   'Musty smell reported after spring flooding.', 'closed', 'normal',
   now() - interval '21 days', now() - interval '21 days' + interval '2 hours', 450.00),

  ('00000000-0000-0000-0000-00000000bb02', '00000000-0000-0000-0000-0000000000a1', 'J00102',
   '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1',
   '00000000-0000-0000-0000-0000000000f3', 'Basement remediation — 3 day',
   'Containment, removal and treatment of affected framing and drywall.',
   'in_progress', 'high',
   now() - interval '2 days', now() + interval '1 day', 8600.00),

  ('00000000-0000-0000-0000-00000000bb03', '00000000-0000-0000-0000-0000000000a1', 'J00103',
   '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000e2',
   '00000000-0000-0000-0000-0000000000f2', 'Unit 3B containment setup',
   'Bathroom ceiling, suspected ongoing leak from unit above.', 'assigned', 'normal',
   now() + interval '1 day', now() + interval '1 day' + interval '6 hours', 2200.00);

-- The multi-day job runs as three visits; the dispatch board plots these.
insert into job_visits (org_id, job_id, seq, scheduled_start, scheduled_end, status) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000bb02', 1,
   now() - interval '2 days', now() - interval '2 days' + interval '8 hours', 'done'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000bb02', 2,
   now() - interval '1 day', now() - interval '1 day' + interval '8 hours', 'done'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000bb02', 3,
   now(), now() + interval '8 hours', 'in_progress');

insert into job_assignments (org_id, job_id, user_id, crew_id, acceptance_status, responded_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000bb02',
   '00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-0000000000c1', 'accepted', now() - interval '3 days'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000bb02',
   '00000000-0000-0000-0000-00000000a004', '00000000-0000-0000-0000-0000000000c1', 'accepted', now() - interval '3 days'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000bb02',
   '00000000-0000-0000-0000-00000000a005', '00000000-0000-0000-0000-0000000000c1', 'accepted', now() - interval '3 days'),
  -- Tomorrow's job: one accepted, one still silent. This is the case the
  -- 12-hour escalation exists for.
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000bb03',
   '00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-0000000000c1', 'accepted', now() - interval '4 hours'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000bb03',
   '00000000-0000-0000-0000-00000000a005', '00000000-0000-0000-0000-0000000000c1', 'pending', null);

-- Equipment currently deployed: two scrubbers and a dehu have been at 42 Oak
-- St since the job started. This is the state the pickup alert watches.
insert into equipment_assignments (org_id, equipment_id, kind, job_id, site_id,
                                   started_at, expected_end_at, placed_by,
                                   assigned_to_user_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000ee01', 'site_staging',
   '00000000-0000-0000-0000-00000000bb02', '00000000-0000-0000-0000-0000000000e1',
   now() - interval '2 days', now() + interval '1 day', '00000000-0000-0000-0000-00000000a003', null),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000ee02', 'site_staging',
   '00000000-0000-0000-0000-00000000bb02', '00000000-0000-0000-0000-0000000000e1',
   now() - interval '2 days', now() + interval '1 day', '00000000-0000-0000-0000-00000000a003', null),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000ee04', 'site_staging',
   '00000000-0000-0000-0000-00000000bb02', '00000000-0000-0000-0000-0000000000e1',
   now() - interval '2 days', now() - interval '6 hours', '00000000-0000-0000-0000-00000000a003', null),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000ee05', 'checkout',
   '00000000-0000-0000-0000-00000000bb02', null,
   now() - interval '2 days', null, '00000000-0000-0000-0000-00000000a003',
   '00000000-0000-0000-0000-00000000a003');

-- Rented in because all three owned scrubbers were committed.
insert into equipment_rentals (org_id, supplier_id, job_id, site_id, description, category,
                               quantity, rate, rate_unit, picked_up_at, return_due_at,
                               estimated_cost, status, agreement_no) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000b02',
   '00000000-0000-0000-0000-00000000bb02', '00000000-0000-0000-0000-0000000000e1',
   'HEPA air scrubber (rental)', 'air_scrubber', 2, 45.00, 'day',
   now() - interval '2 days', now() + interval '1 day', 270.00, 'on_hire', 'NER-88213');

-- Field capture on the running job -----------------------------------------

insert into time_entries (org_id, job_id, user_id, clock_in_at, clock_out_at, within_geofence, break_minutes)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000bb02',
   '00000000-0000-0000-0000-00000000a003', now() - interval '2 days' - interval '8 hours',
   now() - interval '2 days', true, 30),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000bb02',
   '00000000-0000-0000-0000-00000000a004', now() - interval '2 days' - interval '8 hours',
   now() - interval '2 days', true, 30),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000bb02',
   '00000000-0000-0000-0000-00000000a005', now() - interval '1 day' - interval '8 hours',
   now() - interval '1 day', true, 45);

insert into material_usage (org_id, job_id, item_id, location_id, quantity, logged_by) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000bb02',
   '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000c01', 3, '00000000-0000-0000-0000-00000000a003'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000bb02',
   '00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000c02', 9, '00000000-0000-0000-0000-00000000a003'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000bb02',
   '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000c02', 2, '00000000-0000-0000-0000-00000000a004');

insert into mileage_logs (org_id, vehicle_id, user_id, job_id, trip_date,
                          odometer_start, odometer_end, purpose) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000cc01',
   '00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-00000000bb02',
   current_date - 2, 68420.0, 68449.0, 'Shop to 42 Oak St and return'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000cc01',
   '00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-00000000bb02',
   current_date - 1, 68449.0, 68477.0, 'Shop to 42 Oak St and return');

-- A purchase request mid-approval.
insert into purchase_requests (id, org_id, request_number, requested_by, assigned_to, job_id,
                               status, needed_by, notes, submitted_at) values
  ('00000000-0000-0000-0000-00000000dd01', '00000000-0000-0000-0000-0000000000a1', 'PR00041',
   '00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-00000000a002',
   '00000000-0000-0000-0000-00000000bb02', 'draft', current_date + 2,
   'Running low on poly and suits for day 3.', null);

insert into purchase_request_lines (org_id, request_id, item_id, description, quantity, unit, estimated_unit_cost) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000dd01',
   '00000000-0000-0000-0000-000000000102', '6 mil poly sheeting 10x100', 4, 'roll', 62.00),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000dd01',
   '00000000-0000-0000-0000-000000000104', 'Disposable coverall XL', 24, 'each', 9.75),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000dd01',
   null, 'Respirator cartridges P100 (pair)', 6, 'pair', 18.50);

-- Submitted only once the lines exist: the lock trigger refuses line changes
-- after a request leaves draft, which is the behaviour being relied on here.
update purchase_requests
set status = 'submitted', submitted_at = now() - interval '5 hours'
where id = '00000000-0000-0000-0000-00000000dd01';

insert into certification_types (org_id, name, issuing_body, validity_months, is_required) values
  ('00000000-0000-0000-0000-0000000000a1', 'IICRC AMRT', 'IICRC', 24, true),
  ('00000000-0000-0000-0000-0000000000a1', 'IICRC WRT', 'IICRC', 24, true),
  ('00000000-0000-0000-0000-0000000000a1', 'Respirator fit test', 'Occupational health', 12, true);

insert into user_certifications (org_id, user_id, type_id, issued_on, expires_on)
select '00000000-0000-0000-0000-0000000000a1', p.id, ct.id,
       current_date - interval '10 months', current_date + interval '2 months'
from profiles p
cross join certification_types ct
where p.org_id = '00000000-0000-0000-0000-0000000000a1'
  and ct.name = 'Respirator fit test'
  and p.id in ('00000000-0000-0000-0000-00000000a003',
               '00000000-0000-0000-0000-00000000a004',
               '00000000-0000-0000-0000-00000000a005');
