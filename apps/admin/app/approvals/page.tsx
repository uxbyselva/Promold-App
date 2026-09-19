import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase-server';
import { OfficeShell } from '@/components/office-shell';
import { Approvals } from '@/components/approvals';

export const dynamic = 'force-dynamic';

export default async function ApprovalsPage() {
  const session = await requireSession();
  const canReschedule = session.can('reschedule.decide');
  const canTimeOff = session.can('timeoff.manage');
  if (!canReschedule && !canTimeOff) redirect('/jobs');

  const supabase = await supabaseServer();

  const [{ data: reschedules }, { data: timeOff }, { data: people }] = await Promise.all([
    canReschedule
      ? supabase
          .from('reschedule_requests')
          .select('id, job_id, assignment_id, requested_by, reason, proposed_start, proposed_end, created_at')
          .eq('status', 'pending')
          .order('created_at')
      : Promise.resolve({ data: [] as never[] }),
    canTimeOff
      ? supabase
          .from('time_off')
          .select('id, user_id, kind, starts_at, ends_at, reason, created_at')
          .eq('status', 'requested')
          .order('starts_at')
      : Promise.resolve({ data: [] as never[] }),
    supabase.from('profiles_safe').select('id, full_name'),
  ]);

  const jobIds = [...new Set((reschedules ?? []).map((r) => r.job_id))];
  const { data: jobs } = jobIds.length
    ? await supabase
        .from('jobs_safe')
        .select('id, job_number, title, scheduled_start, scheduled_end, site_id')
        .in('id', jobIds)
    : { data: [] };

  const siteIds = [...new Set((jobs ?? []).map((j) => j.site_id).filter(Boolean))];
  const { data: sites } = siteIds.length
    ? await supabase.from('sites').select('id, label').in('id', siteIds)
    : { data: [] };

  // The same clash list the person saw on their phone before they sent it.
  const clashes: Record<string, { job_number: string; title: string; scheduled_start: string }[]> =
    {};
  for (const request of timeOff ?? []) {
    const { data } = await supabase.rpc('time_off_clashes', { p_request_id: request.id });
    clashes[request.id] = (data ?? []) as never[];
  }

  return (
    <OfficeShell session={session} mode="office">
      <div className="page-head">
        <div>
          <h1>Waiting on you</h1>
          <p>
            What the crew have asked for. A request nobody answers is worse than no request —
            they stop using the app and go back to phoning.
          </p>
        </div>
      </div>

      <Approvals
        reschedules={reschedules ?? []}
        timeOff={timeOff ?? []}
        clashes={clashes}
        jobs={jobs ?? []}
        sites={sites ?? []}
        people={people ?? []}
        canReschedule={canReschedule}
        canTimeOff={canTimeOff}
      />
    </OfficeShell>
  );
}
