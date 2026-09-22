import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { Board } from '@/components/board';
import { OfficeShell } from '@/components/office-shell';
import { requireSession } from '@/lib/session';
import { dayWindow, today } from '@/lib/format';

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
  /*
   * The board's day is the company's day. `new Date().toISOString()` gave the
   * server's UTC date, so between 20:00 and midnight in Springfield the office
   * opened the board on tomorrow.
   */
  const day = date ?? today();
  // And its bounds are the UTC instants that company day starts and ends at.
  // Sent without a zone, `${day}T00:00:00` is read in the database's timezone,
  // which put an 8pm job on the following day's board.
  const window = dayWindow(day);
  const supabase = await supabaseServer();

  /*
   * A day on the board is its visits, not its jobs.
   *
   * The board used to filter on `jobs.scheduled_start`, so a three-day job
   * appeared on day one and vanished for days two and three — the crew were
   * on site and the board showed them free. Visits are the day-by-day record;
   * a job booked straight onto the calendar has none, so those are picked up
   * by their own start as a fallback.
   */
  const [{ data: crew }, { data: visits }, { data: starting }, { data: off }] = await Promise.all([
    supabase.from('profiles_safe').select('id, full_name').eq('is_active', true).order('full_name'),
    supabase
      .from('job_visits')
      .select('job_id, scheduled_start, scheduled_end')
      .gte('scheduled_start', window.from)
      .lte('scheduled_start', window.to)
      .order('scheduled_start'),
    // jobs_safe rather than jobs: the price columns are revoked on the base
    // table, so `select *` there would fail by design.
    supabase
      .from('jobs_safe')
      .select('id, job_number, title, status, scheduled_start, scheduled_end, quoted_price')
      .gte('scheduled_start', window.from)
      .lte('scheduled_start', window.to)
      .order('scheduled_start'),
    supabase
      .from('time_off')
      .select('user_id, kind, starts_at, ends_at')
      .eq('status', 'approved')
      .lte('starts_at', window.to)
      .gte('ends_at', window.from),
  ]);

  const visitJobIds = [...new Set((visits ?? []).map((v) => v.job_id))];
  const missing = visitJobIds.filter((id) => !(starting ?? []).some((j) => j.id === id));
  const { data: extra } = missing.length
    ? await supabase
        .from('jobs_safe')
        .select('id, job_number, title, status, scheduled_start, scheduled_end, quoted_price')
        .in('id', missing)
    : { data: [] };

  // A job the board draws today, at the hours it runs today.
  const jobs = [...(starting ?? []), ...(extra ?? [])]
    .map((job) => {
      const visit = (visits ?? []).find((v) => v.job_id === job.id);
      return visit
        ? { ...job, scheduled_start: visit.scheduled_start, scheduled_end: visit.scheduled_end }
        : job;
    })
    .sort((a, b) => (a.scheduled_start ?? '').localeCompare(b.scheduled_start ?? ''));

  const jobIds = jobs.map((j) => j.id);
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
        crew={crew ?? []}
        jobs={jobs}
        assignments={assignments ?? []}
        timeOff={off ?? []}
      />
    </OfficeShell>
  );
}
