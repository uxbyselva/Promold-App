import Link from 'next/link';
import { clock, dayOf, longDate, money, siteAddress } from '@/lib/format';

type Job = {
  id: string;
  job_number: string;
  title: string;
  status: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  site_id: string | null;
};
type Site = { id: string; label: string; address_line1: string | null; city: string | null };
type Assignment = { id: string; job_id: string; acceptance_status: string };
type Kit = {
  equipment_id: string;
  asset_tag: string;
  name: string;
  location_status: string;
  expected_end_at: string | null;
};
type Change = {
  id: string;
  job_id: string;
  seq: number;
  title: string;
  status: string;
  /** Null unless the viewer holds price.view — change_orders_safe masks it. */
  amount: number | null;
};

const WORKING = ['accepted', 'en_route', 'on_site', 'in_progress'];
const DONE = ['work_complete', 'approved', 'closed', 'cancelled'];

const DECISION: Record<string, [string, string]> = {
  draft: ['Not sent yet', ''],
  presented: ['With the customer', 'warn'],
  approved: ['Agreed', 'ok'],
  rejected: ['Turned down', 'crit'],
  cancelled: ['Dropped', ''],
};

/**
 * The four things somebody asks before they turn the key.
 *
 * Not a second copy of the board: where am I going, is anybody waiting on
 * me, what am I in the middle of, and what of ours is in my van. Everything
 * else is a tap away on the tab bar.
 */
export function CrewToday({
  jobs,
  sites,
  assignments,
  kit,
  changes,
  todayFrom,
  todayTo,
}: {
  jobs: Job[];
  sites: Site[];
  assignments: Assignment[];
  kit: Kit[];
  changes: Change[];
  todayFrom: string;
  todayTo: string;
}) {
  const siteOf = (id: string | null) => sites.find((s) => s.id === id) ?? null;
  const where = (j: Job) => {
    const s = siteOf(j.site_id);
    return siteAddress(s, true) || s?.label || 'No address';
  };

  const open = jobs.filter((j) => !DONE.includes(j.status));
  const onToday = open.filter(
    (j) => j.scheduled_start && j.scheduled_start >= todayFrom && j.scheduled_start <= todayTo,
  );
  const working = open.filter((j) => WORKING.includes(j.status) && j.status !== 'accepted');
  const pending = assignments.filter((a) => a.acceptance_status === 'pending');
  // The next thing to turn up at: today's first, else the soonest ahead.
  const next =
    onToday.find((j) => !DONE.includes(j.status)) ??
    open.find((j) => j.scheduled_start && j.scheduled_start > todayTo) ??
    null;

  return (
    <>
      {next ? (
        <Link className="panel" href={`/my/jobs/${next.id}`} style={{ display: 'block' }}>
          <p className="lbl" style={{ marginTop: 0 }}>
            Next
          </p>
          <h3 style={{ margin: '2px 0 2px' }}>{where(next)}</h3>
          <p className="sub" style={{ margin: 0 }}>
            {next.title}
          </p>
          <p className="mono" style={{ margin: '6px 0 0', fontSize: 13.5 }}>
            {next.scheduled_start ? longDate(dayOf(next.scheduled_start)!) : 'Not scheduled'}
            {next.scheduled_start ? ` · ${clock(next.scheduled_start)}` : ''}
            {next.scheduled_end ? `–${clock(next.scheduled_end)}` : ''}
          </p>
        </Link>
      ) : (
        <div className="panel">
          <h3>Nothing booked</h3>
          <p className="sub">
            You are not on anything yet. It turns up here the moment somebody puts you on a job.
          </p>
        </div>
      )}

      <div className="tiles" style={{ marginTop: 12 }}>
        <Link className="tile" href="/my/jobs">
          <span className="lbl">Needs your answer</span>
          <span className="fig mono" style={pending.length ? { color: 'var(--warn)' } : undefined}>
            {pending.length}
          </span>
          <span className="sub">{pending.length ? 'accept or decline' : 'nothing waiting'}</span>
        </Link>
        <Link className="tile" href="/my/jobs">
          <span className="lbl">On site now</span>
          <span className="fig mono">{working.length}</span>
          <span className="sub">{working.length ? 'under way' : 'nothing started'}</span>
        </Link>
        <Link className="tile" href="/my/store">
          <span className="lbl">Kit you have out</span>
          <span className="fig mono">{kit.length}</span>
          <span className="sub">{kit.length ? 'signed out to you' : 'nothing of ours'}</span>
        </Link>
        <Link className="tile" href="/my/jobs">
          <span className="lbl">Today</span>
          <span className="fig mono">{onToday.length}</span>
          <span className="sub">
            {onToday.length === 1 ? 'job' : 'jobs'} on {longDate(dayOf(todayFrom)!)}
          </span>
        </Link>
      </div>

      {onToday.length ? (
        <div className="stack tight" style={{ marginTop: 12 }}>
          <p className="lbl">Today · {onToday.length}</p>
          {onToday.map((j) => (
            // `.job` is a two-column grid: a 4px status stripe, then the
            // body. Putting the contents straight in drops each one into a
            // grid cell of its own, which is how the job number ended up
            // printed over the address and the title wrapped a word a line.
            <Link key={j.id} className="job" href={`/my/jobs/${j.id}`}>
              <span className="stripe" data-s={j.status} />
              <span className="job-body">
                <span className="row between">
                  <span className="mono" style={{ fontSize: 12.5, color: 'var(--faint)' }}>
                    {j.job_number}
                  </span>
                  <span className="mono num" style={{ fontSize: 13 }}>
                    {clock(j.scheduled_start)}
                  </span>
                </span>
                <h3 style={{ margin: 0, fontSize: 15.5 }}>{where(j)}</h3>
                <span className="sub">{j.title}</span>
              </span>
            </Link>
          ))}
        </div>
      ) : null}

      {kit.length ? (
        <div className="panel" style={{ marginTop: 12 }}>
          <p className="lbl" style={{ marginTop: 0 }}>
            In your van
          </p>
          {kit.map((k) => (
            <div key={k.equipment_id} className="row between">
              <span className="row" style={{ gap: 8 }}>
                <span className="mono" style={{ fontSize: 13 }}>
                  {k.asset_tag}
                </span>
                <span className="sub">{k.name}</span>
              </span>
              {k.expected_end_at ? (
                <span className="sub mono">till {longDate(dayOf(k.expected_end_at)!)}</span>
              ) : (
                <span className="pill" data-t="warn">
                  No pickup set
                </span>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {changes.length ? (
        <div className="panel" style={{ marginTop: 12 }}>
          <p className="lbl" style={{ marginTop: 0 }}>
            Extra work you raised
          </p>
          <p className="sub" style={{ marginBottom: 8 }}>
            What the office did with it. You write it up; a manager prices it; the customer decides.
          </p>
          {changes.map((c) => {
            const [label, tone] = DECISION[c.status] ?? [c.status, ''];
            return (
              <Link key={c.id} className="row between" href={`/my/jobs/${c.job_id}`}>
                <span>
                  <span className="mono" style={{ fontSize: 12.5, color: 'var(--faint)' }}>
                    #{c.seq}
                  </span>{' '}
                  {c.title}
                </span>
                <span className="row" style={{ gap: 8 }}>
                  {c.amount !== null ? <span className="mono num">{money(c.amount)}</span> : null}
                  <span className="pill" data-t={tone || undefined}>
                    {label}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
