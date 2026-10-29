import { supabaseServer } from './supabase-server';
import { dayWindow, today } from './format';
import type { Session } from './session';

/**
 * What each dashboard is made of.
 *
 * Every figure here is an exception or a decision somebody owes — not a
 * total. A tile that reads zero all week teaches people to stop looking at
 * the screen, and at five jobs a day there is no room for vanity counts.
 *
 * Nothing is computed about money owed or paid. Cost and margin are costs to
 * us, which is the line this app stays on the right side of.
 *
 * Permission gating is by asking rather than guarding wherever the database
 * already decides: `job_costs` filters on costing.view itself and
 * `job_crew_pay`'s row policy does the same, so a reader without the flag
 * gets an empty set rather than a refusal. Where a query would be wasted
 * work for somebody who cannot act on it, it is skipped outright.
 */

/** Finished as far as the board is concerned. */
const FINISHED = ['work_complete', 'approved', 'closed', 'cancelled'];
const LIVE = [
  'draft',
  'scheduled',
  'assigned',
  'accepted',
  'en_route',
  'on_site',
  'in_progress',
  'blocked',
];

/** The company's current month, as the UTC instants it begins and ends at. */
function monthWindow() {
  const month = today().slice(0, 7);
  const first = dayWindow(`${month}-01`);
  const next = new Date(`${month}-01T12:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { from: first.from, to: dayWindow(next.toISOString().slice(0, 10)).from };
}

export type OfficeDashboard = {
  jobsToday: number;
  crewToday: number;
  overdue: { id: string; job_number: string; title: string; scheduled_start: string | null }[];
  unaccepted: number;
  unassigned: number;
  awaitingApproval: { id: string; job_number: string; title: string }[];
  awaitingClose: { id: string; job_number: string; title: string }[];
  decisions: number;
  /** Null unless the viewer holds costing.view. */
  margin: { contract: number; cost: number; jobs: number } | null;
  /** Finished jobs with no crew pay recorded, so their margin reads too well. */
  missingPay: { id: string; job_number: string; title: string }[];
  kitOverdue: number;
  lowStock: { id: string; name: string; on_hand: number; min_level: number }[];
  mileageKm: number | null;
  byCategory: Record<string, number>;
};

export async function officeDashboard(session: Session): Promise<OfficeDashboard> {
  const supabase = await supabaseServer();
  const day = dayWindow(today());
  const month = monthWindow();
  const count = { count: 'exact' as const, head: true };

  const canCost = session.can('costing.view');
  const canDecide =
    session.can('reschedule.decide') ||
    session.can('timeoff.manage') ||
    session.can('purchase.approve') ||
    session.can('changeorder.manage');

  const [
    { count: jobsToday },
    { data: todayJobs },
    { data: overdue },
    { data: awaitingApproval },
    { data: awaitingClose },
    { data: costs },
    { count: kitOverdue },
  ] = await Promise.all([
    supabase
      .from('jobs_safe')
      .select('id', count)
      .gte('scheduled_start', day.from)
      .lte('scheduled_start', day.to)
      .in('status', LIVE),
    supabase
      .from('jobs_safe')
      .select('id')
      .gte('scheduled_start', day.from)
      .lte('scheduled_start', day.to),
    supabase
      .from('jobs_safe')
      .select('id, job_number, title, scheduled_start')
      .lt('scheduled_start', day.from)
      .in('status', LIVE)
      .order('scheduled_start')
      .limit(8),
    supabase
      .from('jobs_safe')
      .select('id, job_number, title')
      .eq('status', 'work_complete')
      .order('scheduled_start')
      .limit(8),
    supabase
      .from('jobs_safe')
      .select('id, job_number, title')
      .eq('status', 'approved')
      .order('scheduled_start')
      .limit(8),
    // job_costs checks costing.view itself, so this is empty rather than
    // refused for anybody without it.
    canCost
      ? supabase
          .from('job_costs')
          .select('job_id, contract_price, total_cost, status')
          .in('status', ['approved', 'closed'])
      : Promise.resolve({ data: [] }),
    supabase.from('equipment_overdue').select('reference', count),
  ]);

  const todayIds = (todayJobs ?? []).map((j) => j.id);

  const [{ data: assignments }, { data: monthJobs }, { data: paid }, { data: mileage }] =
    await Promise.all([
      supabase.from('job_assignments').select('job_id, user_id, acceptance_status'),
      supabase
        .from('jobs_safe')
        .select('id, category')
        .gte('scheduled_start', month.from)
        .lt('scheduled_start', month.to),
      // job_crew_pay's row policy checks costing.view, so the same applies.
      canCost ? supabase.from('job_crew_pay').select('job_id') : Promise.resolve({ data: [] }),
      session.can('mileage.view_all')
        ? supabase
            .from('mileage_logs')
            .select('distance, is_business')
            .gte('trip_date', month.from)
            .lt('trip_date', month.to)
        : Promise.resolve({ data: [] }),
    ]);

  const live = assignments ?? [];
  // People, not assignments: two jobs for the same person is one person
  // committed today, which is the number the office is deciding against.
  const onToday = new Set(live.filter((a) => todayIds.includes(a.job_id)).map((a) => a.user_id));

  // Low stock: the level is the sum of a ledger, so it is added up here
  // rather than read off a column that does not exist by design.
  const canStock = session.can('inventory.manage');
  const [{ data: items }, { data: levels }] = canStock
    ? await Promise.all([
        supabase
          .from('inventory_items')
          .select('id, name, min_level')
          .eq('is_active', true)
          .is('deleted_at', null),
        supabase.from('stock_levels').select('item_id, quantity'),
      ])
    : [{ data: [] }, { data: [] }];

  const onHand = new Map<string, number>();
  for (const l of levels ?? []) {
    onHand.set(l.item_id, (onHand.get(l.item_id) ?? 0) + Number(l.quantity));
  }
  const lowStock = (items ?? [])
    .map((i) => ({ ...i, on_hand: onHand.get(i.id) ?? 0, min_level: Number(i.min_level) }))
    .filter((i) => i.min_level > 0 && i.on_hand <= i.min_level)
    .slice(0, 6);

  const paidJobs = new Set((paid ?? []).map((p) => p.job_id));
  const missingPay = [...(awaitingApproval ?? []), ...(awaitingClose ?? [])].filter(
    (j) => !paidJobs.has(j.id),
  );

  const byCategory: Record<string, number> = {};
  for (const j of monthJobs ?? []) byCategory[j.category] = (byCategory[j.category] ?? 0) + 1;

  const rows = costs ?? [];
  const margin = canCost
    ? {
        contract: rows.reduce((a, r) => a + Number(r.contract_price ?? 0), 0),
        cost: rows.reduce((a, r) => a + Number(r.total_cost ?? 0), 0),
        jobs: rows.length,
      }
    : null;

  return {
    jobsToday: jobsToday ?? 0,
    crewToday: onToday.size,
    overdue: overdue ?? [],
    unaccepted: live.filter((a) => a.acceptance_status === 'pending').length,
    unassigned: todayIds.filter((id) => !live.some((a) => a.job_id === id)).length,
    awaitingApproval: awaitingApproval ?? [],
    awaitingClose: awaitingClose ?? [],
    decisions: canDecide ? await decisionCount(session) : 0,
    margin,
    missingPay,
    kitOverdue: kitOverdue ?? 0,
    lowStock,
    mileageKm: session.can('mileage.view_all')
      ? (mileage ?? [])
          .filter((m) => m.is_business)
          .reduce((a, m) => a + Number(m.distance ?? 0), 0)
      : null,
    byCategory,
  };
}

/**
 * The four queues somebody with the right flags owes an answer to.
 *
 * Exported because the masthead badge counts the same thing, and it used to
 * count it with its own copy of this query — which drifted: the badge
 * included draft change orders and the dashboard did not, so the nav said 2
 * and the tile beside it said 1. One number, one definition.
 *
 * A draft change order is waiting on a manager to price it; a presented one
 * is with the customer but still the manager's to chase and record. Both are
 * work somebody in the office owes.
 */
export async function decisionCount(session: Session): Promise<number> {
  if (
    !session.can('reschedule.decide') &&
    !session.can('timeoff.manage') &&
    !session.can('purchase.approve') &&
    !session.can('changeorder.manage')
  ) {
    return 0;
  }
  const supabase = await supabaseServer();
  const count = { count: 'exact' as const, head: true };
  const [moves, off, buys, changes] = await Promise.all([
    session.can('reschedule.decide')
      ? supabase.from('reschedule_requests').select('id', count).eq('status', 'pending')
      : Promise.resolve({ count: 0 }),
    session.can('timeoff.manage')
      ? supabase.from('time_off').select('id', count).eq('status', 'requested')
      : Promise.resolve({ count: 0 }),
    session.can('purchase.approve')
      ? supabase
          .from('purchase_requests')
          .select('id', count)
          .in('status', ['submitted', 'under_review'])
      : Promise.resolve({ count: 0 }),
    session.can('changeorder.manage')
      ? supabase.from('change_orders_safe').select('id', count).in('status', ['draft', 'presented'])
      : Promise.resolve({ count: 0 }),
  ]);
  return (moves.count ?? 0) + (off.count ?? 0) + (buys.count ?? 0) + (changes.count ?? 0);
}

export { FINISHED, LIVE };
