import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase-server';
import { OfficeShell } from '@/components/office-shell';
import { MileageOffice } from '@/components/mileage-office';

export const dynamic = 'force-dynamic';

export default async function OfficeMileagePage() {
  const session = await requireSession();
  if (!session.can('mileage.view_all')) redirect('/my/mileage');

  const supabase = await supabaseServer();
  const [{ data: logs }, { data: people }, { data: vehicles }, { data: jobs }, { data: org }] =
    await Promise.all([
      // Row-level security already decides what comes back: everyone's,
      // because the flag above is the same one the policy checks.
      supabase
        .from('mileage_logs')
        .select(
          'id, user_id, vehicle_id, trip_date, odometer_start, odometer_end, distance, purpose, job_id, is_business',
        )
        .order('trip_date', { ascending: false })
        .limit(250),
      supabase.from('profiles_safe').select('id, full_name').order('full_name'),
      supabase.from('vehicles').select('id, name').order('name'),
      supabase.from('jobs_safe').select('id, job_number').order('scheduled_start').limit(400),
      supabase.from('organizations').select('settings').eq('id', session.orgId).maybeSingle(),
    ]);

  const settings = (org?.settings ?? {}) as Record<string, unknown>;

  return (
    <OfficeShell session={session} mode="office">
      <div className="page-head">
        <div>
          <h1>Mileage</h1>
          <p>
            Every trip the crew have logged, newest first. The rate comes from Settings; change it
            there and every figure on this page follows.
          </p>
        </div>
      </div>

      <MileageOffice
        logs={logs ?? []}
        people={people ?? []}
        vehicles={vehicles ?? []}
        jobs={jobs ?? []}
        rate={Number(settings.mileage_rate ?? 0.73)}
        canEdit={session.can('mileage.edit_all')}
      />
    </OfficeShell>
  );
}
