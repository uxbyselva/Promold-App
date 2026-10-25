'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  dayOf,
  daySpan,
  isoDay,
  today,
  clock,
  longDate,
  monthName,
  siteAddress,
} from '@/lib/format';

export type Job = {
  id: string;
  job_number: string;
  title: string;
  status: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  site_id: string | null;
  customer_id: string | null;
};
export type Visit = { id: string; job_id: string; scheduled_start: string; status: string };
type Site = { id: string; label: string; address_line1: string | null; city: string | null };
type Customer = { id: string; name: string };
type Assignment = { id: string; job_id: string; acceptance_status: string };

const STEP_LABEL: Record<string, string> = {
  draft: 'Not sent yet',
  scheduled: 'Scheduled',
  assigned: 'Assigned',
  accepted: 'Accepted',
  in_progress: 'Working',
  work_complete: 'Done',
  approved: 'Approved',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export function JobsView({
  jobs,
  visits,
  sites,
  customers,
  assignments,
}: {
  jobs: Job[];
  visits: Visit[];
  sites: Site[];
  customers: Customer[];
  assignments: Assignment[];
}) {
  // The list is the board and the board is the default. A calendar answers
  // "what is on the 14th"; the question somebody opens this app to ask,
  // standing in a van at eight in the morning, is "what am I doing and what
  // have I not finished" — which is a list, in that order.
  const [view, setView] = useState<'list' | 'cal'>('list');
  const now = new Date();
  const [month, setMonth] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [selected, setSelected] = useState(today());

  const siteOf = (id: string | null) => sites.find((s) => s.id === id);
  const customerOf = (id: string | null) => customers.find((c) => c.id === id);
  const acceptanceOf = (jobId: string) =>
    assignments.find((a) => a.job_id === jobId)?.acceptance_status ?? 'accepted';

  /**
   * Which days each job occupies.
   *
   * Visits are authoritative when they exist. When they do not — a job someone
   * booked straight onto the calendar — fall back to walking the scheduled
   * range, so a multi-day job is never drawn as a single dot on day one.
   */
  const daysByJob = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const job of jobs) {
      const own = visits.filter((v) => v.job_id === job.id).map((v) => dayOf(v.scheduled_start));
      if (own.length) {
        map.set(job.id, [...new Set(own)]);
        continue;
      }
      if (!job.scheduled_start) {
        map.set(job.id, []);
        continue;
      }
      const days = daySpan(job.scheduled_start, job.scheduled_end);
      map.set(job.id, days.length ? days : [dayOf(job.scheduled_start)]);
    }
    return map;
  }, [jobs, visits]);

  const jobsOn = (iso: string) => jobs.filter((j) => daysByJob.get(j.id)?.includes(iso));

  const card = (job: Job) => {
    const acceptance = acceptanceOf(job.id);
    const site = siteOf(job.site_id);
    const customer = customerOf(job.customer_id);
    const pending = acceptance === 'pending';
    return (
      <Link key={job.id} className="job" href={`/my/jobs/${job.id}`}>
        <span className="stripe" data-s={pending ? 'assigned' : job.status} />
        <span className="job-body">
          <span className="row wrap" style={{ gap: 8 }}>
            <span className="mono" style={{ fontSize: 12, color: 'var(--faint)' }}>
              {job.job_number}
            </span>
            {pending ? (
              <span className="pill" data-t="warn">
                <span className="dot" />
                Needs your answer
              </span>
            ) : acceptance === 'reschedule_requested' ? (
              <span className="pill" data-t="accent">
                Reschedule asked
              </span>
            ) : (
              <span className="pill" data-t={job.status === 'in_progress' ? 'ok' : undefined}>
                {STEP_LABEL[job.status] ?? job.status}
              </span>
            )}
          </span>
          <h3>{job.title}</h3>
          <span className="sub">
            {siteAddress(site, true) || site?.label || 'No site'}
            {customer ? <br /> : null}
            {customer?.name}
          </span>
          <span
            className="row between"
            style={{ paddingTop: 8, borderTop: '1px solid var(--line)', fontSize: 13.5 }}
          >
            <span className="muted">
              {job.scheduled_start ? longDate(dayOf(job.scheduled_start)) : 'Not scheduled'}
            </span>
            <span className="mono num">
              {clock(job.scheduled_start)}
              {job.scheduled_end ? `–${clock(job.scheduled_end)}` : ''}
            </span>
          </span>
        </span>
      </Link>
    );
  };

  if (jobs.length === 0) {
    return (
      <div className="panel">
        <h3>Nothing assigned</h3>
        <p className="sub">
          You are not on any jobs yet. They turn up here the moment someone puts you on one.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="seg" role="tablist" aria-label="View">
        <button role="tab" aria-selected={view === 'list'} onClick={() => setView('list')}>
          List
        </button>
        <button role="tab" aria-selected={view === 'cal'} onClick={() => setView('cal')}>
          Calendar
        </button>
      </div>

      {view === 'cal' ? (
        <>
          <MonthGrid
            month={month}
            selected={selected}
            onSelect={setSelected}
            onMove={(delta) => {
              const d = new Date(month.y, month.m + delta, 1);
              setMonth({ y: d.getFullYear(), m: d.getMonth() });
            }}
            dotsFor={(iso) =>
              jobsOn(iso).map((j) =>
                acceptanceOf(j.id) === 'pending'
                  ? 'ask'
                  : j.status === 'work_complete' || j.status === 'closed'
                    ? 'done'
                    : 'on',
              )
            }
          />
          <p className="lbl" style={{ marginTop: 4 }}>
            {longDate(selected)}
          </p>
          {jobsOn(selected).length ? (
            jobsOn(selected).map(card)
          ) : (
            <p className="empty">Nothing on this day.</p>
          )}
        </>
      ) : (
        <ListView jobs={jobs} card={card} acceptanceOf={acceptanceOf} />
      )}
    </>
  );
}

/** Finished with, as far as the crew are concerned. */
const FINISHED = ['work_complete', 'approved', 'closed', 'cancelled'];

/**
 * The board, as a list of what is left to do.
 *
 * It used to be three groups by date — today, coming up, earlier — which put
 * a job finished last Tuesday in the same pile as one from last Tuesday that
 * nobody ever started. Those are opposite things: one is a record and the
 * other is work.
 *
 * So finished jobs come out of the date groups entirely and go to the bottom,
 * folded away, the way a to-do list treats a ticked item. What is left above
 * is only work: anything still waiting on an answer first, then overdue, then
 * today, then what is coming.
 *
 * The order is deliberate and is not chronological. Overdue sits ABOVE today,
 * because a job that should have happened and did not is the thing most
 * likely to have been forgotten, and the bottom of a list is where things go
 * to be forgotten.
 */
function ListView({
  jobs,
  card,
  acceptanceOf,
}: {
  jobs: Job[];
  card: (j: Job) => React.ReactNode;
  acceptanceOf: (jobId: string) => string;
}) {
  const [showDone, setShowDone] = useState(false);
  const t = today();

  const open = jobs.filter((j) => !FINISHED.includes(j.status));
  const done = jobs
    .filter((j) => FINISHED.includes(j.status))
    .sort((a, b) => (b.scheduled_start ?? '').localeCompare(a.scheduled_start ?? ''));

  const unanswered = open.filter((j) => acceptanceOf(j.id) === 'pending');
  const rest = open.filter((j) => acceptanceOf(j.id) !== 'pending');
  const on = (j: Job, test: (d: string) => boolean) =>
    j.scheduled_start ? test(dayOf(j.scheduled_start)) : false;

  const sections: [string, Job[]][] = [
    ['Needs your answer', unanswered],
    ['Overdue', rest.filter((j) => on(j, (d) => d < t)).reverse()],
    ['Today', rest.filter((j) => on(j, (d) => d === t))],
    ['Coming up', rest.filter((j) => on(j, (d) => d > t))],
    ['Not scheduled', rest.filter((j) => !j.scheduled_start)],
  ];

  const nothingOpen = sections.every(([, rows]) => rows.length === 0);

  return (
    <>
      {sections.map(([title, rows]) =>
        rows.length ? (
          <div key={title} className="stack tight">
            <p className="lbl" style={{ marginTop: 4 }}>
              {title} · {rows.length}
            </p>
            {rows.map(card)}
          </div>
        ) : null,
      )}

      {nothingOpen ? (
        <div className="panel">
          <h3>Nothing outstanding</h3>
          <p className="sub">
            {done.length
              ? 'Everything you are on is finished. The ones below are the record of it.'
              : 'Nothing assigned to you right now.'}
          </p>
        </div>
      ) : null}

      {done.length ? (
        <div className="stack tight">
          <button
            className="btn ghost sm"
            style={{ marginTop: 10, alignSelf: 'flex-start' }}
            aria-expanded={showDone}
            onClick={() => setShowDone((v) => !v)}
          >
            {showDone ? 'Hide' : 'Show'} finished · {done.length}
          </button>
          {showDone ? done.map(card) : null}
        </div>
      ) : null}
    </>
  );
}

function MonthGrid({
  month,
  selected,
  onSelect,
  onMove,
  dotsFor,
}: {
  month: { y: number; m: number };
  selected: string;
  onSelect: (iso: string) => void;
  onMove: (delta: number) => void;
  dotsFor: (iso: string) => string[];
}) {
  const first = new Date(month.y, month.m, 1);
  const lead = (first.getDay() + 6) % 7; // Monday-first
  const start = new Date(month.y, month.m, 1 - lead);
  const t = today();

  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return { iso: isoDay(d), n: d.getDate(), out: d.getMonth() !== month.m };
  }).filter((c, i) => i < 35 || !c.out || dotsFor(c.iso).length > 0);

  return (
    <div className="cal">
      <div className="cal-head">
        <h2>{monthName(`${month.y}-${String(month.m + 1).padStart(2, '0')}`)}</h2>
        <div className="cal-nav">
          <button onClick={() => onMove(-1)} aria-label="Previous month">
            ‹
          </button>
          <button onClick={() => onMove(1)} aria-label="Next month">
            ›
          </button>
        </div>
      </div>
      <div className="dow">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="grid">
        {cells.map((c) => {
          const dots = dotsFor(c.iso).slice(0, 3);
          return (
            <button
              key={c.iso}
              className={`cell${c.out ? ' out' : ''}${c.iso === t ? ' today' : ''}`}
              aria-pressed={c.iso === selected}
              aria-label={longDate(c.iso)}
              onClick={() => onSelect(c.iso)}
            >
              {c.n}
              <span className="d">
                {dots.map((kind, i) => (
                  <i key={i} className={kind === 'on' ? undefined : kind} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
