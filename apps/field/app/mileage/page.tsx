import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase-server';
import { Shell } from '@/components/shell';
import { MileageView } from '@/components/mileage-view';

export const dynamic = 'force-dynamic';

export default async function MileagePage() {
  const session = await requireSession();
  const supabase = await supabaseServer();

  const [{ data: org }, { data: vehicles }, { data: trips }, { data: assignments }] =
    await Promise.all([
      supabase.from('organizations').select('settings').eq('id', session.orgId).maybeSingle(),
      supabase
        .from('vehicles')
        .select('id, name, plate, current_odometer, assigned_user_id')
        .eq('is_active', true)
        .order('name'),
      // Mine only. mileage.view_all is the office's flag, and row-level
      // security enforces it whatever this query asks for.
      supabase
        .from('mileage_logs')
        .select('id, vehicle_id, trip_date, odometer_start, odometer_end, distance, purpose, is_business, continuity_gap, job_id')
        .eq('user_id', session.userId)
        .order('trip_date', { ascending: false })
        .limit(60),
      supabase.from('job_assignments').select('job_id').eq('user_id', session.userId),
    ]);

  const jobIds = [...new Set((assignments ?? []).map((a) => a.job_id))];
  const { data: jobs } = jobIds.length
    ? await supabase
        .from('jobs_safe')
        .select('id, job_number, title, scheduled_start')
        .in('id', jobIds)
        .order('scheduled_start', { ascending: false })
        .limit(40)
    : { data: [] };

  const settings = (org?.settings ?? {}) as Record<string, unknown>;
  const rate = Number(settings.mileage_rate ?? 0.67);

  return (
    <Shell title="Mileage" who={`${session.fullName} · ${session.roleName}`}>
      <MileageView
        vehicles={vehicles ?? []}
        trips={trips ?? []}
        jobs={jobs ?? []}
        rate={rate}
        userId={session.userId}
        orgId={session.orgId}
        defaultVehicleId={
          (vehicles ?? []).find((v) => v.assigned_user_id === session.userId)?.id ??
          vehicles?.[0]?.id ??
          null
        }
      />
    </Shell>
  );
}
