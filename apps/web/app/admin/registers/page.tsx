import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase-server';
import { OfficeShell } from '@/components/office-shell';
import { RegisterEditor, type Field } from '@/components/register-editor';

export const dynamic = 'force-dynamic';

const LOCATION_KINDS: [string, string][] = [
  ['warehouse', 'Warehouse'],
  ['van', 'Van'],
  ['site', 'Site'],
  ['supplier', 'Supplier'],
];

const EQUIPMENT_CATEGORIES: [string, string][] = [
  ['air_scrubber', 'Air scrubber'],
  ['dehumidifier', 'Dehumidifier'],
  ['air_mover', 'Air mover'],
  ['meter', 'Meter'],
  ['hepa_vacuum', 'HEPA vacuum'],
  ['negative_air', 'Negative air'],
  ['generator', 'Generator'],
  ['tool', 'Tool'],
  ['other', 'Other'],
];

const LIFECYCLE: [string, string][] = [
  ['active', 'In service'],
  ['in_maintenance', 'In maintenance'],
  ['retired', 'Retired'],
  ['lost', 'Lost'],
];

/**
 * The registers — the lists everything else is chosen from.
 *
 * All five were seeded when the database was built and then had no screen,
 * so the day a new dehumidifier arrived or a supplier changed, somebody had
 * to open the SQL editor. Each one is gated by its own flag rather than by
 * being in admin mode: a bookkeeper reaches admin mode through audit.view
 * and manages none of this.
 */
export default async function RegistersPage() {
  const session = await requireSession();
  const canStock = session.can('inventory.manage');
  const canVehicles = session.can('vehicle.manage');
  const canKit = session.can('equipment.manage');
  if (!canStock && !canVehicles && !canKit) redirect('/jobs');

  const supabase = await supabaseServer();
  const [
    { data: items },
    { data: suppliers },
    { data: locations },
    { data: vehicles },
    { data: kit },
  ] = await Promise.all([
    canStock
      ? supabase
          .from('inventory_items')
          .select('id, sku, name, category, unit_of_measure, average_cost, min_level, is_active')
          .order('name')
      : Promise.resolve({ data: [] }),
    canStock
      ? supabase
          .from('suppliers')
          .select('id, name, contact_name, phone, email, is_rental_vendor, is_active')
          .order('name')
      : Promise.resolve({ data: [] }),
    canStock
      ? supabase.from('stock_locations').select('id, name, kind, is_active').order('name')
      : Promise.resolve({ data: [] }),
    canVehicles
      ? supabase
          .from('vehicles')
          .select('id, name, plate, make_model, year, current_odometer, is_active')
          .order('name')
      : Promise.resolve({ data: [] }),
    canKit
      ? supabase
          .from('equipment')
          .select('id, asset_tag, name, category, make, model, internal_day_rate, lifecycle_status')
          .order('asset_tag')
      : Promise.resolve({ data: [] }),
  ]);

  const itemFields: Field[] = [
    { key: 'sku', label: 'Code', required: true, placeholder: 'POLY-6' },
    { key: 'name', label: 'Name', required: true, placeholder: '6 mil poly sheeting' },
    { key: 'unit_of_measure', label: 'Sold in', required: true, placeholder: 'roll' },
    { key: 'category', label: 'Category', placeholder: 'containment' },
    { key: 'average_cost', label: 'Average cost', kind: 'number', step: '0.01' },
    { key: 'min_level', label: 'Reorder at', kind: 'number', step: '1' },
  ];

  const supplierFields: Field[] = [
    { key: 'name', label: 'Name', required: true, placeholder: 'Restoration Supply Co' },
    { key: 'contact_name', label: 'Contact', placeholder: 'Nina Cross' },
    { key: 'phone', label: 'Phone', placeholder: '613-555-0301' },
    { key: 'email', label: 'Email', placeholder: 'orders@example.test' },
    { key: 'is_rental_vendor', label: 'Rents equipment', kind: 'checkbox' },
  ];

  const locationFields: Field[] = [
    { key: 'name', label: 'Name', required: true, placeholder: 'Main warehouse' },
    { key: 'kind', label: 'Kind', kind: 'select', options: LOCATION_KINDS, required: true },
  ];

  const vehicleFields: Field[] = [
    { key: 'name', label: 'Name', required: true, placeholder: 'Van 1' },
    { key: 'plate', label: 'Plate', placeholder: 'CBXK 429' },
    { key: 'make_model', label: 'Make and model', placeholder: 'Ford Transit 250' },
    { key: 'year', label: 'Year', kind: 'number', step: '1' },
    { key: 'current_odometer', label: 'Odometer (km)', kind: 'number', step: '1' },
  ];

  const kitFields: Field[] = [
    { key: 'asset_tag', label: 'Tag', required: true, placeholder: 'DH-004' },
    { key: 'name', label: 'Name', required: true, placeholder: 'Dehumidifier 4' },
    {
      key: 'category',
      label: 'Category',
      kind: 'select',
      options: EQUIPMENT_CATEGORIES,
      required: true,
    },
    { key: 'make', label: 'Make', placeholder: 'Dri-Eaz' },
    { key: 'model', label: 'Model', placeholder: 'LGR 7000' },
    { key: 'internal_day_rate', label: 'Day rate', kind: 'number', step: '0.01' },
    {
      key: 'lifecycle_status',
      label: 'Status',
      kind: 'select',
      options: LIFECYCLE,
      required: true,
    },
  ];

  return (
    <OfficeShell session={session} mode="admin">
      <div className="page-head">
        <div>
          <h1>Registers</h1>
          <p>
            The lists everything else is chosen from. Nothing here is ever deleted — retiring keeps
            the row, because stock movements, mileage and job history point at it and the past has
            to keep making sense.
          </p>
        </div>
      </div>

      {canStock ? (
        <>
          <RegisterEditor
            table="inventory_items"
            title="Items"
            blurb="What the crew log against a job. The code is what gets scanned or typed; the unit is what one of them is — a roll, a box, a bag."
            fields={itemFields}
            rows={items ?? []}
            canEdit={canStock}
            orgId={session.orgId}
            empty="No items yet. Add the ones the crew use most and the rest can follow."
          />
          <RegisterEditor
            table="suppliers"
            title="Suppliers"
            blurb="Who you buy from. Tick the rental box for anyone you hire equipment from — that is what puts them on the rental screens."
            fields={supplierFields}
            rows={suppliers ?? []}
            canEdit={canStock}
            orgId={session.orgId}
            empty="No suppliers yet."
          />
          <RegisterEditor
            table="stock_locations"
            title="Stock locations"
            blurb="Where stock can be. A van is a location, so is the warehouse, so is a site you have staged material at."
            fields={locationFields}
            rows={locations ?? []}
            canEdit={canStock}
            orgId={session.orgId}
            empty="No locations yet. You need at least a warehouse before stock can arrive anywhere."
          />
        </>
      ) : null}

      {canVehicles ? (
        <RegisterEditor
          table="vehicles"
          title="Vehicles"
          blurb="The vans. The odometer here is the last reading the office knows about; the crew's trips move it on from their own screen."
          fields={vehicleFields}
          rows={vehicles ?? []}
          canEdit={canVehicles}
          orgId={session.orgId}
          empty="No vehicles yet. Mileage cannot be logged until there is one."
        />
      ) : null}

      {canKit ? (
        <RegisterEditor
          table="equipment"
          title="Equipment"
          blurb="Every unit you own, one row each. The tag is what is written on the machine. The day rate is what it costs a job per day on site — not what it is worth."
          fields={kitFields}
          rows={kit ?? []}
          canEdit={canKit}
          orgId={session.orgId}
          empty="No equipment yet."
        />
      ) : null}
    </OfficeShell>
  );
}
