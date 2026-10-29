-- 0034 This company works in Ontario
--
-- The app was built against a Massachusetts stand-in — eastern US timezone,
-- dollars formatted as USD, mileage at the IRS rate per mile, moisture
-- readings in Fahrenheit. Ninety per cent of the work is in Ontario, so all
-- of that was quietly wrong, in the way that only shows up when somebody
-- reads a number off the screen and acts on it.
--
-- None of it is a schema change. The distance column was always called
-- `distance` and always came off an odometer, which in Ontario reads
-- kilometres; the money columns are plain numerics. What changes here is the
-- organisation's own settings and the one form template that named a unit.

-- ---------------------------------------------------------------------------
-- Timezone
-- ---------------------------------------------------------------------------
--
-- America/Toronto, not America/New_York. They have kept the same offset and
-- the same daylight-saving dates for decades, so nothing moves today — but
-- the two are separate entries in the database precisely because that is not
-- promised, and a company in Ottawa should not have its working day defined
-- by a rule New York might change.

alter table organizations alter column timezone set default 'America/Toronto';

update organizations
   set timezone = 'America/Toronto'
 where timezone = 'America/New_York';

-- ---------------------------------------------------------------------------
-- What a kilometre is worth
-- ---------------------------------------------------------------------------
--
-- 0.67 was the IRS rate per MILE. The CRA publishes a per-kilometre
-- allowance instead, and at the time of writing the published figure for the
-- first 5,000 km is reported as either 72 or 73 cents depending on who you
-- ask. 0.72 is set here as the conservative one.
--
-- CHECK IT AND CHANGE IT. It is a setting rather than a column for exactly
-- this reason — the rate moves every year, and no migration should be needed:
--
--   update organizations
--      set settings = jsonb_set(settings, '{mileage_rate}', '0.73');

alter table organizations alter column settings set default jsonb_build_object(
  'mileage_rate', 0.72,
  'approval_threshold', 500,
  'geofence_radius_m', 150,
  'acceptance_escalation_hours', 12
);

update organizations
   set settings = jsonb_set(settings, '{mileage_rate}', '0.72')
 where (settings ->> 'mileage_rate')::numeric = 0.67;

-- ---------------------------------------------------------------------------
-- Degrees
-- ---------------------------------------------------------------------------
--
-- The moisture readings form asked for a temperature in Fahrenheit. A crew
-- in Ontario carries a meter that reads Celsius, and the mismatch is the
-- dangerous kind: 20 is a plausible number in both scales and means two
-- completely different rooms.
--
-- Readings already recorded keep their old `temp_f` key and are NOT
-- converted — reinterpreting numbers somebody wrote down is worse than
-- leaving them legible. There are none yet; if that changes, convert them
-- deliberately rather than here.

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
     {"key":"temp_c","label":"Temperature","type":"number","unit":"C","required":true},
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
     {"key":"suit","label":"Coveralls worn","type":"boolean","required":true},
     {"key":"gloves","label":"Gloves worn","type":"boolean","required":true},
     {"key":"eye","label":"Eye protection worn","type":"boolean","required":true},
     {"key":"hazards","label":"Hazards noted on site","type":"text","required":false}
   ]'::jsonb)
  on conflict (org_id, key) do nothing;
end;
$$;

-- And the organisations that already have the Fahrenheit version.
update form_templates
   set fields = (
         select jsonb_agg(
           case when f ->> 'key' = 'temp_f'
                then jsonb_build_object('key', 'temp_c', 'label', 'Temperature',
                                        'type', 'number', 'unit', 'C', 'required', true)
                else f end
           order by ord)
           from jsonb_array_elements(fields) with ordinality as t(f, ord)
       )
 where key = 'moisture_readings'
   and fields @> '[{"key": "temp_f"}]'::jsonb;
