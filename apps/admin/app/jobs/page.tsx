import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase-server';
import { OfficeShell } from '@/components/office-shell';
import { JobsTable } from '@/components/jobs-table';

export const dynamic = 'force-dynamic';

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const session = await requireSession();
  const { status, q } = await searchParams;
  const supabase = await supabaseServer();

  let query = supabase
    .from('jobs_safe')
    .select(
      'id, job_number, title, status, priority, scheduled_start, scheduled_end, site_id, customer_id, quoted_price',
    )
    .order('scheduled_start', { ascending: false })
    .limit(300);

  if (status && status !== 'all') query = query.eq('status', status);
  // ilike on two columns: enough for "find me the Oak St job" without
  // standing up a search index for a few hundred rows.
  if (q) query = query.or(`title.ilike.%${q}%,job_number.ilike.%${q}%`);

  const { data: jobs } = await query;
  const jobIds = (jobs ?? []).map((j) => j.id);

  const { data: assignments } = jobIds.length
    ? await supabase
        .from('job_assignments')
        .select('job_id, user_id, acceptance_status')
        .in('job_id', jobIds)
    : { data: [] };

  const siteIds = [...new Set((jobs ?? []).map((j) => j.site_id).filter(Boolean))];
  const customerIds = [...new Set((jobs ?? []).map((j) => j.customer_id).filter(Boolean))];

  const [{ data: sites }, { data: customers }, { data: people }] = await Promise.all([
    siteIds.length
      ? supabase.from('sites').select('id, label').in('id', siteIds)
      : Promise.resolve({ data: [] as { id: string; label: string }[] }),
    customerIds.length
      ? supabase.from('customers').select('id, name').in('id', customerIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    supabase.from('profiles_safe').select('id, full_name'),
  ]);

  return (
    <OfficeShell session={session} mode="office">
      <div className="page-head">
        <div>
          <h1>Jobs</h1>
          <p>Everything booked, newest first. The calendar is the same jobs laid out by day.</p>
        </div>
        {session.can('job.edit') ? (
          <Link className="btn sm" href="/jobs/new">
            New job
          </Link>
        ) : null}
      </div>
      <JobsTable
        jobs={jobs ?? []}
        assignments={assignments ?? []}
        sites={sites ?? []}
        customers={customers ?? []}
        people={people ?? []}
        status={status ?? 'all'}
        q={q ?? ''}
        showPrice={session.can('price.view')}
      />
    </OfficeShell>
  );
}
