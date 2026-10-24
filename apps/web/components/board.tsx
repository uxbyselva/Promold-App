'use client';

import { useRouter } from 'next/navigation';
import { clock, dayOf, longDate, money, siteAddress, today } from '@/lib/format';

type Job = {
  id: string;
  job_number: string;
  title: string;
  status: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  site_id: string | null;
  /** Null unless the signed-in user holds price.view — jobs_safe masks it. */
  quoted_price: number | null;
};
type Assignment = { job_id: string; user_id: string; acceptance_status: string };
type Site = {
  id: string;
  label: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
};
type Person = { id: string; full_name: string };
type TimeOff = { user_id: string; kind: string; starts_at: string; ends_at: string };

/**
 * The columns, in the order work moves through them.
 *
 * Deliberately five and not twelve. The database has twelve statuses because
 * it has to tell `en_route` from `on_site`; the office has five questions,
 * and a column per status would mean scrolling sideways past four empty ones
 * to find the full one.
 */
const LANES = [
  {
    key: 'unassigned',
    name: 'Needs a crew',
    hint: 'Booked, nobody on it yet.',
  },
  {
    key: 'waiting',
    name: 'Waiting to accept',
    hint: 'Sent to a crew. Not everybody has said yes.',
  },
  { key: 'ready', name: 'Ready', hint: 'Accepted, not started.' },
  { key: 'onsite', name: 'On site', hint: 'Under way right now.' },
  { key: 'finished', name: 'Finished', hint: 'Work done, waiting on you.' },
] as const;

type LaneKey = (typeof LANES)[number]['key'];

const ON_SITE = ['en_route', 'on_site', 'in_progress', 'blocked'];

/** Which column a job belongs in: where it has got to, then who has it. */
function laneOf(job: Job, mine: Assignment[]): LaneKey {
  if (job.status === 'work_complete') return 'finished';
  if (ON_SITE.includes(job.status)) return 'onsite';
  if (mine.length === 0) return 'unassigned';
  return mine.every((a) => a.acceptance_status === 'accepted') ? 'ready' : 'waiting';
}

export function Board({
  jobs,
  assignments,
  sites,
  people,
  timeOff,
}: {
  jobs: Job[];
  assignments: Assignment[];
  sites: Site[];
  people: Person[];
  timeOff: TimeOff[];
}) {
  const router = useRouter();
  const now = today();

  const nameOf = (id: string) => people.find((p) => p.id === id)?.full_name ?? 'Someone';
  const siteOf = (id: string | null) => sites.find((s) => s.id === id) ?? null;

  // Price is masked for anyone without price.view, so it only appears for the
  // people it is meant for rather than leaving a row of blanks.
  const showsPrice = jobs.some((j) => j.quoted_price !== null);

  const cards = jobs.map((job) => {
    const mine = assignments.filter((a) => a.job_id === job.id);
    const day = job.scheduled_start ? dayOf(job.scheduled_start) : null;
    return {
      job,
      mine,
      lane: laneOf(job, mine),
      day,
      // Past its day and still not finished. The timeline hid these by
      // showing one date at a time, which is how a job goes quiet.
      late: day !== null && day < now && job.status !== 'work_complete',
      declined: mine.some((a) => a.acceptance_status === 'declined'),
      reschedule: mine.some((a) => a.acceptance_status === 'reschedule_requested'),
    };
  });

  const away = timeOff.map((t) => ({ ...t, name: nameOf(t.user_id) }));

  return (
    <>
      <div className="page-head" style={{ padding: '14px 18px 0' }}>
        <div>
          <h1>The board</h1>
          <p>
            Every job that is not signed off yet, by where it has got to. Approved and closed jobs
            are in <a href="/jobs">the job list</a>.
          </p>
        </div>
      </div>

      {away.length ? (
        <p className="kb-away">
          <b>Away today:</b>{' '}
          {away.map((a) => `${a.name} (${a.kind.replace(/_/g, ' ')})`).join(', ')}
        </p>
      ) : null}

      <div className="kb">
        {LANES.map((lane) => {
          const inLane = cards.filter((c) => c.lane === lane.key);
          return (
            <section key={lane.key} className="kb-lane" aria-label={lane.name}>
              <header>
                <h2>{lane.name}</h2>
                <span className="kb-count">{inLane.length}</span>
              </header>

              {inLane.length === 0 ? (
                <p className="kb-empty">{lane.hint}</p>
              ) : (
                inLane.map(({ job, mine, day, late, declined, reschedule }) => {
                  const site = siteOf(job.site_id);
                  return (
                    <article
                      key={job.id}
                      className="kb-card"
                      data-late={late ? 1 : 0}
                      tabIndex={0}
                      role="link"
                      onClick={() => router.push(`/jobs/${job.id}`)}
                      onKeyDown={(e) =>
                        e.key === 'Enter' ? router.push(`/jobs/${job.id}`) : undefined
                      }
                    >
                      <span className="kb-num mono">{job.job_number}</span>

                      {/* The address is the heading on every job screen, so
                          it is the heading here too. */}
                      <p className="kb-where">
                        {siteAddress(site, true) || site?.label || 'No address'}
                      </p>
                      <p className="kb-what">{job.title}</p>

                      {/* Two spans, so the line folds between the date and
                          the hours rather than through "03:00–11:00". */}
                      <p className="kb-when mono">
                        <span>{day ? longDate(day) : 'Not scheduled'}</span>
                        {job.scheduled_start ? (
                          <>
                            {' · '}
                            <span>
                              {clock(job.scheduled_start)}
                              {job.scheduled_end ? `–${clock(job.scheduled_end)}` : ''}
                            </span>
                          </>
                        ) : null}
                      </p>

                      {mine.length ? (
                        <p className="kb-who">
                          {[...new Set(mine.map((a) => a.user_id))].map(nameOf).join(', ')}
                        </p>
                      ) : null}

                      <p className="kb-flags">
                        {late ? <span className="kb-flag late">Overdue</span> : null}
                        {job.status === 'blocked' ? (
                          <span className="kb-flag late">Blocked</span>
                        ) : null}
                        {declined ? <span className="kb-flag late">Declined</span> : null}
                        {reschedule ? (
                          <span className="kb-flag warn">Wants another day</span>
                        ) : null}
                        {showsPrice && job.quoted_price !== null ? (
                          <span className="kb-flag mono num">{money(job.quoted_price)}</span>
                        ) : null}
                      </p>
                    </article>
                  );
                })
              )}
            </section>
          );
        })}
      </div>

      {jobs.length === 0 ? (
        <div className="card" style={{ padding: 18, margin: '0 18px 24px' }}>
          <p className="lbl" style={{ marginBottom: 6 }}>
            Nothing live
          </p>
          <p style={{ color: 'var(--muted)' }}>
            Every job is signed off or cancelled. Book one from the calendar and it lands in the
            first column.
          </p>
        </div>
      ) : null}
    </>
  );
}
