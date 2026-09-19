'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { clock, dayOf, longDate, money } from '@/lib/format';

type Job = {
  id: string;
  job_number: string;
  title: string;
  status: string;
  priority: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  site_id: string | null;
  customer_id: string | null;
  quoted_price: number | null;
};

const STATUSES = [
  ['all', 'All'],
  ['scheduled', 'Scheduled'],
  ['assigned', 'Assigned'],
  ['accepted', 'Accepted'],
  ['in_progress', 'Working'],
  ['work_complete', 'Done'],
  ['approved', 'Approved'],
  ['closed', 'Closed'],
  ['cancelled', 'Cancelled'],
] as const;

const TONE: Record<string, 'ok' | 'warn' | 'crit' | 'accent' | undefined> = {
  in_progress: 'ok',
  assigned: 'warn',
  accepted: 'accent',
  cancelled: 'crit',
};

export function JobsTable({
  jobs,
  assignments,
  sites,
  customers,
  people,
  status,
  q,
  showPrice,
}: {
  jobs: Job[];
  assignments: { job_id: string; user_id: string; acceptance_status: string }[];
  sites: { id: string; label: string }[];
  customers: { id: string; name: string }[];
  people: { id: string; full_name: string }[];
  status: string;
  q: string;
  showPrice: boolean;
}) {
  const router = useRouter();

  const go = (next: { status?: string; q?: string }) => {
    const params = new URLSearchParams();
    const s = next.status ?? status;
    const query = next.q ?? q;
    if (s && s !== 'all') params.set('status', s);
    if (query) params.set('q', query);
    router.push(`/jobs${params.size ? `?${params}` : ''}`);
  };

  const crewOf = (jobId: string) =>
    assignments
      .filter((a) => a.job_id === jobId)
      .map((a) => ({
        name: people.find((p) => p.id === a.user_id)?.full_name ?? '—',
        pending: a.acceptance_status === 'pending',
      }));

  return (
    <>
      <div className="row wrap" style={{ gap: 8 }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: new FormData(e.currentTarget).get('q') as string });
          }}
          className="row"
          style={{ gap: 8 }}
        >
          <input
            name="q"
            defaultValue={q}
            placeholder="Job number or title"
            aria-label="Search jobs"
            style={{
              font: 'inherit',
              padding: '8px 11px',
              borderRadius: 8,
              border: '1px solid var(--line-strong)',
              background: 'var(--surface-2)',
              color: 'var(--ink)',
              minWidth: 220,
            }}
          />
          <button className="btn ghost sm" type="submit">
            Search
          </button>
        </form>
        <div className="row wrap" style={{ gap: 4, marginLeft: 'auto' }}>
          {STATUSES.map(([key, label]) => (
            <button
              key={key}
              className={`btn sm ${status === key ? '' : 'ghost'}`}
              onClick={() => go({ status: key })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="box">
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Customer</th>
                <th>Site</th>
                <th>When</th>
                <th>Crew</th>
                <th>State</th>
                {showPrice ? <th className="r">Price</th> : null}
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => {
                const crew = crewOf(j.id);
                return (
                  <tr key={j.id}>
                    <td>
                      <Link href={`/jobs/${j.id}`} className="mono" style={{ fontSize: 13 }}>
                        {j.job_number}
                      </Link>
                      <br />
                      <span className="sub">{j.title}</span>
                    </td>
                    <td className="sub">
                      {customers.find((c) => c.id === j.customer_id)?.name ?? '—'}
                    </td>
                    <td className="sub">{sites.find((s) => s.id === j.site_id)?.label ?? '—'}</td>
                    <td className="sub">
                      {j.scheduled_start ? (
                        <>
                          {longDate(dayOf(j.scheduled_start))}
                          <br />
                          <span className="mono num">
                            {clock(j.scheduled_start)}
                            {j.scheduled_end ? `–${clock(j.scheduled_end)}` : ''}
                          </span>
                        </>
                      ) : (
                        'Not scheduled'
                      )}
                    </td>
                    <td>
                      {crew.length === 0 ? (
                        <span className="pill" data-t="warn">
                          Nobody yet
                        </span>
                      ) : (
                        <span className="sub">
                          {crew.map((c) => c.name).join(', ')}
                          {crew.some((c) => c.pending) ? (
                            <>
                              <br />
                              <span className="pill" data-t="warn">
                                {crew.filter((c) => c.pending).length} not answered
                              </span>
                            </>
                          ) : null}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="pill" data-t={TONE[j.status]}>
                        {j.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    {showPrice ? <td className="r mono num">{money(j.quoted_price)}</td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {jobs.length === 0 ? <p className="empty">Nothing matches.</p> : null}
      </div>
    </>
  );
}
