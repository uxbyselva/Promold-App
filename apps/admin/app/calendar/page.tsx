import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase-server';
import { OfficeShell } from '@/components/office-shell';
import { OfficeCalendar } from '@/components/office-calendar';
import { today } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await requireSession();
  if (!session.can('job.assign')) redirect('/jobs');

  const { month: asked } = await searchParams;
  const month = asked && /^\d{4}-\d{2}$/.test(asked) ? asked : today().slice(0, 7);
  const supabase = await supabaseServer();

  // A fortnight either side, so a job running over a month boundary still
  // draws on the days that show in the leading and trailing weeks.
  const from = new Date(`${month}-01T00:00`);
  from.setDate(from.getDate() - 14);
  const to = new Date(`${month}-01T00:00`);
  to.setMonth(to.getMonth() + 1);
  to.setDate(to.getDate() + 14);

  const { data: jobs } = await supabase
    .from('jobs_safe')
    .select('id, job_number, title, status, scheduled_start, scheduled_end, site_id, customer_id')
    .gte('scheduled_start', from.toISOString())
    .lte('scheduled_start', to.toISOString())
    .order('scheduled_start');

  const jobIds = (jobs ?? []).map((j) => j.id);

  const { data: visits } = jobIds.length
    ? await supabase
        .from('job_visits')
        .select('id, job_id, scheduled_start, status')
        .in('job_id', jobIds)
    : { data: [] };

  const { data: assignments } = jobIds.length
    ? await supabase
        .from('job_assignments')
        .select('job_id, user_id, acceptance_status')
        .in('job_id', jobIds)
    : { data: [] };

  const siteIds = [...new Set((jobs ?? []).map((j) => j.site_id).filter(Boolean))];
  const { data: sites } = siteIds.length
    ? await supabase.from('sites').select('id, label').in('id', siteIds)
    : { data: [] };

  return (
    <OfficeShell session={session} mode="office">
      <OfficeCalendar
        month={month}
        jobs={jobs ?? []}
        visits={visits ?? []}
        assignments={assignments ?? []}
        sites={sites ?? []}
        canEdit={session.can('job.edit')}
      />
    </OfficeShell>
  );
}
