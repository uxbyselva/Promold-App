import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase-server';
import { Shell } from '@/components/shell';
import { CrewToday } from '@/components/crew-today';
import { dayWindow, today } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * The crew's day, before they go looking for it.
 *
 * Their board is already a to-do list, so this is not a second copy of it:
 * it answers the four things somebody asks sitting in a van at eight in the
 * morning — where am I going, is anybody waiting on me, what am I in the
 * middle of, and what of ours is in my van.
 *
 * A crew lead also gets the answer to the extra work he raised, which he had
 * no way of seeing at all: he writes up a rotten joist, a manager prices it,
 * the customer says yes or no, and nothing told him which.
 */
export default async function CrewHome() {
  const session = await requireSession();
  const supabase = await supabaseServer();
  const day = dayWindow(today());

  const { data: mine } = await supabase
    .from('job_assignments')
    .select('id, job_id, acceptance_status')
    .eq('user_id', session.userId);

  const jobIds = [...new Set((mine ?? []).map((a) => a.job_id))];

  const [{ data: jobs }, { data: kit }, { data: changes }] = await Promise.all([
    jobIds.length
      ? supabase
          .from('jobs_safe')
          .select('id, job_number, title, status, scheduled_start, scheduled_end, site_id')
          .in('id', jobIds)
          .order('scheduled_start')
      : Promise.resolve({ data: [] }),
    supabase
      .from('equipment_current')
      .select(
        'equipment_id, asset_tag, name, location_status, assigned_to_user_id, expected_end_at',
      )
      .eq('assigned_to_user_id', session.userId),
    // What the office decided about the extra work he wrote up. Prices are
    // masked by change_orders_safe for anybody without price.view.
    session.can('changeorder.draft')
      ? supabase
          .from('change_orders_safe')
          .select('id, job_id, seq, title, status, amount')
          .eq('created_by', session.userId)
          .order('created_at', { ascending: false })
          .limit(6)
      : Promise.resolve({ data: [] }),
  ]);

  const siteIds = [...new Set((jobs ?? []).map((j) => j.site_id).filter(Boolean))] as string[];
  const { data: sites } = siteIds.length
    ? await supabase.from('sites').select('id, label, address_line1, city').in('id', siteIds)
    : { data: [] };

  const needsAnswer = (mine ?? []).filter((a) => a.acceptance_status === 'pending').length;

  return (
    <Shell
      backToOffice={session.can('job.assign')}
      title="Today"
      who={`${session.fullName} · ${session.roleName}`}
      needsAnswer={needsAnswer}
    >
      <CrewToday
        jobs={jobs ?? []}
        sites={sites ?? []}
        assignments={mine ?? []}
        kit={kit ?? []}
        changes={changes ?? []}
        todayFrom={day.from}
        todayTo={day.to}
      />
    </Shell>
  );
}
