-- 0016 Default roles and org provisioning
--
-- Roles are per-organisation rows so an owner can adjust one flag without a
-- deployment. These are the starting five from docs/04-permissions.md.

create or replace function provision_org_roles(p_org_id uuid)
returns void
language plpgsql
as $$
begin
  insert into roles (org_id, key, name, is_system, permissions) values
  (p_org_id, 'owner', 'Owner', true, jsonb_build_object(
    'job.view_all', true, 'job.edit', true, 'job.assign', true, 'job.accept', true,
    'job.complete', true, 'job.review', true, 'job.close', true, 'job.manage_templates', true,
    'reschedule.decide', true, 'customer.manage', true,
    'inventory.manage', true, 'inventory.log_usage', true, 'inventory.transfer', true,
    'inventory.adjust', true,
    'purchase.approve', true, 'purchase.approve_unlimited', true,
    'purchase.view_all', true, 'purchase.view_history', true,
    'vehicle.manage', true, 'mileage.view_all', true, 'mileage.edit_all', true,
    'equipment.manage', true, 'equipment.place', true, 'equipment.rental_manage', true,
    'time.view_all', true, 'time.log_others', true, 'time.edit_all', true,
    'timeoff.manage', true, 'user.manage', true, 'user.view_cost_rates', true,
    'role.manage', true, 'org.manage_settings', true, 'audit.view', true,
    'costing.view', true, 'export.run', true
  )),

  -- Manager: everything operational, spend capped by the org threshold
  -- (purchase.approve_unlimited is what lifts the cap, and only the owner
  -- has it).
  (p_org_id, 'manager', 'Manager', true, jsonb_build_object(
    'job.view_all', true, 'job.edit', true, 'job.assign', true, 'job.accept', true,
    'job.complete', true, 'job.review', true, 'job.manage_templates', true,
    'reschedule.decide', true, 'customer.manage', true,
    'inventory.manage', true, 'inventory.log_usage', true, 'inventory.transfer', true,
    'inventory.adjust', true,
    'purchase.approve', true, 'purchase.view_all', true, 'purchase.view_history', true,
    'vehicle.manage', true, 'mileage.view_all', true, 'mileage.edit_all', true,
    'equipment.manage', true, 'equipment.place', true, 'equipment.rental_manage', true,
    'time.view_all', true, 'time.log_others', true, 'time.edit_all', true,
    'timeoff.manage', true, 'user.manage', true, 'audit.view', true,
    'costing.view', true, 'export.run', true
  )),

  -- Crew lead: runs a crew on site, logs for the crew, approves nothing.
  (p_org_id, 'crew_lead', 'Crew Lead', true, jsonb_build_object(
    'job.accept', true, 'job.complete', true,
    'inventory.log_usage', true, 'inventory.transfer', true,
    'equipment.place', true,
    'time.log_others', true
  )),

  (p_org_id, 'technician', 'Technician', true, jsonb_build_object(
    'job.accept', true, 'job.complete', true,
    'inventory.log_usage', true,
    'equipment.place', true
  )),

  (p_org_id, 'bookkeeper', 'Bookkeeper', true, jsonb_build_object(
    'job.view_all', true,
    'purchase.view_all', true, 'purchase.view_history', true,
    'mileage.view_all', true, 'time.view_all', true,
    'audit.view', true, 'costing.view', true, 'export.run', true,
    'job.close', true
  ))
  on conflict (org_id, key) do nothing;
end;
$$;

-- Starting checklists and reading sheets for mold remediation work.
create or replace function provision_org_forms(p_org_id uuid)
returns void
language plpgsql
as $$
begin
  insert into form_templates (org_id, key, name, description, is_per_room, fields) values
  (p_org_id, 'moisture_readings', 'Moisture Readings', 'Per-room moisture and psychrometric readings', true,
   '[
     {"key":"material","label":"Material","type":"select","required":true,
      "options":["Drywall","Wood framing","Subfloor","Concrete","Insulation","Other"]},
     {"key":"moisture_pct","label":"Moisture content","type":"number","unit":"%","required":true},
     {"key":"temp_f","label":"Temperature","type":"number","unit":"F","required":true},
     {"key":"rh_pct","label":"Relative humidity","type":"number","unit":"%","required":true},
     {"key":"gpp","label":"Grains per pound","type":"number","unit":"gpp","required":false},
     {"key":"notes","label":"Notes","type":"text","required":false}
   ]'::jsonb),

  (p_org_id, 'containment_check', 'Containment Verification', 'Containment and negative pressure check', false,
   '[
     {"key":"barrier_intact","label":"Barrier intact","type":"boolean","required":true},
     {"key":"negative_pressure","label":"Negative pressure confirmed","type":"boolean","required":true},
     {"key":"pressure_reading","label":"Pressure differential","type":"number","unit":"inWC","required":false},
     {"key":"scrubbers_running","label":"Air scrubbers running","type":"number","required":true},
     {"key":"decon_setup","label":"Decontamination chamber set up","type":"boolean","required":true},
     {"key":"notes","label":"Notes","type":"text","required":false}
   ]'::jsonb),

  (p_org_id, 'ppe_safety', 'PPE and Job Hazard Check', 'Pre-work safety check', false,
   '[
     {"key":"respirator","label":"Respirator worn and fit-tested","type":"boolean","required":true},
     {"key":"suit","label":"Protective suit","type":"boolean","required":true},
     {"key":"gloves_eyes","label":"Gloves and eye protection","type":"boolean","required":true},
     {"key":"hazards","label":"Hazards identified","type":"text","required":true},
     {"key":"electrical_safe","label":"Electrical hazards controlled","type":"boolean","required":true},
     {"key":"walkthrough_done","label":"Crew walkthrough completed","type":"boolean","required":true}
   ]'::jsonb),

  (p_org_id, 'chain_of_custody', 'Sample Chain of Custody', 'Air and surface sample tracking', false,
   '[
     {"key":"sample_id","label":"Sample ID","type":"text","required":true},
     {"key":"sample_type","label":"Sample type","type":"select","required":true,
      "options":["Air - indoor","Air - outdoor control","Surface tape","Surface swab","Bulk"]},
     {"key":"location","label":"Sample location","type":"text","required":true},
     {"key":"collected_at","label":"Collected at","type":"datetime","required":true},
     {"key":"lab","label":"Lab","type":"text","required":true},
     {"key":"released_to","label":"Released to","type":"text","required":true}
   ]'::jsonb)
  on conflict (org_id, key) do nothing;
end;
$$;

create or replace function provision_org(p_org_id uuid)
returns void
language plpgsql
as $$
begin
  perform provision_org_roles(p_org_id);
  perform provision_org_forms(p_org_id);
end;
$$;

comment on function provision_org(uuid) is
  'Creates the default roles and form templates for a new organisation.';
