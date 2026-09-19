import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase-server';
import { OfficeShell } from '@/components/office-shell';
import { EquipmentRegister } from '@/components/equipment-register';

export const dynamic = 'force-dynamic';

export default async function EquipmentPage() {
  const session = await requireSession();
  if (!session.can('equipment.manage') && !session.can('equipment.place')) redirect('/jobs');

  const supabase = await supabaseServer();

  const [{ data: current }, { data: overdue }, { data: rentals }, { data: people }] =
    await Promise.all([
      supabase
        .from('equipment_current')
        .select(
          'equipment_id, asset_tag, name, category, lifecycle_status, location_status, job_id, site_id, assigned_to_user_id, started_at, expected_end_at, days_deployed, pickup_overdue',
        )
        .order('asset_tag'),
      supabase.from('equipment_overdue').select('source, reference, description, job_id, site_id, due_at, days_overdue'),
      supabase
        .from('equipment_rentals')
        .select('id, description, category, quantity, rate, rate_unit, job_id, picked_up_at, return_due_at, returned_at, estimated_cost, actual_cost, status, supplier_id')
        .is('returned_at', null),
      supabase.from('profiles_safe').select('id, full_name'),
    ]);

  const jobIds = [
    ...new Set(
      [...(current ?? []).map((c) => c.job_id), ...(rentals ?? []).map((r) => r.job_id)].filter(
        Boolean,
      ),
    ),
  ];
  const { data: jobs } = jobIds.length
    ? await supabase.from('jobs_safe').select('id, job_number, title').in('id', jobIds)
    : { data: [] };

  const siteIds = [...new Set((current ?? []).map((c) => c.site_id).filter(Boolean))];
  const { data: sites } = siteIds.length
    ? await supabase.from('sites').select('id, label').in('id', siteIds)
    : { data: [] };

  const { data: suppliers } = await supabase.from('suppliers').select('id, name');

  return (
    <OfficeShell session={session} mode="office">
      <div className="page-head">
        <div>
          <h1>Equipment</h1>
          <p>
            Where every unit physically is. Billing is flat per job, so equipment days add no
            revenue — this exists to stop scrubbers being left behind, and to load real cost onto
            the job.
          </p>
        </div>
        {session.can('audit.view') ? (
          <Link className="btn ghost sm" href="/admin/activity?table=equipment">
            History
          </Link>
        ) : null}
      </div>

      <EquipmentRegister
        current={current ?? []}
        overdue={overdue ?? []}
        rentals={rentals ?? []}
        jobs={jobs ?? []}
        sites={sites ?? []}
        people={people ?? []}
        suppliers={suppliers ?? []}
        canPlace={session.can('equipment.place')}
        canRental={session.can('equipment.rental_manage')}
      />
    </OfficeShell>
  );
}
