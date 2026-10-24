import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { Board } from '@/components/board';
import { OfficeShell } from '@/components/office-shell';
import { requireSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/*
 * The board was a day at a time, drawn as a timeline: an hour grid with a
 * column per crew member and jobs floating at their start time. It answered
 * "who is where at eleven", which the calendar answers too, and it could not
 * answer the question the office actually asks — what needs doing. A job
 * nobody had accepted looked exactly like one everybody had, and a job that
 * had stalled was invisible the moment its day went past.
 *
 * So: columns are stages, not hours, and the board is all live work rather
 * than one date. Something stuck in "waiting to accept" since Tuesday is now
 * the first thing on the screen instead of three days behind the arrows.
 */

/** Everything that is not finished with. The board is about live work. */
const LIVE = [
  'draft',
  'scheduled',
  'assigned',
  'accepted',
  'en_route',
  'on_site',
  'in_progress',
  'blocked',
  'work_complete',
];

export default async function Dispatch() {
  const session = await requireSession();

  // The board is for whoever assigns work. Everyone else gets their own jobs,
  // decided by permission rather than by job title or screen size.
  if (!session.can('job.assign')) redirect('/jobs');

  const supabase = await supabaseServer();

  // jobs_safe rather than jobs: the price columns are revoked on the base
  // table, so `select *` there would fail by design.
  const { data: jobs } = await supabase
    .from('jobs_safe')
    .select(
      'id, job_number, title, status, category, scheduled_start, scheduled_end, quoted_price, site_id',
    )
    .in('status', LIVE)
    .order('scheduled_start', { nullsFirst: true });

  const live = jobs ?? [];
  const jobIds = live.map((j) => j.id);
  const siteIds = [...new Set(live.map((j) => j.site_id).filter(Boolean))] as string[];

  const [{ data: assignments }, { data: sites }, { data: people }, { data: off }] =
    await Promise.all([
      jobIds.length
        ? supabase
            .from('job_assignments')
            .select('job_id, user_id, acceptance_status')
            .in('job_id', jobIds)
        : Promise.resolve({ data: [] }),
      siteIds.length
        ? supabase
            .from('sites')
            .select('id, label, address_line1, address_line2, city, state, postal_code')
            .in('id', siteIds)
        : Promise.resolve({ data: [] }),
      supabase.from('profiles_safe').select('id, full_name').eq('is_active', true),
      // Who is away right now. The timeline used to show this as a hatched
      // column and a stage board has no crew columns, so it comes back as a
      // line above the board rather than being quietly dropped.
      supabase
        .from('time_off')
        .select('user_id, kind, starts_at, ends_at')
        .eq('status', 'approved')
        .lte('starts_at', new Date().toISOString())
        .gte('ends_at', new Date().toISOString()),
    ]);

  return (
    <OfficeShell session={session} mode="office">
      <Board
        jobs={live}
        assignments={assignments ?? []}
        sites={sites ?? []}
        people={people ?? []}
        timeOff={off ?? []}
      />
    </OfficeShell>
  );
}
