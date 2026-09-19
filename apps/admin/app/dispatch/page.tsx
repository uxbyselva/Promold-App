import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { Board } from '@/components/board';
import { OfficeShell } from '@/components/office-shell';
import { requireSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Dispatch({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await requireSession();

  // The board is for whoever assigns work. Everyone else gets their own jobs,
  // decided by permission rather than by job title or screen size.
  if (!session.can('job.assign')) redirect('/jobs');

  const { date } = await searchParams;
  const day = date ?? new Date().toISOString().slice(0, 10);
  const supabase = await supabaseServer();
  const me = { full_name: session.fullName };

  const [{ data: crew }, { data: jobs }, { data: off }] = await Promise.all([
    supabase.from('profiles_safe').select('id, full_name').eq('is_active', true).order('full_name'),
    // jobs_safe rather than jobs: the price columns are revoked on the base
    // table, so `select *` there would fail by design.
    supabase
      .from('jobs_safe')
      .select('id, job_number, title, status, scheduled_start, scheduled_end, quoted_price')
      .gte('scheduled_start', `${day}T00:00:00`)
      .lte('scheduled_start', `${day}T23:59:59`)
      .order('scheduled_start'),
    supabase
      .from('time_off')
      .select('user_id, kind, starts_at, ends_at')
      .eq('status', 'approved')
      .lte('starts_at', `${day}T23:59:59`)
      .gte('ends_at', `${day}T00:00:00`),
  ]);

  const jobIds = (jobs ?? []).map((j) => j.id);
  const { data: assignments } = jobIds.length
    ? await supabase
        .from('job_assignments')
        .select('job_id, user_id, acceptance_status')
        .in('job_id', jobIds)
    : { data: [] };

  return (
    <OfficeShell session={session} mode="office">
      <Board
        day={day}
        me={{ name: me.full_name }}
        crew={crew ?? []}
        jobs={jobs ?? []}
        assignments={assignments ?? []}
        timeOff={off ?? []}
      />
    </OfficeShell>
  );
}
