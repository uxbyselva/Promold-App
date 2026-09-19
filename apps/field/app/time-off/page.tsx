import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase-server';
import { Shell } from '@/components/shell';
import { TimeOffView } from '@/components/time-off-view';

export const dynamic = 'force-dynamic';

export default async function TimeOffPage() {
  const session = await requireSession();
  const supabase = await supabaseServer();

  const [{ data: requests }, { data: assignments }] = await Promise.all([
    supabase
      .from('time_off')
      .select('id, kind, starts_at, ends_at, status, reason, decision_reason, decided_by')
      .eq('user_id', session.userId)
      .order('starts_at', { ascending: false }),
    supabase.from('job_assignments').select('job_id').eq('user_id', session.userId),
  ]);

  // The jobs already booked on me, so the form can show a clash before the
  // request is sent rather than after the office has read it.
  const jobIds = [...new Set((assignments ?? []).map((a) => a.job_id))];
  const { data: jobs } = jobIds.length
    ? await supabase
        .from('jobs_safe')
        .select('id, job_number, title, scheduled_start, scheduled_end')
        .in('id', jobIds)
        .not('scheduled_start', 'is', null)
        .gte('scheduled_end', new Date().toISOString())
    : { data: [] };

  const deciderIds = [...new Set((requests ?? []).map((r) => r.decided_by).filter(Boolean))];
  const { data: deciders } = deciderIds.length
    ? await supabase.from('profiles_safe').select('id, full_name').in('id', deciderIds)
    : { data: [] };

  return (
    <Shell title="Time off" who={`${session.fullName} · ${session.roleName}`}>
      <TimeOffView
        requests={requests ?? []}
        jobs={jobs ?? []}
        deciders={deciders ?? []}
        userId={session.userId}
        orgId={session.orgId}
      />
    </Shell>
  );
}
