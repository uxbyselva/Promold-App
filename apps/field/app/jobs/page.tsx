import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase-server';
import { Shell } from '@/components/shell';
import { JobsView } from '@/components/jobs-view';

export const dynamic = 'force-dynamic';

export default async function JobsPage() {
  const session = await requireSession();
  const supabase = await supabaseServer();

  // My own assignments. Row-level security already limits what comes back to
  // jobs I have a stake in; filtering by user_id is what makes this "mine"
  // rather than "the crew's", which is a different screen.
  const { data: mine } = await supabase
    .from('job_assignments')
    .select('id, job_id, acceptance_status')
    .eq('user_id', session.userId);

  const jobIds = [...new Set((mine ?? []).map((a) => a.job_id))];

  const { data: jobs } = jobIds.length
    ? await supabase
        .from('jobs_safe')
        .select(
          'id, job_number, title, status, scheduled_start, scheduled_end, site_id, customer_id',
        )
        .in('id', jobIds)
        .order('scheduled_start')
    : { data: [] };

  // Visits are the individual work days. A three-day job is one row in `jobs`
  // and three here, which is what lets the calendar mark every day it runs
  // rather than only the first.
  const { data: visits } = jobIds.length
    ? await supabase
        .from('job_visits')
        .select('id, job_id, scheduled_start, scheduled_end, status')
        .in('job_id', jobIds)
    : { data: [] };

  const siteIds = [...new Set((jobs ?? []).map((j) => j.site_id).filter(Boolean))];
  const { data: sites } = siteIds.length
    ? await supabase.from('sites').select('id, label, city').in('id', siteIds)
    : { data: [] };

  const customerIds = [...new Set((jobs ?? []).map((j) => j.customer_id).filter(Boolean))];
  const { data: customers } = customerIds.length
    ? await supabase.from('customers').select('id, name').in('id', customerIds)
    : { data: [] };

  const needsAnswer = (mine ?? []).filter((a) => a.acceptance_status === 'pending').length;

  return (
    <Shell
      title="My jobs"
      who={`${session.fullName} · ${session.roleName}`}
      needsAnswer={needsAnswer}
    >
      <JobsView
        jobs={jobs ?? []}
        visits={visits ?? []}
        sites={sites ?? []}
        customers={customers ?? []}
        assignments={mine ?? []}
      />
    </Shell>
  );
}
