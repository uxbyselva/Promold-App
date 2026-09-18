import { requireSession, homeFor } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase-server';
import { FieldView } from '@/components/field-view';

export const dynamic = 'force-dynamic';

export default async function Jobs() {
  const session = await requireSession();
  const supabase = await supabaseServer();

  // My assignments, and the jobs behind them. Row-level security already
  // limits this to jobs I am on; the filter is for clarity, not safety.
  const { data: mine } = await supabase
    .from('job_assignments')
    .select('id, job_id, acceptance_status')
    .eq('user_id', session.userId);

  const jobIds = (mine ?? []).map((a) => a.job_id);

  const { data: jobs } = jobIds.length
    ? await supabase
        .from('jobs_safe')
        .select(
          'id, job_number, title, status, scheduled_start, scheduled_end, quoted_price, site_id, customer_id',
        )
        .in('id', jobIds)
        .order('scheduled_start')
    : { data: [] };

  const siteIds = [...new Set((jobs ?? []).map((j) => j.site_id).filter(Boolean))];
  const { data: sites } = siteIds.length
    ? await supabase.from('sites').select('id, label, address_line1, city, access_notes').in('id', siteIds)
    : { data: [] };

  return (
    <FieldView
      me={{ name: session.fullName, role: session.roleName }}
      canSeePrice={session.can('price.view')}
      dispatchHref={session.can('job.assign') ? homeFor(session) : null}
      assignments={mine ?? []}
      jobs={jobs ?? []}
      sites={sites ?? []}
    />
  );
}
